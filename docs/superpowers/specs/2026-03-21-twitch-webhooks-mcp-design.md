# Twitch Webhooks MCP Server — Design Spec

## Overview

A Node.js MCP server running in Docker that monitors Twitch streams via EventSub WebSocket and fires Poke webhooks when watched users go live. AI agents interact with it via MCP tools to manage which users to watch and how webhooks are configured.

**Stack:** Node.js (no TypeScript), SQLite, Docker
**MCP Transport:** SSE (default) or stdio

## Architecture

Single-process monolith with three responsibilities:

1. **MCP Server** — exposes tools via SSE (default, port 3000) or stdio
2. **Twitch EventSub WebSocket Client** — persistent connection to Twitch, listens for stream.online/stream.offline events
3. **Poke Webhook Sender** — fires poke.sendWebhook() when a watched user goes live

### Data Flow

```
Agent (via MCP) → watch_user("shroud")
                     ↓
              SQLite stores user + creates EventSub subscription
                     ↓
              Twitch WebSocket → stream.online event
                     ↓
              Poke sendWebhook({ data: stream info })
                     ↓
              Poke agent executes configured action
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TWITCH_CLIENT_ID` | Yes | — | Twitch app client ID |
| `TWITCH_CLIENT_SECRET` | Yes | — | Twitch app client secret |
| `POKE_API_KEY` | Yes | — | Poke SDK API key |
| `MCP_TRANSPORT` | No | `sse` | `sse` or `stdio` |
| `PORT` | No | `3000` | SSE server port |

## MCP Tools

### `watch_user({ username })`

- Resolves the Twitch username to a user ID via Twitch API
- Stores the user in SQLite (username, user_id, status: "offline", created_at)
- Creates a Twitch EventSub `stream.online` subscription for that user ID via the WebSocket transport
- Returns confirmation with the user info
- Errors if user already watched or username not found

### `unwatch_user({ username })`

- Looks up the user in SQLite
- Deletes the EventSub subscription from Twitch
- Removes the user from SQLite
- Returns confirmation
- Errors if user not being watched

### `list_watched_users()`

- Returns all watched users from SQLite with: username, online/offline status, last seen online timestamp
- No parameters

### `configure_webhook({ condition, action })`

- Calls `poke.createWebhook({ condition, action })` and stores the returned webhookUrl and webhookToken in SQLite
- Only one webhook config at a time — calling again replaces the previous one
- Returns the configured condition/action for confirmation
- Example: `configure_webhook({ condition: "When a Twitch streamer goes live", action: "Send me a notification with the stream details" })`

## Data Model (SQLite)

Database file: `data/twitch-webhooks.db` (on a Docker volume)

### `watched_users`

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Auto-increment |
| username | TEXT UNIQUE | Twitch username (lowercase) |
| twitch_user_id | TEXT | Twitch numeric user ID |
| subscription_id | TEXT | EventSub subscription ID (for cleanup) |
| status | TEXT | "online" or "offline" |
| last_online_at | TEXT | ISO timestamp, null if never seen |
| created_at | TEXT | ISO timestamp |

### `webhook_config`

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER PK | Always 1 (single row) |
| condition | TEXT | Poke webhook condition |
| action | TEXT | Poke webhook action |
| webhook_url | TEXT | Returned by Poke |
| webhook_token | TEXT | Returned by Poke |
| created_at | TEXT | ISO timestamp |

## Twitch WebSocket & Event Handling

### Connection Lifecycle

- On startup, connect to `wss://eventsub.wss.twitch.tv/ws`
- Twitch sends `session_keepalive` every ~10 seconds — if none received within the timeout, reconnect
- On `session_welcome`, store the session ID — needed when creating EventSub subscriptions
- On `session_reconnect`, connect to the new URL before dropping the old connection

### Subscription Management

- When `watch_user` is called, create an EventSub subscription via `POST /helix/eventsub/subscriptions` using the WebSocket session ID as transport
- On startup/reconnect, re-subscribe for all users in SQLite (WebSocket subscriptions don't persist across disconnects)

### Event Handling

- `stream.online`: update user status in SQLite to "online", set last_online_at, fire `poke.sendWebhook()` with:
  ```json
  {
    "event": "stream.online",
    "username": "shroud",
    "stream_title": "...",
    "game": "...",
    "started_at": "..."
  }
  ```
- `stream.offline`: update user status in SQLite to "offline" (no Poke webhook)

### Auth Token Management

- On startup, fetch an App Access Token via client credentials flow (`POST https://id.twitch.tv/oauth2/token`)
- Token valid ~60 days — refresh when API calls return 401

## Error Handling

### Twitch WebSocket

- Connection drop: exponential backoff reconnect (1s, 2s, 4s... max 30s)
- On reconnect: re-subscribe all watched users
- Log connection state changes

### Poke Webhook Failures

- Log the error, don't crash
- Stream event still recorded in SQLite
- No retry queue

### MCP Tool Errors

- Structured error messages (e.g., "User 'xyz' not found on Twitch")
- Warn if sendWebhook fires but no webhook is configured

### Auth Token Expiry

- 401 from Twitch API → refresh token, retry once
- If refresh fails, log and surface on next MCP tool call

## Project Structure

```
twitch-webhooks-mcp/
├── src/
│   ├── index.js          # Entry point — starts MCP server + Twitch WS
│   ├── mcp-server.js     # MCP tool definitions and handlers
│   ├── twitch-client.js  # WebSocket connection, EventSub management
│   ├── twitch-auth.js    # App Access Token fetching/refreshing
│   ├── poke-client.js    # Poke SDK wrapper (createWebhook, sendWebhook)
│   └── db.js             # SQLite setup, queries
├── Dockerfile
├── docker-compose.yml
├── package.json
└── .env.example
```

## Docker

### Dockerfile

- Base image: `node:22-slim`
- Install dependencies, copy source
- Expose port 3000
- `CMD ["node", "src/index.js"]`

### docker-compose.yml

- Maps `.env` for credentials
- Mounts volume for `data/` (SQLite)
- Restart policy: `unless-stopped`
- Exposes port 3000

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server implementation
- `poke` — Poke SDK
- `better-sqlite3` — SQLite driver
- `ws` — WebSocket client for Twitch EventSub
