# Twitch Webhooks MCP Server

An MCP server that monitors Twitch streams and fires [Poke](https://poke.com) webhooks when watched users go live. AI agents interact with it via MCP tools to manage which users to watch and how notifications are configured.

![IMG_8639](https://github.com/user-attachments/assets/7c1d5752-91a9-428a-9afa-f1e94dd81a07)


## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- A [Twitch application](https://dev.twitch.tv/console/apps) (for Client ID and Client Secret)
- A [Poke API key](https://poke.com/kitchen/api-keys)
- A public HTTPS URL for Twitch EventSub callbacks (e.g., [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/))

## Quick Start

1. **Set up a Cloudflare tunnel** (or any reverse proxy) pointing to your server's port 3000:

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

   Note the public URL (e.g., `https://twitch-mcp.yourdomain.com`).

2. **Clone and configure:**

   ```bash
   cp .env.example .env
   ```

   Fill in your credentials in `.env`:

   ```
   TWITCH_CLIENT_ID=your_client_id
   TWITCH_CLIENT_SECRET=your_client_secret
   TWITCH_WEBHOOK_URL=https://twitch-mcp.yourdomain.com/twitch/eventsub
   POKE_API_KEY=pk_your_api_key
   ```

   `TWITCH_WEBHOOK_SECRET` can be any random string you choose — it's a shared secret between your server and Twitch used to sign and verify webhook payloads. It doesn't need to be registered anywhere on Twitch's side. You can generate one with:

   ```bash
   openssl rand -hex 32
   ```

   If left empty, a random secret is generated at startup. However, it's recommended to set one explicitly so it persists across server restarts — otherwise Twitch may fail signature verification on existing subscriptions after a restart.

3. **Run:**

   ```bash
   docker compose up --build
   ```

   The MCP server starts on `http://localhost:3000/mcp`.

4. **Connect your MCP client** (e.g., Claude Desktop, Poke) to `http://localhost:3000/mcp`.

6. **Configure the webhook and start watching users** through your AI agent (see [MCP Tools](#mcp-tools) below).

## MCP Tools

### `configure_webhook({ condition, action })`

Sets up the Poke webhook that fires when a watched user goes live. Both `condition` and `action` are natural language strings that tell the Poke agent **when** to act and **what** to do.

**Example:**

| Parameter | Example Value |
|-----------|---------------|
| `condition` | `"A Twitch streamer I follow goes live"` |
| `action` | `"Send me a notification with the streamer's name, stream title, and game"` |

You should configure this **before** adding users to watch, so notifications are ready when events arrive.

### `watch_user({ username })`

Start monitoring a Twitch user. This creates Twitch EventSub subscriptions for `stream.online` and `stream.offline` events for the given username.

**Example:** `watch_user({ username: "shroud" })`

> **Note:** The `TWITCH_WEBHOOK_URL` environment variable must be set to a publicly reachable HTTPS URL, otherwise this will fail with a 400 error about a missing callback field.

### `unwatch_user({ username })`

Stop monitoring a user and remove their EventSub subscriptions.

### `list_watched_users()`

List all monitored users and their current online/offline status.

## How It Works

1. An AI agent calls `configure_webhook` to define what should happen when a streamer goes live
2. The agent calls `watch_user` to start monitoring specific Twitch users
3. The server creates Twitch EventSub subscriptions (webhook transport) — Twitch will POST to your public URL when stream events occur
4. When a watched user starts streaming, Twitch sends a `stream.online` event to `/twitch/eventsub`
5. The server verifies the signature, fetches stream details, and fires a Poke webhook
6. Poke executes the configured action (e.g., send a notification, post a message)

## Configuration

| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `TWITCH_CLIENT_ID` | Yes | — | Twitch app client ID |
| `TWITCH_CLIENT_SECRET` | Yes | — | Twitch app client secret |
| `TWITCH_WEBHOOK_URL` | Yes | — | Public HTTPS URL for EventSub callbacks |
| `POKE_API_KEY` | Yes | — | Poke SDK API key |
| `TWITCH_WEBHOOK_SECRET` | Recommended | random | Any random string used to sign/verify Twitch webhook payloads (see [Quick Start](#quick-start)) |
| `MCP_TRANSPORT` | No | `http` | `http` (Streamable HTTP) or `stdio` |
| `PORT` | No | `3000` | Server port |

## Transport Modes

**HTTP (default):** Runs an Express server with Streamable HTTP transport at `/mcp`. Use this for remote connections from Docker.

**stdio:** Communicates over stdin/stdout. Use this when the MCP client launches the server as a subprocess. Set `MCP_TRANSPORT=stdio` in your `.env`.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | POST/GET/DELETE | MCP Streamable HTTP transport |
| `/twitch/eventsub` | POST | Twitch EventSub webhook callback |
| `/health` | GET | Health check |

## Testing

### Verify the tunnel is reachable

```bash
curl https://your-tunnel-hostname.example.com/health
# {"status":"ok"}
```

### Verify EventSub subscriptions

After calling `watch_user`, you can check that Twitch accepted your subscriptions. The subscription status should be `enabled` (not `webhook_callback_verification_pending`):

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Client-Id: YOUR_CLIENT_ID" \
     https://api.twitch.tv/helix/eventsub/subscriptions
```

### Send a test event with the Twitch CLI

The [Twitch CLI](https://dev.twitch.tv/docs/cli/) can send fake EventSub events directly to your endpoint without waiting for a real streamer to go live:

```bash
brew install twitchdev/twitch/twitch-cli

twitch event trigger stream.online --forward-address https://your-tunnel-hostname.example.com/twitch/eventsub --secret YOUR_WEBHOOK_SECRET
```

You should see `[event] stream.online: testbroadcaster` in your server logs. If you've configured a Poke webhook, you'll also get a notification on your phone.

> **Note:** The Twitch CLI bypasses Twitch entirely — it crafts a fake signed payload and POSTs it directly to your endpoint. This means it works regardless of which users you're watching. In production, only events for users you've subscribed to via `watch_user` will arrive.

## Development

**Run locally (without Docker):**

```bash
npm install
cp .env.example .env  # fill in credentials
npm start
```

**Run tests:**

```bash
npm test
```

## Architecture

Single Node.js process with three responsibilities:

- **MCP Server** — exposes tools via Streamable HTTP or stdio
- **Twitch EventSub Webhook Receiver** — receives stream events from Twitch via HTTP POST, verifies HMAC-SHA256 signatures
- **Poke Webhook Sender** — fires webhooks when stream.online events arrive

Data is persisted in SQLite (stored in a Docker volume at `/app/data`). Webhook subscriptions persist on Twitch's side, so they survive server restarts.

## License

MIT
