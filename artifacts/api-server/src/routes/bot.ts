import { Router } from "express";
import { getBot, processUpdateAndWait, initBotWebhook } from "../bot";
import { logger } from "../lib/logger";

const router = Router();

// Health check — always returns 200 so Vercel knows the function is alive
router.get("/health", (_req, res) => {
  res.json({ ok: true, bot: !!getBot(), ts: Date.now() });
});

// POST /api/webhook — Telegram sends all updates here
// We await processUpdateAndWait() BEFORE responding so Vercel does not
// terminate the serverless function before DB writes + sendMessage finish.
router.post("/webhook", async (req, res) => {
  // ── Log every incoming update (visible in Vercel Function Logs) ───────
  const update = req.body;
  const text = update?.message?.text || update?.callback_query?.data || "(no text)";
  const from = update?.message?.from?.username || update?.message?.from?.first_name || "unknown";
  console.log(`[webhook] update_id=${update?.update_id} from=${from} text="${text}"`);

  let botInstance = getBot();

  // Lazy init — if cold-start missed initBotWebhook, do it now
  if (!botInstance) {
    const webhookUrl =
      process.env.BOT_WEBHOOK_URL ||
      "https://jojoxbot-api-server.vercel.app/api/webhook";
    logger.warn({ webhookUrl }, "Bot not initialized at request time — lazy init");
    initBotWebhook(webhookUrl);
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
