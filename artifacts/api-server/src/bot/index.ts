import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import {
  usersTable,
  botSettingsTable,
  withdrawalsTable,
} from "@workspace/db/schema";
import { eq, sql, desc, and, gt } from "drizzle-orm";
import { logger } from "../lib/logger";
import { executeAutoWithdrawal, isTonConfigured } from "../lib/withdrawalProcessor";
import {
  OWNER_USERNAME,
  isOwner,
  getAdminInfo,
  adminConvState,
  showAdminMenu,
  handleAdminCallback,
  handleNewAdminPermsCallback,
  handleAdminText,
  handleAdminPhoto,
} from "./admin";
import { enforceSubscription, handleSubRecheckCallback, withVerification } from "./subscription";
import { isBotEnabled } from "./control";

const TOKEN = (process.env.TOKEN || process.env.TELEGRAM_BOT_TOKEN)!;

let bot: TelegramBot;

export function getBot(): TelegramBot {
  return bot;
}

function getBotEnabledSetting() {
  return db
    .select()
    .from(botSettingsTable)
    .where(eq(botSettingsTable.key, "bot_enabled"))
    .limit(1)
    .then((rows) => rows.length === 0 ? true : rows[0].value !== "false");
}

async function botIsDisabled() {
  return !(await getBotEnabledSetting());
}

async function allowOwnerWhenDisabled(userId: number) {
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return userId === 6145230334 || u?.username === OWNER_USERNAME;
}

async function maybeBlocked(chatId: number, userId: number): Promise<boolean> {
  if (!(await botIsDisabled())) return false;
  if (await allowOwnerWhenDisabled(userId)) return false;
  await bot.sendMessage(chatId, "⏸️ البوت متوقف حالياً. يمكنك تشغيله من لوحة الأدمن.");
  return true;
}

async function sendWelcomeMessage(chatId: number, userId: number, firstName: string) {
  const MINI_APP_URL = process.env.MINI_APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/`;
  await bot.sendMessage(chatId, `👋 Welcome to Jo-jokes, ${firstName}!`, {
    reply_markup: {
      inline_keyboard: [[{ text: "🎁 Open now", web_app: { url: `${MINI_APP_URL}?uid=${userId}` } }]],
    },
  });
}

function setMenuButton() {
  const MINI_APP_URL = process.env.MINI_APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/`;
  fetch(`https://api.telegram.org/bot${TOKEN}/setChatMenuButton`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ menu_button: { type: "web_app", text: "🎡 Play", web_app: { url: MINI_APP_URL } } }),
  }).catch(() => {});
}

export function initBotWebhook(webhookUrl: string) {
  if (!TOKEN) return;
  bot = new TelegramBot(TOKEN, {});
  bot.setWebHook(webhookUrl).catch(err => logger.error({ err }, "Failed to set webhook"));
  setupBotHandlers();
  setMenuButton();
}

export function initBotPolling() {
  if (!TOKEN) return;
  bot = new TelegramBot(TOKEN, { polling: true });
  setupBotHandlers();
  setMenuButton();
}

function setupBotHandlers() {
  bot.onText(/\/start(.*)/, async (msg, match) => {
    try {
      const chatId = msg.chat.id;
      const userId = msg.from!.id;
      if (await maybeBlocked(chatId, userId)) return;
      const username = msg.from?.username;
      const firstName = msg.from?.first_name || "";
      const lastName = msg.from?.last_name || "";
      const refParam = match?.[1]?.trim();
      let referredBy: number | undefined;
      if (refParam?.startsWith("ref_")) {
        const refId = parseInt(refParam.replace("ref_", ""));
        if (!isNaN(refId) && refId !== userId) referredBy = refId;
      }
      const existing = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
      if (existing.length > 0 && existing[0].isVisible === false) {
        await bot.sendMessage(chatId, "🚫 Your account has been banned from this bot.");
        return;
      }
      const isNew = existing.length === 0;
      if (isNew) {
        await db.insert(usersTable).values({ id: userId, username: username || null, firstName, lastName, referredBy: referredBy ?? null, spins: 0 }).onConflictDoNothing();
      } else {
        await db.update(usersTable).set({ username: username || existing[0].username, firstName: firstName || existing[0].firstName }).where(eq(usersTable.id, userId));
      }
      if (!isNew) {
        const blocked = await enforceSubscription(bot, chatId, userId);
        if (blocked) return;
      }
      await sendWelcomeMessage(chatId, userId, firstName);
    } catch (err) {
      logger.error({ err }, "Error in /start handler");
    }
  });

  bot.onText(/^\/admin$/, async (msg) => {
    const userId = msg.from!.id;
    const username = msg.from?.username;
    const info = await getAdminInfo(userId, username);
    if (!info) return;
    await showAdminMenu(bot, msg.chat.id, undefined, info);
  });

  bot.onText(/^\/setowner$/, async (msg) => {
    const userId = msg.from!.id;
    const username = msg.from?.username;
    if (username !== OWNER_USERNAME) return;
    await db.insert(botSettingsTable).values({ key: "owner_telegram_id", value: String(userId) }).onConflictDoUpdate({ target: botSettingsTable.key, set: { value: String(userId) } });
    await bot.sendMessage(msg.chat.id, `✅ You are now registered as bot owner!\nID: ${userId}\nUse /admin to access the control panel.`);
  });
}
