import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function createToolHandlers({ db, twitchClient, pokeClient }) {
  return {
    async watchUser({ username }) {
      const lower = username.toLowerCase();
      if (db.getUser(lower)) {
        return { isError: true, content: [{ type: 'text', text: `User '${lower}' is already being watched.` }] };
      }
      const userId = await twitchClient.resolveUsername(lower);
      if (!userId) {
        return { isError: true, content: [{ type: 'text', text: `User '${lower}' not found on Twitch.` }] };
      }

      // Connect WebSocket if not already connected
      if (!twitchClient.connected) {
        await twitchClient.connectAndWait();
      }

      const onlineSubId = await twitchClient.createSubscription('stream.online', userId);
      const offlineSubId = await twitchClient.createSubscription('stream.offline', userId);
      db.addUser({
        username: lower,
        twitchUserId: userId,
        onlineSubscriptionId: onlineSubId,
        offlineSubscriptionId: offlineSubId,
      });
      return { content: [{ type: 'text', text: `Now watching '${lower}' (Twitch ID: ${userId}).` }] };
    },

    async unwatchUser({ username }) {
      const lower = username.toLowerCase();
      const user = db.getUser(lower);
      if (!user) {
        return { isError: true, content: [{ type: 'text', text: `User '${lower}' is not being watched.` }] };
      }
      if (user.online_subscription_id) await twitchClient.deleteSubscription(user.online_subscription_id);
      if (user.offline_subscription_id) await twitchClient.deleteSubscription(user.offline_subscription_id);
      db.removeUser(lower);

      // Disconnect WebSocket if no more users to watch
      if (db.getUsers().length === 0) {
        twitchClient.disconnect();
      }

      return { content: [{ type: 'text', text: `Stopped watching '${lower}'.` }] };
    },

    async listWatchedUsers() {
      const users = db.getUsers();
      if (users.length === 0) {
        return { content: [{ type: 'text', text: 'No users being watched.' }] };
      }
      const lines = users.map(u =>
        `- ${u.username}: ${u.status}${u.last_online_at ? ` (last online: ${u.last_online_at})` : ''}`
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },

    async configureWebhook({ condition, action }) {
      const result = await pokeClient.createWebhook({ condition, action });
      db.saveWebhookConfig({
        condition, action,
        webhookUrl: result.webhookUrl,
        webhookToken: result.webhookToken,
      });
      return { content: [{ type: 'text', text: `Webhook configured.\nCondition: ${condition}\nAction: ${action}` }] };
    },
  };
}

export function createMcpServer({ db, twitchClient, pokeClient }) {
  const server = new McpServer(
    { name: 'twitch-webhooks-mcp', version: '1.0.0' },
    { capabilities: { logging: {} } }
  );
  const handlers = createToolHandlers({ db, twitchClient, pokeClient });

  server.tool(
    'watch_user',
    'Start monitoring a Twitch user for going online',
    { username: z.string().describe('Twitch username to watch') },
    async ({ username }) => handlers.watchUser({ username })
  );

  server.tool(
    'unwatch_user',
    'Stop monitoring a Twitch user',
    { username: z.string().describe('Twitch username to stop watching') },
    async ({ username }) => handlers.unwatchUser({ username })
  );

  server.tool(
    'list_watched_users',
    'List all currently monitored Twitch users and their status',
    {},
    async () => handlers.listWatchedUsers()
  );

  server.tool(
    'configure_webhook',
    'Configure the Poke webhook that fires when a watched user goes live',
    {
      condition: z.string().describe('When this condition is met'),
      action: z.string().describe('What the Poke agent should do'),
    },
    async ({ condition, action }) => handlers.configureWebhook({ condition, action })
  );

  return server;
}
