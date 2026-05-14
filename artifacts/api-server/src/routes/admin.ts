import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import {
  tasksTable,
  userTasksTable,
  wheelSlotsTable,
  usersTable,
  adminsTable,
  botSettingsTable,
  withdrawalsTable,
} from "@workspace/db/schema";
import { eq, count, sql, and, ne } from "drizzle-orm";
import { invalidateWheelCache } from "./wheel";
import { invalidateTasksCache } from "./tasks";
import { getBot } from "../bot";
import { getChannelPhotoUrl } from "../bot/admin";
import { setBotEnabled, clearBotEnabledCache } from "../bot/control";
import { clearAllSubCache } from "../bot/subscription";
import { invalidateSetting } from "../lib/settingsCache";

const router = Router();

const OWNER_ID = 6145230334;
const OWNER_USERNAME = (process.env.OWNER_USERNAME || "J_O_H_N8").replace(/^@/, "");

const adminLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "طلبات كثيرة على لوحة الإدارة" },
  skip: () => process.env.NODE_ENV !== "production",
});
router.use(adminLimiter);

async function isAdmin(userId: number): Promise<boolean> {
  if (!userId || isNaN(userId)) return false;
  if (userId === OWNER_ID) return true;
  const ownerSetting = await db.select().from(botSettingsTable).where(eq(botSettingsTable.key, "owner_telegram_id")).limit(1);
  if (ownerSetting.length > 0 && parseInt(ownerSetting[0].value) === userId) return true;
  const [admin] = await db.select().from(adminsTable).where(eq(adminsTable.id, userId)).limit(1);
  if (admin) return true;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.username === OWNER_USERNAME;
}

router.use(async (req: Request, res: Response, next: NextFunction) => {
  // Admin identity must come from a verified session token, never a client header
  const { requireSession } = await import("../middlewares/requireSession");
  requireSession(req, res, async () => {
    const sessionReq = req as import("../middlewares/requireSession").SessionRequest;
    const userId = sessionReq.sessionUserId;
    if (!userId || isNaN(userId) || userId <= 0) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const ok = await isAdmin(userId);
    if (!ok) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  });
});

router.get("/check", (_req, res) => {
  res.json({ isAdmin: true });
});

router.get("/tasks", async (_req, res) => {
  const tasks = await db.select().from(tasksTable).orderBy(tasksTable.id);
  res.json(tasks);
});

router.post("/tasks", async (req, res) => {
  const { title, description, url, icon, expiresAt } = req.body;
  if (!title || typeof title !== "string" || title.length > 200) {
    res.status(400).json({ error: "Invalid title" }); return;
  }
  let channelPhotoUrl: string | null = null;
  const cleanUrl = url?.trim() || null;
  if (cleanUrl) {
    const m = cleanUrl.match(/t\.me\/([A-Za-z0-9_]+)/);
    if (m) {
      try {
        const botInstance = getBot();
        if (botInstance) channelPhotoUrl = await getChannelPhotoUrl(botInstance, m[1]);
      } catch { }
    }
  }
  const [task] = await db.insert(tasksTable).values({
    title: title.trim(),
    description: description?.trim() || null,
    url: cleanUrl,
    icon: (icon?.trim() || "⭐").slice(0, 10),
    channelPhotoUrl,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  }).returning();
  invalidateTasksCache();
  res.json(task);
});

router.put("/tasks/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { title, description, url, icon, isActive, expiresAt } = req.body;
  const [task] = await db.update(tasksTable).set({
    title, description, url, icon, isActive,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
  }).where(eq(tasksTable.id, id)).returning();
  invalidateTasksCache();
  res.json(task);
});

router.delete("/tasks/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  invalidateTasksCache();
  res.json({ success: true });
});

router.get("/wheel", async (_req, res) => {
  const slots = await db.select().from(wheelSlotsTable).orderBy(wheelSlotsTable.displayOrder);
  res.json(slots);
});

router.put("/wheel", async (req, res) => {
  const { slots } = req.body as { slots: { id: number; amount: string; probability: number }[] };
  if (!Array.isArray(slots)) { res.status(400).json({ error: "Invalid slots" }); return; }
  for (const slot of slots) {
    const prob = Math.max(0, Math.min(100, Number(slot.probability) || 0));
    const amt = Math.max(0, parseFloat(slot.amount) || 0);
    await db.update(wheelSlotsTable).set({ amount: String(amt), probability: prob }).where(eq(wheelSlotsTable.id, slot.id));
  }
  const updated = await db.select().from(wheelSlotsTable).orderBy(wheelSlotsTable.displayOrder);
  invalidateWheelCache();
  res.json(updated);
});

router.post("/wheel", async (req, res) => {
  const amount = Math.max(0, parseFloat(req.body.amount) || 0);
  const probability = Math.max(0, Math.min(100, Number(req.body.probability) || 0));
  const displayOrder = parseInt(req.body.displayOrder) || 0;
  const [slot] = await db.insert(wheelSlotsTable).values({ amount: String(amount), probability, displayOrder }).returning();
  invalidateWheelCache();
  res.json(slot);
});

router.delete("/wheel/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(wheelSlotsTable).where(eq(wheelSlotsTable.id, id));
  invalidateWheelCache();
  res.json({ success: true });
});

router.get("/users", async (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit)) || 100, 500);
  const offset = Math.max(parseInt(String(req.query.offset)) || 0, 0);
  const users = await db.select().from(usersTable).orderBy(usersTable.createdAt).limit(limit).offset(offset);
  res.json(users);
});

router.get("/users/count", async (_req, res) => {
  const [result] = await db.select({ count: count() }).from(usersTable);
  const settings = await db.select().from(botSettingsTable).where(eq(botSettingsTable.key, "show_user_count"));
  const showCount = settings.length === 0 || settings[0].value === "true";
  res.json({ count: result.count, showCount });
});

router.put("/users/:id/balance", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { balance, spins } = req.body;
  const updates: Record<string, unknown> = {};
  if (balance !== undefined) {
    const b = parseFloat(balance);
    if (isNaN(b) || b < 0) { res.status(400).json({ error: "Invalid balance" }); return; }
    updates.balance = b.toString();
  }
  if (spins !== undefined) {
    const s = parseInt(spins);
    if (isNaN(s) || s < 0) { res.status(400).json({ error: "Invalid spins" }); return; }
    updates.spins = s;
  }
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  res.json(user);
});

router.put("/users/:id/reset-verification", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.update(usersTable).set({ ipVerifiedAt: null, deviceId: null, verificationToken: null }).where(eq(usersTable.id, id));
  res.json({ success: true });
});

router.get("/settings", async (_req, res) => {
  const settings = await db.select().from(botSettingsTable);
  const obj: Record<string, string> = {};
  for (const s of settings) obj[s.key] = s.value;
  res.json(obj);
});

router.put("/settings", async (req, res) => {
  const { key, value } = req.body;
  if (!key || typeof key !== "string" || key.length > 100) {
    res.status(400).json({ error: "Invalid key" }); return;
  }
  const existing = await db.select().from(botSettingsTable).where(eq(botSettingsTable.key, key)).limit(1);
  if (existing.length > 0) {
    await db.update(botSettingsTable).set({ value: String(value) }).where(eq(botSettingsTable.key, key));
  } else {
    await db.insert(botSettingsTable).values({ key, value: String(value) });
  }
  if (key === "bot_enabled") {
    await setBotEnabled(String(value) === "true");
    clearBotEnabledCache();
  }
  if (key === "required_channels") {
    clearAllSubCache();
  }
  if (key === "referral_threshold") invalidateSetting("referral_threshold");
  if (key === "task_threshold") invalidateSetting("task_threshold");
  if (key === "min_withdrawal") invalidateSetting("min_withdrawal");
  res.json({ key, value });
});

router.get("/admins", async (_req, res) => {
  const admins = await db.select().from(adminsTable).orderBy(adminsTable.addedAt);
  res.json(admins);
});

router.post("/admins", async (req, res) => {
  const { id, username, permissions } = req.body;
  const numId = parseInt(id);
  if (isNaN(numId) || numId <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  const perms = Array.isArray(permissions) ? permissions : [];
  const [admin] = await db.insert(adminsTable).values({ id: numId, username: username || null, permissions: perms }).onConflictDoUpdate({ target: adminsTable.id, set: { username: username || null, permissions: perms } }).returning();
  res.json(admin);
});

router.put("/admins/:id/permissions", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (id === OWNER_ID) { res.status(403).json({ error: "Cannot modify owner" }); return; }
  const { permissions } = req.body;
  if (!Array.isArray(permissions)) { res.status(400).json({ error: "Invalid permissions" }); return; }
  const [admin] = await db.update(adminsTable).set({ permissions }).where(eq(adminsTable.id, id)).returning();
  if (!admin) { res.status(404).json({ error: "Admin not found" }); return; }
  res.json(admin);
});

router.delete("/admins/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (id === OWNER_ID) { res.status(403).json({ error: "Cannot remove owner" }); return; }
  await db.delete(adminsTable).where(eq(adminsTable.id, id));
  res.json({ success: true });
});

router.get("/withdrawals", async (_req, res) => {
  const list = await db.select().from(withdrawalsTable).orderBy(withdrawalsTable.createdAt);
  res.json(list);
});

router.get("/withdrawals/:id/audit", async (req, res) => {
  const wdId = parseInt(req.params.id);
  if (isNaN(wdId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [wd] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, wdId)).limit(1);
  if (!wd) { res.status(404).json({ error: "Withdrawal not found" }); return; }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, wd.userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [allWithdrawals, slots, referredUsers, completedTasks] = await Promise.all([
    db.select().from(withdrawalsTable).where(eq(withdrawalsTable.userId, wd.userId)),
    db.select().from(wheelSlotsTable).orderBy(wheelSlotsTable.displayOrder),
    db.select({
      id: usersTable.id,
      firstName: usersTable.firstName,
      username: usersTable.username,
      createdAt: usersTable.createdAt,
      ipHash: usersTable.ipHash,
      isVisible: usersTable.isVisible,
    })
      .from(usersTable)
      .where(eq(usersTable.referredBy, wd.userId)),
    db.select({ taskId: userTasksTable.taskId, completedAt: userTasksTable.completedAt })
      .from(userTasksTable)
      .where(eq(userTasksTable.userId, wd.userId))
      .orderBy(userTasksTable.completedAt),
  ]);

  const maxSlotAmount = slots.length > 0 ? Math.max(...slots.map(s => parseFloat(s.amount))) : 4;
  const avgSlotAmount = slots.length > 0
    ? slots.reduce((s, sl) => s + parseFloat(sl.amount), 0) / slots.length
    : 1;

  const balance = parseFloat(String(user.balance));
  const tonBalance = parseFloat(String(user.tonBalance));
  const tasksCompleted = user.tasksCompleted || 0;
  const referralCount = user.referralCount || 0;
  const rewardedSpins = user.rewardedSpins || 0;
  const accountAgeMs = Date.now() - new Date(user.createdAt).getTime();
  const accountAgeDays = accountAgeMs / (1000 * 60 * 60 * 24);

  const referralThresholdRow = await db.select().from(botSettingsTable).where(eq(botSettingsTable.key, "referral_threshold")).limit(1);
  const referralThreshold = parseInt(referralThresholdRow[0]?.value) || 5;

  const estimatedSpinsEarned = tasksCompleted + Math.floor(referralCount / referralThreshold) + rewardedSpins;
  const estimatedMaxBalance = estimatedSpinsEarned * maxSlotAmount;

  const pendingWithdrawals = allWithdrawals.filter(w => w.status === "pending");
  const totalWithdrawn = allWithdrawals
    .filter(w => w.status === "approved")
    .reduce((s, w) => s + parseFloat(String(w.amount)), 0);

  let riskScore = 0;
  const findings: { level: "danger" | "warning" | "info"; text: string }[] = [];

  if (!user.ipVerifiedAt) {
    riskScore += 20;
    findings.push({ level: "danger", text: "لم يتحقق المستخدم من جهازه عبر رابط التحقق" });
  }

  if (accountAgeDays < 2 && balance > 0.5) {
    riskScore += 20;
    findings.push({ level: "danger", text: `حساب حديث جداً (${Math.floor(accountAgeDays * 24)} ساعة) مع رصيد ${balance.toFixed(3)} USDT` });
  } else if (accountAgeDays < 7 && balance > 5) {
    riskScore += 10;
    findings.push({ level: "warning", text: `حساب جديد (${Math.floor(accountAgeDays)} يوم) مع رصيد مرتفع ${balance.toFixed(3)} USDT` });
  }

  if (estimatedSpinsEarned === 0 && (balance > 0.1 || tonBalance > 0.001)) {
    riskScore += 30;
    findings.push({ level: "danger", text: `رصيد ${balance.toFixed(3)} USDT بدون أي نشاط مشروع (0 مهام، 0 إحالات، 0 دورات مكافأة)` });
  } else if (estimatedMaxBalance > 0 && balance > estimatedMaxBalance * 1.8) {
    riskScore += 25;
    findings.push({
      level: "danger",
      text: `الرصيد (${balance.toFixed(3)}) يتجاوز الحد الأقصى المتوقع (${estimatedMaxBalance.toFixed(3)}) بأكثر من 80% — يُشير إلى رصيد وهمي`,
    });
  } else if (estimatedMaxBalance > 0 && balance > estimatedMaxBalance * 1.3) {
    riskScore += 10;
    findings.push({
      level: "warning",
      text: `الرصيد (${balance.toFixed(3)}) أعلى من المتوقع (${estimatedMaxBalance.toFixed(3)}) — يحتاج مراجعة`,
    });
  }

  if (user.isBlockedForLeaving) {
    riskScore += 10;
    findings.push({ level: "warning", text: "حاول مغادرة القنوات الإجبارية بعد الحصول على المكافآت" });
  }

  if (pendingWithdrawals.length > 1) {
    riskScore += 10;
    findings.push({ level: "warning", text: `لديه ${pendingWithdrawals.length} طلبات سحب معلقة في نفس الوقت` });
  }

  if (!user.username && balance > 1) {
    riskScore += 5;
    findings.push({ level: "warning", text: "حساب مجهول (بدون يوزرنيم) مع رصيد مرتفع" });
  }

  const wdAmount = parseFloat(String(wd.amount));
  const totalEverHad = balance + tonBalance + totalWithdrawn + wdAmount;
  if (totalEverHad > 0 && wdAmount / totalEverHad > 0.95) {
    findings.push({ level: "info", text: "يحاول سحب كامل رصيده تقريباً دفعة واحدة" });
  }

  if (user.ipSuspicious) {
    riskScore += 35;
    findings.push({ level: "danger", text: "⚠️ IP مكرر — نفس عنوان IP مستخدم من حساب آخر مُتحقق منه (احتمال تعدد حسابات)" });
  }

  // ── Referral IP clustering — same IP across referred accounts ────────
  const referralSharedIp = user.ipHash
    ? referredUsers.filter(r => r.ipHash && r.ipHash === user.ipHash)
    : [];
  if (referralSharedIp.length >= 1) {
    riskScore += Math.min(40, referralSharedIp.length * 15);
    findings.push({ level: "danger", text: `${referralSharedIp.length} حساب مُحال يشترك في نفس الـ IP مع المستخدم — تزوير إحالات شبه مؤكد` });
  }

  // Count banned referred accounts
  const bannedReferrals = referredUsers.filter(r => r.isVisible === false);
  if (bannedReferrals.length >= 2) {
    riskScore += Math.min(30, bannedReferrals.length * 10);
    findings.push({ level: "danger", text: `${bannedReferrals.length} من حساباته المُحالة تم حظرها بسبب تعدد الحسابات` });
  }

  // ── Referral burst timing ─────────────────────────────────────────────
  if (referredUsers.length >= 3) {
    const times = referredUsers.map(r => new Date(r.createdAt).getTime()).sort((a, b) => a - b);
    const windowMs = times[times.length - 1] - times[0];
    const windowHours = windowMs / (1000 * 60 * 60);
    if (windowHours < 2 && referredUsers.length >= 5) {
      riskScore += 30;
      findings.push({ level: "danger", text: `${referredUsers.length} إحالة خلال ${windowHours.toFixed(1)} ساعة فقط — نمط بوت أوتوماتيكي` });
    } else if (windowHours < 24 && referredUsers.length >= 8) {
      riskScore += 20;
      findings.push({ level: "warning", text: `${referredUsers.length} إحالة في ${Math.floor(windowHours)} ساعة — معدل إحالات مرتفع بشكل مشبوه` });
    }
  }

  if (user.ipVerifiedAt) {
    findings.push({ level: "info", text: `تم التحقق من الجهاز بتاريخ ${new Date(user.ipVerifiedAt).toLocaleDateString("ar-SA")}` });
    riskScore = Math.max(0, riskScore - 3);
  }

  if (accountAgeDays >= 30) {
    findings.push({ level: "info", text: `حساب قديم (${Math.floor(accountAgeDays)} يوم) — درجة مصداقية أعلى` });
    riskScore = Math.max(0, riskScore - 5);
  }

  if (tasksCompleted > 0 || referralCount > 0) {
    findings.push({ level: "info", text: `نشاط مشروع موثق: ${tasksCompleted} مهمة مكتملة، ${referralCount} إحالة ناجحة` });
  }

  if (totalWithdrawn > 0) {
    findings.push({ level: "info", text: `سبق وسحب ${totalWithdrawn.toFixed(3)} TON بنجاح من قبل` });
  }

  riskScore = Math.min(100, Math.max(0, riskScore));

  // ── Build activity log from all available data ────────────────────────
  const activityLog: { time: string; event: string; type: "info" | "warning" | "danger" }[] = [];

  activityLog.push({ time: new Date(user.createdAt).toISOString(), event: "انضم إلى البوت", type: "info" });

  if (user.ipVerifiedAt) {
    activityLog.push({
      time: new Date(user.ipVerifiedAt).toISOString(),
      event: user.ipSuspicious ? "تم التحقق من الجهاز ⚠️ (IP مشترك مع حساب آخر)" : "تم التحقق من الجهاز بنجاح",
      type: user.ipSuspicious ? "warning" : "info",
    });
  }

  for (const task of completedTasks) {
    activityLog.push({ time: new Date(task.completedAt).toISOString(), event: `أكمل مهمة #${task.taskId}`, type: "info" });
  }

  for (const ref of referredUsers) {
    const sameIp = ref.ipHash && user.ipHash && ref.ipHash === user.ipHash;
    const banned = ref.isVisible === false;
    activityLog.push({
      time: new Date(ref.createdAt).toISOString(),
      event: `أحال: ${ref.firstName || ref.username || `#${ref.id}`}${sameIp ? " — ⚠️ نفس IP" : ""}${banned ? " — 🚫 محظور" : ""}`,
      type: sameIp ? "danger" : banned ? "warning" : "info",
    });
  }

  for (const w of allWithdrawals) {
    const statusLabel = w.status === "approved" ? "موافق عليه ✅" : w.status === "rejected" ? "مرفوض ❌" : "معلق ⏳";
    activityLog.push({
      time: new Date(w.createdAt).toISOString(),
      event: `طلب سحب ${parseFloat(String(w.amount)).toFixed(3)} USDT — ${statusLabel}`,
      type: w.status === "rejected" ? "warning" : "info",
    });
  }

  activityLog.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

  res.json({
    withdrawal: wd,
    user,
    riskScore,
    findings,
    activityLog,
    stats: {
      accountAgeDays: Math.floor(accountAgeDays),
      balance: balance.toFixed(6),
      tonBalance: tonBalance.toFixed(6),
      tasksCompleted,
      referralCount,
      rewardedSpins,
      estimatedSpinsEarned,
      estimatedMaxBalance: estimatedMaxBalance.toFixed(3),
      avgExpectedBalance: (estimatedSpinsEarned * avgSlotAmount).toFixed(3),
      pendingWithdrawalsCount: pendingWithdrawals.length,
      totalWithdrawn: totalWithdrawn.toFixed(3),
      allWithdrawalsCount: allWithdrawals.length,
      isDeviceVerified: !!user.ipVerifiedAt,
      isBlockedForLeaving: user.isBlockedForLeaving,
      isBanned: user.isVisible === false,
      ipSuspicious: !!user.ipSuspicious,
      referralClusterCount: referralSharedIp.length,
    },
  });
});

router.put("/withdrawals/:id", async (req, res) => {
  const wdId = parseInt(req.params.id);
  if (isNaN(wdId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { action, txHash } = req.body;
  if (action !== "approve" && action !== "reject") {
    res.status(400).json({ error: "action must be 'approve' or 'reject'" }); return;
  }

  const [wd] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, wdId)).limit(1);
  if (!wd) { res.status(404).json({ error: "Withdrawal not found" }); return; }
  if (wd.status !== "pending") { res.status(400).json({ error: "الطلب ليس في حالة انتظار" }); return; }

  if (action === "reject") {
    await db.update(usersTable)
      .set({ tonBalance: sql`ton_balance + ${wd.amount}` })
      .where(eq(usersTable.id, wd.userId));
  }

  const [updated] = await db.update(withdrawalsTable)
    .set({
      status: action === "approve" ? "approved" : "rejected",
      processedAt: new Date(),
      ...(txHash ? { txHash: String(txHash) } : {}),
    })
    .where(eq(withdrawalsTable.id, wdId))
    .returning();

  res.json({ success: true, withdrawal: updated });
});

router.put("/users/:id/ban", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { banned } = req.body;
  const [updated] = await db.update(usersTable)
    .set({ isVisible: banned === true ? false : true })
    .where(eq(usersTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ success: true, user: updated });
});

export default router;
