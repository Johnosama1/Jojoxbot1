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
import { wheelSlotsTable } from "@workspace/db/schema";

// ── v2 wheel slots (matches wheel.ts DEFAULT_SLOTS_V2) ───────────────
const DEFAULT_SLOTS_V2 = [
  { amount: "0.050", probability: 80, displayOrder: 1 },
  { amount: "0.075", probability: 2,  displayOrder: 2 },
  { amount: "0.100", probability: 0,  displayOrder: 3 },
  { amount: "0.200", probability: 0,  displayOrder: 4 },
  { amount: "0.500", probability: 0,  displayOrder: 5 },
  { amount: "1.000", probability: 0,  displayOrder: 6 },
  { amount: "2.000", probability: 0,  displayOrder: 7 },
  { amount: "4.000", probability: 0,  displayOrder: 8 },
];

// Run startup migrations (fire and forget — non-blocking)
async function runStartupMigrations() {
  // Log which DB we are connecting to (helps debug Vercel vs Replit)
  const dbUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || "";
  const dbLabel = process.env.NEON_DATABASE_URL
    ? "NEON_DATABASE_URL"
    : process.env.DATABASE_URL
      ? "DATABASE_URL"
      : "MISSING";
  const dbHost = dbUrl ? new URL(dbUrl).hostname : "—";
  console.log(`[startup] DB source: ${dbLabel} → host: ${dbHost}`);

  if (!process.env.NEON_DATABASE_URL && !process.env.DATABASE_URL) {
    console.error("[startup] CRITICAL: No database URL configured! Set NEON_DATABASE_URL in Vercel env vars.");
    return;
  }

  try {
    await db.execute(sql`SELECT 1`); // warm-up
    console.log("[startup] DB connection OK");
  } catch (e) {
    console.error("[startup] CRITICAL: DB connection failed:", e instanceof Error ? e.message : e);
    console.error("[startup] All user data operations will fail — check NEON_DATABASE_URL in Vercel env vars.");
    return;
  }

  try {
    // Verify critical tables exist (fast schema check)
    await db.execute(sql`SELECT 1 FROM users LIMIT 0`);
    console.log("[startup] Schema OK — users table exists");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[startup] CRITICAL: 'users' table missing:", msg);
    console.error("[startup] Schema was never pushed to Neon DB. Run: pnpm --filter @workspace/db run push");
    return;
  }

  try {
    // Migrate wheel slots to v2 if still on old v1 seed
    const slots = await db.select().from(wheelSlotsTable);
    const amounts = slots.map((s: { amount: string }) => s.amount);
    const isV1 = slots.length > 0 && slots.length <= 7 &&
      amounts.some((a: string) => a === "0.05" || a === "0.10" || a === "0.25");

    if (slots.length === 0 || isV1) {
      if (slots.length > 0) await db.delete(wheelSlotsTable);
      await db.insert(wheelSlotsTable).values(DEFAULT_SLOTS_V2);
      console.log("[startup] Wheel slots migrated to v2");
    } else {
      console.log(`[startup] Wheel slots OK — ${slots.length} slots found`);
    }
  } catch (e) {
    console.warn("[startup] Wheel slot migration skipped:", e instanceof Error ? e.message : e);
  }
}

runStartupMigrations();

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
