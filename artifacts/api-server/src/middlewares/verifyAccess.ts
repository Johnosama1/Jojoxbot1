import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getBot } from "../bot";
import { getRequiredChannels, getMissingChannels } from "../bot/subscription";
import { logger } from "../lib/logger";

// ── Core verification logic (no bot dependency for read-only check) ──
export interface VerifyResult {
  allowed: boolean;
  enforced: boolean;
  missingChannels: Array<{ username: string; title: string; inviteLink: string }>;
  requiredChannels: Array<{ username: string; title: string; inviteLink: string }>;
}

export async function verifyUserAccess(userId: number): Promise<VerifyResult> {
  const [user] = await db
    .select({ rewardedSpins: usersTable.rewardedSpins, isBlockedForLeaving: usersTable.isBlockedForLeaving })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) return { allowed: true, enforced: false, missingChannels: [], requiredChannels: [] };

  // No channel rewards → never enforced, always allowed
  if (!user.rewardedSpins || user.rewardedSpins <= 0) {
    return { allowed: true, enforced: false, missingChannels: [], requiredChannels: [] };
  }

  const requiredChannels = await getRequiredChannels();
  if (requiredChannels.length === 0) {
    // No channels configured → clear any stale block
    if (user.isBlockedForLeaving) {
      await db.update(usersTable)
        .set({ isBlockedForLeaving: false })
        .where(eq(usersTable.id, userId));
    }
    return { allowed: true, enforced: false, missingChannels: [], requiredChannels: [] };
  }

  const bot = getBot();
  if (!bot) {
    // Bot unavailable → use cached DB value
    const isBlocked = user.isBlockedForLeaving ?? false;
    return {
      allowed: !isBlocked,
      enforced: true,
      missingChannels: isBlocked ? requiredChannels : [],
      requiredChannels,
    };
  }

  const missingChannels = await getMissingChannels(bot, userId);
  const isBlocked = missingChannels.length > 0;

  // Persist result
  await db.update(usersTable)
    .set({ isBlockedForLeaving: isBlocked, lastChannelCheckAt: new Date() })
    .where(eq(usersTable.id, userId));

  return { allowed: !isBlocked, enforced: true, missingChannels, requiredChannels };
}

// ── Extract userId from any common location ──────────────────────────
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

// ── Express middleware — call BEFORE route logic ─────────────────────
// Returns 403 JSON if user is blocked, otherwise calls next()
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
