import { Router } from "express";
import { getBot, processUpdateAndWait, initBotWebhook } from "../bot";
import { logger } from "../lib/logger";

const router = Router();

// Health check — always returns 200
router.get("/health", (_req, res) => {
  res.json({ ok: true, bot: !!getBot(), ts: Date.now() });
});


// POST /api/webhook — Telegram sends all updates here
// We await processUpdateAndWait() BEFORE responding so the server
// does not drop the request before DB writes + sendMessage finish.
router.post("/webhook", async (req, res) => {
  // ── Log every incoming update ──────────────────────────────────────────
  const update = req.body;
  const text = update?.message?.text || update?.callback_query?.data || "(no text)";
  const from = update?.message?.from?.username || update?.message?.from?.first_name || "unknown";
  console.log(`[webhook] update_id=${update?.update_id} from=${from} text="${text}"`);

  let botInstance = getBot();

  // Lazy init — if cold-start missed initBotWebhook, do it now
  if (!botInstance) {
    const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
    const webhookUrl =
      process.env.BOT_WEBHOOK_URL ||
      (process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/webhook`
        : null) ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}/api/webhook`
        : null) ||
      (replitDomain ? `https://${replitDomain}/api/webhook` : null);
    logger.warn({ webhookUrl }, "Bot not initialized at request time — lazy init");
    if (webhookUrl) initBotWebhook(webhookUrl);
    botInstance = getBot();
  }

  if (!botInstance) {
    console.error("[webhook] TOKEN missing — cannot initialize bot");
    res.status(200).send("OK"); // ACK so Telegram stops retrying
    return;
  }

  try {
    await processUpdateAndWait(update);
  } catch (err) {
    logger.error({ err }, "Error processing Telegram update");
    console.error("[webhook] Error:", err);
  }

  res.status(200).send("OK");
});

export default router;
