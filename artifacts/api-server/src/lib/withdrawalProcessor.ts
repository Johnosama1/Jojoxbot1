import { db } from "@workspace/db";
import { withdrawalsTable, usersTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { sendTon, isTonConfigured } from "./tonSender";
import { logger } from "./logger";

// Lazily import bot to avoid circular deps
function getBot() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("../bot").getBot?.();
}

// HTML escape helper
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export { isTonConfigured };

export interface AutoWithdrawalResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

export async function executeAutoWithdrawal(
  withdrawalId: number,
  adminChatId?: number
): Promise<AutoWithdrawalResult> {
  const bot = getBot();

  // Fetch withdrawal record from DB — single source of truth
  const [wd] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, withdrawalId)).limit(1);
  if (!wd) {
    return { success: false, error: "Withdrawal not found" };
  }

  const { userId, walletAddress, amount } = wd;

  try {
    await db.update(withdrawalsTable)
      .set({ status: "processing" })
      .where(eq(withdrawalsTable.id, withdrawalId));

    const result = await sendTon(walletAddress, amount);

    await db.update(withdrawalsTable)
      .set({
        status: "completed",
        txHash: result.txRef,
        processedAt: new Date(),
      })
      .where(eq(withdrawalsTable.id, withdrawalId));

    const estimatedFee = wd?.fee ? parseFloat(wd.fee).toFixed(4) : "0.05";

    if (bot) {
      // Notify user
      try {
        const amtStr = parseFloat(amount).toFixed(4);
        await bot.sendMessage(
          userId,
          `✅ <b>تم الموافقة على سحبك بنجاح!</b>\n\n` +
          `💵 المبلغ: <b>${amtStr} TON</b>\n` +
          `👛 العنوان: <code>${esc(walletAddress)}</code>`,
          { parse_mode: "HTML" }
        );
      } catch { /* ignore */ }

      // Notify admin
      if (adminChatId) {
        try {
          const amtStr = parseFloat(amount).toFixed(4);
          await bot.sendMessage(
            adminChatId,
            `✅ <b>تم إرسال ${amtStr} TON بنجاح!</b>\n\n` +
            `💲 المبلغ للمستخدم: <b>${amtStr} TON</b>\n` +
            `⚡ الرسم المخصوم: <b>${estimatedFee} TON</b>\n` +
            `👛 العنوان: <code>${esc(walletAddress)}</code>\n` +
            `🔗 المرجع: <code>${esc(result.txRef)}</code>`,
            { parse_mode: "HTML" }
          );
        } catch { /* ignore */ }
      }
    }

    return { success: true, txHash: result.txRef };

  } catch (err) {
    logger.error({ err, withdrawalId }, "TON transfer failed");

    const errMsg = err instanceof Error ? err.message : String(err);

    // Refund ton_balance (not USDT balance — withdrawal deducted ton_balance)
    await db.update(usersTable)
      .set({ tonBalance: sql`ton_balance + ${amount}` })
      .where(eq(usersTable.id, userId));

    await db.update(withdrawalsTable)
      .set({ status: "failed", errorMsg: errMsg })
      .where(eq(withdrawalsTable.id, withdrawalId));

    if (bot) {
      try {
        await bot.sendMessage(
          userId,
          `❌ فشل إرسال ${parseFloat(amount).toFixed(4)} TON.\n` +
          `تم إعادة المبلغ لرصيدك. حاول مرة أخرى لاحقاً.`
        );
      } catch { /* ignore */ }

      if (adminChatId) {
        try {
          const isNotFunded = errMsg.includes("not funded") || errMsg.includes("Hot wallet");
          const addrMatch = errMsg.match(/Send TON to: (\S+)/);
          const addrHint = addrMatch
            ? `\n\n💳 اشحن المحفظة:\n<code>${esc(addrMatch[1])}</code>`
            : "";
          await bot.sendMessage(
            adminChatId,
            `❌ <b>فشل إرسال ${parseFloat(amount).toFixed(4)} TON</b>\n` +
            (isNotFunded
              ? `⚠️ <b>محفظة البوت الساخنة فارغة!</b>${addrHint}\n\nأرسل TON لهذا العنوان ثم أعد الموافقة على طلب السحب.`
              : `السبب: ${esc(errMsg)}`),
            { parse_mode: "HTML" }
          );
        } catch { /* ignore */ }
      }
    }

    return { success: false, error: errMsg };
  }
}
