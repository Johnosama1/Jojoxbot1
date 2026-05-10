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
//   1. BOT_WEBHOOK_URL  — explicitly set in env vars (preferred)
//   2. REPLIT_DOMAINS   — Replit-provided domain (production deploy)
const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
const webhookUrl =
  process.env.BOT_WEBHOOK_URL ||
  (replitDomain ? `https://${replitDomain}/api/webhook` : null);

// Initialize bot in webhook mode only when a URL is available
if (webhookUrl) initBotWebhook(webhookUrl);

// Export app for Vercel — @vercel/node wraps it as a serverless handler
export default app;
