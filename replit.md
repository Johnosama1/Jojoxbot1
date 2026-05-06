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
- `PORT` — set to `8080` as a Replit shared env var; required by the API server at startup
- `DISABLE_BOT` — set to `true` (shared env var) until `BOT_TOKEN` is configured
- `BOT_TOKEN` — Telegram bot token (user must provide)

## Stack

- **Runtime**: Node.js (ESM)
- **Frontend**: React 19 + Vite 7 + TailwindCSS 4 + shadcn/ui + Wouter
- **Backend**: Express 5 + Pino logging + Helmet + CORS
- **Database**: PostgreSQL via Drizzle ORM (`lib/db`)
- **Package manager**: pnpm (workspace monorepo)
- **Blockchain**: TON via `@ton/ton` + `@tonconnect/ui-react`
- **Bot**: node-telegram-bot-api

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
vercel.json             — Vercel deployment config (no changes needed)
```

Schema: `lib/db/src/schema/index.ts`

## Architecture decisions

- Monorepo with pnpm workspaces; all packages share a catalog for version pinning
- API server builds to `dist/index.mjs` via esbuild before starting (no ts-node in prod)
- Vercel deployment uses `api/index.js` (esbuild serverless entry) + static SPA output from `artifacts/app/dist/public`
- Bot runs in polling mode in dev (`DISABLE_BOT=true` until token is set); webhook mode in prod via `BOT_WEBHOOK_URL`
- Frontend proxies `/api` to `localhost:8080` in dev via Vite proxy

## Product

- Lucky wheel spin game with Telegram Mini App UI
- Referral system with leaderboard
- TON wallet connection and withdrawal flow
- Admin panel for configuration
- Tasks/quests system for users

## User preferences

- No code modifications to the cloned repo; deployed as-is from GitHub
- Telegram bot token setup left for user to configure

## Gotchas

- `PORT=8080` must be set as a shared env var — API server throws if missing
- `DISABLE_BOT=true` prevents bot polling errors when no `BOT_TOKEN` is present
- Sticker pre-cache warnings on startup are harmless (no bot token = no Telegram API access)
- Do not run `drizzle-kit push --force` unless intentionally resetting schema

## Pointers

- Vercel deployment: `vercel.json` at repo root — ready for one-click deploy
- DB schema: `lib/db/src/schema/index.ts`
- API routes: `artifacts/api-server/src/routes/`
