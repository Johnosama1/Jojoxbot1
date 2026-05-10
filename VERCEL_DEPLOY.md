# Vercel Deployment Guide — Jo-jokes Lucky Wheel

## Required Environment Variables

Set these in Vercel Dashboard → Project Settings → Environment Variables:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon PostgreSQL connection string |
| `BOT_TOKEN` | ✅ | Telegram bot token from @BotFather |
| `SESSION_SECRET` | ✅ | Random secret string for JWT signing (min 32 chars) |
| `BOT_WEBHOOK_URL` | ⭐ Recommended | Your stable production URL e.g. `https://jo-jokes.vercel.app/api/webhook` |
| `OWNER_TELEGRAM_ID` | ✅ | Your Telegram numeric ID for /admin access |
| `OWNER_USERNAME` | optional | Your Telegram username (without @) |
| `MINI_APP_URL` | optional | Override the Mini App URL shown in bot messages |

## Steps to Deploy

1. Push this project to a GitHub repository
2. Go to [vercel.com](https://vercel.com) → New Project → Import from GitHub
3. Vercel auto-detects `vercel.json` — no framework settings needed
4. Add all environment variables above in Project Settings
5. Click Deploy

## After First Deploy

Once deployed, set `BOT_WEBHOOK_URL` to your stable domain:
```
https://YOUR-PROJECT.vercel.app/api/webhook
```

Then redeploy once so the webhook URL is stable (VERCEL_URL changes per deployment).

## How it works

- **API** (`/api/*`) → Serverless function at `api/index.js` — handles all bot webhooks and REST endpoints
- **Frontend** (`/*`) → Static React app served from `artifacts/app/dist/public`
- **Bot** → Webhook mode only, no polling — responds instantly 24/7

## Database

Use [Neon](https://neon.tech) for a free serverless PostgreSQL:
1. Create a project at neon.tech
2. Copy the connection string
3. Set it as `DATABASE_URL` in Vercel env vars
4. Run schema push once: `pnpm --filter @workspace/db run push`
