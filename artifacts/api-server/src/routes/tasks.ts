import { Router } from "express";
import { db } from "@workspace/db";
import { tasksTable, userTasksTable, usersTable } from "@workspace/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getBot } from "../bot";
import { checkChannelMembership } from "../bot/admin";
import { recordChannelReward } from "../bot/subscription";
import { verifyAccessMiddleware } from "../middlewares/verifyAccess";
import { requireSession } from "../middlewares/requireSession";

const router = Router();

// ── In-memory cache for active tasks list ───────────────────────────
let _tasksCache: { data: unknown; ts: number } | null = null;
const TASKS_TTL = 30_000; // 30 seconds

export function invalidateTasksCache() {
  _tasksCache = null;
}

function extractChannelUsername(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/t\.me\/([A-Za-z0-9_]+)/);
  return m ? m[1] : null;
}

router.get("/", async (_req, res) => {
  const now = Date.now();

  if (_tasksCache && now - _tasksCache.ts < TASKS_TTL) {
    res.setHeader("Cache-Control", "public, max-age=30");
    res.json(_tasksCache.data);
    return;
  }

  const nowDate = new Date();
  const tasks = await db.select().from(tasksTable).where(eq(tasksTable.isActive, true));
  const active = tasks.filter((t) => !t.expiresAt || t.expiresAt > nowDate);

  _tasksCache = { data: active, ts: now };
  res.setHeader("Cache-Control", "public, max-age=30");
  res.json(active);
});

router.post("/:taskId/complete", requireSession, verifyAccessMiddleware, async (req, res) => {
  invalidateTasksCache();

  const taskId = parseInt(req.params.taskId);
  if (isNaN(taskId) || taskId <= 0) {
    res.status(400).json({ error: "Invalid taskId" });
    return;
  }

  const sessionReq = req as import("../middlewares/requireSession").SessionRequest;
  const userId = parseInt(String(req.body.userId));
  if (isNaN(userId) || userId <= 0) {
    res.status(400).json({ error: "Missing or invalid userId" });
    return;
  }
  if (sessionReq.sessionUserId !== undefined && sessionReq.sessionUserId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [task] = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.id, taskId))
    .limit(1);

  if (!task || !task.isActive) {
    res.status(404).json({ error: "Task not found or inactive" });
    return;
  }

  if (task.expiresAt && task.expiresAt < new Date()) {
    res.status(400).json({ error: "Task expired" });
    return;
  }

  const existing = await db
    .select()
    .from(userTasksTable)
    .where(and(eq(userTasksTable.userId, userId), eq(userTasksTable.taskId, taskId)))
    .limit(1);

  if (existing.length > 0) {
    res.status(400).json({ error: "Already completed" });
    return;
  }

  // Channel membership verification
  const channelUsername = extractChannelUsername(task.url);
  const isChannelTask = !!channelUsername;

  if (channelUsername) {
    try {
      const botInstance = getBot();
      if (botInstance) {
        const isMember = await checkChannelMembership(botInstance, userId, channelUsername);
        if (!isMember) {
          res.status(400).json({ error: `يجب الانضمام للقناة أولاً: @${channelUsername}` });
          return;
        }
      }
    } catch {
      // If bot check fails, allow completion
    }
  }

  await db.insert(userTasksTable).values({ userId, taskId });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (user) {
    const newTasksCompleted = (user.tasksCompleted || 0) + 1;
    const extraSpin = newTasksCompleted % 5 === 0 ? 1 : 0;
    await db
      .update(usersTable)
      .set({ tasksCompleted: newTasksCompleted, spins: sql`spins + ${extraSpin}` })
      .where(eq(usersTable.id, userId));

    // ── Subscription enforcement: record reward if spin was granted from a channel task ──
    if (extraSpin > 0 && isChannelTask) {
      await recordChannelReward(userId, extraSpin);
    }
  }

  const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  res.json({ success: true, user: updated });
});

router.get("/:userId/completed", async (req, res) => {
  const userId = parseInt(req.params.userId);
  res.setHeader("Cache-Control", "private, max-age=10");
  const completed = await db
    .select()
    .from(userTasksTable)
    .where(eq(userTasksTable.userId, userId));
  res.json(completed.map((c) => c.taskId));
});

export default router;
