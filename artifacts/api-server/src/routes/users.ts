import { Router } from "express";
import { createHash } from "crypto";
import { db } from "@workspace/db";
import { usersTable, wheelSlotsTable, botSettingsTable } from "@workspace/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { telegramAuth, softTelegramAuth, spinRateLimit } from "../middlewares/telegramAuth";
import { verifyAccessMiddleware } from "../middlewares/verifyAccess";
import { requireSession } from "../middlewares/requireSession";

const router = Router();

// Fixed salt — change this in production via IP_HASH_SALT env var
const IP_SALT = process.env.IP_HASH_SALT || "jojox_ip_salt_2025";

function hashIp(ip: string): string {
  return createHash("sha256").update(ip + IP_SALT).digest("hex");
}

function normalizeIp(raw: string): string {
  // Strip IPv4-mapped IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4)
  return (raw || "").replace(/^::ffff:/, "").trim();
}

// ── Single-query upsert init — fast path for returning users ─────────
router.post("/init", softTelegramAuth, async (req, res) => {
  const { id, username, first_name, last_name, photo_url } = req.body;
  if (!id) { res.status(400).json({ error: "Missing id" }); return; }

  try {
    // Single upsert: insert new user OR update profile fields for existing user
    const [user] = await db
      .insert(usersTable)
      .values({
        id,
        username: username || null,
        firstName: first_name || "",
        lastName: last_name || "",
        photoUrl: photo_url || null,
        spins: 3,
      })
      .onConflictDoUpdate({
        target: usersTable.id,
        set: {
          username: sql`COALESCE(${username || null}, users.username)`,
          firstName: sql`COALESCE(NULLIF(${first_name || ""}, ''), users.first_name)`,
          lastName: sql`COALESCE(NULLIF(${last_name || ""}, ''), users.last_name)`,
          photoUrl: sql`COALESCE(${photo_url || null}, users.photo_url)`,
        },
      })
      .returning();

    if (user.isVisible === false) {
      res.status(403).json({ error: "محظور", banned: true });
      return;
    }

    // Record IP for informational purposes only (no auto-ban)
    if (!user.ipVerifiedAt) {
      const rawIp = normalizeIp(req.ip || req.socket.remoteAddress || "");
      if (rawIp) {
        const ipHash = hashIp(rawIp);
        await db.update(usersTable).set({ ipHash }).where(eq(usersTable.id, user.id)).catch(() => {});
      }
    }

    res.setHeader("Cache-Control", "no-store");
    res.json({ ...user, isVerified: user.ipVerifiedAt != null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/users/init] DB error:", msg);
    res.status(503).json({ error: "service_unavailable", message: "Server busy, please retry." });
  }
});

router.get("/:id", requireSession, async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const sessionReq = req as import("../middlewares/requireSession").SessionRequest;
  if (sessionReq.sessionUserId !== undefined && sessionReq.sessionUserId !== id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  // Fetch inviter name if referredBy is set
  let inviterName: string | null = null;
  if (user.referredBy) {
    const [inviter] = await db
      .select({ firstName: usersTable.firstName, username: usersTable.username })
      .from(usersTable)
      .where(eq(usersTable.id, user.referredBy))
      .limit(1);
    if (inviter) {
      inviterName = inviter.firstName || (inviter.username ? `@${inviter.username}` : null);
    }
  }

  res.setHeader("Cache-Control", "private, no-store");
  res.json({ ...user, isVerified: user.ipVerifiedAt != null, inviterName });
});

// GET /users/:id/referrals — list users referred by this user with pending/approved status
router.get("/:id/referrals", requireSession, async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const sessionReq = req as import("../middlewares/requireSession").SessionRequest;
  if (sessionReq.sessionUserId !== undefined && sessionReq.sessionUserId !== id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const referred = await db
    .select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      username: usersTable.username,
      ipVerifiedAt: usersTable.ipVerifiedAt,
      isBlockedForLeaving: usersTable.isBlockedForLeaving,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.referredBy, id))
    .orderBy(sql`created_at DESC`);

  const result = referred.map(u => ({
    id: u.id,
    name: u.firstName || (u.username ? `@${u.username}` : `User #${u.id}`),
    username: u.username,
    status: (u.ipVerifiedAt != null && !u.isBlockedForLeaving) ? "approved" : "pending",
    joinedAt: u.createdAt,
  }));

  res.setHeader("Cache-Control", "private, no-store");
  res.json(result);
});

router.post("/:id/spin", requireSession, spinRateLimit, verifyAccessMiddleware, async (req, res) => {
  const id = parseInt(String(req.params.id));
  const sessionReq = req as import("../middlewares/requireSession").SessionRequest;
  if (sessionReq.sessionUserId !== undefined && sessionReq.sessionUserId !== id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);

  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (user.isVisible === false) { res.status(403).json({ error: "محظور", banned: true }); return; }
  if (user.spins <= 0) { res.status(400).json({ error: "No spins available" }); return; }

  const slots = await db.select().from(wheelSlotsTable).orderBy(wheelSlotsTable.displayOrder);
  if (slots.length === 0) { res.status(400).json({ error: "Wheel not configured" }); return; }

  const totalWeight = slots.reduce((sum, s) => sum + s.probability, 0);
  if (totalWeight === 0) { res.status(400).json({ error: "All probabilities are zero" }); return; }

  // Absolute probabilities out of 100 — each slot's % is exactly its chance
  const rand = Math.random() * 100;
  let winner: typeof slots[0] | null = null;
  let cumulative = 0;
  for (const slot of slots) {
    cumulative += slot.probability;
    if (rand < cumulative) { winner = slot; break; }
  }
  // Fallback: if rand fell in the "gap" (sum < 100), pick first non-zero slot
  if (!winner) {
    winner = slots.find(s => s.probability > 0) ?? slots[0];
  }

  // Apply admin-configured power multiplier (respecting boost schedule)
  const [powerSetting, startSetting, endSetting] = await Promise.all([
    db.select().from(botSettingsTable).where(eq(botSettingsTable.key, "spin_power")).limit(1),
    db.select().from(botSettingsTable).where(eq(botSettingsTable.key, "boost_starts_at")).limit(1),
    db.select().from(botSettingsTable).where(eq(botSettingsTable.key, "boost_ends_at")).limit(1),
  ]);
  const rawPower = powerSetting.length > 0 ? Math.max(1, parseInt(powerSetting[0].value) || 1) : 1;
  const power = (() => {
    if (rawPower <= 1) return 1;
    const startsAt = startSetting[0]?.value;
    const endsAt   = endSetting[0]?.value;
    if (!startsAt && !endsAt) return rawPower; // no schedule = always active
    const now   = Date.now();
    const start = startsAt ? new Date(startsAt).getTime() : 0;
    const end   = endsAt   ? new Date(endsAt).getTime()   : Infinity;
    return (now >= start && now <= end) ? rawPower : 1;
  })();
  const multipliedAmount = (parseFloat(winner.amount) * power).toFixed(6);

  await db
    .update(usersTable)
    .set({ spins: sql`spins - 1`, balance: sql`balance + ${multipliedAmount}` })
    .where(eq(usersTable.id, id));

  const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  const slotIndex = slots.findIndex(s => s.id === winner!.id);
  // Return winner with multiplied amount so frontend displays correct prize
  const displayWinner = { ...winner, amount: multipliedAmount };
  res.setHeader("Cache-Control", "no-store");
  // Return full slots array so frontend always uses the correct order for animation
  res.json({ winner: displayWinner, user: updated, slotIndex, slots });
});

// ── Swap USDT balance → TON balance (live rate from CoinGecko) ───────
router.post("/:id/swap", requireSession, verifyAccessMiddleware, async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const sessionReq = req as import("../middlewares/requireSession").SessionRequest;
  if (sessionReq.sessionUserId !== undefined && sessionReq.sessionUserId !== id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { usdtAmount } = req.body;
  const amt = parseFloat(String(usdtAmount));
  if (isNaN(amt) || amt <= 0) { res.status(400).json({ error: "مبلغ غير صحيح" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  if (parseFloat(user.balance) < amt) { res.status(400).json({ error: "رصيد USDT غير كافٍ" }); return; }

  // Fetch live TON/USD price from CoinGecko
  let tonUsdPrice: number;
  try {
    const cgRes = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
      { signal: AbortSignal.timeout(6000) }
    );
    const cgData = await cgRes.json() as { "the-open-network"?: { usd?: number } };
    const price = cgData?.["the-open-network"]?.usd;
    if (!price || price <= 0) throw new Error("Bad price");
    tonUsdPrice = price;
  } catch {
    res.status(502).json({ error: "تعذّر جلب سعر TON — حاول مرة أخرى" }); return;
  }

  const tonAmount = amt / tonUsdPrice;

  await db.update(usersTable)
    .set({
      balance:    sql`balance - ${String(amt)}`,
      tonBalance: sql`ton_balance + ${String(tonAmount)}`,
    })
    .where(eq(usersTable.id, id));

  const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, id)).limit(1);
  res.json({ success: true, tonAmount: tonAmount.toFixed(6), tonPrice: tonUsdPrice, user: updated });
});

// ── Save / update wallet address ────────────────────────────────────
const TON_ADDRESS_RE = /^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/;

router.put("/:id/wallet", requireSession, verifyAccessMiddleware, async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const sessionReq = req as import("../middlewares/requireSession").SessionRequest;
  if (sessionReq.sessionUserId !== undefined && sessionReq.sessionUserId !== id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const { walletAddress } = req.body;

  // Allow empty string / null to clear the wallet
  const clear = walletAddress === null || walletAddress === "" || walletAddress === undefined;

  let clean: string | null = null;
  if (!clear) {
    clean = String(walletAddress).trim();
    if (!TON_ADDRESS_RE.test(clean)) {
      res.status(400).json({ error: "عنوان محفظة TON غير صحيح. يجب أن يبدأ بـ EQ أو UQ ويتكون من 48 حرفاً." });
      return;
    }
  }

  const [updated] = await db
    .update(usersTable)
    .set({ savedWalletAddress: clean })
    .where(eq(usersTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ savedWalletAddress: updated.savedWalletAddress });
});

export default router;
