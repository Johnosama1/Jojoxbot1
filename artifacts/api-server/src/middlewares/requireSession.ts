import type { Request, Response, NextFunction } from "express";
import { validateToken } from "../lib/sessionToken";
import { logger } from "../lib/logger";

export interface SessionRequest extends Request {
  sessionUserId?: number;
}

// ── requireSession middleware ─────────────────────────────────────────
// Validates x-session-token header. Blocks with 401 if missing/invalid.
// Attaches req.sessionUserId for downstream handlers.
export function requireSession(
  req: SessionRequest,
  res: Response,
  next: NextFunction
): void {
  const token = req.headers["x-session-token"] as string | undefined;

  if (!token) {
    // In development without initData, allow through (convenience for testing)
    if (process.env.NODE_ENV !== "production") {
      const rawId =
        req.body?.userId ?? req.body?.id ?? req.params?.id ?? req.query?.userId;
      if (rawId) {
        req.sessionUserId = parseInt(String(rawId));
        next();
        return;
      }
    }
    res.status(401).json({ error: "session_required", message: "يجب فتح التطبيق من تيليجرام" });
    return;
  }

  const result = validateToken(token);

  if (!result.valid) {
    const statusCode = result.reason === "expired" ? 401 : 403;
    res.status(statusCode).json({
      error: result.reason === "expired" ? "session_expired" : "session_invalid",
      message: result.reason === "expired"
        ? "انتهت الجلسة، أعد فتح التطبيق"
        : "جلسة غير صالحة",
    });
    return;
  }

  logger.debug({ userId: result.userId }, "session validated");
  req.sessionUserId = result.userId;
  next();
}
