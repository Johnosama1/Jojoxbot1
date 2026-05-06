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

const TOKEN = (process.env.BOT_TOKEN || process.env.TOKEN || process.env.TELEGRAM_BOT_TOKEN)!;

let bot: TelegramBot;

// ── In-bot captcha store ──────────────────────────────────────────────
interface CaptchaChallenge {
  answer: number;
  expires: number;
  firstName: string;
  attempts: number;
}
const captchaStore = new Map<number, CaptchaChallenge>();

setInterval(() => {
  const now = Date.now();
  for (const [id, c] of captchaStore) {
    if (now > c.expires) captchaStore.delete(id);
  }
}, 5 * 60_000).unref();

function buildCaptchaButtons(userId: number, correct: number): TelegramBot.InlineKeyboardButton[][] {
  const offsets = [1, 2, 3, -1, -2, -3].sort(() => Math.random() - 0.5);
  let wrong1 = correct + offsets[0];
  let wrong2 = correct + offsets[1];
  if (wrong1 <= 0) wrong1 = correct + 1;
  if (wrong2 <= 0) wrong2 = correct + 2;
  if (wrong2 === wrong1) wrong2 = wrong1 + 1;
  const shuffled = [correct, wrong1, wrong2].sort(() => Math.random() - 0.5);
  return [shuffled.map(n => ({ text: String(n), callback_data: `captcha_${userId}_${n}` }))];
}

async function sendCaptchaChallenge(chatId: number, userId: number, firstName: string) {
  const a = Math.floor(Math.random() * 9) + 1;
  const b = Math.floor(Math.random() * 9) + 1;
  const correct = a + b;

  captchaStore.set(userId, {
    answer: correct,
    expires: Date.now() + 5 * 60_000,
    firstName,
    attempts: 0,
  });

  await bot.sendMessage(
    chatId,
    `👋 Hello ${firstName}!\n\n🔐 Please complete verification before using the bot.\n\n📊 Solve this:\n\n*${a} + ${b} = ?*\n\nChoose the correct answer:`,
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buildCaptchaButtons(userId, correct) },
    }
  );
}

// ── Lightweight command spam guard (no external deps) ─────────────────
const cmdTimestamps = new Map<number, number>();
const CMD_COOLDOWN_MS = 1_000; // max 1 command per second per user

function isCommandSpam(userId: number): boolean {
  const now = Date.now();
  const last = cmdTimestamps.get(userId);
  if (last && now - last < CMD_COOLDOWN_MS) return true;
  cmdTimestamps.set(userId, now);
  return false;
}

// Clean up every 10 minutes to avoid memory leak
setInterval(() => {
  const cutoff = Date.now() - CMD_COOLDOWN_MS * 10;
  for (const [id, ts] of cmdTimestamps) {
    if (ts < cutoff) cmdTimestamps.delete(id);
  }
}, 10 * 60_000).unref();

export function getBot(): TelegramBot {
  return bot;
}

/**
 * Process a Telegram update and WAIT for all async handlers to finish.
 * Critical for Vercel serverless: the function must not send 200 until
 * all handlers (DB queries + bot.sendMessage) have completed.
 *
 * node-telegram-bot-api stores onText callbacks in _textRegexpCallbacks (not EventEmitter),
 * so we must patch both systems to collect async promises.
 */
type AnyBot = {
  emit: (...a: unknown[]) => boolean;
  _textRegexpCallbacks: Array<{ regexp: RegExp; callback: (...a: unknown[]) => unknown }>;
};

export async function processUpdateAndWait(update: object): Promise<void> {
  const promises: Promise<unknown>[] = [];
  const b = bot as unknown as AnyBot;

  // ── 1. Patch _textRegexpCallbacks (used by onText) ──────────────────
  const origTextCallbacks = b._textRegexpCallbacks ?? [];
  b._textRegexpCallbacks = origTextCallbacks.map(({ regexp, callback }) => ({
    regexp,
    callback: (...args: unknown[]) => {
      const result = callback(...args);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        promises.push(result as Promise<unknown>);
      }
      return result;
    },
  }));

  // ── 2. Patch emit (used by on('callback_query'), on('message'), etc.) ─
  const origEmit = b.emit.bind(bot);
  b.emit = function (event: unknown, ...args: unknown[]) {
    const listeners = bot.listeners(event as string);
    for (const listener of listeners) {
      try {
        const result = (listener as (...a: unknown[]) => unknown).apply(bot, args);
        if (result && typeof (result as Promise<unknown>).then === "function") {
          promises.push(result as Promise<unknown>);
        }
      } catch { /* ignore sync errors */ }
    }
    return true;
  };

  try {
    bot.processUpdate(update as Parameters<typeof bot.processUpdate>[0]);
  } finally {
    b._textRegexpCallbacks = origTextCallbacks;
    b.emit = origEmit;
  }

  await Promise.allSettled(promises);
}

// ── Shared welcome message sender ────────────────────────────────────
const utf16Len = (s: string): number => {
  let n = 0;
  for (const ch of s) n += (ch.codePointAt(0)! > 0xffff) ? 2 : 1;
  return n;
};

export interface MsgPart { text: string; emojiId?: string }
export const buildMsg = (parts: MsgPart[]) => {
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
};

export async function sendWelcomeMessage(chatId: number, userId: number, firstName: string) {
  const MINI_APP_URL =
    process.env.MINI_APP_URL ||
    `https://${process.env.REPLIT_DEV_DOMAIN}/`;

  const { text: welcomeText, entities: welcomeEntities } = buildMsg([
    { text: "👋", emojiId: "5319007286004299794" },
    { text: ` Welcome to Jo-jokes, ${firstName}!\n\n` },
    { text: "😀", emojiId: "6129832240303051599" },
    { text: ` The fastest USDT earning bot!\n\n` },
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
    entities: welcomeEntities as any,
    reply_markup: {
      inline_keyboard: [
        [{ text: "🎁 Open now", web_app: { url: `${MINI_APP_URL}?uid=${userId}` } }],
      ],
    },
  });
}

// ── Set bot menu button to open the Mini App ─────────────────────────
function setMenuButton() {
  const MINI_APP_URL =
    process.env.MINI_APP_URL ||
    `https://${process.env.REPLIT_DEV_DOMAIN}/`;

  fetch(`https://api.telegram.org/bot${TOKEN}/setChatMenuButton`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      menu_button: {
        type: "web_app",
        text: "🎡 Play",
        web_app: { url: MINI_APP_URL },
      },
    }),
  })
    .then(r => r.json())
    .then((d: unknown) => logger.info({ d }, "Menu button set"))
    .catch(err => logger.error({ err }, "Failed to set menu button"));
}

export function initBotWebhook(webhookUrl: string) {
  if (!TOKEN) {
    logger.warn("No TELEGRAM_BOT_TOKEN — bot disabled");
    return;
  }
  bot = new TelegramBot(TOKEN, {});
  bot.setWebHook(webhookUrl)
    .then(() => logger.info({ webhookUrl }, "Telegram webhook registered"))
    .catch(err => logger.error({ err }, "Failed to set webhook"));
  setupBotHandlers();
  setMenuButton();
}

export function initBotPolling() {
  if (!TOKEN) {
    logger.warn("No TELEGRAM_BOT_TOKEN — bot disabled");
    return;
  }
  bot = new TelegramBot(TOKEN, { polling: true });
  logger.info("Telegram bot started (polling mode)");
  setupBotHandlers();
  setMenuButton();
}

function setupBotHandlers() {
  // ───────────────────────────── /start ─────────────────────────────
  bot.onText(/\/start(.*)/, async (msg, match) => {
    try {
      const chatId = msg.chat.id;
      const userId = msg.from!.id;
      if (isCommandSpam(userId)) return; // silent drop — don't reply
      const username = msg.from?.username;
      const firstName = msg.from?.first_name || "";
      const lastName = msg.from?.last_name || "";
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

      // Block banned users
      if (existing.length > 0 && existing[0].isVisible === false) {
        await bot.sendMessage(chatId, "🚫 Your account has been banned from this bot.");
        return;
      }

      const isNew = existing.length === 0;

      if (isNew) {
        const inserted = await db
          .insert(usersTable)
          .values({
            id: userId,
            username: username || null,
            firstName,
            lastName,
            referredBy: referredBy ?? null,
            spins: 0,
          })
          .onConflictDoNothing()
          .returning({ id: usersTable.id });

        // Referral credit is only awarded AFTER successful verification
        // (see verify.ts POST /verify-device) — nothing to do here
      } else {
        // Update profile info only — never touch verification fields on /start
        await db
          .update(usersTable)
          .set({
            username: username || existing[0].username,
            firstName: firstName || existing[0].firstName,
          })
          .where(eq(usersTable.id, userId));
      }

      // ── Subscription enforcement — check BEFORE verification gate ──
      // Only applies to users who were rewarded for joining channels
      if (!isNew) {
        const blocked = await enforceSubscription(bot, chatId, userId);
        if (blocked) return;
      }

      // ── Always open Lucky Wheel directly — verification happens in-app ──
      await sendWelcomeMessage(chatId, userId, firstName);
    } catch (err) {
      logger.error({ err }, "Error in /start handler");
    }
  });

  // ───────────────────────────── /top ───────────────────────────────
  bot.onText(/^\/top$/, withVerification(bot, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    if (isCommandSpam(userId)) return;
    try {
      const top = await db
        .select({
          id: usersTable.id,
          username: usersTable.username,
          firstName: usersTable.firstName,
          referralCount: usersTable.referralCount,
        })
        .from(usersTable)
        .where(and(eq(usersTable.isVisible, true), gt(usersTable.referralCount, 0)))
        .orderBy(desc(usersTable.referralCount))
        .limit(10);

      if (top.length === 0) {
        await bot.sendMessage(chatId, "🏆 No leaders yet. Be the first!");
        return;
      }

      const medals = ["🥇", "🥈", "🥉"];
      const rows = top.map((u, i) => {
        const medal = medals[i] ?? `${i + 1}.`;
        const name = u.username ? `@${u.username}` : (u.firstName || "User");
        return `${medal} ${name} — ${u.referralCount} referrals`;
      });

      // Find current user's rank
      let myLine = "";
      const myPos = top.findIndex((u) => u.id === userId);
      if (myPos >= 0) {
        myLine = `\n\n🎯 You are ranked #${myPos + 1}`;
      } else {
        const [countRow] = await db
          .select({ cnt: sql<number>`count(*)` })
          .from(usersTable)
          .where(
            and(
              eq(usersTable.isVisible, true),
              sql`referral_count > (SELECT referral_count FROM users WHERE id = ${userId})`
            )
          );
        const [me] = await db
          .select({ referralCount: usersTable.referralCount })
          .from(usersTable)
          .where(eq(usersTable.id, userId))
          .limit(1);
        if (me && me.referralCount > 0) {
          myLine = `\n\n🎯 Your rank: #${Number(countRow.cnt) + 1} (${me.referralCount} referrals)`;
        } else {
          myLine = "\n\n💡 Invite friends to climb the leaderboard!";
        }
      }

      await bot.sendMessage(
        chatId,
        `🏆 *Leaderboard — Top Referrers*\n\n${rows.join("\n")}${myLine}`,
        { parse_mode: "Markdown" }
      );
    } catch (err) {
      logger.error({ err }, "Error in /top handler");
    }
  }));

  // ───────────────────────────── /admin ─────────────────────────────
  bot.onText(/^\/admin$/, async (msg) => {
    const userId = msg.from!.id;
    if (isCommandSpam(userId)) return;
    const username = msg.from?.username;

    const info = await getAdminInfo(userId, username);
    if (!info) return;

    // Auto-save owner Telegram ID on first admin access (owner only)
    if (info.isOwner) {
      const existing = await db
        .select()
        .from(botSettingsTable)
        .where(eq(botSettingsTable.key, "owner_telegram_id"))
        .limit(1);
      const isFirstTime = existing.length === 0;
      if (isFirstTime) {
        await db.insert(botSettingsTable).values({
          key: "owner_telegram_id",
          value: String(userId),
        });
        logger.info({ userId }, "Owner telegram ID saved automatically");

        try {
          const pendingWithdrawals = await db
            .select({ w: withdrawalsTable, u: usersTable })
            .from(withdrawalsTable)
            .leftJoin(usersTable, eq(withdrawalsTable.userId, usersTable.id))
            .where(eq(withdrawalsTable.status, "pending"));

          for (const { w, u } of pendingWithdrawals) {
            await sendWithdrawalNotification(
              userId,
              { firstName: u?.firstName || "", username: u?.username, id: w.userId },
              w.amount,
              w.walletAddress,
              w.id
            );
          }
          if (pendingWithdrawals.length > 0) {
            logger.info({ count: pendingWithdrawals.length }, "Re-sent pending withdrawal notifications");
          }
        } catch (err) {
          logger.error({ err }, "Failed to re-send pending withdrawals");
        }
      }
    }

    await showAdminMenu(bot, msg.chat.id, undefined, info);
  });

  // ───────────────────────────── /setowner ──────────────────────────
  bot.onText(/^\/setowner$/, async (msg) => {
    const userId = msg.from!.id;
    const username = msg.from?.username;
    if (username !== OWNER_USERNAME) return;

    await db
      .insert(botSettingsTable)
      .values({ key: "owner_telegram_id", value: String(userId) })
      .onConflictDoUpdate({
        target: botSettingsTable.key,
        set: { value: String(userId) },
      });

    await bot.sendMessage(
      msg.chat.id,
      `✅ You are now registered as bot owner!\nID: ${userId}\nUse /admin to access the control panel.`
    );
  });

  // ───────────────────────────── /reset_all ─────────────────────────
  bot.onText(/^\/reset_all$/, async (msg) => {
    const userId = msg.from!.id;
    const username = msg.from?.username;
    const ok = await isOwner(userId, username);
    if (!ok) return;

    const chatId = msg.chat.id;

    // Confirmation step — ask before wiping
    await bot.sendMessage(chatId,
      "⚠️ *Warning: Full Reset*\n\n" +
      "This will clear verification data for all users.\n" +
      "Every user will need to verify again on next login.\n\n" +
      "Are you sure?",
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Yes, Reset All", callback_data: "owner:reset_all:confirm" },
              { text: "❌ Cancel", callback_data: "owner:reset_all:cancel" },
            ],
          ],
        },
      }
    );
  });

  // ───────────────────────────── /reset_user ────────────────────────
  bot.onText(/^\/reset_user (.+)$/, async (msg, match) => {
    const userId = msg.from!.id;
    const username = msg.from?.username;
    const ok = await isOwner(userId, username);
    if (!ok) return;

    const target = match?.[1]?.trim();
    if (!target) return;

    const targetId = parseInt(target);
    if (isNaN(targetId)) {
      await bot.sendMessage(msg.chat.id, "⚠️ Send a valid ID. Example: /reset_user 123456789");
      return;
    }

    await db.update(usersTable).set({
      ipVerifiedAt: null,
      deviceId: null,
      verificationToken: null,
    }).where(eq(usersTable.id, targetId));

    const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
    await bot.sendMessage(
      msg.chat.id,
      `🔄 Verification reset for user *${u?.firstName || targetId}* (${targetId}).\nThey will need to verify again on next login.`,
      { parse_mode: "Markdown" }
    );
  });

  // ───────────────────────────── Callback handlers ──────────────────
  bot.on("callback_query", async (q) => {
    if (!q.data) return;
    const data = q.data;

    // ── Subscription re-check ("Check Again" button) ─────────────
    if (data === "sub_recheck") {
      await handleSubRecheckCallback(bot, q);
      return;
    }

    // ── Subscription enforcement on all non-captcha callbacks ─────
    // Skip for admin and withdrawal callbacks (they need full access)
    const isAdminOrWithdrawal =
      data.startsWith("admin_") ||
      data.startsWith("owner:") ||
      data.startsWith("withdraw_") ||
      data.startsWith("newadmin_");
    if (!isAdminOrWithdrawal) {
      const blocked = await enforceSubscription(bot, q.message!.chat.id, q.from.id, q.id);
      if (blocked) return;
    }

    // ── In-bot captcha verification ───────────────────────────────
    if (data.startsWith("captcha_")) {
      const parts = data.split("_");
      const targetUserId = parseInt(parts[1]);
      const chosen = parseInt(parts[2]);

      if (q.from.id !== targetUserId) {
        await bot.answerCallbackQuery(q.id, { text: "⛔ This verification is not for you" });
        return;
      }

      const challenge = captchaStore.get(targetUserId);

      if (!challenge || Date.now() > challenge.expires) {
        await bot.answerCallbackQuery(q.id, { text: "⏰ Question expired, press /start again" });
        try {
          await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: q.message!.chat.id,
            message_id: q.message!.message_id,
          });
        } catch { /* ignore */ }
        return;
      }

      if (chosen === challenge.answer) {
        captchaStore.delete(targetUserId);
        await db
          .update(usersTable)
          .set({ ipVerifiedAt: new Date(), verificationToken: null })
          .where(eq(usersTable.id, targetUserId));

        await bot.answerCallbackQuery(q.id, { text: "✅ Verified successfully!" });
        try {
          await bot.editMessageText("✅ Verified successfully!", {
            chat_id: q.message!.chat.id,
            message_id: q.message!.message_id,
            reply_markup: { inline_keyboard: [] },
          });
        } catch { /* ignore */ }

        await sendWelcomeMessage(q.message!.chat.id, targetUserId, challenge.firstName);
      } else {
        challenge.attempts++;
        if (challenge.attempts >= 3) {
          captchaStore.delete(targetUserId);
          await bot.answerCallbackQuery(q.id, { text: "❌ Too many attempts, press /start to try again" });
          try {
            await bot.editMessageText(
              "❌ Verification failed — too many wrong attempts.\nPress /start to try again.",
              { chat_id: q.message!.chat.id, message_id: q.message!.message_id, reply_markup: { inline_keyboard: [] } }
            );
          } catch { /* ignore */ }
        } else {
          const remaining = 3 - challenge.attempts;
          const a = Math.floor(Math.random() * 9) + 1;
          const b = Math.floor(Math.random() * 9) + 1;
          const correct = a + b;
          challenge.answer = correct;

          await bot.answerCallbackQuery(q.id, { text: `❌ Wrong answer! ${remaining} attempts left` });
          try {
            await bot.editMessageText(
              `❌ Wrong answer! *${remaining}* attempts left.\n\n📊 New question:\n\n*${a} + ${b} = ?*\n\nChoose the correct answer:`,
              {
                chat_id: q.message!.chat.id,
                message_id: q.message!.message_id,
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: buildCaptchaButtons(targetUserId, correct) },
              }
            );
          } catch { /* ignore */ }
        }
      }
      return;
    }

    // ── Owner: reset all users verification ──────────────────────────
    if (data === "owner:reset_all:confirm") {
      const ok = await isOwner(q.from.id, q.from.username);
      if (!ok) {
        await bot.answerCallbackQuery(q.id, { text: "⛔ Unauthorized" });
        return;
      }
      await bot.answerCallbackQuery(q.id, { text: "⏳ Resetting..." });
      const result = await db.update(usersTable).set({
        ipVerifiedAt: null,
        deviceId: null,
        verificationToken: null,
        isVisible: true,
      });
      const count = (result as unknown as { rowCount?: number }).rowCount ?? 0;
      try {
        await bot.editMessageText(
          `✅ *Verification reset for all users*\n\nAffected users: *${count}*\nEveryone will be asked to verify again on next login.`,
          {
            chat_id: q.message!.chat.id,
            message_id: q.message!.message_id,
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: [] },
          }
        );
      } catch { /* ignore */ }
      return;
    }

    if (data === "owner:reset_all:cancel") {
      const ok = await isOwner(q.from.id, q.from.username);
      if (!ok) return;
      await bot.answerCallbackQuery(q.id, { text: "❌ Cancelled" });
      try {
        await bot.editMessageText("❌ Reset operation cancelled.", {
          chat_id: q.message!.chat.id,
          message_id: q.message!.message_id,
          reply_markup: { inline_keyboard: [] },
        });
      } catch { /* ignore */ }
      return;
    }

    // Admin panel callbacks
    if (await handleNewAdminPermsCallback(bot, q)) return;
    const handled = await handleAdminCallback(bot, q);
    if (handled) return;

    // Withdrawal approve/reject (legacy format)
    await handleWithdrawalCallback(q);
  });

  // ───────────────────────────── Text messages ──────────────────────
  bot.on("message", async (msg) => {
    const userId = msg.from!.id;
    if (!adminConvState.has(userId)) return;

    const info = await getAdminInfo(userId, msg.from?.username);
    if (!info) return;

    // Photo message — handle first (e.g. task icon upload)
    if (msg.photo && msg.photo.length > 0) {
      await handleAdminPhoto(bot, msg);
      return;
    }

    if (!msg.text || msg.text.startsWith("/")) return;
    await handleAdminText(bot, msg);
  });

}

// ────────────────────────────────────────────────────────────────────
// Withdrawal callback (approve / reject)
// ────────────────────────────────────────────────────────────────────
async function handleWithdrawalCallback(q: TelegramBot.CallbackQuery) {
  const data = q.data ?? "";
  const chatId = q.message!.chat.id;
  const msgId = q.message!.message_id;
  const userId = q.from.id;
  const username = q.from.username;

  const ok = await isOwner(userId, username);
  if (!ok) {
    await bot.answerCallbackQuery(q.id, { text: "⛔ Unauthorized" });
    return;
  }

  if (data.startsWith("withdraw_approve_")) {
    const wdId = parseInt(data.replace("withdraw_approve_", ""));
    await processWithdrawal(bot, wdId, "approved", chatId, msgId, q.id);
  } else if (data.startsWith("withdraw_reject_")) {
    const wdId = parseInt(data.replace("withdraw_reject_", ""));
    await processWithdrawal(bot, wdId, "rejected", chatId, msgId, q.id);
  } else if (data.startsWith("withdraw_marksent_")) {
    const wdId = parseInt(data.replace("withdraw_marksent_", ""));
    await markWithdrawalSent(bot, wdId, chatId, msgId, q.id);
  }
}

async function processWithdrawal(
  bot: TelegramBot,
  wdId: number,
  action: "approved" | "rejected",
  chatId: number,
  msgId: number,
  callbackId: string
) {
  try {
    const [wd] = await db
      .select()
      .from(withdrawalsTable)
      .where(eq(withdrawalsTable.id, wdId))
      .limit(1);

    if (!wd) {
      await bot.answerCallbackQuery(callbackId, { text: "❌ Request not found" });
      return;
    }
    if (wd.status !== "pending") {
      await bot.answerCallbackQuery(callbackId, {
        text: `This request was already processed: ${wd.status}`,
      });
      return;
    }

    if (action === "rejected") {
      await db.update(withdrawalsTable)
        .set({ status: "rejected" })
        .where(eq(withdrawalsTable.id, wdId));
      await db.update(usersTable)
        .set({ balance: sql`balance + ${wd.amount}` })
        .where(eq(usersTable.id, wd.userId));

      await bot.answerCallbackQuery(callbackId, { text: "❌ Rejected" });

      try {
        await bot.editMessageText(
          `❌ Withdrawal #${wdId} rejected\n${parseFloat(wd.amount).toFixed(4)} TON returned to user.`,
          { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }
        );
      } catch { /* ignore */ }

      try {
        await bot.sendMessage(
          wd.userId,
          `❌ Withdrawal request rejected\n\n${parseFloat(wd.amount).toFixed(4)} TON has been returned to your balance.`
        );
      } catch { /* ignore */ }

      return;
    }

    // ── APPROVED ──────────────────────────────────────────────────────
    await db.update(withdrawalsTable)
      .set({ status: "approved" })
      .where(eq(withdrawalsTable.id, wdId));

    await bot.answerCallbackQuery(callbackId, { text: "✅ Approved" });

    const amtStr = parseFloat(wd.amount).toFixed(4);
    const autoMode = isTonConfigured();

    if (autoMode) {
      // Auto mode: send TON directly from server wallet
      try {
        await bot.editMessageText(
          `✅ Withdrawal #${wdId} approved\n\n` +
          `💰 *${amtStr} TON* — sending automatically...`,
          {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: [] },
          }
        );
      } catch { /* ignore */ }

      // Fire-and-forget auto transfer
      executeAutoWithdrawal(wdId, chatId).catch(() => {});

    } else {
      // Manual mode: send deep links for admin to transfer from their own wallet
      const nanotons = Math.round(parseFloat(wd.amount) * 1e9);
      const tonLink = `ton://transfer/${wd.walletAddress}?amount=${nanotons}&text=Withdrawal%20%23${wdId}`;
      const tonkeeperLink = `https://app.tonkeeper.com/transfer/${wd.walletAddress}?amount=${nanotons}&text=Withdrawal%20%23${wdId}`;

      try {
        await bot.editMessageText(
          `✅ Withdrawal #${wdId} approved\n\n` +
          `👤 User ID: ${wd.userId}\n` +
          `💰 Amount: *${amtStr} TON*\n` +
          `📍 Wallet:\n\`${wd.walletAddress}\`\n\n` +
          `⬇️ Open your wallet, send the TON, then tap *✅ Mark as Sent*`,
          {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "💳 Open Wallet", url: tonLink },
                  { text: "🔑 Tonkeeper", url: tonkeeperLink },
                ],
                [
                  { text: "✅ Mark as Sent", callback_data: `withdraw_marksent_${wdId}` },
                ],
              ],
            },
          }
        );
      } catch { /* ignore */ }

      // Notify user (manual mode — no auto processor will do it)
      try {
        const { text: uText, entities: uEnt } = buildMsg([
          { text: "✅", emojiId: "6008009744969637955" },
          { text: ` Your withdrawal was approved!\n\n` },
          { text: "💵", emojiId: "5409048419211682843" },
          { text: ` Amount: ${amtStr} TON\n` },
          { text: "👛", emojiId: "5039557485157942342" },
          { text: ` Wallet: ${wd.walletAddress}\n\n` },
          { text: `⏳ Transfer is being processed...` },
        ]);
        await bot.sendMessage(wd.userId, uText, { entities: uEnt as any });
      } catch { /* ignore */ }
    }

  } catch (err) {
    logger.error({ err }, "Error processing withdrawal");
    await bot.answerCallbackQuery(callbackId, { text: "❌ Processing error" });
  }
}

async function markWithdrawalSent(
  bot: TelegramBot,
  wdId: number,
  chatId: number,
  msgId: number,
  callbackId: string
) {
  try {
    const [wd] = await db
      .select()
      .from(withdrawalsTable)
      .where(eq(withdrawalsTable.id, wdId))
      .limit(1);

    if (!wd) {
      await bot.answerCallbackQuery(callbackId, { text: "❌ Not found" });
      return;
    }
    if (wd.status === "completed") {
      await bot.answerCallbackQuery(callbackId, { text: "Already marked as sent" });
      return;
    }

    await db.update(withdrawalsTable)
      .set({ status: "completed", processedAt: new Date() })
      .where(eq(withdrawalsTable.id, wdId));

    await bot.answerCallbackQuery(callbackId, { text: "✅ Marked as sent!" });

    const amtStr = parseFloat(wd.amount).toFixed(4);
    try {
      await bot.editMessageText(
        `✅ Withdrawal #${wdId} — *COMPLETED*\n\n` +
        `💰 ${amtStr} TON sent to:\n\`${wd.walletAddress}\``,
        {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [] },
        }
      );
    } catch { /* ignore */ }

    // Notify user
    try {
      const { text: uText, entities: uEnt } = buildMsg([
        { text: "✅", emojiId: "6008009744969637955" },
        { text: ` Withdrawal completed!\n\n` },
        { text: "💵", emojiId: "5409048419211682843" },
        { text: ` Amount: ${amtStr} TON\n` },
        { text: "👛", emojiId: "5039557485157942342" },
        { text: ` Wallet: ${wd.walletAddress}` },
      ]);
      await bot.sendMessage(wd.userId, uText, { entities: uEnt as any });
    } catch { /* ignore */ }

  } catch (err) {
    logger.error({ err }, "Error marking withdrawal as sent");
    await bot.answerCallbackQuery(callbackId, { text: "❌ Error" });
  }
}

// ────────────────────────────────────────────────────────────────────
// Send withdrawal notification to owner
// ────────────────────────────────────────────────────────────────────
export async function sendWithdrawalNotification(
  ownerId: number,
  user: { firstName: string; username?: string | null; id: number },
  amount: string,
  wallet: string,
  withdrawalId: number
) {
  if (!bot) return;
  const uname = user.username ? `@${user.username}` : "—";
  const text =
    `💸 New Withdrawal Request #${withdrawalId}\n\n` +
    `👤 Name: ${user.firstName || "—"}\n` +
    `🔗 Username: ${uname}\n` +
    `🆔 ID: ${user.id}\n` +
    `💰 Amount: ${parseFloat(amount).toFixed(4)} TON\n` +
    `📍 Wallet:\n${wallet}`;

  try {
    await bot.sendMessage(ownerId, text, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Approve", callback_data: `withdraw_approve_${withdrawalId}` },
            { text: "❌ Reject", callback_data: `withdraw_reject_${withdrawalId}` },
          ],
        ],
      },
    });
  } catch (err) {
    logger.error({ err }, "Failed to send withdrawal notification");
  }
}

export function setupCallbackHandlers() {
  // handled inline in initBot
}
