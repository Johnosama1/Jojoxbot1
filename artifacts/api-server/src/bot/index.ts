import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import {
  usersTable,
  botSettingsTable,
  withdrawalsTable,
} from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { getSetting } from "../lib/settingsCache";
import { logger } from "../lib/logger";
import { executeAutoWithdrawal, isTonConfigured } from "../lib/withdrawalProcessor";
import { getWalletAddress, getWalletBalance } from "../lib/tonSender";
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
  clearSubCache,
} from "./subscription";
import { isBotEnabled, clearBotEnabledCache, setBotEnabled } from "./control";

const TOKEN =
  process.env.TELEGRAM_BOT_TOKEN ||
  process.env.BOT_TOKEN ||
  process.env.TOKEN ||
  "";

let bot: TelegramBot;

export function getBot(): TelegramBot {
  return bot;
}

// ── Async handler tracking ─────────────────────────────────────────────────────
// node-telegram-bot-api fires handlers via EventEmitter (fire-and-forget).
// We collect all handler promises and await them in processUpdateAndWait
// to ensure DB writes + sendMessage finish before the response is sent.
const _handlerPromises: Promise<void>[] = [];

function wrapHandler<T extends unknown[]>(
  fn: (...args: T) => Promise<void> | void
): (...args: T) => void {
  return (...args: T) => {
    const result = fn(...args);
    if (result instanceof Promise) {
      _handlerPromises.push(result.catch(err => logger.error({ err }, "Bot handler error")));
    }
  };
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
    "🚧 <b>البوت تحت الصيانة حالياً</b>\n\nنحن نقوم بتحديث وتحسين التطبيق. عد قريباً! 🔧",
    { parse_mode: "HTML" }
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

export function buildMsg(parts: MsgPart[]): { text: string; entities: TelegramBot.MessageEntity[] } {
  let text = "";
  let offset = 0;
  const entities: TelegramBot.MessageEntity[] = [];
  for (const p of parts) {
    if (p.emojiId) {
      entities.push({ type: "custom_emoji", offset, length: utf16Len(p.text), custom_emoji_id: p.emojiId });
    }
    text += p.text;
    offset += utf16Len(p.text);
  }
  return { text, entities };
}

// ── HTML escape helper ─────────────────────────────────────────────────────
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── Withdrawal notification ────────────────────────────────────────────────

export async function sendWithdrawalNotification(
  ownerId: number,
  user: { firstName: string; username?: string | null; id: number },
  amount: string,
  walletAddress: string,
  withdrawalId: number,
  riskScore?: number
): Promise<void> {
  if (!bot) return;
  try {
    const userName = user.username
      ? `@${esc(user.username)}`
      : esc(user.firstName || String(user.id));

    const riskLine = riskScore !== undefined
      ? `\n🎯 درجة الخطر: <b>${riskScore}/100</b> ${riskScore >= 61 ? "🔴" : riskScore >= 31 ? "⚠️" : "✅"}`
      : "";

    await bot.sendMessage(
      ownerId,
      `💸 <b>طلب سحب جديد #${withdrawalId}</b>\n\n` +
      `👤 ${userName} (${user.id})\n` +
      `💰 المبلغ: <b>${parseFloat(amount).toFixed(4)} TON</b>\n` +
      `📍 العنوان: <code>${esc(walletAddress)}</code>` +
      riskLine,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ قبول وتحويل", callback_data: `withdraw_approve_${withdrawalId}` },
              { text: "❌ رفض وإرجاع", callback_data: `withdraw_reject_${withdrawalId}` },
            ],
            [
              { text: "🚫 حظر المستخدم", callback_data: `withdraw_ban_${user.id}_${withdrawalId}` },
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
  _handlerPromises.length = 0; // Clear previous cycle's promises
  try {
    // Trigger all registered handlers synchronously; wrapped handlers push
    // their Promise into _handlerPromises before returning.
    (bot as unknown as { processUpdate: (u: TelegramBot.Update) => void }).processUpdate(update);
    // Give synchronous code one tick to register promises
    await new Promise<void>((resolve) => setImmediate(resolve));
    // Now await every async handler before returning the response
    if (_handlerPromises.length > 0) {
      await Promise.allSettled([..._handlerPromises]);
    }
  } catch (err) {
    logger.error({ err }, "processUpdateAndWait error");
  } finally {
    _handlerPromises.length = 0;
  }
}

// ── Welcome & menu ──────────────────────────────────────────────────────────

export async function sendWelcomeMessage(chatId: number, userId: number, firstName: string) {
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const MINI_APP_URL =
    process.env.MINI_APP_URL ||
    (replitDomain ? `https://${replitDomain}` : "") ||
    (vercelDomain ? `https://${vercelDomain}` : "");

  const [rawRefThresh, rawTaskThresh] = await Promise.all([
    getSetting("referral_threshold").catch(() => null),
    getSetting("task_threshold").catch(() => null),
  ]);
  const refThresh  = Math.max(1, parseInt(rawRefThresh  ?? "5") || 5);
  const taskThresh = Math.max(1, parseInt(rawTaskThresh ?? "5") || 5);

  const toKeycap = (n: number) => String(n).split("").map(d => `${d}\uFE0F\u20E3`).join("");
  const E = (id: string, emoji: string) => `<tg-emoji emoji-id="${id}">${emoji}</tg-emoji>`;

  const welcomeHtml =
    `${E("5319007286004299794", "👋")} Welcome to Jo-jokes, ${esc(firstName)}!\n\n` +
    `${E("6129832240303051599", "😀")} The fastest USDT earning bot!\n\n` +
    `${E("6131673419768403090", "✨")} How to earn${E("5436113877181941026", "❓")}\n\n` +
    `✅ Complete tasks ${E("5215229232476596064", "➡️")} 1 spin per ${toKeycap(taskThresh)} tasks\n\n` +
    `👥 Invite friends ${E("5215229232476596064", "➡️")} 1 free spin per ${toKeycap(refThresh)} friends\n\n` +
    `${E("5104986024807760966", "🎰")} Spin the wheel ${E("5215229232476596064", "➡️")} win 0.1 to 10 USDT!`;

  await bot.sendMessage(chatId, welcomeHtml, {
    parse_mode: "HTML",
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
  if (!data.startsWith("withdraw_approve_") && !data.startsWith("withdraw_reject_") && !data.startsWith("withdraw_ban_")) return false;

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
    // Always execute TON transfer on admin approval
    if (isTonConfigured()) {
      try {
        const result = await executeAutoWithdrawal(w.id, chatId);
        if (result.success) {
          await bot.editMessageText(
            `✅ <b>تم التحويل بنجاح</b>\n\n` +
            `طلب #${wId} — ${parseFloat(w.amount).toFixed(4)} TON\n` +
            `📍 <code>${esc(w.walletAddress)}</code>\n` +
            `🔗 المرجع: <code>${esc(result.txHash ?? "")}</code>`,
            { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
          );
        } else {
          await bot.sendMessage(chatId, `❌ فشل التحويل: ${esc(result.error ?? "")}`, { parse_mode: "HTML" });
        }
      } catch (err) {
        await bot.sendMessage(chatId, `❌ فشل التحويل: ${esc(err instanceof Error ? err.message : String(err))}`, { parse_mode: "HTML" });
      }
    } else {
      // TON wallet not configured — mark approved but no transfer executed
      await db
        .update(withdrawalsTable)
        .set({ status: "approved", processedAt: new Date() })
        .where(eq(withdrawalsTable.id, wId));
      try {
        await bot.sendMessage(
          w.userId,
          `✅ <b>تمت الموافقة على طلب السحب #${wId}</b>\n` +
          `💰 المبلغ: <b>${parseFloat(w.amount).toFixed(4)} TON</b>\n` +
          `📍 العنوان: <code>${esc(w.walletAddress)}</code>\n\n` +
          `سيتم معالجة التحويل قريباً.`,
          { parse_mode: "HTML" }
        );
      } catch { /* ignore */ }
      await bot.editMessageText(
        `✅ تمت الموافقة على الطلب #${wId}\n` +
        `⚠️ محفظة TON غير مُهيَّأة — يُرجى إعداد المحفظة لإتمام التحويل.`,
        { chat_id: chatId, message_id: msgId }
      );
    }
  } else if (data.startsWith("withdraw_reject_")) {
    const wId = parseInt(data.replace("withdraw_reject_", ""));
    if (isNaN(wId)) return true;
    const [w] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, wId)).limit(1);
    if (!w) { await bot.sendMessage(chatId, "❌ الطلب غير موجود"); return true; }
    if (w.status !== "pending") {
      await bot.sendMessage(chatId, `⚠️ الطلب #${wId} بالفعل ${esc(w.status)}`);
      return true;
    }
    await db
      .update(withdrawalsTable)
      .set({ status: "rejected" })
      .where(eq(withdrawalsTable.id, wId));
    await db
      .update(usersTable)
      .set({ tonBalance: sql`ton_balance + ${w.amount}` })
      .where(eq(usersTable.id, w.userId));
    try {
      await bot.sendMessage(
        w.userId,
        `❌ <b>تم رفض طلب السحب #${wId}</b>\n` +
        `💰 تم إعادة <b>${parseFloat(w.amount).toFixed(4)} TON</b> لرصيدك داخل البوت.`,
        { parse_mode: "HTML" }
      );
    } catch { /* ignore */ }
    await bot.editMessageText(
      `❌ تم رفض الطلب #${wId}\n💰 أُعيد ${parseFloat(w.amount).toFixed(4)} TON لرصيد المستخدم.`,
      { chat_id: chatId, message_id: msgId }
    );
  } else if (data.startsWith("withdraw_ban_")) {
    const parts = data.replace("withdraw_ban_", "").split("_");
    const targetUserId = parseInt(parts[0]);
    const wId = parseInt(parts[1]);
    if (isNaN(targetUserId) || isNaN(wId)) return true;

    await db.update(usersTable).set({ isVisible: false }).where(eq(usersTable.id, targetUserId));

    const [w] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, wId)).limit(1);
    if (w && w.status === "pending") {
      await db.update(withdrawalsTable).set({ status: "rejected" }).where(eq(withdrawalsTable.id, wId));
      await db.update(usersTable).set({ tonBalance: sql`ton_balance + ${w.amount}` }).where(eq(usersTable.id, w.userId));
    }

    await bot.editMessageText(
      `🚫 <b>تم حظر المستخدم #${targetUserId}</b>\n` +
      (w ? `❌ الطلب #${wId} مرفوض وأُعيد ${parseFloat(w.amount).toFixed(4)} TON للرصيد.` : `❌ الطلب #${wId} مرفوض.`),
      { chat_id: chatId, message_id: msgId, parse_mode: "HTML" }
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
  bot.onText(/\/start\s*(.*)/, wrapHandler(async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const username = msg.from?.username;
    const firstName = msg.from?.first_name || "";
    const lastName = msg.from?.last_name || "";

    try {
      if (await maybeBlocked(chatId, userId, username)) return;

      // Clear subscription cache so /start always does a live channel check
      clearSubCache(userId);

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
        await bot.sendMessage(chatId, "🚫 حسابك محظور. تواصل مع الدعم للمزيد من المعلومات.", { parse_mode: "HTML" });
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

        // ── Referral reward for inviter ───────────────────────────────────────
        if (referredBy) {
          try {
            const rawThreshold = await getSetting("referral_threshold").catch(() => null);
            const refThreshold = Math.max(1, parseInt(rawThreshold ?? "5") || 5);

            // Atomically increment inviter's referralCount
            const [inviter] = await db
              .update(usersTable)
              .set({ referralCount: sql`referral_count + 1` })
              .where(eq(usersTable.id, referredBy))
              .returning({ id: usersTable.id, referralCount: usersTable.referralCount });

            if (inviter) {
              const newCount = inviter.referralCount;
              const earnedSpin = newCount % refThreshold === 0;

              if (earnedSpin) {
                await db
                  .update(usersTable)
                  .set({ spins: sql`spins + 1` })
                  .where(eq(usersTable.id, referredBy));
              }

              // Notify inviter
              try {
                const notifyText = earnedSpin
                  ? `🎉 <b>مبروك!</b> صديق جديد انضم عبر رابطك!\n🎰 حصلت على لفة مجانية! (${newCount}/${refThreshold} إحالة)`
                  : `👥 صديق جديد انضم عبر رابطك! (${newCount}/${refThreshold} إحالة)`;
                await bot.sendMessage(referredBy, notifyText, { parse_mode: "HTML" });
              } catch { /* inviter may have blocked the bot */ }
            }
          } catch (refErr) {
            logger.error({ refErr }, "Referral reward processing error");
          }
        }
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
      console.error("[/start] error — attempting fallback welcome:", err);
      // Send welcome as fallback unless user is known banned — ensures Telegram always gets a reply
      try {
        const [u] = await db.select({ isVisible: usersTable.isVisible })
          .from(usersTable).where(eq(usersTable.id, userId)).limit(1).catch(() => [null]);
        if (!u || u.isVisible !== false) {
          await sendWelcomeMessage(chatId, userId, firstName);
        }
      } catch (sendErr) {
        console.error("[/start] fallback sendWelcomeMessage failed:", sendErr);
      }
    }
  }));

  // ── /admin ────────────────────────────────────────────────────────────────
  bot.onText(/^\/admin$/, wrapHandler(async (msg) => {
    const userId = msg.from!.id;
    const username = msg.from?.username;
    const info = await getAdminInfo(userId, username);
    if (!info) {
      await bot.sendMessage(msg.chat.id, "⛔ ليس لديك صلاحية الوصول للوحة التحكم.");
      return;
    }
    await showAdminMenu(bot, msg.chat.id, undefined, info);
  }));

  // ── /wallet ───────────────────────────────────────────────────────────────
  bot.onText(/^\/wallet$/, wrapHandler(async (msg) => {
    const userId = msg.from!.id;
    const username = msg.from?.username;
    const info = await getAdminInfo(userId, username);
    if (!info) return;
    const [addr, balance] = await Promise.all([getWalletAddress(), getWalletBalance()]);
    await bot.sendMessage(
      msg.chat.id,
      `💼 <b>محفظة البوت الساخنة</b>\n\n` +
      `📍 العنوان:\n<code>${esc(addr ?? "غير متاح")}</code>\n\n` +
      `💰 الرصيد: <b>${balance ?? "—"} TON</b>\n\n` +
      (balance && parseFloat(balance) < 0.1
        ? "⚠️ الرصيد منخفض — اشحن المحفظة لضمان نجاح عمليات السحب."
        : "✅ المحفظة جاهزة للإرسال."),
      { parse_mode: "HTML" }
    );
  }));

  // ── /setowner ─────────────────────────────────────────────────────────────
  bot.onText(/^\/setowner$/, wrapHandler(async (msg) => {
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
  }));

  // ── Global callback_query handler ─────────────────────────────────────────
  bot.on("callback_query", wrapHandler(async (q) => {
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
      if ((data.startsWith("withdraw_approve_") || data.startsWith("withdraw_reject_") || data.startsWith("withdraw_ban_")) && adminInfo) {
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
  }));

  // ── Global message handler ────────────────────────────────────────────────
  bot.on("message", wrapHandler(async (msg) => {
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
  }));
}
