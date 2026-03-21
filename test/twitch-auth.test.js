import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTwitchAuth } from '../src/twitch-auth.js';

describe('twitch-auth', () => {
  let auth;
  let fetchCalls;

  beforeEach(() => {
    fetchCalls = [];
    const mockFetch = async (url, opts) => {
      fetchCalls.push({ url, opts });
      return {
        ok: true,
        json: async () => ({ access_token: 'test-token-123', expires_in: 5000000 }),
      };
    };
    auth = createTwitchAuth({
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      fetchFn: mockFetch,
    });
  });

  it('should fetch an access token', async () => {
    const token = await auth.getToken();
    assert.equal(token, 'test-token-123');
    assert.equal(fetchCalls.length, 1);
    assert.ok(fetchCalls[0].url.includes('id.twitch.tv/oauth2/token'));
  });

  it('should cache the token on subsequent calls', async () => {
    await auth.getToken();
    await auth.getToken();
    assert.equal(fetchCalls.length, 1);
  });

  it('should refresh token when invalidated', async () => {
    await auth.getToken();
    auth.invalidate();
    const token = await auth.getToken();
    assert.equal(token, 'test-token-123');
    assert.equal(fetchCalls.length, 2);
  });

  it('should throw on fetch failure', async () => {
    const failAuth = createTwitchAuth({
      clientId: 'id',
      clientSecret: 'secret',
      fetchFn: async () => ({ ok: false, status: 400, text: async () => 'Bad Request' }),
    });
    await assert.rejects(() => failAuth.getToken(), /Failed to fetch Twitch token/);
  });

  it('should return clientId', () => {
    assert.equal(auth.clientId, 'test-client-id');
  });
});
