import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import { usersTable, botSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

// ── HTML escape helper ─────────────────────────────────────────────────────
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ── Inline buildMsg (avoids circular import from bot/index.ts) ────────────
const _utf16Len = (s: string): number => {
  let n = 0;
  for (const ch of s) n += (ch.codePointAt(0)! > 0xffff) ? 2 : 1;
  return n;
};
function buildSubMsg(parts: { text: string; emojiId?: string }[]): { text: string; entities: object[] } {
  let text = "";
  let offset = 0;
  const entities: object[] = [];
  for (const p of parts) {
    if (p.emojiId) {
      entities.push({ type: "custom_emoji", offset, length: _utf16Len(p.text), custom_emoji_id: p.emojiId });
    }
    text += p.text;
    offset += _utf16Len(p.text);
  }
  return { text, entities };
}

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

// ── Check ALL required channels in batches of 10 (avoids rate limits) ───────
export async function getMissingChannels(
  bot: TelegramBot,
  userId: number
): Promise<RequiredChannel[]> {
  const channels = await getRequiredChannels();
  if (channels.length === 0) return [];

  const missing: RequiredChannel[] = [];
  const BATCH = 10;

  for (let i = 0; i < channels.length; i += BATCH) {
    const batch = channels.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (ch) => {
        const ok = await checkChannel(bot, userId, ch);
        return { ch, ok };
      })
    );
    for (const r of results) {
      if (!r.ok) missing.push(r.ch);
    }
    if (i + BATCH < channels.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return missing;
}

// ── Build the subscription block message (HTML) ──────────────────────────────
// Shows ONLY the channels the user has not joined yet, then verify button
export function buildBlockMessage(missingChannels: RequiredChannel[]): {
  text: string;
  keyboard: TelegramBot.InlineKeyboardButton[][];
} {
  const text =
    `⚠️ <b>يجب الانضمام إلى قنوات الشرط أولاً لاستخدام البوت</b>`;

  const keyboard: TelegramBot.InlineKeyboardButton[][] = [
    ...missingChannels.map((ch) => [
      {
        text: `📢 ${ch.title || `@${ch.username}`}`,
        url: ch.inviteLink || `https://t.me/${ch.username.replace(/^@/, "")}`,
      },
    ]),
    [{ text: "✅ تحقق", callback_data: "sub_recheck" }],
  ];

  return { text, keyboard };
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

    // ── Step 1: fetch all required channels ───────────────────────────
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

    // ── Step 2: check user-level cache ────────────────────────────────
    const cached = userSubCache.get(userId);
    let missingChannels: RequiredChannel[];

    if (cached && (now - cached.ts) < USER_CACHE_TTL) {
      missingChannels = cached.missing;
    } else {
      // ── Step 3: live-check all channels ────────────────────────────
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

    // ── Step 4: answer callback query if provided ─────────────────────
    if (callbackQueryId) {
      try {
        await bot.answerCallbackQuery(callbackQueryId, {
          text: "⛔ يجب الاشتراك في القنوات المطلوبة أولاً",
          show_alert: true,
        });
      } catch { /* ignore */ }
    }

    // ── Step 5: send block message with ONLY missing channels ─────────
    const { text, keyboard } = buildBlockMessage(missingChannels);
    await bot.sendMessage(chatId, text, {
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: keyboard },
    });
    return true;
  } catch (err) {
    logger.error({ err, userId }, "enforceSubscription error");
    return false; // Fail-open on error
  }
}

// ── Handle ✅ "تحقق" callback ──────────────────────────────────────────────
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
          "✅ <b>لا توجد قنوات مطلوبة. يمكنك استخدام البوت!</b>",
          { chat_id: chatId, message_id: msgId, parse_mode: "HTML", reply_markup: { inline_keyboard: [] } }
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
      // Still missing channels — show ONLY remaining missing channels
      const { text, keyboard } = buildBlockMessage(missingChannels);
      try {
        await bot.editMessageText(text, {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: keyboard },
        });
      } catch {
        await bot.sendMessage(chatId, text, {
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: keyboard },
        });
      }
    } else {
      // ── All channels joined — delete the verification message and send the full welcome ─────
      try { await bot.deleteMessage(chatId, msgId); } catch { /* ignore */ }

      // Look up user's first name
      let firstName = q.from.first_name || "there";
      try {
        const rows = await db.select({ firstName: usersTable.firstName }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
        if (rows[0]?.firstName) firstName = rows[0].firstName;
      } catch { /* ignore */ }

      const vercelDomain = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
      const MINI_APP_URL =
        process.env.MINI_APP_URL ||
        (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}/` : "") ||
        (vercelDomain ? `https://${vercelDomain}` : "");
      const appUrl = `${MINI_APP_URL}?uid=${userId}`;

      const { text: welcomeText, entities: welcomeEntities } = buildSubMsg([
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

      try {
        await bot.sendMessage(chatId, welcomeText, {
          entities: welcomeEntities as never,
          reply_markup: {
            inline_keyboard: [
              [{ text: "🎁 Open now", web_app: { url: appUrl } }],
            ],
          },
        });
      } catch {
        await bot.sendMessage(
          chatId,
          `👋 <b>Welcome to Jo-jokes, ${firstName}!</b>\n\n` +
          `🎁 The fastest USDT earning bot!\n\n` +
          `✨ <b>How to earn</b>\n\n` +
          `✅ Complete tasks « 1 spin per 5 tasks\n\n` +
          `👥 Invite friends « 1 free spin per 5 friends\n\n` +
          `🎰 Spin the wheel « win 0.1 to 10 USDT!`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [
                [{ text: "🎁 Open now", web_app: { url: appUrl } }],
              ],
            },
          }
        );
      }
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
