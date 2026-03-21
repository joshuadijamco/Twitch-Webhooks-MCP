import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createToolHandlers } from '../src/mcp-server.js';

describe('mcp-server tool handlers', () => {
  let handlers;
  let mockDb;
  let mockTwitch;
  let mockPoke;

  beforeEach(() => {
    mockDb = {
      users: [],
      webhookConfig: null,
      addUser(u) {
        this.users.push({
          ...u, username: u.username, twitch_user_id: u.twitchUserId,
          status: 'offline', online_subscription_id: u.onlineSubscriptionId,
          offline_subscription_id: u.offlineSubscriptionId,
        });
      },
      removeUser(u) { this.users = this.users.filter(x => x.username !== u); },
      getUser(u) { return this.users.find(x => x.username === u) || null; },
      getUsers() { return this.users; },
      saveWebhookConfig(c) {
        this.webhookConfig = {
          condition: c.condition, action: c.action,
          webhook_url: c.webhookUrl, webhook_token: c.webhookToken,
        };
      },
      getWebhookConfig() { return this.webhookConfig; },
    };
    mockTwitch = {
      resolveUsername: async (u) => u === 'shroud' ? '12345' : null,
      createSubscription: async () => 'sub-id',
      deleteSubscription: async () => {},
      sessionId: 'session-abc',
    };
    mockPoke = {
      createWebhook: async ({ condition, action }) => ({
        triggerId: 't1', webhookUrl: 'https://poke.com/webhook', webhookToken: 'tok-123',
      }),
    };
    handlers = createToolHandlers({ db: mockDb, twitchClient: mockTwitch, pokeClient: mockPoke });
  });

  describe('watch_user', () => {
    it('should resolve username, create subscriptions, and store user', async () => {
      const result = await handlers.watchUser({ username: 'shroud' });
      assert.ok(result.content[0].text.includes('shroud'));
      assert.equal(mockDb.users.length, 1);
      assert.equal(mockDb.users[0].username, 'shroud');
    });

    it('should error if user not found on Twitch', async () => {
      const result = await handlers.watchUser({ username: 'nonexistent' });
      assert.ok(result.isError);
      assert.ok(result.content[0].text.includes('not found'));
    });

    it('should error if user already watched', async () => {
      await handlers.watchUser({ username: 'shroud' });
      const result = await handlers.watchUser({ username: 'shroud' });
      assert.ok(result.isError);
      assert.ok(result.content[0].text.includes('already'));
    });
  });

  describe('unwatch_user', () => {
    it('should remove user and delete subscriptions', async () => {
      await handlers.watchUser({ username: 'shroud' });
      const result = await handlers.unwatchUser({ username: 'shroud' });
      assert.ok(result.content[0].text.includes('shroud'));
      assert.equal(mockDb.users.length, 0);
    });

    it('should error if user not watched', async () => {
      const result = await handlers.unwatchUser({ username: 'nobody' });
      assert.ok(result.isError);
    });
  });

  describe('list_watched_users', () => {
    it('should return empty list', async () => {
      const result = await handlers.listWatchedUsers();
      assert.ok(result.content[0].text.includes('No users'));
    });

    it('should return watched users', async () => {
      await handlers.watchUser({ username: 'shroud' });
      const result = await handlers.listWatchedUsers();
      assert.ok(result.content[0].text.includes('shroud'));
    });
  });

  describe('configure_webhook', () => {
    it('should create webhook and store config', async () => {
      const result = await handlers.configureWebhook({
        condition: 'When live', action: 'Notify me',
      });
      assert.ok(result.content[0].text.includes('When live'));
      assert.equal(mockDb.webhookConfig.webhook_url, 'https://poke.com/webhook');
    });
  });
});
