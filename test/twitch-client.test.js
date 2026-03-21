import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTwitchClient } from '../src/twitch-client.js';

describe('twitch-client', () => {
  let client;
  let apiCalls;
  let mockAuth;

  beforeEach(() => {
    apiCalls = [];
    mockAuth = {
      clientId: 'test-client-id',
      getToken: async () => 'test-token',
      invalidate: () => {},
    };
  });

  describe('createSubscription', () => {
    it('should create an EventSub subscription via API', async () => {
      const mockFetch = async (url, opts) => {
        apiCalls.push({ url, opts });
        return {
          ok: true,
          json: async () => ({ data: [{ id: 'sub-123', status: 'enabled' }] }),
        };
      };
      client = createTwitchClient({ auth: mockAuth, fetchFn: mockFetch });
      client._setSessionId('session-abc');

      const subId = await client.createSubscription('stream.online', '12345');
      assert.equal(subId, 'sub-123');
      assert.equal(apiCalls.length, 1);

      const body = JSON.parse(apiCalls[0].opts.body);
      assert.equal(body.type, 'stream.online');
      assert.equal(body.condition.broadcaster_user_id, '12345');
      assert.equal(body.transport.session_id, 'session-abc');
    });

    it('should retry with fresh token on 401', async () => {
      let callCount = 0;
      const mockFetch = async (url, opts) => {
        callCount++;
        if (callCount === 1) return { ok: false, status: 401, text: async () => 'Unauthorized' };
        return { ok: true, json: async () => ({ data: [{ id: 'sub-456' }] }) };
      };
      client = createTwitchClient({ auth: mockAuth, fetchFn: mockFetch });
      client._setSessionId('session-abc');

      const subId = await client.createSubscription('stream.online', '12345');
      assert.equal(subId, 'sub-456');
      assert.equal(callCount, 2);
    });
  });

  describe('deleteSubscription', () => {
    it('should delete an EventSub subscription', async () => {
      const mockFetch = async (url, opts) => {
        apiCalls.push({ url, opts });
        return { ok: true };
      };
      client = createTwitchClient({ auth: mockAuth, fetchFn: mockFetch });
      await client.deleteSubscription('sub-123');
      assert.equal(apiCalls.length, 1);
      assert.ok(apiCalls[0].url.includes('sub-123'));
      assert.equal(apiCalls[0].opts.method, 'DELETE');
    });
  });

  describe('resolveUsername', () => {
    it('should resolve a username to user ID', async () => {
      const mockFetch = async (url) => {
        apiCalls.push({ url });
        return { ok: true, json: async () => ({ data: [{ id: '99999', login: 'shroud' }] }) };
      };
      client = createTwitchClient({ auth: mockAuth, fetchFn: mockFetch });
      const userId = await client.resolveUsername('shroud');
      assert.equal(userId, '99999');
    });

    it('should return null for unknown username', async () => {
      const mockFetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
      client = createTwitchClient({ auth: mockAuth, fetchFn: mockFetch });
      const userId = await client.resolveUsername('nonexistent');
      assert.equal(userId, null);
    });
  });

  describe('getStreamInfo', () => {
    it('should fetch stream details', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({
          data: [{ user_login: 'shroud', title: 'Playing ranked', game_name: 'Valorant', started_at: '2026-01-01T00:00:00Z' }]
        }),
      });
      client = createTwitchClient({ auth: mockAuth, fetchFn: mockFetch });
      const info = await client.getStreamInfo('12345');
      assert.equal(info.title, 'Playing ranked');
      assert.equal(info.game_name, 'Valorant');
    });

    it('should return null when stream is not live', async () => {
      const mockFetch = async () => ({ ok: true, json: async () => ({ data: [] }) });
      client = createTwitchClient({ auth: mockAuth, fetchFn: mockFetch });
      const info = await client.getStreamInfo('12345');
      assert.equal(info, null);
    });
  });
});
