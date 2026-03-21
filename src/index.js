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
const mcpServer = createMcpServer({ db, twitchClient, pokeClient });

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

console.log('[startup] Fetching Twitch auth token...');
await auth.getToken();
console.log('[startup] Connecting to Twitch EventSub WebSocket...');
twitchClient.connect();

if (mcpTransport === 'stdio') {
  const stdioTransport = new StdioServerTransport();
  await mcpServer.connect(stdioTransport);
  console.log('[startup] MCP server running on stdio');
} else {
  const app = express();
  app.use(express.json());

  const sessions = {};

  app.post('/mcp', async (req, res) => {
    try {
      const sessionId = req.headers['mcp-session-id'];
      let transport = sessions[sessionId];

      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
        });
        await mcpServer.connect(transport);
        sessions[transport.sessionId] = transport;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] Error handling POST:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const transport = sessions[sessionId];
    if (transport) {
      await transport.handleRequest(req, res);
    } else {
      res.status(400).json({ error: 'Invalid or missing session ID' });
    }
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const transport = sessions[sessionId];
    if (transport) {
      await transport.handleRequest(req, res);
      delete sessions[sessionId];
    } else {
      res.status(400).json({ error: 'Invalid or missing session ID' });
    }
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', twitchConnected: !!twitchClient.sessionId });
  });

  app.listen(port, () => {
    console.log(`[startup] MCP server running on http://0.0.0.0:${port}/mcp`);
  });
}
