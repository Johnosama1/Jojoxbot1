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

// Inline buildMsg to avoid circular dependency with bot/index.ts
function utf16Len(s: string): number {
  let n = 0;
  for (const ch of s) n += (ch.codePointAt(0)! > 0xffff) ? 2 : 1;
  return n;
}
function buildMsgLocal(parts: { text: string; emojiId?: string }[]) {
  let text = "";
  let offset = 0;
  const entities: object[] = [];
  for (const p of parts) {
    if (p.emojiId) {
      entities.push({ type: "custom_emoji", offset, length: utf16Len(p.text), custom_emoji_id: p.emojiId });
    }
    text += p.text;
    offset += utf16Len(p.text);
  }
  return { text, entities };
}

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
        const { text: uText, entities: uEnt } = buildMsgLocal([
          { text: "✅", emojiId: "6008009744969637955" },
          { text: ` تم الموافقة على سحبك بنجاح!\n\n` },
          { text: "💵", emojiId: "5409048419211682843" },
          { text: ` المبلغ: ${amtStr} TON\n` },
          { text: "👛", emojiId: "5039557485157942342" },
          { text: ` العنوان: ${walletAddress}` },
        ]);
        await bot.sendMessage(userId, uText, { entities: uEnt as any });
      } catch { /* ignore */ }

      // Notify admin
      if (adminChatId) {
        try {
          const amtStr = parseFloat(amount).toFixed(4);
          await bot.sendMessage(
            adminChatId,
            `✅ تم إرسال *${amtStr} TON* بنجاح!\n\n` +
            `💲 المبلغ للمستخدم: *${amtStr} TON*\n` +
            `⚡ الرسم المخصوم منك: *${estimatedFee} TON*\n` +
            `👛 العنوان: \`${walletAddress}\`\n` +
            `🔗 المرجع: \`${result.txRef}\``,
            { parse_mode: "Markdown" }
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
            ? `\n\n💳 اشحن المحفظة:\n\`${addrMatch[1]}\``
            : "";
          await bot.sendMessage(
            adminChatId,
            `❌ فشل إرسال *${parseFloat(amount).toFixed(4)} TON*\n` +
            (isNotFunded
              ? `⚠️ *محفظة البوت الساخنة فارغة!*${addrHint}\n\nأرسل TON لهذا العنوان ثم أعد الموافقة على طلب السحب.`
              : `السبب: ${errMsg}`),
            { parse_mode: "Markdown" }
          );
        } catch { /* ignore */ }
      }
    }

    return { success: false, error: errMsg };
  }
}
