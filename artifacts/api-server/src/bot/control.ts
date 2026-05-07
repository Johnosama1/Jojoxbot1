import { db } from "@workspace/db";
import { botSettingsTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";

export const BOT_ENABLED_KEY = "bot_enabled";

export async function isBotEnabled(): Promise<boolean> {
  const [row] = await db.select().from(botSettingsTable).where(eq(botSettingsTable.key, BOT_ENABLED_KEY)).limit(1);
  return row ? row.value !== "false" : true;
}

export async function setBotEnabled(enabled: boolean): Promise<void> {
  const value = enabled ? "true" : "false";
  const [existing] = await db.select().from(botSettingsTable).where(eq(botSettingsTable.key, BOT_ENABLED_KEY)).limit(1);
  if (existing) {
    await db.update(botSettingsTable).set({ value }).where(eq(botSettingsTable.key, BOT_ENABLED_KEY));
    return;
  }
  await db.insert(botSettingsTable).values({ key: BOT_ENABLED_KEY, value });
}
