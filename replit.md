# Jojox Lucky Wheel

A Telegram Mini App (TMA) featuring a lucky wheel game where users can spin to win USDT prizes. Built with React + Vite frontend and an Express API backend.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/app run dev` — run the frontend (port 5173)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Optional: `NEON_DATABASE_URL` — Neon cloud DB (for Vercel/production)
- Optional: `BOT_TOKEN` — Telegram bot token
- Optional: `SESSION_SECRET` — JWT signing secret

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Wouter (routing), TailwindCSS v4, TanStack Query, TonConnect
- API: Express 5 + Pino logging
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Bot: node-telegram-bot-api

## Where things live

- `artifacts/app/` — React + Vite frontend (Lucky Wheel TMA)
- `artifacts/app/src/pages/` — Route pages (Home, Tasks, Referral, Leaderboard, Wallet, Withdraw, Admin)
- `artifacts/app/src/components/` — UI components (WheelCanvas, TabBar, TopBar, AnimatedBackground, etc.)
- `artifacts/app/src/lib/` — Client utilities (api.ts, userContext.tsx, telegram.ts, tonConnect.ts)
- `artifacts/app/public/` — Static assets (logo, Lottie animations, images)
- `artifacts/api-server/src/routes/` — API route handlers
- `artifacts/api-server/src/bot/` — Telegram bot logic
- `artifacts/api-server/src/middlewares/` — Auth middlewares (Telegram auth, session, access)
- `lib/db/src/schema/` — Drizzle DB schema (users, tasks, withdrawals, wheel-config, admins)
- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth)
- `lib/api-client-react/` — Generated React Query hooks
- `lib/api-zod/` — Generated Zod schemas

## Architecture decisions

- This is a Telegram Mini App — auth is via Telegram's `initData` HMAC verification
- Session tokens are issued by the backend after Telegram auth verification
- TonConnect integration for crypto wallet connections (TON blockchain)
- Frontend runs entirely client-side (no SSR); all data fetching is via React Query
- Sticker cache is warmed at server startup for fast Telegram sticker responses
- Bot can run in webhook mode (production) or polling mode (dev)

## Product

A Telegram Mini App where users:
1. Authenticate via Telegram
2. Spin a lucky wheel to win USDT prizes
3. Complete tasks to earn more spins
4. Refer friends for bonus spins
5. View a leaderboard of top winners
6. Manage their TON wallet and withdraw winnings
7. Admins can configure the wheel and manage users

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- This is a Telegram Mini App — it requires `initData` from Telegram for full auth to work. When running in browser directly, it falls back to a test user.
- The Vite dev proxy for `/api` should NOT be used in Replit — the shared reverse proxy handles routing. The vite.config.ts proxy was removed per Replit conventions.
- `pnpm dev` at workspace root is intentionally not available — use `restart_workflow` to run services.
- The app's `BASE_PATH` env var must be `/` for Replit routing.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
