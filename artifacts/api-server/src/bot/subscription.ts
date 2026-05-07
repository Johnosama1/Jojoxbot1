import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import { usersTable, botSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

export interface RequiredChannel {
  username: string;
  title: string;
  inviteLink: string;
}

// ── In-memory cache for required channels list (cleared when admin updates) ──
let channelsListCache: { ts: number; channels: RequiredChannel[] } | null = null;
const CHANNELS_LIST_TTL = 60_000; // 1 minute

// ── Per-user subscription result cache ─────────────────────────────────────
const userSubCache = new Map<number, { ts: number; missing: RequiredChannel[] }>();
const USER_CACHE_TTL = 30_000; // 30 seconds

export function clearSubCache(userId: number): void {
  userSubCache.delete(userId);
}

export function clearAllSubCache(): void {
  userSubCache.clear();
  channelsListCache = null;
}

// ── Fetch required channels from bot_settings (with cache) ─────────────────
export async function getRequiredChannels(): Promise<RequiredChannel[]> {
  const now = Date.now();
  if (channelsListCache && (now - channelsListCache.ts) < CHANNELS_LIST_TTL) {
    return channelsListCache.channels;
  }
  try {
    const [row] = await db
      .select()
      .from(botSettingsTable)
      .where(eq(botSettingsTable.key, "required_channels"))
      .limit(1);
    const channels = row?.value ? (JSON.parse(row.value) as RequiredChannel[]) : [];
    channelsListCache = { ts: now, channels };
    return channels;
  } catch {
    return [];
  }
}

// ── Check one channel membership ────────────────────────────────────────────
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
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { channel: channel.username, userId, err: msg },
        "getChatMember failed — channel may be private or bot not admin"
      );
    }
  }
  // Fail-open: if we cannot verify, do not block the user
  return true;
}

// ── Check ALL required channels — return list of missing ones ──────────────
export async function getMissingChannels(
  bot: TelegramBot,
  userId: number
): Promise<RequiredChannel[]> {
  const channels = await getRequiredChannels();
  if (channels.length === 0) return [];

  const results = await Promise.all(
    channels.map(async (ch) => {
      const ok = await checkChannel(bot, userId, ch);
      logger.debug(
        { userId, channel: ch.username, status: ok ? "member" : "not_member" },
        "subscription check"
      );
      return { ch, ok };
    })
  );
  return results.filter((r) => !r.ok).map((r) => r.ch);
}

// ── Build the subscription block message ────────────────────────────────────
export function buildBlockMessage(missingChannels: RequiredChannel[]): {
  text: string;
  keyboard: TelegramBot.InlineKeyboardButton[][];
} {
  const channelList = missingChannels
    .map((ch, i) => `${i + 1}\\. *${escapeMarkdownV2(ch.title || `@${ch.username}`)}*`)
    .join("\n");

  const text =
    `⚠️ *الاشتراك الإجباري*\n\n` +
    `للاستمرار في استخدام البوت، يجب أن تكون عضواً في القنوات التالية:\n\n` +
    `${channelList}\n\n` +
    `📌 بعد الانضمام اضغط زر *التحقق* أدناه\\.`;

  const joinButtons: TelegramBot.InlineKeyboardButton[] = missingChannels.map((ch) => ({
    text: `📢 انضمام — ${ch.title || `@${ch.username}`}`,
    url: ch.inviteLink || `https://t.me/${ch.username.replace(/^@/, "")}`,
  }));

  const keyboard: TelegramBot.InlineKeyboardButton[][] = joinButtons.map((btn) => [btn]);
  keyboard.push([{ text: "✅ تحققت من اشتراكي", callback_data: "sub_recheck" }]);

  return { text, keyboard };
}

function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, "\\$&");
}

// ── Main enforcement gate ────────────────────────────────────────────────────
// Returns true  → user is BLOCKED  → stop execution
// Returns false → user is CLEAR    → proceed
export async function enforceSubscription(
  bot: TelegramBot,
  chatId: number,
  userId: number,
  callbackQueryId?: string
): Promise<boolean> {
  try {
    const now = Date.now();

    // ── Step 1: check user-level cache ────────────────────────────────
    const cached = userSubCache.get(userId);
    let missingChannels: RequiredChannel[];

    if (cached && (now - cached.ts) < USER_CACHE_TTL) {
      missingChannels = cached.missing;
    } else {
      // ── Step 2: fetch required channels ──────────────────────────────
      const requiredChannels = await getRequiredChannels();
      if (requiredChannels.length === 0) {
        // No channels configured — clear any stale block
        userSubCache.set(userId, { ts: now, missing: [] });
        await db
          .update(usersTable)
          .set({ isBlockedForLeaving: false })
          .where(eq(usersTable.id, userId))
          .catch(() => {});
        return false;
      }

      // ── Step 3: live-check all channels ───────────────────────────────
      missingChannels = await getMissingChannels(bot, userId);
      userSubCache.set(userId, { ts: now, missing: missingChannels });

      // Persist to DB
      const isBlocked = missingChannels.length > 0;
      await db
        .update(usersTable)
        .set({ isBlockedForLeaving: isBlocked, lastChannelCheckAt: new Date() })
        .where(eq(usersTable.id, userId))
        .catch(() => {});
    }

    if (missingChannels.length === 0) return false;

    // ── Step 4: send block message ────────────────────────────────────
    if (callbackQueryId) {
      try {
        await bot.answerCallbackQuery(callbackQueryId, {
          text: "⛔ يجب الاشتراك في القنوات المطلوبة أولاً",
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
    return false; // Fail-open on error
  }
}

// ── Handle ✅ "تحققت من اشتراكي" callback ─────────────────────────────────
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
    // ── Clear cache for fresh check ───────────────────────────────────
    clearSubCache(userId);

    const requiredChannels = await getRequiredChannels();
    if (requiredChannels.length === 0) {
      try {
        await bot.editMessageText(
          "✅ لا توجد قنوات مطلوبة حالياً\\. يمكنك استخدام البوت بحرية\\!",
          { chat_id: chatId, message_id: msgId, parse_mode: "MarkdownV2", reply_markup: { inline_keyboard: [] } }
        );
      } catch { /* ignore */ }
      return true;
    }

    const missingChannels = await getMissingChannels(bot, userId);
    const isBlocked = missingChannels.length > 0;

    // Update cache and DB
    userSubCache.set(userId, { ts: Date.now(), missing: missingChannels });
    await db
      .update(usersTable)
      .set({ isBlockedForLeaving: isBlocked, lastChannelCheckAt: new Date() })
      .where(eq(usersTable.id, userId))
      .catch(() => {});

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
      const MINI_APP_URL =
        process.env.MINI_APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/`;

      try {
        await bot.editMessageText(
          "✅ *تم التحقق بنجاح\\!*\n\nأنت مشترك في جميع القنوات المطلوبة\\. مرحباً بك\\! 🎉",
          {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: "MarkdownV2",
            reply_markup: { inline_keyboard: [] },
          }
        );
      } catch { /* ignore */ }

      await bot.sendMessage(
        chatId,
        "🎉 *تم استعادة وصولك الكامل\\!*\n\nاستمر في اللعب والفوز بالجوائز\\! 🏆",
        {
          parse_mode: "MarkdownV2",
          reply_markup: {
            inline_keyboard: [
              [{ text: "🎡 افتح التطبيق", web_app: { url: `${MINI_APP_URL}` } }],
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

// ── withVerification wrappers (kept for backward compat) ──────────────────
type MsgHandler = (msg: TelegramBot.Message, match?: RegExpExecArray | null) => Promise<void>;
type CallbackHandler = (q: TelegramBot.CallbackQuery) => Promise<void>;

export function withVerification(botInstance: TelegramBot, handler: MsgHandler): MsgHandler {
  return async (msg, match) => {
    const userId = msg.from?.id;
    const chatId = msg.chat.id;
    if (!userId) return;
    const blocked = await enforceSubscription(botInstance, chatId, userId);
    if (blocked) return;
    return handler(msg, match);
  };
}

export function withVerificationCb(botInstance: TelegramBot, handler: CallbackHandler): CallbackHandler {
  return async (q) => {
    const userId = q.from.id;
    const chatId = q.message!.chat.id;
    const blocked = await enforceSubscription(botInstance, chatId, userId, q.id);
    if (blocked) return;
    return handler(q);
  };
}

// ── Record channel-task reward ─────────────────────────────────────────────
export async function recordChannelReward(userId: number, spinsAwarded: number): Promise<void> {
  try {
    const channels = await getRequiredChannels();
    const snapshot = JSON.stringify(channels.map((c) => c.username));
    const { sql } = await import("drizzle-orm");
    await db
      .update(usersTable)
      .set({
        rewardedSpins: sql`rewarded_spins + ${spinsAwarded}`,
        joinedChannelsAtReward: snapshot,
        isBlockedForLeaving: false,
        lastChannelCheckAt: new Date(),
      })
      .where(eq(usersTable.id, userId));
    clearSubCache(userId);
  } catch (err) {
    logger.error({ err, userId }, "recordChannelReward error");
  }
}
