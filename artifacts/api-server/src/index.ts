import app from "./app";
import { logger } from "./lib/logger";
import { initBotWebhook, initBotPolling, getBot } from "./bot";
import { startReferralMonitor, runInitialSecurityScan } from "./bot/referralMonitor";
import { db } from "@workspace/db";
import { pool } from "@workspace/db";
import { sql } from "drizzle-orm";

const t0 = Date.now();

const rawPort = process.env["PORT"] || "8080";
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const server = app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  const httpMs = Date.now() - t0;
  logger.info({ port, startupMs: httpMs }, "Server listening");

  // DB warm-up and bot start run in parallel — neither blocks the server
  const tBot = Date.now();
  db.execute(sql`SELECT 1`).catch(() => {});

  if (process.env.DISABLE_BOT !== "true") {
    // Prefer explicit env var; fall back to Replit production domain auto-detection
    const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
    const webhookUrl =
      process.env.BOT_WEBHOOK_URL ||
      (replitDomain ? `https://${replitDomain}/api/webhook` : undefined);

    if (webhookUrl) {
      initBotWebhook(webhookUrl);
      logger.info({ botMs: Date.now() - tBot, webhookUrl }, "Telegram bot started (webhook mode)");
    } else {
      initBotPolling();
      logger.info({ botMs: Date.now() - tBot }, "Telegram bot started (polling mode)");
    }
    // Start fast + hourly referral monitor after bot initializes
    try {
      startReferralMonitor(getBot());
    } catch (e) {
      logger.warn({ e }, "referralMonitor: failed to start");
    }
    // One-time initial security scan: runs 10s after startup to cover ALL existing users
    setTimeout(() => {
      runInitialSecurityScan(getBot()).catch(err =>
        logger.warn({ err }, "initialScan: startup run error (non-critical)")
      );
    }, 10_000);
  } else {
    logger.info("Bot disabled (DISABLE_BOT=true)");
  }
});

// Keep-alive: longer timeout prevents premature connection drops
server.keepAliveTimeout = 65_000;
server.headersTimeout   = 66_000;

// Self-ping every 14 min in production to prevent Replit sleep
if (process.env.NODE_ENV === "production") {
  setInterval(async () => {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) logger.warn({ status: res.status }, "Keep-alive ping failed");
    } catch { /* ignore */ }
  }, 14 * 60_000);
}

// Graceful shutdown
function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT",  () => shutdown("SIGINT"));
