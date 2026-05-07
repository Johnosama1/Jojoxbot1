import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import {
  usersTable,
  botSettingsTable,
  withdrawalsTable,
} from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { executeAutoWithdrawal, isTonConfigured } from "../lib/withdrawalProcessor";
import {
  OWNER_USERNAME,
  isOwner,
  getAdminInfo,
  adminConvState,
  showAdminMenu,
  handleAdminCallback,
  handleAdminText,
  handleAdminPhoto,
} from "./admin";
import {
  enforceSubscription,
  handleSubRecheckCallback,
  clearAllSubCache,
} from "./subscription";
import { isBotEnabled, clearBotEnabledCache, setBotEnabled } from "./control";

const TOKEN = (process.env.TOKEN || process.env.TELEGRAM_BOT_TOKEN)!;

let bot: TelegramBot;

export function getBot(): TelegramBot {
  return bot;
}

// ── Maintenance check helpers ──────────────────────────────────────────────

async function botIsDisabled(): Promise<boolean> {
  return !(await isBotEnabled());
}

async function allowOwnerWhenDisabled(userId: number, username?: string): Promise<boolean> {
  if (userId === 6145230334) return true;
  if (username === OWNER_USERNAME) return true;
  try {
    const [row] = await db
      .select()
      .from(botSettingsTable)
      .where(eq(botSettingsTable.key, "owner_telegram_id"))
      .limit(1);
    if (row?.value && userId === parseInt(row.value)) return true;
  } catch { /* ignore */ }
  return false;
}

async function maybeBlocked(chatId: number, userId: number, username?: string): Promise<boolean> {
  if (!(await botIsDisabled())) return false;
  if (await allowOwnerWhenDisabled(userId, username)) return false;
  await bot.sendMessage(
    chatId,
    "🚧 *البوت تحت الصيانة حالياً*\n\nنحن نقوم بتحديث وتحسين التطبيق\\. عد قريباً\\! 🔧",
    { parse_mode: "MarkdownV2" }
  );
  return true;
}

// ── buildMsg: Telegram message with custom emoji entities ─────────────────

const utf16Len = (s: string): number => {
  let n = 0;
  for (const ch of s) n += (ch.codePointAt(0)! > 0xffff) ? 2 : 1;
  return n;
};

export interface MsgPart { text: string; emojiId?: string }

export function buildMsg(parts: MsgPart[]): { text: string; entities: object[] } {
  let text = "";
  let offset = 0;
  const entities: object[] = [];
  for (const p of parts) {
    if (p.emojiId) {
      entities.push({ type: "custom_emoji", offset, length: utf16Len(p.text), custom_emoji_id: p.emojiId });
    }
    text += p.text;
    offset += utf16Len(p.text);
  }
  return { text, entities };
}

// ── Withdrawal notification ────────────────────────────────────────────────

export async function sendWithdrawalNotification(
  ownerId: number,
  user: { firstName: string; username?: string | null; id: number },
  amount: string,
  walletAddress: string,
  withdrawalId: number
): Promise<void> {
  if (!bot) return;
  try {
    const userName = user.username ? `@${user.username}` : user.firstName || String(user.id);
    await bot.sendMessage(
      ownerId,
      `💸 *طلب سحب جديد #${withdrawalId}*\n\n` +
      `👤 ${userName} (${user.id})\n` +
      `💰 المبلغ: *${parseFloat(amount).toFixed(4)} TON*\n` +
      `📍 العنوان: \`${walletAddress}\``,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ موافقة", callback_data: `withdraw_approve_${withdrawalId}` },
              { text: "❌ رفض", callback_data: `withdraw_reject_${withdrawalId}` },
            ],
          ],
        },
      }
    );
  } catch (err) {
    logger.error({ err, ownerId }, "sendWithdrawalNotification failed");
  }
}

// ── processUpdateAndWait: for webhook mode ────────────────────────────────

export async function processUpdateAndWait(update: TelegramBot.Update): Promise<void> {
  if (!bot) return;
  try {
    // node-telegram-bot-api processes updates automatically in webhook mode
    // via processUpdate. This lets us await any async side effects.
    (bot as unknown as { processUpdate: (u: TelegramBot.Update) => void }).processUpdate(update);
    // Allow event loop to flush async handlers
    await new Promise<void>((resolve) => setImmediate(resolve));
  } catch (err) {
    logger.error({ err }, "processUpdateAndWait error");
  }
}

// ── Welcome & menu ──────────────────────────────────────────────────────────

export async function sendWelcomeMessage(chatId: number, userId: number, firstName: string) {
  const MINI_APP_URL = process.env.MINI_APP_URL || "https://jojoxbot-api-server.vercel.app/app/";

  const { text: welcomeText, entities: welcomeEntities } = buildMsg([
    { text: "👋", emojiId: "5319007286004299794" },
    { text: ` Welcome to Jo-jokes, ${firstName}!\n\n` },
    { text: "😀", emojiId: "6129832240303051599" },
    { text: " The fastest USDT earning bot!\n\n" },
    { text: "✨", emojiId: "6131673419768403090" },
    { text: " How to earn" },
    { text: "❓", emojiId: "5436113877181941026" },
    { text: "\n\n" },
    { text: "✅", emojiId: "6203840986443944067" },
    { text: " Complete tasks " },
    { text: "⬅️", emojiId: "6131729520631223468" },
    { text: " 1 spin per " },
    { text: "5️⃣", emojiId: "6203785577070858514" },
    { text: " tasks\n\n" },
    { text: "👥", emojiId: "6204118338252049831" },
    { text: " Invite friends " },
    { text: "⬅️", emojiId: "6131729520631223468" },
    { text: " 1 free spin per " },
    { text: "5️⃣", emojiId: "6203785577070858514" },
    { text: " friends\n\n" },
    { text: "🎰", emojiId: "5104986024807760966" },
    { text: " Spin the wheel " },
    { text: "⬅️", emojiId: "6131729520631223468" },
    { text: " win 0.1 to 10 USDT!" },
  ]);

  await bot.sendMessage(chatId, welcomeText, {
    entities: welcomeEntities as never,
    reply_markup: {
      inline_keyboard: [
        [{ text: "🎁 Open now", web_app: { url: `${MINI_APP_URL}?uid=${userId}` } }],
      ],
    },
  });
}

function setMenuButton() {
  // Use default menu button — WebApp must only open after subscription is verified via bot
  fetch(`https://api.telegram.org/bot${TOKEN}/setChatMenuButton`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ menu_button: { type: "default" } }),
  }).catch(() => {});
}

// ── Withdrawal callback handler ─────────────────────────────────────────────

async function handleWithdrawalCallback(
  q: TelegramBot.CallbackQuery
): Promise<boolean> {
  const data = q.data ?? "";
  if (!data.startsWith("withdraw_approve_") && !data.startsWith("withdraw_reject_")) return false;

  const chatId = q.message!.chat.id;
  const msgId = q.message!.message_id;
  const adminInfo = await getAdminInfo(q.from.id, q.from.username);

  if (!adminInfo) {
    await bot.answerCallbackQuery(q.id, { text: "⛔ غير مصرح" });
    return true;
  }

  await bot.answerCallbackQuery(q.id);

  if (data.startsWith("withdraw_approve_")) {
    const wId = parseInt(data.replace("withdraw_approve_", ""));
    if (isNaN(wId)) return true;
    const [w] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, wId)).limit(1);
    if (!w) { await bot.sendMessage(chatId, "❌ الطلب غير موجود"); return true; }
    if (w.status !== "pending") {
      await bot.sendMessage(chatId, `⚠️ الطلب #${wId} بالفعل ${w.status}`);
      return true;
    }
    if (w.status === "pending" && isTonConfigured()) {
      try {
        const result = await executeAutoWithdrawal(w.id, chatId);
        if (result.success) {
          await bot.editMessageText(
            `✅ *تم التحويل التلقائي*\n\nطلب #${wId} — ${parseFloat(w.amount).toFixed(4)} TON\n📍 \`${w.walletAddress}\`\n🔗 المرجع: \`${result.txHash}\``,
            { chat_id: chatId, message_id: msgId, parse_mode: "Markdown" }
          );
        } else {
          await bot.sendMessage(chatId, `❌ فشل التحويل: ${result.error}`);
        }
      } catch (err) {
        await bot.sendMessage(chatId, `❌ فشل التحويل التلقائي: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      await db
        .update(withdrawalsTable)
        .set({ status: "approved", processedAt: new Date() })
        .where(eq(withdrawalsTable.id, wId));
      try {
        await bot.sendMessage(
          w.userId,
          `✅ *تم الموافقة على طلب السحب #${wId}*\n💰 المبلغ: *${parseFloat(w.amount).toFixed(4)} TON*\n📍 العنوان: \`${w.walletAddress}\`\n\n✅ تم التحويل! شكراً.`,
          { parse_mode: "Markdown" }
        );
      } catch { /* ignore */ }
      await bot.editMessageText(
        `✅ تمت الموافقة على الطلب #${wId}`,
        { chat_id: chatId, message_id: msgId, parse_mode: "Markdown" }
      );
    }
  } else if (data.startsWith("withdraw_reject_")) {
    const wId = parseInt(data.replace("withdraw_reject_", ""));
    if (isNaN(wId)) return true;
    const [w] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, wId)).limit(1);
    if (!w) { await bot.sendMessage(chatId, "❌ الطلب غير موجود"); return true; }
    if (w.status !== "pending") {
      await bot.sendMessage(chatId, `⚠️ الطلب #${wId} بالفعل ${w.status}`);
      return true;
    }
    await db
      .update(withdrawalsTable)
      .set({ status: "rejected" })
      .where(eq(withdrawalsTable.id, wId));
    await db
      .update(usersTable)
      .set({ balance: sql`balance + ${w.amount}` })
      .where(eq(usersTable.id, w.userId));
    try {
      await bot.sendMessage(
        w.userId,
        `❌ *تم رفض طلب السحب #${wId}*\n💰 تم إعادة *${parseFloat(w.amount).toFixed(4)} TON* لرصيدك.`,
        { parse_mode: "Markdown" }
      );
    } catch { /* ignore */ }
    await bot.editMessageText(
      `❌ تم رفض الطلب #${wId} وإعادة المبلغ لرصيد المستخدم.`,
      { chat_id: chatId, message_id: msgId }
    );
  }

  return true;
}

// ── Bot setup ────────────────────────────────────────────────────────────────

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

  // ── /start ────────────────────────────────────────────────────────────────
  bot.onText(/\/start(.*)/, async (msg, match) => {
    try {
      const chatId = msg.chat.id;
      const userId = msg.from!.id;
      const username = msg.from?.username;
      const firstName = msg.from?.first_name || "";
      const lastName = msg.from?.last_name || "";

      if (await maybeBlocked(chatId, userId, username)) return;

      const refParam = match?.[1]?.trim();
      let referredBy: number | undefined;
      if (refParam?.startsWith("ref_")) {
        const refId = parseInt(refParam.replace("ref_", ""));
        if (!isNaN(refId) && refId !== userId) referredBy = refId;
      }

      const existing = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);

      if (existing.length > 0 && existing[0].isVisible === false) {
        await bot.sendMessage(chatId, "🚫 حسابك محظور\\. تواصل مع الدعم للمزيد من المعلومات\\.", { parse_mode: "MarkdownV2" });
        return;
      }

      const isNew = existing.length === 0;
      if (isNew) {
        await db
          .insert(usersTable)
          .values({
            id: userId,
            username: username || null,
            firstName,
            lastName,
            referredBy: referredBy ?? null,
            spins: 0,
          })
          .onConflictDoNothing();
      } else {
        await db
          .update(usersTable)
          .set({
            username: username || existing[0].username,
            firstName: firstName || existing[0].firstName,
          })
          .where(eq(usersTable.id, userId));
      }

      // ── Subscription check for ALL users (new and existing) ─────────────
      const adminInfo = await getAdminInfo(userId, username);
      if (!adminInfo) {
        const blocked = await enforceSubscription(bot, chatId, userId);
        if (blocked) return;
      }

      await sendWelcomeMessage(chatId, userId, firstName);
    } catch (err) {
      logger.error({ err }, "Error in /start handler");
    }
  });

  // ── /admin ────────────────────────────────────────────────────────────────
  bot.onText(/^\/admin$/, async (msg) => {
    const userId = msg.from!.id;
    const username = msg.from?.username;
    const info = await getAdminInfo(userId, username);
    if (!info) return;
    await showAdminMenu(bot, msg.chat.id, undefined, info);
  });

  // ── /setowner ─────────────────────────────────────────────────────────────
  bot.onText(/^\/setowner$/, async (msg) => {
    const userId = msg.from!.id;
    const username = msg.from?.username;
    if (username !== OWNER_USERNAME) return;
    await db
      .insert(botSettingsTable)
      .values({ key: "owner_telegram_id", value: String(userId) })
      .onConflictDoUpdate({ target: botSettingsTable.key, set: { value: String(userId) } });
    await bot.sendMessage(
      msg.chat.id,
      `✅ تم تسجيلك كمالك للبوت!\nID: ${userId}\nاستخدم /admin للوصول إلى لوحة التحكم.`
    );
  });

  // ── Global callback_query handler ─────────────────────────────────────────
  bot.on("callback_query", async (q) => {
    if (!q.message) {
      await bot.answerCallbackQuery(q.id).catch(() => {});
      return;
    }

    const userId = q.from.id;
    const chatId = q.message.chat.id;
    const data = q.data ?? "";

    try {
      // 1. sub_recheck is handled first (no maintenance block for it)
      if (data === "sub_recheck") {
        await handleSubRecheckCallback(bot, q);
        return;
      }

      // 2. Get admin info
      const adminInfo = await getAdminInfo(userId, q.from.username);

      // 3. Maintenance check for non-admins
      if (!adminInfo) {
        if (await botIsDisabled()) {
          await bot.answerCallbackQuery(q.id, {
            text: "🚧 البوت تحت الصيانة حالياً. حاول مرة أخرى لاحقاً.",
            show_alert: true,
          }).catch(() => {});
          return;
        }
      }

      // 4. Admin callbacks (adm:* prefix)
      if (data.startsWith("adm:") && adminInfo) {
        await handleAdminCallback(bot, q);
        return;
      }

      // 5. Withdrawal approval/rejection (admin)
      if ((data.startsWith("withdraw_approve_") || data.startsWith("withdraw_reject_")) && adminInfo) {
        await handleWithdrawalCallback(q);
        return;
      }

      // 6. Subscription check for non-admin callbacks
      if (!adminInfo) {
        const blocked = await enforceSubscription(bot, chatId, userId, q.id);
        if (blocked) return;
      }

      // 7. Fallback — answer to remove loading state
      await bot.answerCallbackQuery(q.id).catch(() => {});
    } catch (err) {
      logger.error({ err, data, userId }, "callback_query handler error");
      await bot.answerCallbackQuery(q.id).catch(() => {});
    }
  });

  // ── Global message handler ────────────────────────────────────────────────
  bot.on("message", async (msg) => {
    if (!msg.from) return;

    // Commands handled by onText — skip here to avoid double processing
    if (msg.text?.startsWith("/")) return;

    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username;

    try {
      const adminInfo = await getAdminInfo(userId, username);

      // Maintenance check for non-admins (silent — don't send duplicate message)
      if (!adminInfo && await botIsDisabled()) return;

      // Admin photo handler (task icon uploads)
      if (adminInfo && msg.photo) {
        if (await handleAdminPhoto(bot, msg)) return;
      }

      // Admin text/conversation state-machine handler
      if (adminInfo) {
        if (await handleAdminText(bot, msg)) return;
      }

      // Regular user message — check subscription if there is text
      if (!adminInfo && msg.text) {
        const blocked = await enforceSubscription(bot, chatId, userId);
        if (blocked) return;
        // No further command routing for now
      }
    } catch (err) {
      logger.error({ err, userId }, "message handler error");
    }
  });
}
