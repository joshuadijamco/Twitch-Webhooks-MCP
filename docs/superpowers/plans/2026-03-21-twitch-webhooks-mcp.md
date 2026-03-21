# Twitch Webhooks MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP server that monitors Twitch streams via EventSub WebSocket and fires Poke webhooks when watched users go live.

**Architecture:** Single Node.js process exposing MCP tools (Streamable HTTP + stdio), maintaining a persistent Twitch EventSub WebSocket connection, and using SQLite for persistence. Runs in Docker.

**Tech Stack:** Node.js (ESM, no TypeScript), @modelcontextprotocol/sdk, better-sqlite3, ws, poke, zod, express

---

## File Structure

```
twitch-webhooks-mcp/
├── src/
│   ├── index.js              # Entry point — starts MCP server + Twitch WS
│   ├── mcp-server.js         # McpServer setup, tool registrations
│   ├── twitch-auth.js        # App Access Token fetch/refresh
│   ├── twitch-client.js      # EventSub WebSocket connection + subscription management
│   ├── poke-client.js        # Poke SDK wrapper
│   └── db.js                 # SQLite setup + queries
├── test/
│   ├── db.test.js
│   ├── twitch-auth.test.js
│   ├── twitch-client.test.js
│   ├── poke-client.test.js
│   └── mcp-server.test.js
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .dockerignore
└── .gitignore
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `.dockerignore`

- [ ] **Step 1: Initialize package.json**

Run `npm init -y`, then update `package.json` to:

```json
{
  "name": "twitch-webhooks-mcp",
  "version": "1.0.0",
  "description": "MCP server that monitors Twitch streams and fires Poke webhooks",
  "type": "module",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "test": "node --test test/*.test.js"
  },
  "license": "MIT"
}
```

Note: `"type": "module"` enables ESM imports. Tests use Node's built-in test runner.

- [ ] **Step 2: Install dependencies**

```bash
npm install @modelcontextprotocol/sdk poke better-sqlite3 ws zod express
```

- [ ] **Step 3: Create .env.example**

```
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
POKE_API_KEY=
MCP_TRANSPORT=http
PORT=3000
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
data/
.env
```

- [ ] **Step 5: Create .dockerignore**

```
node_modules/
data/
.env
.git/
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .env.example .gitignore .dockerignore
git commit -m "feat: scaffold project with dependencies"
```

---

### Task 2: SQLite Database Layer

**Files:**
- Create: `src/db.js`
- Create: `test/db.test.js`

- [ ] **Step 1: Write failing tests for db module**

Create `test/db.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/db.test.js
```

Expected: FAIL — `cannot find module '../src/db.js'`

- [ ] **Step 3: Implement db.js**

Create `src/db.js`:

```js
import Database from 'better-sqlite3';

export function createDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS watched_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      twitch_user_id TEXT NOT NULL,
      online_subscription_id TEXT,
      offline_subscription_id TEXT,
      status TEXT NOT NULL DEFAULT 'offline',
      last_online_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS webhook_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      condition TEXT NOT NULL,
      action TEXT NOT NULL,
      webhook_url TEXT NOT NULL,
      webhook_token TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return {
    addUser({ username, twitchUserId, onlineSubscriptionId, offlineSubscriptionId }) {
      db.prepare(`
        INSERT INTO watched_users (username, twitch_user_id, online_subscription_id, offline_subscription_id)
        VALUES (?, ?, ?, ?)
      `).run(username.toLowerCase(), twitchUserId, onlineSubscriptionId, offlineSubscriptionId);
    },

    removeUser(username) {
      db.prepare('DELETE FROM watched_users WHERE username = ?').run(username.toLowerCase());
    },

    getUser(username) {
      return db.prepare('SELECT * FROM watched_users WHERE username = ?').get(username.toLowerCase()) || null;
    },

    getUsers() {
      return db.prepare('SELECT * FROM watched_users ORDER BY username').all();
    },

    setUserOnline(username) {
      db.prepare(`
        UPDATE watched_users SET status = 'online', last_online_at = datetime('now')
        WHERE username = ?
      `).run(username.toLowerCase());
    },

    setUserOffline(username) {
      db.prepare("UPDATE watched_users SET status = 'offline' WHERE username = ?")
        .run(username.toLowerCase());
    },

    updateSubscriptionIds(username, onlineSubId, offlineSubId) {
      db.prepare(`
        UPDATE watched_users SET online_subscription_id = ?, offline_subscription_id = ?
        WHERE username = ?
      `).run(onlineSubId, offlineSubId, username.toLowerCase());
    },

    saveWebhookConfig({ condition, action, webhookUrl, webhookToken }) {
      db.prepare(`
        INSERT INTO webhook_config (id, condition, action, webhook_url, webhook_token)
        VALUES (1, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          condition = excluded.condition,
          action = excluded.action,
          webhook_url = excluded.webhook_url,
          webhook_token = excluded.webhook_token,
          created_at = datetime('now')
      `).run(condition, action, webhookUrl, webhookToken);
    },

    getWebhookConfig() {
      return db.prepare('SELECT * FROM webhook_config WHERE id = 1').get() || null;
    },

    clearAll() {
      db.prepare('DELETE FROM watched_users').run();
      db.prepare('DELETE FROM webhook_config').run();
    },

    close() {
      db.close();
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/db.test.js
```

Expected: All 10 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "feat: add SQLite database layer with tests"
```

---

### Task 3: Twitch Auth Module

**Files:**
- Create: `src/twitch-auth.js`
- Create: `test/twitch-auth.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/twitch-auth.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/twitch-auth.test.js
```

Expected: FAIL

- [ ] **Step 3: Implement twitch-auth.js**

Create `src/twitch-auth.js`:

```js
export function createTwitchAuth({ clientId, clientSecret, fetchFn = fetch }) {
  let cachedToken = null;

  async function fetchToken() {
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    });
    const res = await fetchFn('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      body: params,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to fetch Twitch token: ${res.status} ${body}`);
    }
    const data = await res.json();
    cachedToken = data.access_token;
    return cachedToken;
  }

  return {
    get clientId() { return clientId; },

    async getToken() {
      if (cachedToken) return cachedToken;
      return fetchToken();
    },

    invalidate() {
      cachedToken = null;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/twitch-auth.test.js
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/twitch-auth.js test/twitch-auth.test.js
git commit -m "feat: add Twitch auth module with token caching"
```

---

### Task 4: Poke Client Wrapper

**Files:**
- Create: `src/poke-client.js`
- Create: `test/poke-client.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/poke-client.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPokeClient } from '../src/poke-client.js';

describe('poke-client', () => {
  it('should create a webhook and return config', async () => {
    const mockPoke = {
      createWebhook: async ({ condition, action }) => ({
        triggerId: 'trigger-1',
        webhookUrl: 'https://poke.com/api/v1/inbound/webhook',
        webhookToken: 'token-abc',
      }),
    };
    const client = createPokeClient({ pokeInstance: mockPoke });
    const result = await client.createWebhook({ condition: 'test', action: 'test action' });
    assert.equal(result.webhookUrl, 'https://poke.com/api/v1/inbound/webhook');
    assert.equal(result.webhookToken, 'token-abc');
  });

  it('should send a webhook with data', async () => {
    let sentData;
    const mockPoke = {
      sendWebhook: async (opts) => {
        sentData = opts;
        return { success: true };
      },
    };
    const client = createPokeClient({ pokeInstance: mockPoke });
    await client.sendWebhook({
      webhookUrl: 'https://poke.com/api/v1/inbound/webhook',
      webhookToken: 'token-abc',
      data: { event: 'stream.online', username: 'shroud' },
    });
    assert.equal(sentData.webhookUrl, 'https://poke.com/api/v1/inbound/webhook');
    assert.deepEqual(sentData.data, { event: 'stream.online', username: 'shroud' });
  });

  it('should throw on webhook send failure', async () => {
    const mockPoke = {
      sendWebhook: async () => { throw new Error('Network error'); },
    };
    const client = createPokeClient({ pokeInstance: mockPoke });
    await assert.rejects(
      () => client.sendWebhook({ webhookUrl: 'url', webhookToken: 'tok', data: {} }),
      /Network error/
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/poke-client.test.js
```

Expected: FAIL

- [ ] **Step 3: Implement poke-client.js**

Create `src/poke-client.js`:

```js
import { Poke } from 'poke';

export function createPokeClient({ apiKey, pokeInstance } = {}) {
  const poke = pokeInstance || new Poke({ apiKey });

  return {
    async createWebhook({ condition, action }) {
      const result = await poke.createWebhook({ condition, action });
      return {
        triggerId: result.triggerId,
        webhookUrl: result.webhookUrl,
        webhookToken: result.webhookToken,
      };
    },

    async sendWebhook({ webhookUrl, webhookToken, data }) {
      return poke.sendWebhook({ webhookUrl, webhookToken, data });
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/poke-client.test.js
```

Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/poke-client.js test/poke-client.test.js
git commit -m "feat: add Poke client wrapper with tests"
```

---

### Task 5: Twitch EventSub WebSocket Client

**Files:**
- Create: `src/twitch-client.js`
- Create: `test/twitch-client.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/twitch-client.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/twitch-client.test.js
```

Expected: FAIL

- [ ] **Step 3: Implement twitch-client.js**

Create `src/twitch-client.js`:

```js
import WebSocket from 'ws';

const TWITCH_EVENTSUB_WS = 'wss://eventsub.wss.twitch.tv/ws';
const TWITCH_API = 'https://api.twitch.tv/helix';

export function createTwitchClient({ auth, fetchFn = fetch, wsUrl = TWITCH_EVENTSUB_WS }) {
  let sessionId = null;
  let ws = null;
  let keepaliveTimeout = null;
  let reconnectDelay = 1000;
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
      console.log(`[twitch-ws] WebSocket closed, reconnecting in ${reconnectDelay}ms`);
      clearTimeout(keepaliveTimeout);
      setTimeout(() => connectWs(), reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    });

    ws.on('error', (err) => {
      console.error('[twitch-ws] WebSocket error:', err.message);
    });
  }

  return {
    connect() { connectWs(); },

    disconnect() {
      clearTimeout(keepaliveTimeout);
      if (ws) ws.close();
      ws = null;
    },

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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/twitch-client.test.js
```

Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/twitch-client.js test/twitch-client.test.js
git commit -m "feat: add Twitch EventSub WebSocket client with tests"
```

---

### Task 6: MCP Server with Tool Definitions

**Files:**
- Create: `src/mcp-server.js`
- Create: `test/mcp-server.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/mcp-server.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/mcp-server.test.js
```

Expected: FAIL

- [ ] **Step 3: Implement mcp-server.js**

Create `src/mcp-server.js`:

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test test/mcp-server.test.js
```

Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp-server.js test/mcp-server.test.js
git commit -m "feat: add MCP server with tool definitions and tests"
```

---

### Task 7: Entry Point & Wiring

**Files:**
- Create: `src/index.js`

- [ ] **Step 1: Implement index.js**

Create `src/index.js`:

```js
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
```

- [ ] **Step 2: Verify module resolution**

```bash
node -e "import('./src/index.js').catch(e => console.log('Import check:', e.message))"
```

Expected: May fail on missing env vars but should not fail on import resolution. If it fails with "Cannot find package", ensure dependencies are installed.

- [ ] **Step 3: Commit**

```bash
git add src/index.js
git commit -m "feat: add entry point wiring all components together"
```

---

### Task 8: Docker Setup

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM node:22-slim AS build

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/

EXPOSE 3000
CMD ["node", "src/index.js"]
```

- [ ] **Step 2: Create docker-compose.yml**

```yaml
services:
  twitch-webhooks-mcp:
    build: .
    ports:
      - "${PORT:-3000}:${PORT:-3000}"
    env_file:
      - .env
    volumes:
      - mcp-data:/app/data
    restart: unless-stopped

volumes:
  mcp-data:
```

- [ ] **Step 3: Verify Docker build**

```bash
docker build -t twitch-webhooks-mcp .
```

Expected: Build completes successfully.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "feat: add Docker setup with multi-stage build"
```

---

### Task 9: Run All Tests & Final Verification

- [ ] **Step 1: Run full test suite**

```bash
node --test test/*.test.js
```

Expected: All tests pass.

- [ ] **Step 2: Verify Docker image builds**

```bash
docker build -t twitch-webhooks-mcp .
```

Expected: Build succeeds.

- [ ] **Step 3: Final commit if any cleanup needed**

Review `git log --oneline` for clean history.
