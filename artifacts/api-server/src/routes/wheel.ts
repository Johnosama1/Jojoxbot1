import { Router } from "express";
import { db } from "@workspace/db";
import { wheelSlotsTable } from "@workspace/db/schema";

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

export default router;
