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

    async resetWatchlist() {
      const users = db.getUsers();
      const errors = [];

      // Delete subscriptions known to the DB
      for (const user of users) {
        try {
          if (user.online_subscription_id) await twitchClient.deleteSubscription(user.online_subscription_id);
        } catch (err) {
          errors.push(`Failed to delete online subscription for ${user.username}: ${err.message}`);
        }
        try {
          if (user.offline_subscription_id) await twitchClient.deleteSubscription(user.offline_subscription_id);
        } catch (err) {
          errors.push(`Failed to delete offline subscription for ${user.username}: ${err.message}`);
        }
      }

      // Also fetch and delete ALL subscriptions from Twitch to handle orphans
      let twitchDeletedCount = 0;
      try {
        const allSubs = await twitchClient.listSubscriptions();
        for (const sub of allSubs) {
          try {
            await twitchClient.deleteSubscription(sub.id);
            twitchDeletedCount++;
          } catch (err) {
            errors.push(`Failed to delete Twitch subscription ${sub.id}: ${err.message}`);
          }
        }
      } catch (err) {
        errors.push(`Failed to list Twitch subscriptions: ${err.message}`);
      }

      db.clearAll();

      const parts = [];
      if (users.length > 0) parts.push(`Removed ${users.length} user(s) from database.`);
      if (twitchDeletedCount > 0) parts.push(`Deleted ${twitchDeletedCount} Twitch subscription(s).`);
      if (parts.length === 0) parts.push('No users or subscriptions to remove.');

      const summary = parts.join(' ');
      if (errors.length > 0) {
        return { content: [{ type: 'text', text: `${summary}\nWarnings:\n${errors.join('\n')}` }] };
      }
      return { content: [{ type: 'text', text: summary }] };
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
    'reset_watchlist',
    'Remove all watched users and delete their Twitch EventSub subscriptions',
    {},
    async () => handlers.resetWatchlist()
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
