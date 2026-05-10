import { Router } from "express";
import { getBot, processUpdateAndWait, initBotWebhook } from "../bot";
import { logger } from "../lib/logger";

const router = Router();

// Health check — always returns 200 so Vercel knows the function is alive
router.get("/health", (_req, res) => {
  res.json({ ok: true, bot: !!getBot(), ts: Date.now() });
});

// Diagnostic: send a test message and return the raw Telegram API result
// Usage: GET /api/test-send?chat_id=6145230334
router.get("/test-send", async (req, res) => {
  const TOKEN =
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.BOT_TOKEN ||
    process.env.TOKEN ||
    "";
  const MINI_APP_URL = process.env.MINI_APP_URL || "";
  const chatId = Number(req.query.chat_id) || 6145230334;
  const results: Record<string, unknown> = {
    env: { TOKEN_set: !!TOKEN, MINI_APP_URL: MINI_APP_URL || "(not set)" },
  };

  // Test 1: plain text, no button
  try {
    const r1 = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: "🔍 Diagnostic test 1: plain text" }),
    });
    results.test1_plain = await r1.json();
  } catch (e: unknown) { results.test1_plain = { error: String(e) }; }

  // Test 2: HTML parse_mode
  try {
    const r2 = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: "🔍 Diagnostic test 2: <b>HTML bold</b>\n\nLine 3\n\nLine 4\n\nLine 5\n\nLine 6",
        parse_mode: "HTML",
      }),
    });
    results.test2_html = await r2.json();
  } catch (e: unknown) { results.test2_html = { error: String(e) }; }

  // Test 3: HTML + web_app button (with MINI_APP_URL)
  if (MINI_APP_URL) {
    try {
      const r3 = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "🔍 Diagnostic test 3: HTML + web_app button",
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: [[{ text: "Open", web_app: { url: MINI_APP_URL } }]] },
        }),
      });
      results.test3_webapp = await r3.json();
    } catch (e: unknown) { results.test3_webapp = { error: String(e) }; }
  } else {
    results.test3_webapp = "SKIPPED: MINI_APP_URL not set";
  }

  // Test 4: getWebhookInfo
  try {
    const r4 = await fetch(`https://api.telegram.org/bot${TOKEN}/getWebhookInfo`);
    results.webhook_info = await r4.json();
  } catch (e: unknown) { results.webhook_info = { error: String(e) }; }

  res.json(results);
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
    const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
    const webhookUrl =
      process.env.BOT_WEBHOOK_URL ||
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
