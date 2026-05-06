# JojoX Bot

A Telegram Mini App with a lucky wheel game, referral system, leaderboard, and TON wallet integration backed by a PostgreSQL database.

## Run & Operate

| Command | Purpose |
|---|---|
| `pnpm install` | Install all workspace dependencies |
| `pnpm --filter @workspace/db run push` | Apply DB schema (drizzle-kit push) |
| `pnpm --filter @workspace/api-server run dev` | Start API server (requires `PORT=8080`) |
| `pnpm --filter @workspace/app run dev` | Start frontend app |

Required env vars:
- `DATABASE_URL` — set automatically by Replit PostgreSQL
- `PORT` — set to `8080` as a Replit shared env var
- `BOT_TOKEN` / `TELEGRAM_BOT_TOKEN` — Telegram bot token (set as Replit secrets)
- `MINI_APP_URL` — URL of the frontend app; currently points to Replit dev domain

## Stack

- **Runtime**: Node.js (ESM)
- **Frontend**: React 19 + Vite 7 + TailwindCSS 4 + shadcn/ui + Wouter
- **Backend**: Express 5 + Pino logging + Helmet + CORS
- **Database**: PostgreSQL via Drizzle ORM (`lib/db`)
- **Package manager**: pnpm (workspace monorepo)
- **Blockchain**: TON via `@ton/ton` + `@tonconnect/ui-react`
- **Bot**: node-telegram-bot-api (polling mode in dev)

## Where things live

```
artifacts/api-server/   — Express API + Telegram bot
artifacts/app/          — React frontend (Telegram Mini App)
artifacts/jojox-wheel/  — Standalone lucky wheel component
artifacts/mockup-sandbox/ — Component preview/design sandbox
lib/db/                 — Drizzle ORM schema + migrations
lib/api-spec/           — Shared API contract types
lib/api-zod/            — Zod validators for API
lib/api-client-react/   — React Query hooks for API
vercel.json             — Vercel deployment config
```

Schema: `lib/db/src/schema/index.ts`
API routes: `artifacts/api-server/src/routes/`

## Architecture decisions

- Monorepo with pnpm workspaces; all packages share a catalog for version pinning
- API server builds to `dist/index.mjs` via esbuild before starting (no ts-node in prod)
- **Replit deployment**: `vm` target (always-on); single process serves both API (`/api/*`) and the built React SPA (static files from `artifacts/app/dist/public`). See `.replit` `[deployment]` section.
- Vercel deployment also supported: `vercel.json` uses serverless `api/index.js` entry + static SPA output
- Bot runs in polling mode in dev; webhook mode in prod via `BOT_WEBHOOK_URL`
- Frontend proxies `/api` to `localhost:8080` in dev via Vite proxy; app served at `/app/` path

## Product

- Lucky wheel spin game with Telegram Mini App UI
- Referral system with leaderboard
- TON wallet connection and withdrawal flow
- Admin panel for configuration (owner Telegram ID: 6145230334)
- Tasks/quests system for users

## User preferences

- No code modifications to the cloned repo; deployed as-is from GitHub
- Telegram bot token set as Replit secrets (`BOT_TOKEN` + `TELEGRAM_BOT_TOKEN`)

## Gotchas

- **Port conflict pattern**: Old node processes hold ports 8080/23863/18635 after checkpoint → run `fuser -k 8080/tcp 23863/tcp 18635/tcp` before restarting workflows
- `PORT=8080` must be set as a shared env var — API server throws if missing
- `MINI_APP_URL` must point to the running app URL — currently the Replit dev domain; update after deployment
- Bot token read as `process.env.TOKEN || process.env.TELEGRAM_BOT_TOKEN` in bot/index.ts
- `wheel_slots` and `bot_settings` tables need data — seeded on first setup (8 default wheel slots)
- Tasks table starts empty — add tasks via the admin panel in Telegram
- Do not run `drizzle-kit push --force` unless intentionally resetting schema
- In production: set `BOT_WEBHOOK_URL=https://<domain>/api/bot-webhook` for reliable bot operation

## Pointers

- DB schema: `lib/db/src/schema/index.ts`
- API routes: `artifacts/api-server/src/routes/`
- Vercel deployment: `vercel.json` at repo root
