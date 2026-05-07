import { Router } from "express";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import { withdrawalsTable, usersTable, botSettingsTable } from "@workspace/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { sendWithdrawalNotification } from "../bot";
import { verifyAccessMiddleware } from "../middlewares/verifyAccess";
import { requireSession } from "../middlewares/requireSession";

const router = Router();

const MIN_WITHDRAWAL = 0.1;
const MAX_WITHDRAWAL = 1000;

// TON address: EQ/UQ/kQ/0Q + 46 base64url chars
const TON_ADDRESS_RE = /^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/;

// Max 3 withdrawal requests per 10 minutes — keyed by IP (default)
const withdrawLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "طلبات سحب كثيرة، حاول بعد قليل" },
  skip: () => process.env.NODE_ENV !== "production",
});

router.post("/", withdrawLimiter, requireSession, verifyAccessMiddleware, async (req, res) => {
  const { userId, amount, walletAddress } = req.body;

  if (!userId || !amount || !walletAddress) {
    res.status(400).json({ error: "الحقول مطلوبة" }); return;
  }

  const numUserId = parseInt(String(userId));
  if (isNaN(numUserId) || numUserId <= 0) {
    res.status(400).json({ error: "معرّف مستخدم غير صحيح" }); return;
  }

  const cleanAddress = String(walletAddress).trim();
  if (!TON_ADDRESS_RE.test(cleanAddress)) {
    res.status(400).json({ error: "عنوان محفظة TON غير صحيح. يجب أن يبدأ بـ EQ أو UQ ويتكون من 48 حرفاً." }); return;
  }

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

  // Always manual — notify admin for approval. Admin presses ✅/❌ via bot callback.
  try {
    const ownerIdRow = await db
      .select()
      .from(botSettingsTable)
      .where(eq(botSettingsTable.key, "owner_telegram_id"))
      .limit(1);

    if (ownerIdRow.length > 0 && ownerIdRow[0].value) {
      const ownerId = parseInt(ownerIdRow[0].value);
      await sendWithdrawalNotification(
        ownerId,
        { firstName: user.firstName || "", username: user.username, id: numUserId },
        String(amt),
        cleanAddress,
        wd.id
      );
    }
  } catch { /* notification failure is non-critical */ }

  res.json({ success: true, withdrawal: wd });
});

router.get("/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (isNaN(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid userId" }); return;
  }

  const withdrawals = await db
    .select()
    .from(withdrawalsTable)
    .where(eq(withdrawalsTable.userId, userId))
    .orderBy(desc(withdrawalsTable.createdAt));

  res.json(withdrawals);
});

export default router;
