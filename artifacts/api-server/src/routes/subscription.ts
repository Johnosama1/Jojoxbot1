import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { getBot } from "../bot";
import {
  getRequiredChannels,
  getMissingChannels,
} from "../bot/subscription";
import { verifyUserAccess } from "../middlewares/verifyAccess";

const router = Router();

// GET /subscription/status/:userId
// Returns subscription enforcement status for the mini app
router.get("/status/:userId", async (req, res) => {
  const userId = parseInt(req.params.userId);
  if (isNaN(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const [user] = await db
    .select({
      rewardedSpins: usersTable.rewardedSpins,
      isBlockedForLeaving: usersTable.isBlockedForLeaving,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Never enforced if no channel rewards
  if (user.rewardedSpins <= 0) {
    res.json({ enforced: false, isBlocked: false, missingChannels: [], requiredChannels: [] });
    return;
  }

  const requiredChannels = await getRequiredChannels();
  if (requiredChannels.length === 0) {
    res.json({ enforced: false, isBlocked: false, missingChannels: [], requiredChannels: [] });
    return;
  }

  const bot = getBot();
  if (!bot) {
    // Bot not available — return cached DB status
    res.json({
      enforced: true,
      isBlocked: user.isBlockedForLeaving,
      missingChannels: [],
      requiredChannels,
    });
    return;
  }

  const missingChannels = await getMissingChannels(bot, userId);
  const isBlocked = missingChannels.length > 0;

  // Update DB with real-time result
  await db
    .update(usersTable)
    .set({ isBlockedForLeaving: isBlocked, lastChannelCheckAt: new Date() })
    .where(eq(usersTable.id, userId));

  res.json({ enforced: true, isBlocked, missingChannels, requiredChannels });
});

// POST /subscription/recheck
// Re-checks membership and unblocks if user rejoined all channels
router.post("/recheck", async (req, res) => {
  const userId = parseInt(String(req.body.userId));
  if (isNaN(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const [user] = await db
    .select({ rewardedSpins: usersTable.rewardedSpins })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (user.rewardedSpins <= 0) {
    res.json({ isBlocked: false, missingChannels: [] });
    return;
  }

  const requiredChannels = await getRequiredChannels();
  if (requiredChannels.length === 0) {
    await db
      .update(usersTable)
      .set({ isBlockedForLeaving: false, lastChannelCheckAt: new Date() })
      .where(eq(usersTable.id, userId));
    res.json({ isBlocked: false, missingChannels: [] });
    return;
  }

  const bot = getBot();
  if (!bot) {
    res.status(503).json({ error: "Bot not available, try again later" });
    return;
  }

  const missingChannels = await getMissingChannels(bot, userId);
  const isBlocked = missingChannels.length > 0;

  await db
    .update(usersTable)
    .set({ isBlockedForLeaving: isBlocked, lastChannelCheckAt: new Date() })
    .where(eq(usersTable.id, userId));

  res.json({ isBlocked, missingChannels });
});

// GET /verify-access?userId=XXX
// Centralized WebApp entry-point check (as per spec)
router.get("/verify-access", async (req, res) => {
  const userId = parseInt(String(req.query.userId));
  if (isNaN(userId) || userId <= 0) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  try {
    const result = await verifyUserAccess(userId);
    if (!result.allowed) {
      res.json({
        allowed: false,
        enforced: true,
        message: "يجب إعادة الانضمام للقنوات المطلوبة للمتابعة",
        missingChannels: result.missingChannels,
        requiredChannels: result.requiredChannels,
      });
      return;
    }
    res.json({ allowed: true, enforced: result.enforced, missingChannels: [], requiredChannels: result.requiredChannels });
  } catch {
    res.json({ allowed: true, enforced: false, missingChannels: [], requiredChannels: [] });
  }
});

export default router;
