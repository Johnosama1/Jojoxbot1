import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import { usersTable, referralsTable, botSettingsTable } from "@workspace/db/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { getRequiredChannels, getMissingChannels } from "./subscription";
import { logger } from "../lib/logger";
import { getSetting } from "../lib/settingsCache";

const BATCH_SIZE = 20;

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Per-process cooldown: avoid re-sending risk warnings every hour
const riskWarnCooldown = new Map<number, number>();
const RISK_WARN_COOLDOWN_MS = 22 * 3_600_000;

async function getOwnerId(): Promise<number | null> {
  try {
    const [row] = await db
      .select()
      .from(botSettingsTable)
      .where(eq(botSettingsTable.key, "owner_telegram_id"))
      .limit(1);
    return row?.value ? parseInt(row.value) : null;
  } catch {
    return null;
  }
}

// ── Phase 1: activate pending referrals whose referred user is now subscribed ─
async function activatePendingReferrals(bot: TelegramBot): Promise<number> {
  const pending = await db
    .select({
      id: referralsTable.id,
      referrerId: referralsTable.referrerId,
      referredId: referralsTable.referredId,
    })
    .from(referralsTable)
    .where(eq(referralsTable.status, "pending"));

  if (pending.length === 0) return 0;

  const rawThreshold = await getSetting("referral_threshold").catch(() => null);
  const refThreshold = Math.max(1, parseInt(rawThreshold ?? "5") || 5);
  let activated = 0;

  for (const ref of pending) {
    try {
      const missing = await getMissingChannels(bot, ref.referredId);
      if (missing.length > 0) {
        await new Promise(r => setTimeout(r, 150));
        continue;
      }

      // Subscribed — activate referral and credit inviter
      await db.update(referralsTable)
        .set({ status: "active" })
        .where(eq(referralsTable.id, ref.id));

      const [inviter] = await db
        .update(usersTable)
        .set({ referralCount: sql`referral_count + 1` })
        .where(eq(usersTable.id, ref.referrerId))
        .returning({ id: usersTable.id, referralCount: usersTable.referralCount });

      if (inviter) {
        const newCount = inviter.referralCount;
        const earnedSpin = newCount % refThreshold === 0;
        if (earnedSpin) {
          await db.update(usersTable)
            .set({ spins: sql`spins + 1` })
            .where(eq(usersTable.id, ref.referrerId));
        }
        const msg = earnedSpin
          ? `🎉 <b>مبروك!</b> إحالتك تم التحقق منها!\n🎰 حصلت على لفة مجانية! (${newCount}/${refThreshold})`
          : `✅ إحالتك تم التحقق منها! (${newCount}/${refThreshold})`;
        await bot.sendMessage(ref.referrerId, msg, { parse_mode: "HTML" }).catch(() => {});
      }

      activated++;
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      logger.error({ err, refId: ref.id }, "activatePendingReferrals: error");
    }
  }

  return activated;
}

// ── Phase 2: scan active referrals every 5 min — immediately remove if left ──
// No cooldown: once a referral is marked "removed" it won't appear next scan.
async function scanActiveReferrals(bot: TelegramBot): Promise<{ removed: number; skipped: number }> {
  const channels = await getRequiredChannels();
  if (channels.length === 0) return { removed: 0, skipped: 0 };

  // Only check users with at least one active referral record as referredId
  const activeRefs = await db
    .select({
      id: referralsTable.id,
      referrerId: referralsTable.referrerId,
      referredId: referralsTable.referredId,
    })
    .from(referralsTable)
    .where(eq(referralsTable.status, "active"));

  let removed = 0, skipped = 0;

  for (let i = 0; i < activeRefs.length; i += BATCH_SIZE) {
    const batch = activeRefs.slice(i, i + BATCH_SIZE);

    for (const ref of batch) {
      try {
        // Check if referred user is still subscribed to ALL channels
        const missing = await getMissingChannels(bot, ref.referredId);
        if (missing.length === 0) { skipped++; continue; }

        // Left at least one channel — immediately invalidate referral
        await db.update(referralsTable)
          .set({ status: "removed" })
          .where(eq(referralsTable.id, ref.id));

        // Decrement inviter's referral count (floor at 0)
        await db.update(usersTable)
          .set({ referralCount: sql`GREATEST(referral_count - 1, 0)` })
          .where(eq(usersTable.id, ref.referrerId));

        // Mark referred user as blocked for leaving
        await db.update(usersTable)
          .set({ isBlockedForLeaving: true })
          .where(eq(usersTable.id, ref.referredId));

        // Fetch referred user for display
        const [referredUser] = await db
          .select({ firstName: usersTable.firstName, username: usersTable.username })
          .from(usersTable)
          .where(eq(usersTable.id, ref.referredId))
          .limit(1);

        const userDisplay = referredUser?.username
          ? `@${esc(referredUser.username)}`
          : esc(referredUser?.firstName || String(ref.referredId));

        const channelName = esc(missing[0].title || missing[0].username);

        // Notify inviter: referral was deducted automatically
        await bot.sendMessage(
          ref.referrerId,
          `❌ <b>تم خصم إحالة تلقائياً</b>\n` +
          `المستخدم <b>${userDisplay}</b> غادر القناة <b>${channelName}</b>\n` +
          `تم خصم إحالة واحدة من رصيدك.`,
          { parse_mode: "HTML" }
        ).catch(() => {});

        removed++;
        await new Promise(r => setTimeout(r, 250));
      } catch (err) {
        logger.error({ err, refId: ref.id }, "scanActiveReferrals: error");
      }
    }

    if (i + BATCH_SIZE < activeRefs.length) {
      await new Promise(r => setTimeout(r, 1_000));
    }
  }

  return { removed, skipped };
}

// ── Phase 3: referral spam detection ─────────────────────────────────────────
// Alert admin when a user has 10+ total referrals with 0% active
async function detectReferralSpam(bot: TelegramBot): Promise<void> {
  const ownerId = await getOwnerId();
  if (!ownerId) return;

  const result = await db.execute(sql`
    SELECT
      u.id, u.username, u.first_name,
      COUNT(r.id)::int AS total_refs,
      SUM(CASE WHEN r.status = 'active' THEN 1 ELSE 0 END)::int AS active_refs
    FROM users u
    JOIN referrals r ON r.referrer_id = u.id
    WHERE u.is_visible = true
    GROUP BY u.id, u.username, u.first_name
    HAVING COUNT(r.id) >= 10
      AND SUM(CASE WHEN r.status = 'active' THEN 1 ELSE 0 END) = 0
  `);

  type SpamRow = { id: number; username: string | null; first_name: string | null; total_refs: number };
  const rows = ((result as unknown as { rows?: SpamRow[] }).rows ?? []);

  for (const row of rows) {
    const userDisplay = row.username
      ? `@${esc(row.username)}`
      : esc(row.first_name || String(row.id));

    await bot.sendMessage(
      ownerId,
      `🚨 <b>تنبيه: المستخدم ${userDisplay} لديه ${row.total_refs} إحالة بنسبة 0% انضمام للقنوات</b>\n\n` +
      `هذا يشير إلى رشق إحالات.\nاختر الإجراء:`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "⚠️ إرسال تحذير للمستخدم", callback_data: `spam:warn:${row.id}` },
              { text: "🚫 حظر المستخدم", callback_data: `spam:ban:${row.id}` },
            ],
            [{ text: "👁️ مراقبة فقط", callback_data: `spam:ignore:${row.id}` }],
          ],
        },
      }
    ).catch(() => {});

    await new Promise(r => setTimeout(r, 500));
  }
}

// ── Phase 4: risk score warnings ─────────────────────────────────────────────
async function sendRiskWarnings(bot: TelegramBot): Promise<void> {
  const ownerId = await getOwnerId();

  const result = await db.execute(sql`
    SELECT
      u.id, u.username, u.first_name, u.ip_suspicious,
      COUNT(r.id)::int           AS total_refs,
      SUM(CASE WHEN r.status = 'active'  THEN 1 ELSE 0 END)::int AS active_refs,
      SUM(CASE WHEN r.status = 'removed' THEN 1 ELSE 0 END)::int AS removed_refs
    FROM users u
    LEFT JOIN referrals r ON r.referrer_id = u.id
    WHERE u.is_visible = true
    GROUP BY u.id, u.username, u.first_name, u.ip_suspicious
  `);

  type RiskRow = {
    id: number; username: string | null; first_name: string | null;
    ip_suspicious: boolean; total_refs: number; active_refs: number; removed_refs: number;
  };
  const rows = ((result as unknown as { rows?: RiskRow[] }).rows ?? []);

  for (const row of rows) {
    try {
      const lastWarn = riskWarnCooldown.get(row.id);
      if (lastWarn && Date.now() - lastWarn < RISK_WARN_COOLDOWN_MS) continue;

      const total   = row.total_refs   || 0;
      const active  = row.active_refs  || 0;
      const removed = row.removed_refs || 0;
      const validPct = total > 0 ? (active / total) * 100 : 100;

      let risk = 0;
      if (row.ip_suspicious)                   risk += 35;
      if (total >= 10 && validPct === 0)        risk += 40;
      else if (total >= 5 && validPct < 10)     risk += 25;
      else if (total >= 3 && validPct < 30)     risk += 15;
      if (removed > 0)                          risk += Math.min(20, removed * 4);
      risk = Math.min(100, risk);

      if (risk < 60) continue;

      const userDisplay = row.username
        ? `@${esc(row.username)}`
        : esc(row.first_name || String(row.id));

      if (risk === 100 && ownerId) {
        await bot.sendMessage(
          ownerId,
          `🚨 <b>مستخدم بدرجة خطر 100/100</b>\n👤 ${userDisplay} (${row.id})\n\nيجب اتخاذ إجراء فوري:`,
          {
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[
                { text: "🚫 حظر المستخدم", callback_data: `spam:ban:${row.id}` },
                { text: "👁️ مراقبة فقط",  callback_data: `spam:ignore:${row.id}` },
              ]],
            },
          }
        ).catch(() => {});
      } else if (risk >= 80) {
        await bot.sendMessage(
          row.id,
          `🚨 <b>تحذير شديد:</b> حسابك معرض للحظر بسبب نشاط مشبوه.\nيرجى الالتزام بشروط الاستخدام.`,
          { parse_mode: "HTML" }
        ).catch(() => {});
      } else {
        await bot.sendMessage(
          row.id,
          `⚠️ <b>تحذير:</b> نشاط مشبوه تم رصده على حسابك.\nيرجى الالتزام بشروط الاستخدام.`,
          { parse_mode: "HTML" }
        ).catch(() => {});
      }

      riskWarnCooldown.set(row.id, Date.now());
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      logger.error({ err, userId: row.id }, "sendRiskWarnings: error");
    }
  }
}

// ── Phase 5: multi-account detection ─────────────────────────────────────────
// Only alerts for groups with at least one NOT-YET-flagged account (prevents hourly repeats)
async function detectMultiAccounts(bot: TelegramBot): Promise<void> {
  const ownerId = await getOwnerId();
  if (!ownerId) return;

  const result = await db.execute(sql`
    SELECT
      ip_hash,
      array_agg(id ORDER BY created_at)                                             AS user_ids,
      array_agg(COALESCE('@' || username, first_name, id::text) ORDER BY created_at) AS names
    FROM users
    WHERE ip_hash IS NOT NULL
      AND is_visible = true
    GROUP BY ip_hash
    HAVING COUNT(*) > 1
      AND COUNT(CASE WHEN ip_suspicious = false THEN 1 END) > 0
  `);

  type MultiRow = { ip_hash: string; user_ids: number[]; names: string[] };
  const rows = ((result as unknown as { rows?: MultiRow[] }).rows ?? []);

  for (const row of rows) {
    const userIds = row.user_ids || [];
    const names   = row.names    || [];

    const accounts = names
      .map((n, i) => `• ${esc(String(n))} (${userIds[i]})`)
      .join("\n");

    // Telegram callback_data limit: 64 bytes — cap IDs to avoid overflow
    const idsStr    = userIds.slice(0, 5).join(",");
    const newestId  = userIds[userIds.length - 1];

    await bot.sendMessage(
      ownerId,
      `🚨 <b>تم اكتشاف تعدد حسابات</b>\n\nالحسابات:\n${accounts}\n\nاختر الإجراء:`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🚫 حظر الكل",         callback_data: `multi:banall:${idsStr}` },
              { text: "🚫 حظر الجديد فقط",   callback_data: `multi:bannew:${newestId}` },
            ],
            [{ text: "👁️ تجاهل",            callback_data: `multi:ignore:${userIds[0]}` }],
          ],
        },
      }
    ).catch(() => {});

    // Mark all as ipSuspicious so we don't alert again next hour
    for (const uid of userIds) {
      await db.update(usersTable)
        .set({ ipSuspicious: true })
        .where(eq(usersTable.id, uid))
        .catch(() => {});
    }

    await new Promise(r => setTimeout(r, 500));
  }
}

// ── Fast scan: Phase 1 + 2 only (runs every 5 minutes) ───────────────────────
async function runFastScan(bot: TelegramBot): Promise<void> {
  try {
    const activated = await activatePendingReferrals(bot);
    if (activated > 0) logger.info({ activated }, "fastScan: pending→active");
  } catch (err) { logger.error({ err }, "fastScan: phase1 error"); }

  try {
    const { removed, skipped } = await scanActiveReferrals(bot);
    if (removed > 0) logger.info({ removed, skipped }, "fastScan: referrals removed");
  } catch (err) { logger.error({ err }, "fastScan: phase2 error"); }
}

// ── Full monitor: all 5 phases (runs hourly) ──────────────────────────────────
export async function runReferralMonitor(bot: TelegramBot): Promise<void> {
  logger.info("referralMonitor: starting full scan");

  try {
    const activated = await activatePendingReferrals(bot);
    logger.info({ activated }, "referralMonitor: phase1 done");
  } catch (err) { logger.error({ err }, "referralMonitor: phase1 error"); }

  try {
    const { removed, skipped } = await scanActiveReferrals(bot);
    logger.info({ removed, skipped }, "referralMonitor: phase2 done");
  } catch (err) { logger.error({ err }, "referralMonitor: phase2 error"); }

  try {
    await detectReferralSpam(bot);
    logger.info("referralMonitor: phase3 done");
  } catch (err) { logger.error({ err }, "referralMonitor: phase3 error"); }

  try {
    await sendRiskWarnings(bot);
    logger.info("referralMonitor: phase4 done");
  } catch (err) { logger.error({ err }, "referralMonitor: phase4 error"); }

  try {
    await detectMultiAccounts(bot);
    logger.info("referralMonitor: phase5 done");
  } catch (err) { logger.error({ err }, "referralMonitor: phase5 error"); }

  logger.info("referralMonitor: full scan complete");
}

// ── One-time deployment security scan ────────────────────────────────────────
let _deploymentScanDone = false;
export async function runDeploymentSecurityScan(bot: TelegramBot): Promise<void> {
  if (_deploymentScanDone) return;
  _deploymentScanDone = true;
  logger.info("deploymentScan: starting one-time security scan");
  await runReferralMonitor(bot);
  logger.info("deploymentScan: complete");
}

export function startReferralMonitor(bot: TelegramBot): void {
  const FIVE_MIN = 5 * 60_000;
  const ONE_HOUR = 60 * 60_000;

  // Fast scan (Phase 1+2) every 5 minutes — first run after 30s
  setTimeout(
    () => runFastScan(bot).catch(err =>
      logger.error({ err }, "fastScan: initial run error")),
    30_000,
  );
  setInterval(
    () => runFastScan(bot).catch(err =>
      logger.error({ err }, "fastScan: periodic error")),
    FIVE_MIN,
  );

  // Full scan (all 5 phases) hourly — first run after 90s
  setTimeout(
    () => runReferralMonitor(bot).catch(err =>
      logger.error({ err }, "referralMonitor: initial full run error")),
    90_000,
  );
  setInterval(
    () => runReferralMonitor(bot).catch(err =>
      logger.error({ err }, "referralMonitor: periodic full run error")),
    ONE_HOUR,
  );

  logger.info("referralMonitor: fast scan every 5min (first in 30s), full scan hourly (first in 90s)");
}
