import { Router } from "express";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import { withdrawalsTable, usersTable, botSettingsTable, referralsTable } from "@workspace/db/schema";
import { eq, sql, desc, and } from "drizzle-orm";
import { sendWithdrawalNotification, getBot } from "../bot";
import { getMissingChannels, getRequiredChannels } from "../bot/subscription";
import { verifyAccessMiddleware } from "../middlewares/verifyAccess";
import { requireSession } from "../middlewares/requireSession";
import { getSetting } from "../lib/settingsCache";
import { logger } from "../lib/logger";

const router = Router();

const MAX_WITHDRAWAL = 10000;

// TON address: EQ/UQ/kQ/0Q + 46 base64url chars
const TON_ADDRESS_RE = /^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/;

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Max 3 withdrawal requests per 10 minutes — keyed by IP (default)
const withdrawLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "طلبات سحب كثيرة، حاول بعد قليل" },
  skip: () => process.env.NODE_ENV !== "production",
});

// ── Real-time security check at withdrawal request time ───────────────────────
// Returns true if something suspicious was found and admin was alerted.
async function runWithdrawalSecurityCheck(opts: {
  userId: number;
  userDisplay: string;
  amount: string;
  withdrawalId: number;
  ownerId: number;
}): Promise<boolean> {
  const { userId, userDisplay, amount, withdrawalId, ownerId } = opts;

  let bot: ReturnType<typeof getBot>;
  try { bot = getBot(); } catch { return false; }

  const channels = await getRequiredChannels().catch(() => []);
  if (channels.length === 0) return false;

  // ── Check 1: is the requesting user still subscribed? ──────────────────────
  const userMissing = await getMissingChannels(bot, userId).catch(() => [] as typeof channels);

  // ── Check 2: how many of their active referrals are still subscribed? ───────
  const activeRefs = await db
    .select({ id: referralsTable.id, referredId: referralsTable.referredId })
    .from(referralsTable)
    .where(and(
      eq(referralsTable.referrerId, userId),
      eq(referralsTable.status, "active"),
    ));

  let validRefs = 0, leftRefs = 0;
  for (const ref of activeRefs) {
    const missing = await getMissingChannels(bot, ref.referredId).catch(() => [""]);
    if (missing.length === 0) validRefs++;
    else leftRefs++;
  }

  const totalRefs = activeRefs.length;
  const validPct  = totalRefs > 0 ? Math.round((validRefs / totalRefs) * 100) : 100;

  const isSuspicious = userMissing.length > 0 || leftRefs > 0;
  if (!isSuspicious) return false;

  // ── Build admin message ─────────────────────────────────────────────────────
  let userStatusLines: string;
  if (userMissing.length === 0) {
    userStatusLines = `✅ منضم في جميع القنوات (${channels.length}/${channels.length})`;
  } else {
    const joinedCount = channels.length - userMissing.length;
    const leftNames = userMissing
      .map(c => esc(c.title || c.username))
      .join("، ");
    userStatusLines =
      `✅ منضم في ${joinedCount} من ${channels.length} قناة\n` +
      `❌ خرج من: ${leftNames}`;
  }

  const refStatusLines =
    `✅ منضمين ومحسوبين: ${validRefs}\n` +
    `❌ خرجوا من القنوات: ${leftRefs}\n` +
    `📊 النسبة الصحيحة: ${validPct}%`;

  try {
    await bot.sendMessage(
      ownerId,
      `🚨 <b>تنبيه سحب مشبوه!</b>\n` +
      `المستخدم ${userDisplay} طلب سحب <b>${esc(amount)} TON</b>\n\n` +
      `📢 <b>حالة المستخدم:</b>\n${userStatusLines}\n\n` +
      `👥 <b>حالة إحالاته:</b>\n${refStatusLines}\n\n` +
      `اختر الإجراء:`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[
            { text: "✅ موافقة رغم ذلك", callback_data: `withdraw_approve_${withdrawalId}` },
            { text: "❌ رفض السحب",      callback_data: `withdraw_reject_${withdrawalId}` },
            { text: "🚫 حظر المستخدم",   callback_data: `withdraw_ban_${withdrawalId}` },
          ]],
        },
      }
    );
  } catch (err) {
    logger.error({ err }, "withdrawalSecurityCheck: failed to send admin alert");
  }

  // Notify the user that their withdrawal is under review
  await bot.sendMessage(
    userId,
    `⏳ سحبك قيد المراجعة، سيتم الرد خلال قليل.`,
  ).catch(() => {});

  return true;
}

router.post("/", withdrawLimiter, requireSession, verifyAccessMiddleware, async (req, res) => {
  const { userId, amount, walletAddress } = req.body;

  if (!userId || !amount || !walletAddress) {
    res.status(400).json({ error: "الحقول مطلوبة" }); return;
  }

  const numUserId = parseInt(String(userId));
  if (isNaN(numUserId) || numUserId <= 0) {
    res.status(400).json({ error: "معرّف مستخدم غير صحيح" }); return;
  }

  const sessionReq = req as import("../middlewares/requireSession").SessionRequest;
  if (sessionReq.sessionUserId !== undefined && sessionReq.sessionUserId !== numUserId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const cleanAddress = String(walletAddress).trim();
  if (!TON_ADDRESS_RE.test(cleanAddress)) {
    res.status(400).json({ error: "عنوان محفظة TON غير صحيح. يجب أن يبدأ بـ EQ أو UQ ويتكون من 48 حرفاً." }); return;
  }

  const rawMin = await getSetting("min_withdrawal").catch(() => null);
  const MIN_WITHDRAWAL = Math.max(0.01, parseFloat(rawMin ?? "0.1") || 0.1);

  const amt = parseFloat(String(amount));
  if (isNaN(amt) || amt < MIN_WITHDRAWAL || amt > MAX_WITHDRAWAL) {
    res.status(400).json({ error: `المبلغ يجب أن يكون بين ${MIN_WITHDRAWAL} و ${MAX_WITHDRAWAL} TON` }); return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, numUserId)).limit(1);
  if (!user) { res.status(404).json({ error: "المستخدم غير موجود" }); return; }
  if (user.isVisible === false) { res.status(403).json({ error: "الحساب محظور" }); return; }

  // ── Subscription enforcement: block withdrawal if user left required channels ──
  if (user.isBlockedForLeaving === true) {
    res.status(403).json({
      error: "لا يمكن السحب — يجب إعادة الانضمام للقنوات المطلوبة أولاً",
    });
    return;
  }

  if (parseFloat(String(user.tonBalance ?? "0")) < amt) {
    res.status(400).json({ error: "رصيد TON غير كافٍ — حوّل USDT إلى TON أولاً" }); return;
  }

  // Deduct ton_balance atomically
  await db.update(usersTable)
    .set({ tonBalance: sql`ton_balance - ${amt}` })
    .where(eq(usersTable.id, numUserId));

  const [wd] = await db.insert(withdrawalsTable).values({
    userId: numUserId,
    amount: String(amt),
    walletAddress: cleanAddress,
    status: "pending",
  }).returning();

  const userDisplay = user.username
    ? `@${esc(user.username)}`
    : esc(user.firstName || String(numUserId));

  // Fetch owner ID once — used by both security check and normal notification
  const ownerIdRow = await db
    .select()
    .from(botSettingsTable)
    .where(eq(botSettingsTable.key, "owner_telegram_id"))
    .limit(1);
  const ownerId = ownerIdRow.length > 0 && ownerIdRow[0].value
    ? parseInt(ownerIdRow[0].value)
    : null;

  // ── Real-time security check: user subscription + referral validity ──────────
  let securityAlertSent = false;
  if (ownerId) {
    try {
      securityAlertSent = await runWithdrawalSecurityCheck({
        userId: numUserId,
        userDisplay,
        amount: String(amt),
        withdrawalId: wd.id,
        ownerId,
      });
    } catch (err) {
      logger.warn({ err }, "withdrawals: security check error (non-critical)");
    }
  }

  // ── Normal admin notification (only if security check didn't already alert) ──
  if (!securityAlertSent && ownerId) {
    try {
      await sendWithdrawalNotification(
        ownerId,
        {
          firstName: user.firstName || "",
          username: user.username,
          id: numUserId,
          ipHash: user.ipHash,
          ipSuspicious: user.ipSuspicious,
        },
        String(amt),
        cleanAddress,
        wd.id,
      );
    } catch { /* notification failure is non-critical */ }
  }

  res.json({ success: true, withdrawal: wd });
});

router.get("/:userId", requireSession, async (req, res) => {
  const userId = parseInt(String(req.params.userId));
  if (isNaN(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid userId" }); return;
  }

  const sessionReq = req as import("../middlewares/requireSession").SessionRequest;
  if (sessionReq.sessionUserId !== undefined && sessionReq.sessionUserId !== userId) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const withdrawals = await db
    .select()
    .from(withdrawalsTable)
    .where(eq(withdrawalsTable.userId, userId))
    .orderBy(desc(withdrawalsTable.createdAt));

  res.json(withdrawals);
});

export default router;
