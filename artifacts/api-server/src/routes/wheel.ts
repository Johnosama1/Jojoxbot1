import { Router } from "express";
import { db } from "@workspace/db";
import { wheelSlotsTable, botSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

const router = Router();

// ── In-memory cache (invalidated when admin updates wheel) ──────────
let _cache: { data: unknown; ts: number } | null = null;
const TTL = 60_000; // 60 seconds

export function invalidateWheelCache() {
  _cache = null;
}

// Default slots shown when DB is empty (admin can override via panel)
const DEFAULT_SLOTS = [
  { amount: "0.05", probability: 30, displayOrder: 1 },
  { amount: "0.10", probability: 25, displayOrder: 2 },
  { amount: "0.25", probability: 20, displayOrder: 3 },
  { amount: "0.50", probability: 12, displayOrder: 4 },
  { amount: "1.00", probability: 8,  displayOrder: 5 },
  { amount: "2.00", probability: 4,  displayOrder: 6 },
  { amount: "4.00", probability: 1,  displayOrder: 7 },
];

router.get("/", async (_req, res) => {
  const now = Date.now();

  if (_cache && now - _cache.ts < TTL) {
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("X-Cache", "HIT");
    res.json(_cache.data);
    return;
  }

  try {
    let slots = await db.select().from(wheelSlotsTable).orderBy(wheelSlotsTable.displayOrder);

    // Auto-seed default slots if table is empty (fresh DB)
    if (slots.length === 0) {
      slots = await db.insert(wheelSlotsTable).values(DEFAULT_SLOTS).returning();
    }

    _cache = { data: slots, ts: now };
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("X-Cache", "MISS");
    res.json(slots);
  } catch (err) {
    // DB not reachable — return defaults so UI doesn't break
    res.setHeader("Cache-Control", "no-store");
    res.json(DEFAULT_SLOTS.map((s, i) => ({ id: i + 1, ...s })));
  }
});

// ── Public boost status (no auth needed — used by frontend) ────────
router.get("/boost", async (_req, res) => {
  try {
    const [powerRow, startRow, endRow] = await Promise.all([
      db.select().from(botSettingsTable).where(eq(botSettingsTable.key, "spin_power")).limit(1),
      db.select().from(botSettingsTable).where(eq(botSettingsTable.key, "boost_starts_at")).limit(1),
      db.select().from(botSettingsTable).where(eq(botSettingsTable.key, "boost_ends_at")).limit(1),
    ]);
    const multiplier = powerRow.length > 0 ? Math.max(1, parseInt(powerRow[0].value) || 1) : 1;
    const startsAt   = startRow[0]?.value || null;
    const endsAt     = endRow[0]?.value   || null;

    let active = multiplier > 1;
    if (active && (startsAt || endsAt)) {
      const now   = Date.now();
      const start = startsAt ? new Date(startsAt).getTime() : 0;
      const end   = endsAt   ? new Date(endsAt).getTime()   : Infinity;
      active = now >= start && now <= end;
    }

    res.setHeader("Cache-Control", "no-store");
    res.json({
      active,
      multiplier: active ? multiplier : 1,
      endsAt:     active ? endsAt : null,
    });
  } catch {
    res.json({ active: false, multiplier: 1, endsAt: null });
  }
});

export default router;
