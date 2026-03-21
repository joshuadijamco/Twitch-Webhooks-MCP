import { createHmac, randomBytes } from 'node:crypto';

const TWITCH_API = 'https://api.twitch.tv/helix';

export function createTwitchClient({ auth, webhookUrl, webhookSecret, fetchFn = fetch }) {
  if (!webhookSecret) {
    webhookSecret = randomBytes(16).toString('hex');
  }

  async function twitchApiCall(url, opts = {}) {
    const token = await auth.getToken();
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Client-Id': auth.clientId,
      ...opts.headers,
    };
    const res = await fetchFn(url, { ...opts, headers });
    if (res.status === 401) {
      auth.invalidate();
      const newToken = await auth.getToken();
      headers['Authorization'] = `Bearer ${newToken}`;
      return fetchFn(url, { ...opts, headers });
    }
    return res;
  }

  async function createSubscription(type, broadcasterId) {
    const body = {
      type,
      version: '1',
      condition: { broadcaster_user_id: broadcasterId },
      transport: {
        method: 'webhook',
        callback: webhookUrl,
        secret: webhookSecret,
      },
    };
    const res = await twitchApiCall(`${TWITCH_API}/eventsub/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create subscription ${type}: ${res.status} ${text}`);
    }
    const data = await res.json();
    return data.data[0].id;
  }

  async function deleteSubscription(subscriptionId) {
    const res = await twitchApiCall(
      `${TWITCH_API}/eventsub/subscriptions?id=${subscriptionId}`,
      { method: 'DELETE' }
    );
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`Failed to delete subscription: ${res.status} ${text}`);
    }
  }

  async function resolveUsername(username) {
    const res = await twitchApiCall(
      `${TWITCH_API}/users?login=${encodeURIComponent(username.toLowerCase())}`
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to resolve username: ${res.status} ${text}`);
    }
    const data = await res.json();
    return data.data.length > 0 ? data.data[0].id : null;
  }

  async function getStreamInfo(userId) {
    const res = await twitchApiCall(`${TWITCH_API}/streams?user_id=${userId}`);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to fetch stream info: ${res.status} ${text}`);
    }
    const data = await res.json();
    return data.data.length > 0 ? data.data[0] : null;
  }

  function verifySignature(messageId, timestamp, body, signature) {
    const message = messageId + timestamp + body;
    const expectedSig = 'sha256=' + createHmac('sha256', webhookSecret)
      .update(message)
      .digest('hex');
    return expectedSig === signature;
  }

  return {
    createSubscription,
    deleteSubscription,
    resolveUsername,
    getStreamInfo,
    verifySignature,
    get webhookSecret() { return webhookSecret; },
  };
}
