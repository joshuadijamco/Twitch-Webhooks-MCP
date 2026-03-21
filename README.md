# Twitch Webhooks MCP Server

An MCP server that monitors Twitch streams and fires [Poke](https://poke.com) webhooks when watched users go live. AI agents interact with it via MCP tools to manage which users to watch and how notifications are configured.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- A [Twitch application](https://dev.twitch.tv/console/apps) (for Client ID and Client Secret)
- A [Poke API key](https://poke.com/kitchen/api-keys)

## Quick Start

1. **Clone and configure:**

   ```bash
   cp .env.example .env
   ```

   Fill in your credentials in `.env`:

   ```
   TWITCH_CLIENT_ID=your_client_id
   TWITCH_CLIENT_SECRET=your_client_secret
   POKE_API_KEY=pk_your_api_key
   ```

2. **Run:**

   ```bash
   docker compose up --build
   ```

   The MCP server starts on `http://localhost:3000/mcp`.

3. **Connect your MCP client** (e.g., Claude Desktop, Poke) to `http://localhost:3000/mcp`.

4. **Use the tools** through your AI agent:

   ```
   > Configure a webhook to notify me when a streamer goes live
   > Watch user "shroud"
   ```

## MCP Tools

| Tool | Description |
|------|-------------|
| `watch_user({ username })` | Start monitoring a Twitch user for going online |
| `unwatch_user({ username })` | Stop monitoring a user |
| `list_watched_users()` | List all monitored users and their online/offline status |
| `configure_webhook({ condition, action })` | Set up the Poke webhook (what the agent should do when someone goes live) |

## How It Works

1. An AI agent calls `configure_webhook` to define what should happen when a streamer goes live
2. The agent calls `watch_user` to start monitoring specific Twitch users
3. The server maintains a persistent WebSocket connection to Twitch EventSub
4. When a watched user starts streaming, the server fires a Poke webhook with the stream details
5. Poke executes the configured action (e.g., send a notification, post a message)

## Configuration

| Environment Variable | Required | Default | Description |
|---------------------|----------|---------|-------------|
| `TWITCH_CLIENT_ID` | Yes | — | Twitch app client ID |
| `TWITCH_CLIENT_SECRET` | Yes | — | Twitch app client secret |
| `POKE_API_KEY` | Yes | — | Poke SDK API key |
| `MCP_TRANSPORT` | No | `http` | `http` (Streamable HTTP) or `stdio` |
| `PORT` | No | `3000` | Server port for HTTP transport |

## Transport Modes

**HTTP (default):** Runs an Express server with Streamable HTTP transport at `/mcp`. Use this for remote connections from Docker.

**stdio:** Communicates over stdin/stdout. Use this when the MCP client launches the server as a subprocess. Set `MCP_TRANSPORT=stdio` in your `.env`.

## Health Check

```bash
curl http://localhost:3000/health
# {"status":"ok","twitchConnected":true}
```

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
- **Twitch EventSub WebSocket Client** — persistent connection to Twitch, auto-reconnects with exponential backoff, re-subscribes watched users on reconnect
- **Poke Webhook Sender** — fires webhooks when stream.online events arrive

Data is persisted in SQLite (stored in a Docker volume at `/app/data`).

## License

MIT
