import { db } from "@workspace/db";
import { botSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export const BOT_ENABLED_KEY = "bot_enabled";

// ── TTL cache for bot_enabled (5 seconds) ──────────────────────────────────
let botEnabledCache: { ts: number; enabled: boolean } | null = null;
const BOT_ENABLED_CACHE_TTL = 5_000;

export async function isBotEnabled(): Promise<boolean> {
  const now = Date.now();
  if (botEnabledCache && (now - botEnabledCache.ts) < BOT_ENABLED_CACHE_TTL) {
    return botEnabledCache.enabled;
  }
  const [row] = await db
    .select()
    .from(botSettingsTable)
    .where(eq(botSettingsTable.key, BOT_ENABLED_KEY))
    .limit(1);
  const enabled = row ? row.value !== "false" : true;
  botEnabledCache = { ts: now, enabled };
  return enabled;
}

export function clearBotEnabledCache(): void {
  botEnabledCache = null;
}

export async function setBotEnabled(enabled: boolean): Promise<void> {
  const value = enabled ? "true" : "false";
  await db
    .insert(botSettingsTable)
    .values({ key: BOT_ENABLED_KEY, value })
    .onConflictDoUpdate({ target: botSettingsTable.key, set: { value } });
  botEnabledCache = { ts: Date.now(), enabled };
}
