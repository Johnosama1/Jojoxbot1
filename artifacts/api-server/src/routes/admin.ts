import { Router, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import {
  tasksTable,
  wheelSlotsTable,
  usersTable,
  adminsTable,
  botSettingsTable,
  withdrawalsTable,
} from "@workspace/db/schema";
import { eq, count } from "drizzle-orm";
import { invalidateWheelCache } from "./wheel";
import { invalidateTasksCache } from "./tasks";
import { getBot } from "../bot";
import { getChannelPhotoUrl } from "../bot/admin";
import { setBotEnabled } from "../bot/control";

const router = Router();

const OWNER_ID = 6145230334;
const OWNER_USERNAME = "J_O_H_N8";

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
  const raw = req.headers["x-user-id"];
  if (!raw || Array.isArray(raw)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const userId = parseInt(raw);
  if (isNaN(userId) || userId <= 0) {
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
  }
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

export default router;
