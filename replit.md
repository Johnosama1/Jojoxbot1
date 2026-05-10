# Jojox Lucky Wheel

A Telegram Mini App where users spin a lucky wheel to win instant USDT/TON rewards on the TON blockchain network.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/app run dev` — run the frontend (Vite dev server)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional env: `TELEGRAM_BOT_TOKEN` / `BOT_TOKEN` — Telegram bot token
- Optional env: `NEON_DATABASE_URL` — cloud Neon DB (preferred over DATABASE_URL)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite + Tailwind CSS v4 + wouter routing
- API: Express 5 + Pino logging
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- TON integration: `@tonconnect/ui-react`, `@ton/core`, `@ton/ton`
- Build: esbuild (ESM bundle)
- Bot: node-telegram-bot-api

## Where things live

- `artifacts/app/` — Frontend React+Vite app (`@workspace/app`)
- `artifacts/app/src/App.tsx` — Root router (wouter) with all page lazy-imports
- `artifacts/app/src/pages/` — HomePage, TasksPage, ReferralPage, WalletPage, WithdrawPage, LeaderboardPage, AdminPage
- `artifacts/app/src/lib/api.ts` — Custom fetch helpers calling the backend
- `artifacts/app/src/lib/userContext.tsx` — Global user state (Telegram initData auth)
- `artifacts/app/public/` — Static assets (bg.jpg, Lottie JSONs, images)
- `artifacts/api-server/` — Express backend (`@workspace/api-server`)
- `artifacts/api-server/src/routes/` — API routes (users, wheel, tasks, withdrawals, admin, etc.)
- `artifacts/api-server/src/bot/` — Telegram bot handlers
- `artifacts/api-server/src/lib/` — logger, tonSender, withdrawalProcessor, settingsCache
- `lib/db/src/schema/` — Drizzle schema: users, tasks, withdrawals, wheel-config, admins
- `lib/api-spec/openapi.yaml` — OpenAPI spec (scaffold only; app uses custom fetch)

## Architecture decisions

- App is a Telegram Mini App — authenticates via `x-telegram-init-data` header
- No traditional auth (no JWT/sessions) — Telegram provides user identity
- TON blockchain integration for crypto withdrawals and wallet connect
- Telegram bot runs in webhook mode in production (polling in dev with no domain)
- DB prefers NEON_DATABASE_URL (cloud Neon) over DATABASE_URL (local Replit DB)
- Frontend calls `/api/*` which is proxied to the api-server; no CORS issues

## Product

- **Spin & Win**: Users spin a configurable lucky wheel to win USDT rewards
- **Auto Spin**: Automated spinning with balance management
- **Tasks**: Complete social tasks (join Telegram channels) to earn bonus spins
- **Referrals**: Invite friends to earn referral bonuses
- **Leaderboard**: Top earners displayed with custom Lottie animations
- **Wallet**: Connect TON wallet, view balance, withdraw earnings
- **Admin Panel**: Configure wheel slots, manage users, control bot settings
- **Subscription Gates**: Channel membership enforcement before rewards

## Gotchas

- Bot uses webhook in production; needs `BOT_WEBHOOK_URL` or `REPLIT_DOMAINS` set
- `DISABLE_BOT=true` to run without bot (useful for local dev without a token)
- Wheel config (`wheel_slots` table) must be seeded for the wheel to work
- App expects Telegram WebApp JS to be present — some features won't work outside Telegram
- Always run `pnpm --filter @workspace/db run push` after schema changes

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
