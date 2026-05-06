import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

// ── How old can an initData be before we reject it? (15 min) ─────────
const MAX_AGE_MS = 15 * 60 * 1000;

function verifyTelegramHash(
  initData: string,
  token: string,
): { valid: boolean; userId?: number; authDate?: number } {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { valid: false };
    params.delete("hash");

    // Sort entries and build check string
    const entries = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    const secretKey = crypto.createHmac("sha256", "WebAppData").update(token).digest();
    const computedHash = crypto
      .createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    // Timing-safe comparison to prevent timing attacks
    if (
      computedHash.length !== hash.length ||
      !crypto.timingSafeEqual(Buffer.from(computedHash, "hex"), Buffer.from(hash, "hex"))
    ) {
      return { valid: false };
    }

    // Extract user ID and auth date
    const userParam = params.get("user");
    const userId = userParam ? JSON.parse(userParam).id : undefined;
    const authDate = parseInt(params.get("auth_date") || "0") * 1000;

    return { valid: true, userId, authDate };
  } catch {
    return { valid: false };
  }
}

// ── In-memory spin rate limiter ───────────────────────────────────────
const spinTimestamps = new Map<number, number>();
const SPIN_COOLDOWN_MS = 3000;

// Clean up old entries every 10 minutes to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - SPIN_COOLDOWN_MS * 2;
  for (const [id, ts] of spinTimestamps) {
    if (ts < cutoff) spinTimestamps.delete(id);
  }
}, 10 * 60 * 1000);

export function spinRateLimit(req: Request, res: Response, next: NextFunction) {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { next(); return; }
  const now = Date.now();
  const last = spinTimestamps.get(id);
  if (last && now - last < SPIN_COOLDOWN_MS) {
    res.status(429).json({ error: "يرجى الانتظار قليلاً قبل الدوران مجدداً" });
    return;
  }
  spinTimestamps.set(id, now);
  next();
}

export function telegramAuth(req: Request, res: Response, next: NextFunction) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  // If no token configured — skip in dev only
  if (!token) {
    if (process.env.NODE_ENV !== "production") { next(); return; }
    res.status(500).json({ error: "Bot token not configured" });
    return;
  }

  const initData = req.headers["x-telegram-init-data"] as string | undefined;

  // No initData header
  if (!initData) {
    if (process.env.NODE_ENV !== "production") { next(); return; }
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { valid, userId, authDate } = verifyTelegramHash(initData, token);

  if (!valid) {
    res.status(401).json({ error: "Invalid authentication" });
    return;
  }

  // Reject stale initData (replay attack prevention) — production only
  if (authDate && process.env.NODE_ENV === "production") {
    if (Date.now() - authDate > MAX_AGE_MS) {
      res.status(401).json({ error: "Session expired, please restart the app" });
      return;
    }
  }

  // Verify userId in initData matches the userId in the request
  const bodyId = req.body?.id ? parseInt(String(req.body.id)) : undefined;
  const paramId = req.params?.id ? parseInt(req.params.id) : undefined;
  const routeUserId = bodyId ?? paramId;

  if (routeUserId && userId && routeUserId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Attach verified userId to request for downstream use
  (req as Request & { telegramUserId?: number }).telegramUserId = userId;
  next();
}
