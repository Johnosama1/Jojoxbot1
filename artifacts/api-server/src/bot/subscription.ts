import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import { usersTable, botSettingsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "../lib/logger";

export interface RequiredChannel {
  username: string;
  title: string;
  inviteLink: string;
}

// ── Fetch required channels from bot_settings ────────────────────────
export async function getRequiredChannels(): Promise<RequiredChannel[]> {
  try {
    const [row] = await db
      .select()
      .from(botSettingsTable)
      .where(eq(botSettingsTable.key, "required_channels"))
      .limit(1);
    if (!row?.value) return [];
    return JSON.parse(row.value) as RequiredChannel[];
  } catch {
    return [];
  }
}

// ── Check one channel — retry once on failure ────────────────────────
async function checkChannel(
  bot: TelegramBot,
  userId: number,
  channel: RequiredChannel
): Promise<boolean> {
  const target = channel.username.startsWith("@")
    ? channel.username
    : `@${channel.username}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const member = await bot.getChatMember(target, userId);
      return ["member", "administrator", "creator"].includes(member.status);
    } catch (err: unknown) {
      if (attempt === 0) continue;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { channel: channel.username, userId, err: msg },
        "getChatMember failed — bot may not be admin in this channel"
      );
    }
  }
  // Fail-open: if we cannot check, don't block the user
  return true;
}

// ── Check ALL required channels — return list of missing ones ────────
export async function getMissingChannels(
  bot: TelegramBot,
  userId: number
): Promise<RequiredChannel[]> {
  const channels = await getRequiredChannels();
  if (channels.length === 0) return [];

  const results = await Promise.all(
    channels.map(async (ch) => {
      const ok = await checkChannel(bot, userId, ch);
      // Debug log every channel check as required by spec
      logger.debug(
        { userId, channelUsername: ch.username, channelTitle: ch.title, status: ok ? "member" : "not_member" },
        "verifyUserAccess channel check"
      );
      return { ch, ok };
    })
  );
  return results.filter((r) => !r.ok).map((r) => r.ch);
}

// ── Build the blocking message + keyboard ───────────────────────────
export function buildBlockMessage(missingChannels: RequiredChannel[]): {
  text: string;
  keyboard: TelegramBot.InlineKeyboardButton[][];
} {
  const channelList = missingChannels
    .map((ch, i) => `${i + 1}\\. ${ch.title || `@${ch.username}`}`)
    .join("\n");

  const text =
    `⛔ *لقد غادرت قناة مطلوبة\\!*\n\n` +
    `لقد حصلت على مكافآت \\(لفات\\) مقابل الانضمام للقنوات المطلوبة\\. ` +
    `يجب عليك البقاء مشتركاً للاستمرار في استخدام البوت\\.\n\n` +
    `📢 *القنوات التي غادرتها:*\n${channelList}\n\n` +
    `يُرجى الانضمام مرة أخرى للحصول على وصول كامل\\.`;

  const joinButtons: TelegramBot.InlineKeyboardButton[] = missingChannels.map((ch) => ({
    text: `➕ انضمام — ${ch.title || `@${ch.username}`}`,
    url: ch.inviteLink || `https://t.me/${ch.username.replace(/^@/, "")}`,
  }));

  const keyboard: TelegramBot.InlineKeyboardButton[][] = joinButtons.map((btn) => [btn]);
  keyboard.push([{ text: "🔄 تحقق مرة أخرى", callback_data: "sub_recheck" }]);

  return { text, keyboard };
}

// ── Main enforcement middleware ───────────────────────────────────────
// Returns true  → user IS blocked  → caller must stop execution
// Returns false → user is clear    → proceed normally
export async function enforceSubscription(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  callbackQueryId?: string
): Promise<boolean> {
  try {
    const [user] = await db
      .select({
        rewardedSpins: usersTable.rewardedSpins,
        isBlockedForLeaving: usersTable.isBlockedForLeaving,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    // Only enforce if user was previously rewarded for channel tasks
    if (!user || user.rewardedSpins <= 0) return false;

    const requiredChannels = await getRequiredChannels();
    if (requiredChannels.length === 0) {
      // Admin removed all required channels → clear block if set
      if (user.isBlockedForLeaving) {
        await db
          .update(usersTable)
          .set({ isBlockedForLeaving: false, lastChannelCheckAt: new Date() })
          .where(eq(usersTable.id, userId));
      }
      return false;
    }

    const missingChannels = await getMissingChannels(bot, userId);
    const isBlocked = missingChannels.length > 0;

    await db
      .update(usersTable)
      .set({ isBlockedForLeaving: isBlocked, lastChannelCheckAt: new Date() })
      .where(eq(usersTable.id, userId));

    if (!isBlocked) return false;

    // Answer callback first (prevents Telegram spinner from hanging)
    if (callbackQueryId) {
      try {
        await bot.answerCallbackQuery(callbackQueryId, {
          text: "⛔ يجب إعادة الانضمام للقنوات المطلوبة أولاً",
          show_alert: true,
        });
      } catch { /* ignore */ }
    }

    const { text, keyboard } = buildBlockMessage(missingChannels);
    await bot.sendMessage(chatId, text, {
      parse_mode: "MarkdownV2",
      reply_markup: { inline_keyboard: keyboard },
    });
    return true;
  } catch (err) {
    logger.error({ err, userId }, "enforceSubscription error");
    return false;
  }
}

// ── Handle "Check Again" callback ────────────────────────────────────
export async function handleSubRecheckCallback(
  bot: TelegramBot,
  q: TelegramBot.CallbackQuery
): Promise<boolean> {
  if (q.data !== "sub_recheck") return false;

  const userId = q.from.id;
  const chatId = q.message!.chat.id;
  const msgId = q.message!.message_id;

  await bot.answerCallbackQuery(q.id, { text: "⏳ جاري التحقق من اشتراكاتك..." });

  try {
    const [user] = await db
      .select({ rewardedSpins: usersTable.rewardedSpins })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!user || user.rewardedSpins <= 0) {
      try {
        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId });
      } catch { /* ignore */ }
      return true;
    }

    const missingChannels = await getMissingChannels(bot, userId);
    const isBlocked = missingChannels.length > 0;

    await db
      .update(usersTable)
      .set({ isBlockedForLeaving: isBlocked, lastChannelCheckAt: new Date() })
      .where(eq(usersTable.id, userId));

    if (isBlocked) {
      const { text, keyboard } = buildBlockMessage(missingChannels);
      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: "MarkdownV2",
          reply_markup: { inline_keyboard: keyboard },
        });
      } catch {
        await bot.sendMessage(chatId, text, {
          parse_mode: "MarkdownV2",
          reply_markup: { inline_keyboard: keyboard },
        });
      }
    } else {
      // ✅ Unblocked — restore access
      try {
        await bot.editMessageText(
          "✅ تم استعادة الوصول\\! أنت مشترك في جميع القنوات المطلوبة\\.",
          {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: "MarkdownV2",
            reply_markup: { inline_keyboard: [] },
          }
        );
      } catch { /* ignore */ }

      const MINI_APP_URL =
        process.env.MINI_APP_URL ||
        `https://${process.env.REPLIT_DEV_DOMAIN}/`;

      await bot.sendMessage(
        chatId,
        "🎉 مرحباً بك مرة أخرى\\! تم استعادة وصولك الكامل — استمر في الفوز\\!",
        {
          parse_mode: "MarkdownV2",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🎁 افتح التطبيق", web_app: { url: `${MINI_APP_URL}?uid=${userId}` } }],
            ],
          },
        }
      );
    }
  } catch (err) {
    logger.error({ err, userId }, "handleSubRecheckCallback error");
  }

  return true;
}

// ── withVerification wrapper ─────────────────────────────────────────
// Wraps any bot handler so it runs verifyUserAccess first.
// Usage:
//   bot.onText(/\/cmd/, withVerification(bot, async (msg) => { ... }))
//   bot.on("callback_query", withVerification(bot, async (q) => { ... }))

type MsgHandler = (msg: TelegramBot.Message, match?: RegExpExecArray | null) => Promise<void>;
type CallbackHandler = (q: TelegramBot.CallbackQuery) => Promise<void>;

export function withVerification(
  botInstance: TelegramBot,
  handler: MsgHandler
): MsgHandler {
  return async (msg, match) => {
    const userId = msg.from?.id;
    const chatId = msg.chat.id;
    if (!userId) return;

    const blocked = await enforceSubscription(botInstance, chatId, userId);
    if (blocked) return;

    return handler(msg, match);
  };
}

export function withVerificationCb(
  botInstance: TelegramBot,
  handler: CallbackHandler
): CallbackHandler {
  return async (q) => {
    const userId = q.from.id;
    const chatId = q.message!.chat.id;

    const blocked = await enforceSubscription(botInstance, chatId, userId, q.id);
    if (blocked) return;

    return handler(q);
  };
}

// ── Record channel-task reward (call when spin is granted from task) ──
export async function recordChannelReward(
  userId: number,
  spinsAwarded: number
): Promise<void> {
  try {
    const channels = await getRequiredChannels();
    const snapshot = JSON.stringify(channels.map((c) => c.username));
    await db
      .update(usersTable)
      .set({
        rewardedSpins: sql`rewarded_spins + ${spinsAwarded}`,
        joinedChannelsAtReward: snapshot,
        isBlockedForLeaving: false,
        lastChannelCheckAt: new Date(),
      })
      .where(eq(usersTable.id, userId));
  } catch (err) {
    logger.error({ err, userId }, "recordChannelReward error");
  }
}
