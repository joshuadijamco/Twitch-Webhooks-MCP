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
const twitchClient = createTwitchClient({
  auth,
  webhookUrl: process.env.TWITCH_WEBHOOK_URL,
  webhookSecret: process.env.TWITCH_WEBHOOK_SECRET,
});
const pokeClient = createPokeClient({ apiKey: process.env.POKE_API_KEY });
const mcpDeps = { db, twitchClient, pokeClient };

// Handle stream.online events — fetch stream details and fire Poke webhook
async function handleStreamOnline(event) {
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
}

function handleStreamOffline(event) {
  const username = event.broadcaster_user_login.toLowerCase();
  console.log(`[event] stream.offline: ${username}`);
  db.setUserOffline(username);
}

// Start MCP server first (so it's available even if Twitch auth fails)
if (mcpTransport === 'stdio') {
  const mcpServer = createMcpServer(mcpDeps);
  const stdioTransport = new StdioServerTransport();
  await mcpServer.connect(stdioTransport);
  console.log('[startup] MCP server running on stdio');
} else {
  const app = express();
  app.use('/mcp', express.json());

  // CORS headers required for MCP Inspector (browser-based)
  app.use('/mcp', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

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
        await transport.handleRequest(req, res, req.body);
        if (req.method === 'DELETE') {
          delete sessions[sessionId];
        }
        return;
      }

      // POST — existing session
      if (transport) {
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // POST — new session (initialize)
      const mcpServer = createMcpServer(mcpDeps);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });
      transport.onclose = () => {
        if (transport.sessionId) delete sessions[transport.sessionId];
      };
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      if (transport.sessionId) {
        sessions[transport.sessionId] = transport;
      }
    } catch (err) {
      console.error('[mcp] Error handling request:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Twitch EventSub webhook endpoint — receives stream events from Twitch
  app.post('/twitch/eventsub', express.raw({ type: 'application/json' }), (req, res) => {
    const messageId = req.headers['twitch-eventsub-message-id'];
    const timestamp = req.headers['twitch-eventsub-message-timestamp'];
    const signature = req.headers['twitch-eventsub-message-signature'];
    const messageType = req.headers['twitch-eventsub-message-type'];
    const rawBody = req.body.toString();

    if (!twitchClient.verifySignature(messageId, timestamp, rawBody, signature)) {
      console.warn('[twitch-eventsub] Invalid signature, rejecting');
      res.status(403).send('Invalid signature');
      return;
    }

    const body = JSON.parse(rawBody);

    // Twitch sends a challenge on subscription creation — echo it back
    if (messageType === 'webhook_callback_verification') {
      console.log(`[twitch-eventsub] Verification challenge for ${body.subscription.type}`);
      res.set('Content-Type', 'text/plain').status(200).send(body.challenge);
      return;
    }

    // Revocation — Twitch removed the subscription
    if (messageType === 'revocation') {
      console.warn(`[twitch-eventsub] Subscription revoked: ${body.subscription.type} for ${body.subscription.condition.broadcaster_user_id}`);
      res.status(204).end();
      return;
    }

    // Notification — actual event
    if (messageType === 'notification') {
      const subType = body.subscription.type;
      if (subType === 'stream.online') {
        handleStreamOnline(body.event);
      } else if (subType === 'stream.offline') {
        handleStreamOffline(body.event);
      }
      res.status(204).end();
      return;
    }

    res.status(204).end();
  });

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.listen(port, () => {
    console.log(`[startup] MCP server running on http://0.0.0.0:${port}/mcp`);
    console.log(`[startup] Twitch EventSub webhook at http://0.0.0.0:${port}/twitch/eventsub`);
  });
}

// Fetch Twitch auth token (non-blocking)
try {
  console.log('[startup] Fetching Twitch auth token...');
  await auth.getToken();
  console.log('[startup] Twitch auth OK');
} catch (err) {
  console.error(`[startup] Twitch auth failed: ${err.message}`);
  console.error('[startup] MCP server is running but Twitch features will fail until auth succeeds');
}
