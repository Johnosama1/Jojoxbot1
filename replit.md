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
- Bot disabled in dev (`DISABLE_BOT=true` dev-only env var); webhook mode in prod auto-detected from `REPLIT_DOMAINS`, or override with `BOT_WEBHOOK_URL`
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

## Vercel Deployment Environment Variables

The Vercel project (`jojoxbot-api-server`, ID `prj_fiuT4KK00JSNGe9b3cOUIsK7dber`) requires
these env vars set under **Settings → Environment Variables** (Production + Preview):

| Variable | Where to get it | Required |
|---|---|---|
| `NEON_DATABASE_URL` | Replit secret `NEON_DATABASE_URL` (Neon cloud PostgreSQL) | **Yes** |
| `TELEGRAM_BOT_TOKEN` | Replit secret `TELEGRAM_BOT_TOKEN` | **Yes** |
| `BOT_WEBHOOK_URL` | `https://jojoxbot-api-server.vercel.app/api/webhook` | **Yes** |
| `MINI_APP_URL` | Frontend app URL | Yes |
| `NODE_ENV` | `production` | Yes |

> **Why NEON_DATABASE_URL and not DATABASE_URL?**
> `DATABASE_URL` is the Replit-local Postgres instance — unreachable from Vercel.
> `NEON_DATABASE_URL` is the Neon cloud database that works from any environment.
> See `lib/db/src/index.ts` — it reads `NEON_DATABASE_URL || DATABASE_URL`.

To sync env vars to Vercel automatically from Replit secrets, run:

```bash
bash scripts/sync-vercel-env.sh
```

Requires `VERCEL_TOKEN` set as a Replit secret (https://vercel.com/account/tokens).

## GitHub Push (CI/CD)

To push commits from this Replit environment to GitHub (which triggers Vercel auto-redeploy):

```bash
bash .local/push-to-github.sh
```

Requires `GITHUB_TOKEN` secret (classic PAT with `repo` scope) set in Replit Secrets.
Plain `git push` via HTTPS hangs in this environment — the helper script uses the correct
`https://username:token@github.com/...` URL format with `HTTP/1.1` to work around the block.

## Gotchas

- **Port conflict pattern**: Old node processes hold ports 8080/23863/18635 after checkpoint → run `fuser -k 8080/tcp 23863/tcp 18635/tcp` before restarting workflows
- `PORT=8080` must be set as a shared env var — API server throws if missing
- `MINI_APP_URL` must point to the running app URL — currently the Replit dev domain; update after deployment
- Bot token read as `process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || process.env.TOKEN` in bot/index.ts
- `wheel_slots` and `bot_settings` tables need data — seeded on first setup (8 default wheel slots)
- Tasks table starts empty — add tasks via the admin panel in Telegram
- Do not run `drizzle-kit push --force` unless intentionally resetting schema
- **Vercel DB**: Vercel cannot reach `DATABASE_URL` (Replit-local Postgres). Set `NEON_DATABASE_URL` on Vercel — `lib/db/src/index.ts` prefers it. Run `bash scripts/sync-vercel-env.sh` to sync from Replit secrets
- In production: webhook URL auto-detected from `REPLIT_DOMAINS` env var (set by Replit runtime). Override with `BOT_WEBHOOK_URL=https://<domain>/api/webhook` if needed (Vercel: uses `VERCEL_PROJECT_PRODUCTION_URL` auto-var)
- **GitHub push**: plain `git push` hangs — use `bash .local/push-to-github.sh` instead

## Pointers

- DB schema: `lib/db/src/schema/index.ts`
- API routes: `artifacts/api-server/src/routes/`
- Vercel deployment: `vercel.json` at repo root
- .
