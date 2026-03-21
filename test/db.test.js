import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../src/db.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('db', () => {
  let db;
  let tmpDir;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'twitch-mcp-test-'));
    db = createDb(join(tmpDir, 'test.db'));
  });

  after(() => {
    db.close();
    rmSync(tmpDir, { recursive: true });
  });

  beforeEach(() => {
    db.clearAll();
  });

  describe('watched_users', () => {
    it('should add and retrieve a watched user', () => {
      db.addUser({
        username: 'shroud',
        twitchUserId: '12345',
        onlineSubscriptionId: 'sub-1',
        offlineSubscriptionId: 'sub-2',
      });
      const users = db.getUsers();
      assert.equal(users.length, 1);
      assert.equal(users[0].username, 'shroud');
      assert.equal(users[0].twitch_user_id, '12345');
      assert.equal(users[0].status, 'offline');
    });

    it('should reject duplicate usernames', () => {
      db.addUser({ username: 'shroud', twitchUserId: '12345', onlineSubscriptionId: 'sub-1', offlineSubscriptionId: 'sub-2' });
      assert.throws(() => {
        db.addUser({ username: 'shroud', twitchUserId: '12345', onlineSubscriptionId: 'sub-3', offlineSubscriptionId: 'sub-4' });
      });
    });

    it('should remove a user', () => {
      db.addUser({ username: 'shroud', twitchUserId: '12345', onlineSubscriptionId: 'sub-1', offlineSubscriptionId: 'sub-2' });
      db.removeUser('shroud');
      assert.equal(db.getUsers().length, 0);
    });

    it('should get a user by username', () => {
      db.addUser({ username: 'shroud', twitchUserId: '12345', onlineSubscriptionId: 'sub-1', offlineSubscriptionId: 'sub-2' });
      const user = db.getUser('shroud');
      assert.equal(user.username, 'shroud');
    });

    it('should return null for unknown user', () => {
      assert.equal(db.getUser('nobody'), null);
    });

    it('should update user status to online', () => {
      db.addUser({ username: 'shroud', twitchUserId: '12345', onlineSubscriptionId: 'sub-1', offlineSubscriptionId: 'sub-2' });
      db.setUserOnline('shroud');
      const user = db.getUser('shroud');
      assert.equal(user.status, 'online');
      assert.ok(user.last_online_at);
    });

    it('should update user status to offline', () => {
      db.addUser({ username: 'shroud', twitchUserId: '12345', onlineSubscriptionId: 'sub-1', offlineSubscriptionId: 'sub-2' });
      db.setUserOnline('shroud');
      db.setUserOffline('shroud');
      const user = db.getUser('shroud');
      assert.equal(user.status, 'offline');
      assert.ok(user.last_online_at);
    });

    it('should update subscription IDs', () => {
      db.addUser({ username: 'shroud', twitchUserId: '12345', onlineSubscriptionId: 'sub-1', offlineSubscriptionId: 'sub-2' });
      db.updateSubscriptionIds('shroud', 'sub-new-1', 'sub-new-2');
      const user = db.getUser('shroud');
      assert.equal(user.online_subscription_id, 'sub-new-1');
      assert.equal(user.offline_subscription_id, 'sub-new-2');
    });
  });

  describe('webhook_config', () => {
    it('should save and retrieve webhook config', () => {
      db.saveWebhookConfig({
        condition: 'When a streamer goes live',
        action: 'Notify me',
        webhookUrl: 'https://poke.com/api/v1/inbound/webhook',
        webhookToken: 'token-123',
      });
      const config = db.getWebhookConfig();
      assert.equal(config.condition, 'When a streamer goes live');
      assert.equal(config.webhook_url, 'https://poke.com/api/v1/inbound/webhook');
    });

    it('should replace existing config', () => {
      db.saveWebhookConfig({ condition: 'old', action: 'old', webhookUrl: 'url1', webhookToken: 'tok1' });
      db.saveWebhookConfig({ condition: 'new', action: 'new', webhookUrl: 'url2', webhookToken: 'tok2' });
      const config = db.getWebhookConfig();
      assert.equal(config.condition, 'new');
      assert.equal(config.webhook_url, 'url2');
    });

    it('should return null when no config', () => {
      assert.equal(db.getWebhookConfig(), null);
    });
  });
});
