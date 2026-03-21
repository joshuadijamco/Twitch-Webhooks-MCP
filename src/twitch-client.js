import WebSocket from 'ws';

const TWITCH_EVENTSUB_WS = 'wss://eventsub.wss.twitch.tv/ws';
const TWITCH_API = 'https://api.twitch.tv/helix';

export function createTwitchClient({ auth, fetchFn = fetch, wsUrl = TWITCH_EVENTSUB_WS }) {
  let sessionId = null;
  let ws = null;
  let keepaliveTimeout = null;
  let reconnectDelay = 1000;
  let intentionalClose = false;
  let onStreamOnline = null;
  let onStreamOffline = null;
  let onSessionReady = null;

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
      transport: { method: 'websocket', session_id: sessionId },
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

  function resetKeepaliveTimer(timeoutSeconds) {
    clearTimeout(keepaliveTimeout);
    keepaliveTimeout = setTimeout(() => {
      console.log('[twitch-ws] Keepalive timeout, reconnecting...');
      if (ws) ws.close();
    }, (timeoutSeconds + 5) * 1000);
  }

  function handleMessage(raw) {
    const msg = JSON.parse(raw);
    const { metadata, payload } = msg;

    switch (metadata.message_type) {
      case 'session_welcome':
        sessionId = payload.session.id;
        reconnectDelay = 1000;
        resetKeepaliveTimer(payload.session.keepalive_timeout_seconds);
        console.log(`[twitch-ws] Connected, session: ${sessionId}`);
        if (onSessionReady) onSessionReady();
        break;

      case 'session_keepalive':
        resetKeepaliveTimer(10);
        break;

      case 'session_reconnect':
        console.log('[twitch-ws] Reconnect requested');
        connectWs(payload.session.reconnect_url);
        break;

      case 'notification': {
        const type = payload.subscription.type;
        const event = payload.event;
        resetKeepaliveTimer(10);
        if (type === 'stream.online' && onStreamOnline) {
          onStreamOnline(event);
        } else if (type === 'stream.offline' && onStreamOffline) {
          onStreamOffline(event);
        }
        break;
      }
    }
  }

  function connectWs(url = wsUrl) {
    const oldWs = ws;
    ws = new WebSocket(url);

    ws.on('open', () => {
      console.log(`[twitch-ws] WebSocket open: ${url}`);
      if (oldWs && oldWs.readyState === WebSocket.OPEN) {
        oldWs.close();
      }
    });

    ws.on('message', (data) => handleMessage(data.toString()));

    ws.on('close', () => {
      clearTimeout(keepaliveTimeout);
      if (intentionalClose) {
        console.log('[twitch-ws] WebSocket closed');
        intentionalClose = false;
        return;
      }
      console.log(`[twitch-ws] WebSocket closed, reconnecting in ${reconnectDelay}ms`);
      setTimeout(() => connectWs(), reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    });

    ws.on('error', (err) => {
      console.error('[twitch-ws] WebSocket error:', err.message);
    });
  }

  return {
    connect() { connectWs(); },

    connectAndWait() {
      return new Promise((resolve) => {
        const prevHandler = onSessionReady;
        onSessionReady = () => {
          onSessionReady = prevHandler;
          if (prevHandler) prevHandler();
          resolve();
        };
        connectWs();
      });
    },

    disconnect() {
      intentionalClose = true;
      clearTimeout(keepaliveTimeout);
      if (ws) ws.close();
      ws = null;
      sessionId = null;
    },

    get connected() { return ws !== null && sessionId !== null; },

    get sessionId() { return sessionId; },

    onStreamOnline(handler) { onStreamOnline = handler; },
    onStreamOffline(handler) { onStreamOffline = handler; },
    onSessionReady(handler) { onSessionReady = handler; },

    createSubscription,
    deleteSubscription,
    resolveUsername,
    getStreamInfo,

    // For testing
    _setSessionId(id) { sessionId = id; },
  };
}
