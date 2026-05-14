import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import { usersTable, referralsTable } from "@workspace/db/schema";
import { eq, and, isNotNull } from "drizzle-orm";
import { getRequiredChannels, getMissingChannels } from "./subscription";
import { logger } from "../lib/logger";

const BATCH_SIZE = 30;
const WARN_COOLDOWN_MS = 23 * 3_600_000;

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function runReferralMonitor(bot: TelegramBot): Promise<void> {
  logger.info("referralMonitor: starting hourly scan");

  const channels = await getRequiredChannels();
  if (channels.length === 0) {
    logger.info("referralMonitor: no required channels configured, skipping");
    return;
  }

  const usersToCheck = await db
    .select({
      id: usersTable.id,
      referredBy: usersTable.referredBy,
      firstName: usersTable.firstName,
      username: usersTable.username,
    })
    .from(usersTable)
    .where(isNotNull(usersTable.referredBy));

  logger.info({ count: usersToCheck.length }, "referralMonitor: users to scan");

  let warned = 0;
  let skipped = 0;

  for (let i = 0; i < usersToCheck.length; i += BATCH_SIZE) {
    const batch = usersToCheck.slice(i, i + BATCH_SIZE);

    for (const user of batch) {
      try {
        const referrerId = user.referredBy!;

        const [ref] = await db
          .select()
          .from(referralsTable)
          .where(and(
            eq(referralsTable.referredId, user.id),
            eq(referralsTable.referrerId, referrerId),
            eq(referralsTable.status, "active"),
          ))
          .limit(1);

        if (!ref) { skipped++; continue; }

        if (ref.warnedAt && Date.now() - ref.warnedAt.getTime() < WARN_COOLDOWN_MS) {
          skipped++; continue;
        }

        const missing = await getMissingChannels(bot, user.id);
        if (missing.length === 0) { skipped++; continue; }

        const channelName = missing[0].title || missing[0].username;
        const userDisplay = user.username
          ? `@${esc(user.username)}`
          : esc(user.firstName || String(user.id));

        try {
          await bot.sendMessage(
            referrerId,
            `⚠️ <b>تنبيه!</b>\nالمستخدم <b>${userDisplay}</b> غادر القناة: <b>${esc(channelName)}</b>`,
            {
              parse_mode: "HTML",
              reply_markup: {
                inline_keyboard: [[
                  { text: "📤 إرسال تنبيه للشخص", callback_data: `ref:warn:${user.id}` },
                  { text: "❌ خصم الإحالة", callback_data: `ref:deduct:${user.id}` },
                ]],
              },
            }
          );
        } catch { /* referrer may have blocked bot */ }

        await db.update(referralsTable)
          .set({ warnedAt: new Date() })
          .where(eq(referralsTable.id, ref.id));

        await db.update(usersTable)
          .set({ isBlockedForLeaving: true })
          .where(eq(usersTable.id, user.id));

        warned++;
        await new Promise(r => setTimeout(r, 250));
      } catch (err) {
        logger.error({ err, userId: user.id }, "referralMonitor: error processing user");
      }
    }

    if (i + BATCH_SIZE < usersToCheck.length) {
      await new Promise(r => setTimeout(r, 1_500));
    }
  }

  logger.info({ warned, skipped }, "referralMonitor: scan complete");
}

export function startReferralMonitor(bot: TelegramBot): void {
  setTimeout(
    () => runReferralMonitor(bot).catch(err =>
      logger.error({ err }, "referralMonitor: initial run error")),
    60_000,
  );
  setInterval(
    () => runReferralMonitor(bot).catch(err =>
      logger.error({ err }, "referralMonitor: periodic run error")),
    60 * 60_000,
  );
  logger.info("referralMonitor: scheduled (hourly)");
}
