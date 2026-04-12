# PumpTx 🚀

> Real-time PumpFun BUY monitor with terminal dashboard + auto post to X, Telegram, and (optionally) Discord

PumpTx is a small monorepo with two apps:

- **`apps/bot`**: listens to PumpFun program logs on Solana, parses BUY activity, generates a Sharp “terminal card” image, stores rows in SQLite, and notifies Telegram/X (and Discord via webhook when configured).
- **`apps/web`**: Next.js 14 App Router dashboard that polls SQLite-backed APIs for a live feed and transaction detail pages.

## Architecture Overview

```
┌───────────────┐      ┌────────────────────┐      ┌──────────────────┐
│ Solana (WSS)  │─────▶│ PumpTx Bot (Node)  │─────▶│ SQLite (shared)  │
│ PumpFun logs  │      │ parse/filter/image │      │ ./pumptx.db      │
└───────────────┘      └─────────┬──────────┘      └────────┬─────────┘
                                 │                          │
                                 │ express static           │ better-sqlite3
                                 ▼                          │
                        ┌────────────────┐                  │
                        │ /generated/*.png│◀─────────────────┘
                        └────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Next.js UI (apps/web)                                                 │
│  - GET /api/transactions                                              │
│  - GET /api/transactions/[signature]                                  │
│  - Dashboard polls every 5s                                           │
└──────────────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Node.js 20+ recommended (Node 25+ requires a recent `better-sqlite3` native build; this repo pins `better-sqlite3@^11.8.1` for compatibility)
- Windows: Visual Studio Build Tools may be required for `better-sqlite3` native compilation
- Helius (or equivalent) Solana HTTPS + WSS RPC URLs
- Telegram bot token + chat id
- `twitterapi.io` API key (see notes below)

## Quick Start

1. Copy environment template:

```bash
cp .env.example .env
```

2. Fill in `.env` values (RPC, Telegram, Twitter API, URLs).

3. Install dependencies:

```bash
cd apps/bot && npm install
cd ../web && npm install
```

4. Generate the Sharp base template:

```bash
cd apps/bot
npm run create-template
```

5. Start the bot (serves `public/generated` on `BOT_PORT`):

```bash
npm run dev
```

6. Start the web UI (separate terminal):

```bash
cd apps/web
npm run dev
```

Open `NEXT_PUBLIC_BASE_URL` (default `http://localhost:3000`).

## Getting API Keys

### Helius RPC

Create a project in Helius and copy:

- HTTPS RPC URL(s) → `SOLANA_RPC_HTTPS` (optional **comma-separated** Helius URLs with different `api-key` values to round-robin `getTransaction` and raise throughput; **first** URL’s key should match `SOLANA_RPC_WSS` because only one websocket subscription is used)
- WSS URL → `SOLANA_RPC_WSS`

### Telegram Bot

1. Create a bot with BotFather and copy `TELEGRAM_BOT_TOKEN`
2. Add the bot to your channel/group (or DM) and resolve `TELEGRAM_CHAT_ID`

### TwitterAPI.io

Create an API key in the twitterapi.io dashboard and set `TWITTER_API_IO_KEY`.

**Important:** twitterapi.io endpoints and required fields can vary by product tier. This repo implements the paths described in the PumpTx spec:

- `POST /twitter/upload/media`
- `POST /twitter/tweet`

If your account uses different routes (for example `upload_media_v2` / `create_tweet_v2` with extra fields), set `TWITTERAPI_IO_BASE_URL` and adjust `apps/bot/src/twitter.js` to match your provider documentation.

## Running in Development

- Bot: `cd apps/bot && npm run dev`
- Web: `cd apps/web && npm run dev`

## Deploying to Production

- **Bot**: Railway/Render/Fly.io/VPS + PM2. Ensure `BOT_BASE_URL` is publicly reachable so the dashboard can render generated images (`/generated/...`).
- **Web**: Vercel (or any Node host). Set `NEXT_PUBLIC_BASE_URL` to your public site URL.

**SQLite note:** `pumptx.db` lives at the monorepo root. In production you typically mount a persistent volume so both processes can read/write the same file path.

## Environment Variables

| Name | Purpose |
| --- | --- |
| `SOLANA_RPC_HTTPS` | Solana HTTP RPC. Comma-separated URLs = pool (round-robin `getTransaction` across keys). |
| `SOLANA_RPC_WSS` | Solana websocket RPC. One URL = subscribe on first HTTPS endpoint only. **Comma-separated** URLs (same count as `SOLANA_RPC_HTTPS`) = one `onLogs` per key; duplicate signatures are dropped (`WSS_LOG_DEDUPE_MS`, default 45s). |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Destination chat/channel id |
| `DISCORD_WEBHOOK_URL` | Optional. [Incoming Webhook](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks) URL; BUY alerts post as a rich embed (image attached or linked). Alias: `DISCORD_WEBHOOK`. |
| `TWITTER_API_IO_KEY` | twitterapi.io API key |
| `TWITTERAPI_IO_BASE_URL` | Optional API host override |
| `NEXT_PUBLIC_BASE_URL` | Public website base URL (detail links) |
| `BOT_PORT` | Bot static server port |
| `BOT_BASE_URL` | Public base URL for generated images (`/generated/...`) |
| `MIN_BUY_SOL` | Minimum SOL threshold for notifications |
| `COOLDOWN_MS` | Per-mint cooldown between notifications |
| `RPC_MIN_INTERVAL_MS` | Delay between queued `getTransaction` calls. Default `ceil(1000/(7×N))` ms when `N` = number of comma-separated HTTPS URLs (`143` for one URL → ~7 req/s per key headroom). |
| `RPC_QUEUE_CAP` | Max queued unique signatures before dropping (default `80`) |
| `RPC_429_BACKOFF_MS` | Extra pause after a 429 response (default `2500`) |
| `WSS_LOG_DEDUPE_MS` | When using multi-`SOLANA_RPC_WSS`, ignore duplicate log signatures within this window (default `45000`) |

## Troubleshooting

- **`EADDRINUSE` / port already in use (bot)**: another process is bound to `BOT_PORT` (often a previous `npm run dev` still running). Stop it (Task Manager / `Ctrl+C` in that terminal) or set a different `BOT_PORT` and matching `BOT_BASE_URL` port.
- **`better-sqlite3` install fails on Windows**: install VS Build Tools (Desktop development with C++) and retry `npm install`.
- **No buys showing**: verify Helius websocket connectivity and that your RPC tier supports log subscriptions.
- **Images missing in the UI**: confirm `BOT_BASE_URL` matches where the bot is reachable and that `/generated/*.png` is not blocked by mixed content (HTTPS site + HTTP bot).
- **Tweet posting fails**: verify twitterapi.io route compatibility (see deployment notes above).

## License

MIT (unless you choose otherwise for your own deployment).
