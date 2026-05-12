import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getSetting } from "../lib/settingsCache";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/config", async (_req, res) => {
  const [rawRef, rawTask, rawMin] = await Promise.all([
    getSetting("referral_threshold").catch(() => null),
    getSetting("task_threshold").catch(() => null),
    getSetting("min_withdrawal").catch(() => null),
  ]);
  res.json({
    botUsername: process.env.BOT_USERNAME || "Jojox1bot",
    referralThreshold: Math.max(1, parseInt(rawRef ?? "5") || 5),
    taskThreshold: Math.max(1, parseInt(rawTask ?? "5") || 5),
    minWithdrawal: Math.max(0.01, parseFloat(rawMin ?? "0.1") || 0.1),
  });
});

// ── Diagnostic endpoint — shows DB + env status (safe, no secrets exposed) ──
router.get("/debug", async (_req, res) => {
  let dbOk = false;
  let dbError = "";
  try {
    await db.execute(sql`SELECT 1`);
    dbOk = true;
  } catch (e) {
    dbError = e instanceof Error ? e.message.slice(0, 120) : String(e);
  }

  res.json({
    db: dbOk ? "✅ connected" : `❌ ${dbError}`,
    env: {
      NODE_ENV: process.env.NODE_ENV || "—",
      NEON_DATABASE_URL: process.env.NEON_DATABASE_URL ? "✅ set" : "❌ missing",
      DATABASE_URL: process.env.DATABASE_URL ? "✅ set" : "❌ missing",
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN ? "✅ set" : "❌ missing",
      BOT_TOKEN: process.env.BOT_TOKEN ? "✅ set" : "❌ missing",
      SESSION_TOKEN_SECRET: process.env.SESSION_TOKEN_SECRET ? "✅ set" : "— (using BOT_TOKEN fallback)",
      BOT_WEBHOOK_URL: process.env.BOT_WEBHOOK_URL || "❌ missing",
      MINI_APP_URL: process.env.MINI_APP_URL || "— (using Vercel auto-detect)",
      VERCEL_URL: process.env.VERCEL_URL || "— (not Vercel)",
      VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL || "— (not Vercel)",
    },
  });
});

export default router;
