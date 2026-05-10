/**
 * Vercel Serverless Entry Point
 *
 * Exports the Express app without calling app.listen().
 * @vercel/node wraps it automatically as a serverless handler.
 * Bot runs in webhook mode — no polling, no persistent process needed.
 */
import app from "./app";
import { initBotWebhook } from "./bot";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// Warm-up DB connection (fire and forget)
db.execute(sql`SELECT 1`).catch(() => {});

// Webhook URL priority:
//   1. BOT_WEBHOOK_URL  — explicit override (most reliable, set this in Vercel env)
//   2. VERCEL_PROJECT_PRODUCTION_URL — stable production alias (Vercel auto-set)
//   3. VERCEL_URL       — per-deployment URL (Vercel auto-set)
const webhookUrl =
  process.env.BOT_WEBHOOK_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/webhook`
    : null) ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/api/webhook`
    : null);

if (webhookUrl) {
  initBotWebhook(webhookUrl);
}

export default app;
