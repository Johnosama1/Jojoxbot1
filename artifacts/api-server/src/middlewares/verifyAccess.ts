import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getBot } from "../bot";
import { getRequiredChannels, getMissingChannels } from "../bot/subscription";
import { logger } from "../lib/logger";

// ── Core verification logic ────────────────────────────────────────────────
export interface VerifyResult {
  allowed: boolean;
  enforced: boolean;
  missingChannels: Array<{ username: string; title: string; inviteLink: string }>;
  requiredChannels: Array<{ username: string; title: string; inviteLink: string }>;
}

/**
 * Verify a user's access based on required channel subscriptions.
 * Enforces for ALL users when channels are configured — not just those
 * who previously received channel rewards.
 */
export async function verifyUserAccess(userId: number): Promise<VerifyResult> {
  // ── 1. Check required channels ───────────────────────────────────────────
  const requiredChannels = await getRequiredChannels();
  if (requiredChannels.length === 0) {
    // No channels configured — clear any stale DB block
    await db
      .update(usersTable)
      .set({ isBlockedForLeaving: false })
      .where(eq(usersTable.id, userId))
      .catch(() => {});
    return { allowed: true, enforced: false, missingChannels: [], requiredChannels: [] };
  }

  // ── 2. Live-check membership via bot ────────────────────────────────────
  const bot = getBot();
  if (!bot) {
    // Bot unavailable — fall back to cached DB value
    const [user] = await db
      .select({ isBlockedForLeaving: usersTable.isBlockedForLeaving })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    const isBlocked = user?.isBlockedForLeaving ?? false;
    return {
      allowed: !isBlocked,
      enforced: true,
      missingChannels: isBlocked ? requiredChannels : [],
      requiredChannels,
    };
  }

  const missingChannels = await getMissingChannels(bot, userId);
  const isBlocked = missingChannels.length > 0;

  // Persist result to DB
  await db
    .update(usersTable)
    .set({ isBlockedForLeaving: isBlocked, lastChannelCheckAt: new Date() })
    .where(eq(usersTable.id, userId))
    .catch(() => {});

  return { allowed: !isBlocked, enforced: true, missingChannels, requiredChannels };
}

// ── Extract userId from any common request location ───────────────────────
function extractUserId(req: Request): number | null {
  const raw =
    req.body?.userId ??
    req.params?.id ??
    req.query?.userId ??
    null;
  if (raw == null) return null;
  const n = parseInt(String(raw));
  return isNaN(n) || n <= 0 ? null : n;
}

// ── Express middleware ────────────────────────────────────────────────────
export function verifyAccessMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const userId = extractUserId(req);
  if (!userId) { next(); return; }

  verifyUserAccess(userId)
    .then((result) => {
      if (!result.allowed) {
        res.status(403).json({
          error: "subscription_blocked",
          message: "يجب إعادة الانضمام للقنوات المطلوبة للمتابعة",
          missingChannels: result.missingChannels,
          requiredChannels: result.requiredChannels,
        });
        return;
      }
      next();
    })
    .catch((err) => {
      logger.error({ err, userId }, "verifyAccessMiddleware error");
      next(); // fail-open
    });
}
