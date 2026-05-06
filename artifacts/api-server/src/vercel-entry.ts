/**
 * Vercel serverless entry point.
 * Exports the Express app (no app.listen call).
 * Bot uses webhook mode instead of long-polling.
 */
import app from "./app";
import { initBotWebhook } from "./bot";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// Warm-up DB connection (fire and forget — do NOT crash on failure)
db.execute(sql`SELECT 1`).catch(() => {});

// Determine the stable production webhook URL.
// Priority:
//   1. BOT_WEBHOOK_URL  — explicitly set in Vercel project env vars (preferred)
//   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel auto-var, always the production alias
//   3. VERCEL_URL — Vercel auto-var, unique per deployment (fallback)
const webhookUrl =
  process.env.BOT_WEBHOOK_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/webhook`
    : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/api/webhook`
    : "https://jojoxbot-api-server.vercel.app/api/webhook");

// Initialize bot in webhook mode — no polling, compatible with Vercel Serverless.
initBotWebhook(webhookUrl);

// Export app for Vercel — @vercel/node wraps it as a serverless handler
export default app;
