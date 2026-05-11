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

// ── v2 wheel configuration (admin can override via panel) ────────────
// Probabilities are out of 100. Slots with 0% appear on wheel visually
// but are never awarded — the spin engine falls back to the first
// non-zero slot for any remainder.
const DEFAULT_SLOTS_V2 = [
  { amount: "0.050", probability: 80, displayOrder: 1 },
  { amount: "0.075", probability: 2,  displayOrder: 2 },
  { amount: "0.100", probability: 0,  displayOrder: 3 },
  { amount: "0.200", probability: 0,  displayOrder: 4 },
  { amount: "0.500", probability: 0,  displayOrder: 5 },
  { amount: "1.000", probability: 0,  displayOrder: 6 },
  { amount: "2.000", probability: 0,  displayOrder: 7 },
  { amount: "4.000", probability: 0,  displayOrder: 8 },
];

// Detect whether existing DB slots are the old v1 seed (needs migration)
function isV1Seed(slots: { amount: string; probability: number }[]): boolean {
  if (slots.length !== 7) return false;
  const amounts = slots.map(s => s.amount);
  return amounts.includes("0.05") && !amounts.includes("0.050");
}

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

    // Auto-seed: fresh DB or detected old v1 seed → replace with v2
    if (slots.length === 0 || isV1Seed(slots)) {
      if (slots.length > 0) {
        // Clear old v1 slots before re-seeding
        await db.delete(wheelSlotsTable);
      }
      slots = await db.insert(wheelSlotsTable).values(DEFAULT_SLOTS_V2).returning();
    }

    _cache = { data: slots, ts: now };
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("X-Cache", "MISS");
    res.json(slots);
  } catch (err) {
    // DB not reachable — return defaults so UI doesn't break
    res.setHeader("Cache-Control", "no-store");
    res.json(DEFAULT_SLOTS_V2.map((s, i) => ({ id: i + 1, ...s })));
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
