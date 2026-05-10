import { db } from "@workspace/db";
import { botSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60_000; // 5 minutes

export async function getSetting(key: string): Promise<string | null> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const [row] = await db
    .select({ value: botSettingsTable.value })
    .from(botSettingsTable)
    .where(eq(botSettingsTable.key, key))
    .limit(1);

  if (!row) {
    cache.delete(key);
    return null;
  }

  cache.set(key, { value: row.value, expiresAt: now + TTL_MS });
  return row.value;
}

export function invalidateSetting(key: string) {
  cache.delete(key);
}

export function invalidateAllSettings() {
  cache.clear();
}
