import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createDb } from './db.js';
import { createTwitchAuth } from './twitch-auth.js';
import { createTwitchClient } from './twitch-client.js';
import { createPokeClient } from './poke-client.js';
import { createMcpServer } from './mcp-server.js';

const mcpTransport = process.env.MCP_TRANSPORT || 'http';
const port = parseInt(process.env.PORT || '3000', 10);

mkdirSync('data', { recursive: true });

const db = createDb('data/twitch-webhooks.db');
const auth = createTwitchAuth({
  clientId: process.env.TWITCH_CLIENT_ID,
  clientSecret: process.env.TWITCH_CLIENT_SECRET,
});
const twitchClient = createTwitchClient({ auth });
const pokeClient = createPokeClient({ apiKey: process.env.POKE_API_KEY });
const mcpDeps = { db, twitchClient, pokeClient };

// Register Twitch event handlers
twitchClient.onStreamOnline(async (event) => {
  const username = event.broadcaster_user_login.toLowerCase();
  console.log(`[event] stream.online: ${username}`);
  db.setUserOnline(username);

  const config = db.getWebhookConfig();
  if (!config) {
    console.warn('[event] No webhook configured, skipping Poke notification');
    return;
  }

  try {
    const streamInfo = await twitchClient.getStreamInfo(event.broadcaster_user_id);
    await pokeClient.sendWebhook({
      webhookUrl: config.webhook_url,
      webhookToken: config.webhook_token,
      data: {
        event: 'stream.online',
        username,
        stream_title: streamInfo?.title || 'Unknown',
        game: streamInfo?.game_name || 'Unknown',
        started_at: event.started_at,
      },
    });
    console.log(`[event] Poke webhook sent for ${username}`);
  } catch (err) {
    console.error(`[event] Failed to send Poke webhook for ${username}:`, err.message);
  }
});

twitchClient.onStreamOffline((event) => {
  const username = event.broadcaster_user_login.toLowerCase();
  console.log(`[event] stream.offline: ${username}`);
  db.setUserOffline(username);
});

twitchClient.onSessionReady(async () => {
  const users = db.getUsers();
  console.log(`[startup] Re-subscribing ${users.length} watched users`);
  for (const user of users) {
    try {
      const onlineSubId = await twitchClient.createSubscription('stream.online', user.twitch_user_id);
      const offlineSubId = await twitchClient.createSubscription('stream.offline', user.twitch_user_id);
      db.updateSubscriptionIds(user.username, onlineSubId, offlineSubId);
    } catch (err) {
      console.error(`[startup] Failed to re-subscribe ${user.username}:`, err.message);
    }
  }
});

// Start MCP server first (so it's available even if Twitch auth fails)
if (mcpTransport === 'stdio') {
  const mcpServer = createMcpServer(mcpDeps);
  const stdioTransport = new StdioServerTransport();
  await mcpServer.connect(stdioTransport);
  console.log('[startup] MCP server running on stdio');
} else {
  const app = express();

  const sessions = {};

  app.all('/mcp', async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'];
      let transport = sessions[sessionId];

      if (req.method === 'GET' || req.method === 'DELETE') {
        if (!transport) {
          res.status(400).json({ error: 'Invalid or missing session ID' });
          return;
        }
        await transport.handleRequest(req, res);
        if (req.method === 'DELETE') {
          delete sessions[sessionId];
        }
        return;
      }

      // POST — create new session if needed
      if (!transport) {
        const mcpServer = createMcpServer(mcpDeps);
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        await mcpServer.connect(transport);
        sessions[transport.sessionId] = transport;
      }

      await transport.handleRequest(req, res);
    } catch (err) {
      console.error('[mcp] Error handling request:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', twitchConnected: !!twitchClient.sessionId });
  });

  app.listen(port, () => {
    console.log(`[startup] MCP server running on http://0.0.0.0:${port}/mcp`);
  });
}

// Connect to Twitch in the background (non-blocking)
try {
  console.log('[startup] Fetching Twitch auth token...');
  await auth.getToken();
  console.log('[startup] Twitch auth OK');

  const existingUsers = db.getUsers();
  if (existingUsers.length > 0) {
    console.log(`[startup] ${existingUsers.length} watched users found, connecting to Twitch EventSub WebSocket...`);
    twitchClient.connect();
  } else {
    console.log('[startup] No watched users, WebSocket will connect when first user is added');
  }
} catch (err) {
  console.error(`[startup] Twitch auth failed: ${err.message}`);
  console.error('[startup] MCP server is running but Twitch features will fail until auth succeeds');
}
