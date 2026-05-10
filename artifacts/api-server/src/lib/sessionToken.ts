import crypto from "crypto";
import { logger } from "./logger";

// ── Config ───────────────────────────────────────────────────────────
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function getKey(): Buffer {
  const secret =
    process.env.SESSION_TOKEN_SECRET ||
    process.env.TELEGRAM_BOT_TOKEN;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_TOKEN_SECRET is required in production");
    }
    // Dev only — not used in production
    return crypto.createHmac("sha256", "SessionGate").update("dev_only_not_for_prod").digest();
  }

  return crypto.createHmac("sha256", "SessionGate").update(secret).digest();
}

// ── Token format: base64url( userId:expiryMs:hmacHex ) ───────────────
export function issueToken(userId: number): { token: string; expiresAt: number } {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}:${expiresAt}`;
  const hmac = crypto.createHmac("sha256", getKey()).update(payload).digest("hex");
  const raw = `${payload}:${hmac}`;
  const token = Buffer.from(raw).toString("base64url");

  logger.info({ userId, expiresAt: new Date(expiresAt).toISOString() }, "session token issued");
  return { token, expiresAt };
}

export interface TokenResult {
  valid: boolean;
  userId?: number;
  reason?: string;
}

export function validateToken(token: string): TokenResult {
  try {
    const raw = Buffer.from(token, "base64url").toString("utf8");
    const parts = raw.split(":");
    if (parts.length !== 3) return { valid: false, reason: "malformed" };

    const [userIdStr, expiryStr, hmac] = parts;
    const userId = parseInt(userIdStr);
    const expiry = parseInt(expiryStr);

    if (isNaN(userId) || isNaN(expiry)) return { valid: false, reason: "invalid_parts" };

    if (Date.now() > expiry) {
      logger.debug({ userId }, "session token expired");
      return { valid: false, reason: "expired" };
    }

    const payload = `${userIdStr}:${expiryStr}`;
    const expected = crypto.createHmac("sha256", getKey()).update(payload).digest("hex");

    const hmacBuf = Buffer.from(hmac, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (
      hmacBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(hmacBuf, expectedBuf)
    ) {
      logger.warn({ userId }, "session token invalid signature");
      return { valid: false, reason: "invalid_signature" };
    }

    return { valid: true, userId };
  } catch {
    return { valid: false, reason: "parse_error" };
  }
}
