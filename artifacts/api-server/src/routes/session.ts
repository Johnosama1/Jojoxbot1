import { Router } from "express";
import crypto from "crypto";
import { db } from "@workspace/db";
import { usersTable, adminsTable, botSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { issueToken } from "../lib/sessionToken";
import { verifyUserAccess } from "../middlewares/verifyAccess";
import { isBotEnabled } from "../bot/control";
import { logger } from "../lib/logger";

const OWNER_ID = 6145230334;

// ── Check if a userId belongs to an admin/owner (bypasses maintenance) ────
async function isAdminUser(userId: number): Promise<boolean> {
  if (userId === OWNER_ID) return true;
  try {
    const [ownerRow] = await db
      .select()
      .from(botSettingsTable)
      .where(eq(botSettingsTable.key, "owner_telegram_id"))
      .limit(1);
    if (ownerRow?.value && userId === parseInt(ownerRow.value)) return true;
    const [adminRow] = await db
      .select()
      .from(adminsTable)
      .where(eq(adminsTable.id, userId))
      .limit(1);
    if (adminRow) return true;
  } catch { /* DB may not be ready */ }
  return false;
}

const router = Router();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

// ── Parse + validate Telegram WebApp initData ─────────────────────────
function parseInitData(initData: string): { valid: boolean; userId?: number } {
  try {
    if (!BOT_TOKEN) {
      // In production, no token means fail closed — cannot verify identity
      if (process.env.NODE_ENV === "production") return { valid: false };
      // In dev, allow through without verification
      return { valid: true, userId: undefined };
    }

    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { valid: false };
    params.delete("hash");

    const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const checkStr = entries.map(([k, v]) => `${k}=${v}`).join("\n");
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const computed = crypto.createHmac("sha256", secretKey).update(checkStr).digest("hex");

    if (
      computed.length !== hash.length ||
      !crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(hash, "hex"))
    ) {
      return { valid: false };
    }

    const userStr = params.get("user");
    const userId = userStr ? JSON.parse(userStr).id : undefined;
    return { valid: true, userId };
  } catch {
    return { valid: false };
  }
}

// ── POST /session/issue ───────────────────────────────────────────────
// 1. Validate Telegram initData
// 2. Run verifyUserAccess (subscription gate)
// 3. Issue HMAC-signed session token
router.post("/issue", async (req, res) => {
  const initData = (req.headers["x-telegram-init-data"] as string | undefined) ?? req.body?.initData ?? "";
  const bodyUserId = req.body?.userId ? parseInt(String(req.body.userId)) : undefined;

  // ── Step 1: validate initData ────────────────────────────────────
  const parsed = parseInitData(initData);
  if (!parsed.valid) {
    logger.warn({ bodyUserId }, "issue-session: invalid initData");
    res.status(401).json({ error: "invalid_auth", message: "بيانات Telegram غير صالحة" });
    return;
  }

  const userId = parsed.userId ?? bodyUserId;
  if (!userId) {
    res.status(400).json({ error: "missing_user", message: "معرّف المستخدم مفقود" });
    return;
  }

  // ── Step 2: maintenance check (before anything else) ─────────────
  const botEnabled = await isBotEnabled().catch(() => true); // fail-open
  if (!botEnabled) {
    const adminBypass = await isAdminUser(userId);
    if (!adminBypass) {
      logger.info({ userId }, "issue-session: blocked by maintenance mode");
      res.status(503).json({ error: "maintenance", message: "البوت تحت الصيانة حالياً. يرجى المحاولة لاحقاً." });
      return;
    }
  }

  // ── Step 3: ensure user exists and is not banned ─────────────────
  const [user] = await db
    .select({ id: usersTable.id, isVisible: usersTable.isVisible })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "user_not_found" });
    return;
  }

  if (user.isVisible === false) {
    logger.warn({ userId }, "issue-session: user is banned");
    res.status(403).json({ error: "banned", message: "حسابك محظور" });
    return;
  }

  // ── Step 3: run subscription gate (verifyUserAccess) ─────────────
  const access = await verifyUserAccess(userId);
  if (!access.allowed) {
    logger.info(
      { userId, missingChannels: access.missingChannels.map((c) => c.username) },
      "issue-session: blocked — left required channel"
    );
    res.status(403).json({
      error: "subscription_blocked",
      message: "يجب إعادة الانضمام للقنوات المطلوبة للمتابعة",
      missingChannels: access.missingChannels,
      requiredChannels: access.requiredChannels,
    });
    return;
  }

  // ── Step 4: issue session token ───────────────────────────────────
  const { token, expiresAt } = issueToken(userId);
  logger.info({ userId, expiresAt: new Date(expiresAt).toISOString() }, "issue-session: token issued");

  res.json({ token, expiresAt, userId });
});

// ── POST /session/recheck ─────────────────────────────────────────────
// Re-run subscription check + issue new token (for "Check Again" button)
router.post("/recheck", async (req, res) => {
  const initData = (req.headers["x-telegram-init-data"] as string | undefined) ?? "";
  const bodyUserId = req.body?.userId ? parseInt(String(req.body.userId)) : undefined;

  const parsed = parseInitData(initData);
  if (!parsed.valid && process.env.NODE_ENV === "production") {
    res.status(401).json({ error: "invalid_auth", message: "بيانات Telegram غير صالحة" });
    return;
  }
  const userId = (parsed.valid ? parsed.userId : undefined) ?? bodyUserId;

  if (!userId) {
    res.status(400).json({ error: "missing_user" });
    return;
  }

  // Maintenance check
  const botEnabled = await isBotEnabled().catch(() => true);
  if (!botEnabled && !(await isAdminUser(userId))) {
    res.status(503).json({ error: "maintenance", message: "البوت تحت الصيانة حالياً." });
    return;
  }

  const access = await verifyUserAccess(userId);

  if (!access.allowed) {
    res.status(403).json({
      error: "subscription_blocked",
      message: "لا تزال غير مشترك في القنوات المطلوبة",
      missingChannels: access.missingChannels,
      requiredChannels: access.requiredChannels,
    });
    return;
  }

  const { token, expiresAt } = issueToken(userId);
  logger.info({ userId }, "issue-session: recheck passed — new token issued");
  res.json({ token, expiresAt, userId });
});

export default router;
