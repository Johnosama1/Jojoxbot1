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

router.get("/", async (_req, res) => {
  const now = Date.now();

  if (_cache && now - _cache.ts < TTL) {
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("X-Cache", "HIT");
    res.json(_cache.data);
    return;
  }

  const slots = await db.select().from(wheelSlotsTable).orderBy(wheelSlotsTable.displayOrder);
  _cache = { data: slots, ts: now };

  res.setHeader("Cache-Control", "public, max-age=60");
  res.setHeader("X-Cache", "MISS");
  res.json(slots);
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
