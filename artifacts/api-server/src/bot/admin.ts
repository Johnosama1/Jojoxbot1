import TelegramBot from "node-telegram-bot-api";
import { db } from "@workspace/db";
import {
  usersTable,
  tasksTable,
  wheelSlotsTable,
  botSettingsTable,
  withdrawalsTable,
  adminsTable,
} from "@workspace/db/schema";
import { eq, desc, sql, count, ilike } from "drizzle-orm";
import { logger } from "../lib/logger";
import { isBotEnabled, setBotEnabled, clearBotEnabledCache } from "./control";
import { clearAllSubCache } from "./subscription";

export const OWNER_USERNAME = (process.env.OWNER_USERNAME || "J_O_H_N8").replace(/^@/, "");

type AdminPermission = "canUnban" | "canWarn" | "canReceiveWithdrawals" | "canEditWheel";

const ALL_PERMS: AdminPermission[] = ["canUnban", "canWarn", "canReceiveWithdrawals", "canEditWheel"];

export const PERM_LABELS: Record<AdminPermission, string> = {
  canUnban:              "🔓 رفع الحظر",
  canWarn:               "⚠️ تحذير المستخدمين",
  canReceiveWithdrawals: "💸 إدارة السحوبات",
  canEditWheel:          "🎡 تعديل العجلة",
};

// ─────────────────────────── HTML ESCAPE ───────────────────────────

function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─────────────────────────── AUTH ───────────────────────────

interface AdminInfo {
  isOwner: boolean;
  permissions: AdminPermission[];
}

export async function isOwner(userId: number, username?: string): Promise<boolean> {
  try {
    const setting = await db
      .select()
      .from(botSettingsTable)
      .where(eq(botSettingsTable.key, "owner_telegram_id"))
      .limit(1);
    if (setting.length > 0 && setting[0].value) {
      return userId === parseInt(setting[0].value);
    }
  } catch { /* fall through */ }
  return username === OWNER_USERNAME;
}

export async function getAdminInfo(userId: number, username?: string): Promise<AdminInfo | null> {
  const ownerCheck = await isOwner(userId, username);
  if (ownerCheck) return { isOwner: true, permissions: [...ALL_PERMS] };
  try {
    const [admin] = await db.select().from(adminsTable).where(eq(adminsTable.id, userId)).limit(1);
    if (admin) return { isOwner: false, permissions: (admin.permissions as AdminPermission[]) ?? [] };
  } catch { /* DB may not be ready */ }
  return null;
}

function hasPerm(info: AdminInfo, perm: AdminPermission): boolean {
  return info.isOwner || info.permissions.includes(perm);
}

// ─────────────────────────── HELPERS ───────────────────────────

export async function checkChannelMembership(
  bot: TelegramBot,
  userId: number,
  channelUsername: string
): Promise<boolean> {
  try {
    const member = await bot.getChatMember(`@${channelUsername}`, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch {
    return false;
  }
}

export async function getChannelPhotoUrl(
  bot: TelegramBot,
  channelUsername: string
): Promise<string | null> {
  try {
    const chat = await bot.getChat(`@${channelUsername}`) as unknown as {
      photo?: { big_file_id: string };
    };
    if (!chat.photo?.big_file_id) return null;
    const file = await bot.getFile(chat.photo.big_file_id);
    if (!file.file_path) return null;
    const token = process.env.TELEGRAM_BOT_TOKEN!;
    return `https://api.telegram.org/file/bot${token}/${file.file_path}`;
  } catch {
    return null;
  }
}

interface ConvState {
  step: string;
  data: Record<string, unknown>;
}
export const adminConvState = new Map<number, ConvState>();

async function getSetting(key: string): Promise<string | null> {
  const rows = await db.select().from(botSettingsTable).where(eq(botSettingsTable.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(botSettingsTable)
    .values({ key, value })
    .onConflictDoUpdate({ target: botSettingsTable.key, set: { value } });
}

async function editOrSend(
  bot: TelegramBot,
  chatId: number,
  text: string,
  keyboard: TelegramBot.InlineKeyboardMarkup,
  messageId?: number
) {
  const opts = { parse_mode: "HTML" as const, reply_markup: keyboard };
  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, ...opts });
      return;
    } catch { /* fall through to send */ }
  }
  await bot.sendMessage(chatId, text, { ...opts });
}

// ─────────────────────────── MAIN MENU ───────────────────────────

export async function showAdminMenu(bot: TelegramBot, chatId: number, messageId?: number, info?: AdminInfo) {
  const [usersRes] = await db.select({ c: count() }).from(usersTable);
  const [pendingRes] = await db.select({ c: count() }).from(withdrawalsTable).where(eq(withdrawalsTable.status, "pending"));
  const text =
    `🎛 <b>لوحة التحكم — Jo-jokes</b>\n\n` +
    `👥 المستخدمون: <b>${usersRes?.c ?? 0}</b>\n` +
    `💸 طلبات السحب المعلقة: <b>${pendingRes?.c ?? 0}</b>\n\n` +
    `اختر من القائمة:`;

  const rows: TelegramBot.InlineKeyboardButton[][] = [];

  const row1: TelegramBot.InlineKeyboardButton[] = [];
  if (!info || info.isOwner || hasPerm(info, "canEditWheel"))
    row1.push({ text: "🎡 العجلة", callback_data: "adm:wheel" });
  if (!info || info.isOwner)
    row1.push({ text: "📋 المهام", callback_data: "adm:tasks" });
  if (row1.length) rows.push(row1);

  const row2: TelegramBot.InlineKeyboardButton[] = [];
  if (!info || info.isOwner || hasPerm(info, "canUnban") || hasPerm(info, "canWarn"))
    row2.push({ text: "👥 المستخدمون", callback_data: "adm:users" });
  if (!info || info.isOwner || hasPerm(info, "canReceiveWithdrawals"))
    row2.push({ text: "💸 السحوبات", callback_data: "adm:wd" });
  if (row2.length) rows.push(row2);

  if (!info || info.isOwner) {
    rows.push([
      { text: "⚙️ الإعدادات", callback_data: "adm:settings" },
      { text: "📊 الإحصائيات", callback_data: "adm:stats" },
    ]);
  }

  if (!info || info.isOwner) {
    rows.push([
      { text: "📢 القنوات الإجبارية", callback_data: "adm:channels" },
      { text: "🛠 التحكم بالبوت", callback_data: "adm:botctrl" },
    ]);
  }

  if (!info || info.isOwner) {
    rows.push([{ text: "👮 المشرفون", callback_data: "adm:admins" }]);
  }

  const keyboard: TelegramBot.InlineKeyboardMarkup = { inline_keyboard: rows };
  await editOrSend(bot, chatId, text, keyboard, messageId);
}

// ─────────────────────────── WHEEL ───────────────────────────

async function showWheelMenu(bot: TelegramBot, chatId: number, messageId?: number) {
  const slots = await db.select().from(wheelSlotsTable).orderBy(wheelSlotsTable.displayOrder);
  const total = slots.reduce((s, r) => s + r.probability, 0);
  const totalIcon = total === 100 ? "✅" : total > 100 ? "🔴" : "🟡";
  let text = `🎡 <b>إعدادات العجلة</b>\n${totalIcon} مجموع النسب: <b>${total}%</b> (يجب أن يساوي 100%)\n\n`;
  slots.forEach((s) => {
    const icon = s.probability > 0 ? "🟢" : "⚫";
    text += `${icon} ${parseFloat(s.amount).toFixed(3)} TON — <b>${s.probability}%</b>\n`;
  });
  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      ...slots.map((s) => [
        { text: `✏️ ${parseFloat(s.amount).toFixed(3)} TON (${s.probability}%)`, callback_data: `adm:w:e:${s.id}` },
        { text: `🗑️`, callback_data: `adm:w:del:${s.id}` },
      ]),
      [{ text: "➕ إضافة خانة جديدة", callback_data: "adm:w:add" }],
      [{ text: "⚫ تصفير الكل", callback_data: "adm:w:zero" }],
      [{ text: "◀️ رجوع", callback_data: "adm:main" }],
    ],
  };
  await editOrSend(bot, chatId, text, keyboard, messageId);
}

// ─────────────────────────── TASKS ───────────────────────────

async function showTasksMenu(bot: TelegramBot, chatId: number, messageId?: number) {
  const tasks = await db.select().from(tasksTable).orderBy(tasksTable.id);
  let text = "📋 <b>إدارة المهام</b>\n\n";
  if (tasks.length === 0) text += "لا توجد مهام بعد.\n";
  else tasks.forEach((t) => { text += `${t.isActive ? "✅" : "❌"} [${t.id}] ${esc(t.title)}\n`; });
  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      ...tasks.map((t) => [
        { text: `${t.isActive ? "✅" : "❌"} ${t.title.substring(0, 28)}`, callback_data: `adm:t:v:${t.id}` },
      ]),
      [{ text: "➕ إضافة مهمة جديدة", callback_data: "adm:t:add" }],
      [{ text: "◀️ رجوع", callback_data: "adm:main" }],
    ],
  };
  await editOrSend(bot, chatId, text, keyboard, messageId);
}

// ─────────────────────────── USERS ───────────────────────────

async function showUsersMenu(bot: TelegramBot, chatId: number, messageId?: number) {
  const [res] = await db.select({ c: count() }).from(usersTable);
  const text =
    `👥 <b>إدارة المستخدمين</b>\n\n` +
    `إجمالي المستخدمين: <b>${res?.c ?? 0}</b>\n\n` +
    `ابحث بـ ID أو @يوزرنيم:`;
  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: "🔍 البحث عن مستخدم", callback_data: "adm:u:search" }],
      [{ text: "◀️ رجوع", callback_data: "adm:main" }],
    ],
  };
  await editOrSend(bot, chatId, text, keyboard, messageId);
}

function showUserCard(bot: TelegramBot, chatId: number, u: typeof usersTable.$inferSelect, info: AdminInfo) {
  const safeName = esc(`${u.firstName || "—"} ${u.lastName || ""}`.trim());
  const safeUsername = u.username ? `@${esc(u.username)}` : "—";
  const banned = u.isVisible === false;
  const infoText =
    `${banned ? "🚫 محظور" : "✅ نشط"} | المعرف: ${u.id}\n\n` +
    `الاسم: ${safeName}\n` +
    `اليوزرنيم: ${safeUsername}\n` +
    `💰 الرصيد: ${parseFloat(u.balance).toFixed(4)} TON\n` +
    `🎰 اللفات: ${u.spins}\n` +
    `👥 الإحالات: ${u.referralCount}\n` +
    `✅ المهام المكتملة: ${u.tasksCompleted}`;

  const rows: TelegramBot.InlineKeyboardButton[][] = [];

  if (info.isOwner) {
    rows.push([
      { text: "💰 إضافة رصيد", callback_data: `adm:u:addbal:${u.id}` },
      { text: "💸 خصم رصيد", callback_data: `adm:u:subbal:${u.id}` },
    ]);
    rows.push([
      { text: "✏️ تحديد الرصيد", callback_data: `adm:u:bal:${u.id}` },
      { text: "🎰 تعديل اللفات", callback_data: `adm:u:spins:${u.id}` },
    ]);
  }

  const banRow: TelegramBot.InlineKeyboardButton[] = [];
  if (info.isOwner) {
    banRow.push(banned
      ? { text: "✅ رفع الحظر", callback_data: `adm:u:unban:${u.id}` }
      : { text: "🚫 حظر المستخدم", callback_data: `adm:u:ban:${u.id}` }
    );
  } else if (hasPerm(info, "canUnban") && banned) {
    banRow.push({ text: "✅ رفع الحظر", callback_data: `adm:u:unban:${u.id}` });
  }

  if (hasPerm(info, "canWarn")) {
    banRow.push({ text: "⚠️ تحذير", callback_data: `adm:u:warn:${u.id}` });
  }
  if (banRow.length) rows.push(banRow);

  if (info.isOwner) {
    rows.push([{ text: "🔄 إعادة التحقق", callback_data: `adm:u:resetv:${u.id}` }]);
  }

  rows.push([{ text: "◀️ رجوع للمستخدمين", callback_data: "adm:users" }]);

  return bot.sendMessage(chatId, infoText, { reply_markup: { inline_keyboard: rows } });
}

// ─────────────────────────── WITHDRAWALS ───────────────────────────

async function showWithdrawalsMenu(bot: TelegramBot, chatId: number, messageId?: number, tab: "pending" | "all" = "pending") {
  const statusIcon = (s: string) => s === "pending" ? "⏳" : s === "approved" ? "✅" : "❌";
  if (tab === "all") {
    const all = await db.select().from(withdrawalsTable).orderBy(desc(withdrawalsTable.createdAt)).limit(15);
    let text = `📋 كل السحوبات (آخر ${all.length})\n\n`;
    if (all.length === 0) text += "لا توجد سحوبات بعد.";
    else all.forEach((w) => { text += `${statusIcon(w.status)} #${w.id} — ${parseFloat(w.amount).toFixed(3)} TON — ID: ${w.userId}\n`; });
    const keyboard: TelegramBot.InlineKeyboardMarkup = {
      inline_keyboard: [
        ...all.map((w) => [{ text: `${statusIcon(w.status)} #${w.id} — ${parseFloat(w.amount).toFixed(2)} TON`, callback_data: `adm:wd:v:${w.id}` }]),
        [{ text: "⏳ المعلقة", callback_data: "adm:wd" }, { text: "📋 الكل ✓", callback_data: "adm:wd:all" }],
        [{ text: "◀️ رجوع", callback_data: "adm:main" }],
      ],
    };
    await editOrSend(bot, chatId, text, keyboard, messageId);
  } else {
    const pending = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.status, "pending")).orderBy(desc(withdrawalsTable.createdAt)).limit(10);
    const [allRes] = await db.select({ c: count() }).from(withdrawalsTable);
    let text = `💸 <b>طلبات السحب المعلقة</b>\nمعلق: ${pending.length} | الإجمالي: ${allRes?.c ?? 0}\n\n`;
    if (pending.length === 0) text += "لا توجد طلبات معلقة.";
    const keyboard: TelegramBot.InlineKeyboardMarkup = {
      inline_keyboard: [
        ...pending.map((w) => [{ text: `⏳ #${w.id} — ${parseFloat(w.amount).toFixed(2)} TON (${w.userId})`, callback_data: `adm:wd:v:${w.id}` }]),
        [{ text: "⏳ المعلقة ✓", callback_data: "adm:wd" }, { text: "📋 الكل", callback_data: "adm:wd:all" }],
        [{ text: "◀️ رجوع", callback_data: "adm:main" }],
      ],
    };
    await editOrSend(bot, chatId, text, keyboard, messageId);
  }
}

// ─────────────────────────── SETTINGS ───────────────────────────

async function showSettingsMenu(bot: TelegramBot, chatId: number, messageId?: number) {
  const mode = (await getSetting("withdraw_mode")) || "manual";
  const modeLabel = mode === "auto" ? "🟢 تلقائي" : "🔴 يدوي";
  const chRaw = await getSetting("required_channels");
  let chList = "لا توجد قنوات مطلوبة";
  if (chRaw) {
    try {
      const chs = JSON.parse(chRaw) as { username: string; title: string }[];
      chList = chs.length === 0 ? "لا توجد قنوات مطلوبة" : chs.map((c, i) => `${i + 1}. ${esc(c.title || `@${c.username}`)}`).join("\n");
    } catch { /* ignore */ }
  }
  const text =
    `⚙️ <b>إعدادات البوت</b>\n\n` +
    `وضع السحب الحالي: ${modeLabel}\n\n` +
    `<b>يدوي</b> ← المالك يوافق يدوياً على كل طلب.\n` +
    `<b>تلقائي</b> ← موافقة وتحويل تلقائي.\n\n` +
    `🔒 <b>القنوات المطلوبة للاشتراك:</b>\n${chList}`;
  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: "🔴 يدوي", callback_data: "adm:set:mode:manual" }, { text: "🟢 تلقائي", callback_data: "adm:set:mode:auto" }],
      [{ text: "🔒 إدارة القنوات المطلوبة", callback_data: "adm:set:channels" }],
      [{ text: "◀️ رجوع", callback_data: "adm:main" }],
    ],
  };
  await editOrSend(bot, chatId, text, keyboard, messageId);
}

async function showRequiredChannelsMenu(bot: TelegramBot, chatId: number, messageId?: number) {
  const chRaw = await getSetting("required_channels");
  let channels: { username: string; title: string; inviteLink: string }[] = [];
  if (chRaw) {
    try { channels = JSON.parse(chRaw); } catch { /* ignore */ }
  }
  const listText = channels.length === 0
    ? "لا توجد قنوات مطلوبة حتى الآن."
    : channels.map((c, i) => `${i + 1}. ${esc(c.title || `@${c.username}`)} (@${esc(c.username)})`).join("\n");

  const text =
    `📢 <b>إدارة القنوات الإجبارية</b>\n\n` +
    `جميع المستخدمين (جدد وقدامى) <b>ملزمون</b> بالاشتراك في هذه القنوات لاستخدام البوت والميني آب.\n\n` +
    `<b>القنوات الحالية:</b>\n${listText}`;

  const channelButtons: TelegramBot.InlineKeyboardButton[][] = channels.map((c, i) => [
    { text: `🗑️ حذف: @${c.username}`, callback_data: `adm:set:ch:del:${i}` },
  ]);

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      ...channelButtons,
      [{ text: "➕ إضافة قناة", callback_data: "adm:set:ch:add" }],
      [{ text: "◀️ رجوع للإعدادات", callback_data: "adm:settings" }],
    ],
  };
  await editOrSend(bot, chatId, text, keyboard, messageId);
}

// ─────────────────────────── BOT CONTROL ───────────────────────────

async function showBotControlMenu(bot: TelegramBot, chatId: number, messageId?: number) {
  const enabled = await isBotEnabled();
  const statusText = enabled ? "🟢 يعمل بشكل طبيعي" : "🔴 متوقف (وضع الصيانة)";
  const text =
    `🛠 <b>التحكم في حالة البوت</b>\n\n` +
    `الحالة الحالية: <b>${statusText}</b>\n\n` +
    (enabled
      ? "لإيقاف البوت اضغط الزر أدناه. سيظهر للمستخدمين رسالة صيانة وستبقى أنت وحدك قادراً على الوصول."
      : "البوت <b>متوقف</b> حالياً. المستخدمون لا يمكنهم الوصول. اضغط لتشغيله.");
  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      enabled
        ? [{ text: "🔴 إيقاف البوت (وضع الصيانة)", callback_data: "adm:botctrl:off" }]
        : [{ text: "🟢 تشغيل البوت", callback_data: "adm:botctrl:on" }],
      [{ text: "◀️ رجوع", callback_data: "adm:main" }],
    ],
  };
  await editOrSend(bot, chatId, text, keyboard, messageId);
}

// ─────────────────────────── STATS ───────────────────────────

async function showStats(bot: TelegramBot, chatId: number, messageId?: number) {
  const [users] = await db.select({ c: count() }).from(usersTable);
  const [pending] = await db.select({ c: count() }).from(withdrawalsTable).where(eq(withdrawalsTable.status, "pending"));
  const [approved] = await db.select({ c: count() }).from(withdrawalsTable).where(eq(withdrawalsTable.status, "approved"));
  const [tasks] = await db.select({ c: count() }).from(tasksTable).where(eq(tasksTable.isActive, true));
  const [slots] = await db.select({ c: count() }).from(wheelSlotsTable);
  const text =
    `📊 <b>الإحصائيات</b>\n\n` +
    `👥 المستخدمون: <b>${users?.c ?? 0}</b>\n` +
    `📋 المهام النشطة: <b>${tasks?.c ?? 0}</b>\n` +
    `🎡 خانات العجلة: <b>${slots?.c ?? 0}</b>\n` +
    `💸 السحوبات المعلقة: <b>${pending?.c ?? 0}</b>\n` +
    `✅ السحوبات الموافق عليها: <b>${approved?.c ?? 0}</b>`;
  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [[{ text: "◀️ رجوع", callback_data: "adm:main" }]],
  };
  await editOrSend(bot, chatId, text, keyboard, messageId);
}

// ─────────────────────────── ADMINS MANAGEMENT ───────────────────────────

async function showAdminsMenu(bot: TelegramBot, chatId: number, messageId?: number) {
  let admins: (typeof adminsTable.$inferSelect)[] = [];
  try {
    admins = await db.select().from(adminsTable).orderBy(adminsTable.addedAt);
  } catch (err) {
    logger.error({ err }, "Failed to query admins table");
  }

  let text = `👮 <b>إدارة المشرفين</b>\n\nعدد المشرفين: <b>${admins.length}</b>\n\n`;
  if (admins.length === 0) {
    text += "لا يوجد مشرفون مضافون بعد.\n";
  } else {
    for (const a of admins) {
      const name = a.username ? `@${esc(a.username)}` : `ID: ${a.id}`;
      const perms = (a.permissions as AdminPermission[]) ?? [];
      const permsText = perms.length > 0 ? perms.map((p) => PERM_LABELS[p]).join(", ") : "لا صلاحيات";
      text += `👤 ${name}\n   ↳ ${permsText}\n\n`;
    }
  }

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      [{ text: "➕ إضافة مشرف", callback_data: "adm:admins:add" }],
      ...admins.map((a) => [
        { text: `✏️ ${a.username ? `@${a.username}` : String(a.id)}`, callback_data: `adm:admins:edit:${a.id}` },
        { text: "🗑️ حذف", callback_data: `adm:admins:del:${a.id}` },
      ]),
      [{ text: "◀️ رجوع", callback_data: "adm:main" }],
    ],
  };
  await editOrSend(bot, chatId, text, keyboard, messageId);
}

async function showAdminPermsEditor(
  bot: TelegramBot,
  chatId: number,
  targetId: number,
  selectedPerms: AdminPermission[],
  isNew: boolean,
  messageId?: number
) {
  const text = isNew
    ? `👮 <b>إضافة مشرف جديد</b>\n🆔 ID: <code>${targetId}</code>\n\nاختر الصلاحيات ثم اضغط تأكيد:`
    : `✏️ <b>تعديل صلاحيات المشرف</b>\n🆔 ID: <code>${targetId}</code>\n\nاختر الصلاحيات ثم اضغط حفظ:`;

  const confirmData = isNew ? `adm:admins:confirm:${targetId}` : `adm:admins:save:${targetId}`;
  const confirmLabel = isNew ? "✅ تأكيد الإضافة" : "💾 حفظ الصلاحيات";

  const keyboard: TelegramBot.InlineKeyboardMarkup = {
    inline_keyboard: [
      ...ALL_PERMS.map((p) => [
        {
          text: `${selectedPerms.includes(p) ? "✅" : "☐"} ${PERM_LABELS[p]}`,
          callback_data: `adm:admins:tog:${targetId}:${p}:${isNew ? "1" : "0"}`,
        },
      ]),
      [{ text: confirmLabel, callback_data: confirmData }],
      [{ text: "❌ إلغاء", callback_data: "adm:admins" }],
    ],
  };
  await editOrSend(bot, chatId, text, keyboard, messageId);
}

// ─────────────────────────── MAIN CALLBACK HANDLER ───────────────────────────

export async function handleAdminCallback(
  bot: TelegramBot,
  q: TelegramBot.CallbackQuery
): Promise<boolean> {
  const data = q.data ?? "";
  if (!data.startsWith("adm:")) return false;

  const chatId = q.message!.chat.id;
  const msgId = q.message!.message_id;
  const userId = q.from.id;
  const username = q.from.username;

  const info = await getAdminInfo(userId, username);
  if (!info) {
    await bot.answerCallbackQuery(q.id, { text: "⛔ غير مصرح" });
    return true;
  }
  await bot.answerCallbackQuery(q.id);

  const parts = data.split(":");
  const sec = parts[1];
  const act = parts[2];
  const p1  = parts[3];
  const p2  = parts[4];
  const p3  = parts[5];

  try {
    if (data === "adm:main")     { await showAdminMenu(bot, chatId, msgId, info); return true; }
    if (data === "adm:stats")    { if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; } await showStats(bot, chatId, msgId); return true; }
    if (data === "adm:settings") { if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; } await showSettingsMenu(bot, chatId, msgId); return true; }

    if (data === "adm:channels") {
      if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
      await showRequiredChannelsMenu(bot, chatId, msgId); return true;
    }

    if (data === "adm:botctrl") {
      if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
      await showBotControlMenu(bot, chatId, msgId); return true;
    }
    if (data === "adm:botctrl:on" || data === "adm:botctrl:off") {
      if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
      const enable = data === "adm:botctrl:on";
      await setBotEnabled(enable);
      clearBotEnabledCache();
      await bot.sendMessage(
        chatId,
        enable
          ? "✅ <b>تم تشغيل البوت بنجاح!</b> 🟢\n\nالمستخدمون يمكنهم الوصول الآن."
          : "🔴 <b>تم إيقاف البوت!</b>\n\nوضع الصيانة مفعّل. ستظهر للمستخدمين رسالة صيانة.",
        { parse_mode: "HTML" }
      );
      await showBotControlMenu(bot, chatId, msgId); return true;
    }

    if (data === "adm:wheel") {
      if (!info.isOwner && !hasPerm(info, "canEditWheel")) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
      await showWheelMenu(bot, chatId, msgId); return true;
    }
    if (data === "adm:tasks") {
      if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
      await showTasksMenu(bot, chatId, msgId); return true;
    }
    if (data === "adm:users") {
      if (!info.isOwner && !hasPerm(info, "canUnban") && !hasPerm(info, "canWarn")) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
      await showUsersMenu(bot, chatId, msgId); return true;
    }
    if (data === "adm:wd") {
      if (!info.isOwner && !hasPerm(info, "canReceiveWithdrawals")) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
      await showWithdrawalsMenu(bot, chatId, msgId, "pending"); return true;
    }
    if (data === "adm:wd:all") {
      if (!info.isOwner && !hasPerm(info, "canReceiveWithdrawals")) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
      await showWithdrawalsMenu(bot, chatId, msgId, "all"); return true;
    }
    if (data === "adm:admins") {
      if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
      await showAdminsMenu(bot, chatId, msgId); return true;
    }

    // ── Wheel ──
    if (sec === "w") {
      if (!info.isOwner && !hasPerm(info, "canEditWheel")) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }

      if (data === "adm:w:zero") {
        await db.update(wheelSlotsTable).set({ probability: 0 });
        await showWheelMenu(bot, chatId, msgId);
      } else if (data === "adm:w:add") {
        adminConvState.set(userId, { step: "wheel_add_amount", data: { chatId, msgId } });
        await bot.sendMessage(chatId, "🎡 <b>إضافة خانة جديدة</b>\n\nأدخل <b>المبلغ</b> بـ TON (مثال: <code>0.5</code> أو <code>5</code>):", { parse_mode: "HTML" });
      } else if (act === "del" && p1) {
        await db.delete(wheelSlotsTable).where(eq(wheelSlotsTable.id, parseInt(p1)));
        await showWheelMenu(bot, chatId, msgId);
      } else if (act === "e" && p1) {
        const [slot] = await db.select().from(wheelSlotsTable).where(eq(wheelSlotsTable.id, parseInt(p1))).limit(1);
        if (slot) {
          adminConvState.set(userId, { step: "wheel_edit_amount", data: { slotId: parseInt(p1), chatId, msgId } });
          await bot.sendMessage(chatId,
            `✏️ تعديل الخانة <b>${parseFloat(slot.amount).toFixed(3)} TON</b>\n\nأدخل المبلغ الجديد (أو - للإبقاء على <b>${parseFloat(slot.amount).toFixed(3)}</b>):`,
            { parse_mode: "HTML" });
        }
      }
      return true;
    }

    // ── Tasks (owner only) ──
    if (sec === "t") {
      if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }

      if (act === "v" && p1) {
        const [t] = await db.select().from(tasksTable).where(eq(tasksTable.id, parseInt(p1))).limit(1);
        if (t) {
          await bot.editMessageText(
            `📋 المهمة #${t.id}\n\n${esc(t.icon || "⭐")} ${esc(t.title)}\nالوصف: ${esc(t.description || "—")}\nالرابط: ${esc(t.url || "—")}\nالحالة: ${t.isActive ? "✅ نشطة" : "❌ معطلة"}`,
            { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [
              [{ text: t.isActive ? "❌ تعطيل" : "✅ تفعيل", callback_data: `adm:t:tog:${t.id}` }, { text: "🗑️ حذف", callback_data: `adm:t:del:${t.id}` }],
              [{ text: "◀️ رجوع للمهام", callback_data: "adm:tasks" }],
            ]}}
          );
        }
      } else if (act === "tog" && p1) {
        const [t] = await db.select().from(tasksTable).where(eq(tasksTable.id, parseInt(p1))).limit(1);
        if (t) await db.update(tasksTable).set({ isActive: !t.isActive }).where(eq(tasksTable.id, parseInt(p1)));
        await showTasksMenu(bot, chatId, msgId);
      } else if (act === "del" && p1) {
        await db.delete(tasksTable).where(eq(tasksTable.id, parseInt(p1)));
        await showTasksMenu(bot, chatId, msgId);
      } else if (act === "add") {
        adminConvState.set(userId, { step: "task_title", data: { chatId, msgId } });
        await bot.sendMessage(chatId, "📝 أدخل <b>عنوان المهمة</b>:", { parse_mode: "HTML" });
      }
      return true;
    }

    // ── Users ──
    if (sec === "u") {
      if (!info.isOwner && !hasPerm(info, "canUnban") && !hasPerm(info, "canWarn")) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }

      if (act === "search") {
        adminConvState.set(userId, { step: "user_search", data: {} });
        await bot.sendMessage(chatId, "🔍 أدخل <b>Telegram ID</b> أو <b>@يوزرنيم</b>:", { parse_mode: "HTML" });
      } else if (act === "addbal" && p1) {
        if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        adminConvState.set(userId, { step: "user_addbal", data: { targetId: parseInt(p1) } });
        await bot.sendMessage(chatId, `💰 كم تريد <b>إضافة</b> لرصيد المستخدم ${p1}؟\n(مثال: 5 أو 0.5)`, { parse_mode: "HTML" });
      } else if (act === "subbal" && p1) {
        if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        adminConvState.set(userId, { step: "user_subbal", data: { targetId: parseInt(p1) } });
        await bot.sendMessage(chatId, `💸 كم تريد <b>خصم</b> من رصيد المستخدم ${p1}؟`, { parse_mode: "HTML" });
      } else if (act === "bal" && p1) {
        if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        adminConvState.set(userId, { step: "user_balance", data: { targetId: parseInt(p1) } });
        await bot.sendMessage(chatId, `✏️ أدخل الرصيد الجديد للمستخدم ${p1}:`, { parse_mode: "HTML" });
      } else if (act === "spins" && p1) {
        if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        adminConvState.set(userId, { step: "user_spins", data: { targetId: parseInt(p1) } });
        await bot.sendMessage(chatId, `🎰 أدخل اللفات للمستخدم ${p1}\n(مثال: 10 أو +5 أو -2)`, { parse_mode: "HTML" });
      } else if (act === "ban" && p1) {
        if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        const targetId = parseInt(p1);
        await db.update(usersTable).set({ isVisible: false }).where(eq(usersTable.id, targetId));
        try { await bot.sendMessage(targetId, "🚫 تم حظر حسابك. تواصل مع الدعم لمزيد من المعلومات."); } catch { /**/ }
        const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
        await bot.sendMessage(chatId, `🚫 تم حظر المستخدم ${esc(u?.firstName || String(targetId))} (${targetId}).`);
      } else if (act === "unban" && p1) {
        if (!info.isOwner && !hasPerm(info, "canUnban")) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        const targetId = parseInt(p1);
        await db.update(usersTable).set({
          isVisible: true,
          isBlockedForLeaving: false,
          ipVerifiedAt: new Date(),
          verificationToken: null,
        }).where(eq(usersTable.id, targetId));
        try { await bot.sendMessage(targetId, "✅ تم رفع الحظر عن حسابك. يمكنك الاستخدام الآن! 🎉"); } catch { /**/ }
        const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
        await bot.sendMessage(chatId, `✅ تم رفع الحظر عن المستخدم ${esc(u?.firstName || String(targetId))} (${targetId}) — يمكنه الاستخدام مباشرة بدون إعادة تحقق.`);
      } else if (act === "warn" && p1) {
        if (!info.isOwner && !hasPerm(info, "canWarn")) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        adminConvState.set(userId, { step: "user_warn", data: { targetId: parseInt(p1) } });
        await bot.sendMessage(chatId, "⚠️ أدخل نص التحذير الذي سيُرسل للمستخدم:");
      } else if (act === "resetv" && p1) {
        if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        const targetId = parseInt(p1);
        await db.update(usersTable).set({ ipVerifiedAt: null, deviceId: null, verificationToken: null }).where(eq(usersTable.id, targetId));
        const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
        await bot.sendMessage(chatId, `🔄 تمت إعادة التحقق للمستخدم ${esc(u?.firstName || String(targetId))} (${targetId}).`);
      }
      return true;
    }

    // ── Withdrawals ──
    if (sec === "wd") {
      if (!info.isOwner && !hasPerm(info, "canReceiveWithdrawals")) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
      if (act === "v" && p1) {
        const [w] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, parseInt(p1))).limit(1);
        if (w) {
          const [u] = await db.select().from(usersTable).where(eq(usersTable.id, w.userId)).limit(1);
          await bot.editMessageText(
            `💸 <b>طلب سحب #${w.id}</b>\n\n👤 ${esc(u?.firstName || "—")} @${esc(u?.username || "—")}\n🆔 ${w.userId}\n💰 <b>${parseFloat(w.amount).toFixed(4)} TON</b>\n📍 <code>${esc(w.walletAddress)}</code>\nالحالة: <b>${w.status}</b>`,
            {
              chat_id: chatId, message_id: msgId, parse_mode: "HTML",
              reply_markup: { inline_keyboard: [
                [{ text: "✅ موافقة", callback_data: `withdraw_approve_${w.id}` }, { text: "❌ رفض", callback_data: `withdraw_reject_${w.id}` }],
                [{ text: "◀️ رجوع", callback_data: "adm:wd" }],
              ]},
            }
          );
        }
      }
      return true;
    }

    // ── Settings (owner only) ──
    if (sec === "set") {
      if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
      if (act === "mode" && p1) { await setSetting("withdraw_mode", p1); await showSettingsMenu(bot, chatId, msgId); return true; }

      if (act === "channels") { await showRequiredChannelsMenu(bot, chatId, msgId); return true; }

      if (act === "ch") {
        if (p1 === "add") {
          adminConvState.set(userId, { step: "ch_add_username", data: {} });
          await bot.sendMessage(chatId, "📢 <b>إضافة قناة مطلوبة</b>\n\nأدخل @يوزرنيم القناة:", { parse_mode: "HTML" });
          return true;
        }
        if (p1 === "del" && p2 !== undefined) {
          const idx = parseInt(p2);
          const chRaw = await getSetting("required_channels");
          let channels: { username: string; title: string; inviteLink: string }[] = [];
          try { channels = JSON.parse(chRaw ?? "[]"); } catch { /* ignore */ }
          channels.splice(idx, 1);
          await setSetting("required_channels", JSON.stringify(channels));
          clearAllSubCache();
          await showRequiredChannelsMenu(bot, chatId, msgId);
          return true;
        }
      }
      return true;
    }

    // ── Admins management (owner only) ──
    if (sec === "admins") {
      if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }

      if (act === "add") {
        adminConvState.set(userId, { step: "admin_add_id", data: { selectedPerms: [] } });
        await bot.sendMessage(chatId, "👮 <b>إضافة مشرف جديد</b>\n\nأدخل <b>@يوزرنيم</b> أو <b>Telegram ID</b> للمستخدم:", { parse_mode: "HTML" });
      } else if (act === "edit" && p1) {
        const targetId = parseInt(p1);
        const [admin] = await db.select().from(adminsTable).where(eq(adminsTable.id, targetId)).limit(1);
        if (admin) {
          const perms = (admin.permissions as AdminPermission[]) ?? [];
          adminConvState.set(userId, { step: "admin_edit_perms", data: { targetId, selectedPerms: [...perms] } });
          await showAdminPermsEditor(bot, chatId, targetId, perms, false, msgId);
        }
      } else if (act === "del" && p1) {
        await db.delete(adminsTable).where(eq(adminsTable.id, parseInt(p1)));
        await showAdminsMenu(bot, chatId, msgId);
      } else if (act === "tog" && p1 && p2) {
        const targetId = parseInt(p1);
        const perm = p2 as AdminPermission;
        const isNew = p3 === "1";
        const state = adminConvState.get(userId);
        const currentPerms: AdminPermission[] = (state?.data?.selectedPerms as AdminPermission[]) ?? [];
        const newPerms = currentPerms.includes(perm) ? currentPerms.filter((x) => x !== perm) : [...currentPerms, perm];
        adminConvState.set(userId, { step: state?.step ?? (isNew ? "admin_add_perms" : "admin_edit_perms"), data: { ...(state?.data ?? {}), targetId, selectedPerms: newPerms } });
        await showAdminPermsEditor(bot, chatId, targetId, newPerms, isNew, msgId);
      } else if (act === "save" && p1) {
        const targetId = parseInt(p1);
        const state = adminConvState.get(userId);
        const perms: AdminPermission[] = (state?.data?.selectedPerms as AdminPermission[]) ?? [];
        adminConvState.delete(userId);
        await db.update(adminsTable).set({ permissions: perms }).where(eq(adminsTable.id, targetId));
        await showAdminsMenu(bot, chatId, msgId);
      } else if (act === "confirm" && p1) {
        const targetId = parseInt(p1);
        const state = adminConvState.get(userId);
        const perms: AdminPermission[] = (state?.data?.selectedPerms as AdminPermission[]) ?? [];
        adminConvState.delete(userId);

        let tgUsername: string | null = null;
        try {
          const rows = await db.select({ username: usersTable.username })
            .from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
          tgUsername = rows[0]?.username ?? null;
        } catch { /* ignore */ }

        const permsJson = JSON.stringify(perms);
        await db.execute(sql`
          INSERT INTO admins (id, username, permissions)
          VALUES (${targetId}, ${tgUsername}, ${permsJson}::jsonb)
          ON CONFLICT (id) DO UPDATE
            SET username = EXCLUDED.username,
                permissions = EXCLUDED.permissions
        `);

        const permsLines = perms.length > 0
          ? perms.map((p) => "  - " + PERM_LABELS[p]).join("\n")
          : "  - لا صلاحيات";
        const nameStr = tgUsername ? ` (@${esc(tgUsername)})` : "";
        await bot.sendMessage(
          chatId,
          `تمت إضافة المشرف بنجاح!\n\nID: ${targetId}${nameStr}\n\nالصلاحيات:\n${permsLines}`,
        );
        const tmp = await bot.sendMessage(chatId, "...");
        await showAdminsMenu(bot, chatId, tmp.message_id);
      }
      return true;
    }

  } catch (err) {
    logger.error({ err }, "Admin callback error");
    const errDetail = err instanceof Error ? err.message.slice(0, 150) : String(err).slice(0, 150);
    try { await bot.sendMessage(chatId, `❌ خطأ: ${esc(errDetail)}`); } catch { /**/ }
  }

  return true;
}

// ─────────────────────────── PHOTO HANDLER ───────────────────────────

export async function handleAdminPhoto(bot: TelegramBot, msg: TelegramBot.Message): Promise<boolean> {
  const userId = msg.from!.id;
  const state = adminConvState.get(userId);
  if (!state || state.step !== "task_icon") return false;
  if (!msg.photo || msg.photo.length === 0) return false;

  const chatId = msg.chat.id;
  try {
    const photo = msg.photo[msg.photo.length - 1];
    const file = await bot.getFile(photo.file_id);
    const token = process.env.TELEGRAM_BOT_TOKEN!;
    const channelPhotoUrl = file.file_path ? `https://api.telegram.org/file/bot${token}/${file.file_path}` : null;
    const { title, description, url } = state.data as { title: string; description: string | null; url: string | null };
    await db.insert(tasksTable).values({ title, description, url, icon: "⭐", channelPhotoUrl, isActive: true });
    adminConvState.delete(userId);
    await bot.sendMessage(chatId, `✅ تمت إضافة المهمة: <b>${esc(title)}</b> (مع صورة مخصصة 🖼)`, { parse_mode: "HTML" });
    const tmp = await bot.sendMessage(chatId, "جاري التحميل...");
    await showTasksMenu(bot, chatId, tmp.message_id);
  } catch (err) {
    logger.error({ err }, "handleAdminPhoto error");
    await bot.sendMessage(chatId, "❌ فشل رفع الصورة، يرجى المحاولة مرة أخرى.");
  }
  return true;
}

// ─────────────────────────── TEXT HANDLER ───────────────────────────

export async function handleAdminText(bot: TelegramBot, msg: TelegramBot.Message): Promise<boolean> {
  const userId = msg.from!.id;
  const state = adminConvState.get(userId);
  if (!state) return false;

  const text = msg.text?.trim() ?? "";
  const chatId = msg.chat.id;
  const clearState = () => adminConvState.delete(userId);
  const send = (t: string, opts: TelegramBot.SendMessageOptions = {}) => bot.sendMessage(chatId, t, { ...opts });

  try {
    // ── Wheel: add slot ──
    if (state.step === "wheel_add_amount") {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount <= 0) { await send("❌ أدخل رقماً صحيحاً أكبر من 0"); return true; }
      adminConvState.set(userId, { step: "wheel_add_prob", data: { ...state.data, amount } });
      await send(`💡 المبلغ: <b>${amount} TON</b>\nأدخل الآن <b>النسبة</b> (0–100):`, { parse_mode: "HTML" });
      return true;
    }
    if (state.step === "wheel_add_prob") {
      const prob = parseInt(text);
      if (isNaN(prob) || prob < 0 || prob > 100) { await send("❌ أدخل رقماً بين 0 و100"); return true; }
      const { amount } = state.data as { amount: number };
      const [maxOrder] = await db.select({ m: sql<number>`max(display_order)` }).from(wheelSlotsTable);
      await db.insert(wheelSlotsTable).values({ amount: String(amount), probability: prob, displayOrder: ((maxOrder?.m as number) || 0) + 1 });
      clearState();
      await send(`✅ تمت إضافة الخانة: <b>${amount} TON</b> بنسبة <b>${prob}%</b>`, { parse_mode: "HTML" });
      const tmp = await send("جاري التحميل...");
      await showWheelMenu(bot, chatId, tmp.message_id);
      return true;
    }

    // ── Wheel: edit slot ──
    if (state.step === "wheel_edit_amount") {
      const { slotId } = state.data as { slotId: number };
      const [slot] = await db.select().from(wheelSlotsTable).where(eq(wheelSlotsTable.id, slotId)).limit(1);
      const newAmount = text === "-" ? parseFloat(slot.amount) : parseFloat(text);
      if (isNaN(newAmount) || newAmount <= 0) { await send("❌ أدخل رقماً صحيحاً أكبر من 0، أو - للإبقاء"); return true; }
      adminConvState.set(userId, { step: "wheel_edit_prob", data: { ...state.data, newAmount } });
      await send(`💡 المبلغ: <b>${newAmount} TON</b>\nأدخل النسبة الجديدة (0–100) أو - للإبقاء على <b>${slot.probability}%</b>:`, { parse_mode: "HTML" });
      return true;
    }
    if (state.step === "wheel_edit_prob") {
      const { slotId, newAmount } = state.data as { slotId: number; newAmount: number };
      const [slot] = await db.select().from(wheelSlotsTable).where(eq(wheelSlotsTable.id, slotId)).limit(1);
      const newProb = text === "-" ? slot.probability : parseInt(text);
      if (isNaN(newProb) || newProb < 0 || newProb > 100) { await send("❌ أدخل رقماً بين 0 و100، أو - للإبقاء"); return true; }
      await db.update(wheelSlotsTable).set({ amount: String(newAmount), probability: newProb }).where(eq(wheelSlotsTable.id, slotId));
      clearState();
      await send(`✅ تم التحديث: <b>${newAmount} TON</b> — <b>${newProb}%</b>`, { parse_mode: "HTML" });
      const tmp = await send("جاري التحميل...");
      await showWheelMenu(bot, chatId, tmp.message_id);
      return true;
    }

    // ── Task flow ──
    if (state.step === "task_title") {
      adminConvState.set(userId, { step: "task_desc", data: { ...state.data, title: text } });
      await send("📝 أدخل <b>وصف المهمة</b> (أو - للتخطي):", { parse_mode: "HTML" });
      return true;
    }
    if (state.step === "task_desc") {
      adminConvState.set(userId, { step: "task_url", data: { ...state.data, description: text === "-" ? null : text } });
      await send("🔗 أدخل <b>رابط المهمة</b> (مثال: https://t.me/...) أو -:", { parse_mode: "HTML" });
      return true;
    }
    if (state.step === "task_url") {
      adminConvState.set(userId, { step: "task_icon", data: { ...state.data, url: text === "-" ? null : text } });
      await send("🖼 أرسل <b>صورة القناة</b> (أو <b>إيموجي</b> أو - للتخطي):", { parse_mode: "HTML" });
      return true;
    }
    if (state.step === "task_icon") {
      const { title, description, url } = state.data as { title: string; description: string | null; url: string | null };
      const icon = text === "-" ? "⭐" : text;
      let channelPhotoUrl: string | null = null;
      if (url) { const m = url.match(/t\.me\/([A-Za-z0-9_]+)/); if (m) { try { channelPhotoUrl = await getChannelPhotoUrl(bot, m[1]); } catch { /**/ } } }
      await db.insert(tasksTable).values({ title, description, url, icon, channelPhotoUrl, isActive: true });
      clearState();
      await send(`✅ تمت إضافة المهمة: <b>${esc(title)}</b>${channelPhotoUrl ? " (تم جلب صورة القناة ✅)" : ""}`, { parse_mode: "HTML" });
      const tmp = await send("جاري التحميل...");
      await showTasksMenu(bot, chatId, tmp.message_id);
      return true;
    }

    // ── User search ──
    if (state.step === "user_search") {
      const info = await getAdminInfo(userId, msg.from?.username);
      if (!info) { clearState(); return false; }
      let u: typeof usersTable.$inferSelect | undefined;
      if (text.startsWith("@")) {
        const uname = text.slice(1);
        u = (await db.select().from(usersTable).where(ilike(usersTable.username, uname)).limit(1))[0];
      } else {
        const targetId = parseInt(text);
        if (isNaN(targetId)) { await send("❌ أدخل ID رقمي صحيح أو @يوزرنيم"); return true; }
        u = (await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1))[0];
      }
      clearState();
      if (!u) { await send("❌ لم يتم العثور على مستخدم بهذا المعرف"); return true; }
      await showUserCard(bot, chatId, u, info);
      return true;
    }

    // ── User warn ──
    if (state.step === "user_warn") {
      const { targetId } = state.data as { targetId: number };
      clearState();
      try { await bot.sendMessage(targetId, `⚠️ <b>تحذير من الإدارة:</b>\n\n${esc(text)}`, { parse_mode: "HTML" }); } catch { /**/ }
      await send(`✅ تم إرسال التحذير للمستخدم ${targetId}.`);
      return true;
    }

    // ── Balance & Spins (owner only) ──
    if (state.step === "user_addbal") {
      const { targetId } = state.data as { targetId: number };
      clearState();
      const val = parseFloat(text);
      if (isNaN(val) || val <= 0) { await send("❌ أدخل قيمة موجبة صحيحة"); return true; }
      await db.update(usersTable).set({ balance: sql`balance + ${val}` }).where(eq(usersTable.id, targetId));
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
      await send(`✅ تمت إضافة <b>${val} TON</b> للمستخدم ${targetId}\nالرصيد الجديد: <b>${parseFloat(u.balance).toFixed(4)} TON</b>`, { parse_mode: "HTML" });
      try { await bot.sendMessage(targetId, `💰 تمت إضافة <b>${val} TON</b> لرصيدك!\nرصيدك الحالي: <b>${parseFloat(u.balance).toFixed(4)} TON</b>`, { parse_mode: "HTML" }); } catch { /**/ }
      return true;
    }
    if (state.step === "user_subbal") {
      const { targetId } = state.data as { targetId: number };
      clearState();
      const val = parseFloat(text);
      if (isNaN(val) || val <= 0) { await send("❌ أدخل قيمة موجبة صحيحة"); return true; }
      await db.update(usersTable).set({ balance: sql`GREATEST(balance - ${val}, 0)` }).where(eq(usersTable.id, targetId));
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
      await send(`✅ تم خصم <b>${val} TON</b> من المستخدم ${targetId}\nالرصيد الجديد: <b>${parseFloat(u.balance).toFixed(4)} TON</b>`, { parse_mode: "HTML" });
      try { await bot.sendMessage(targetId, `📉 تم خصم <b>${val} TON</b> من رصيدك.\nرصيدك الحالي: <b>${parseFloat(u.balance).toFixed(4)} TON</b>`, { parse_mode: "HTML" }); } catch { /**/ }
      return true;
    }
    if (state.step === "user_balance") {
      const { targetId } = state.data as { targetId: number };
      clearState();
      const val = parseFloat(text);
      if (isNaN(val) || val < 0) { await send("❌ أدخل قيمة صحيحة (0 أو أكبر)"); return true; }
      await db.update(usersTable).set({ balance: String(val) }).where(eq(usersTable.id, targetId));
      await send(`✅ تم تحديد رصيد المستخدم ${targetId} إلى <b>${val} TON</b>`, { parse_mode: "HTML" });
      try { await bot.sendMessage(targetId, `💰 تم تحديث رصيدك إلى <b>${val} TON</b>`, { parse_mode: "HTML" }); } catch { /**/ }
      return true;
    }
    if (state.step === "user_spins") {
      const { targetId } = state.data as { targetId: number };
      clearState();
      const isRelative = text.startsWith("+") || text.startsWith("-");
      const val = parseInt(text);
      if (isNaN(val)) { await send("❌ قيمة غير صحيحة"); return true; }
      if (isRelative) {
        await db.update(usersTable).set({ spins: sql`GREATEST(spins + ${val}, 0)` }).where(eq(usersTable.id, targetId));
      } else {
        if (val < 0) { await send("❌ أدخل رقماً غير سالب"); return true; }
        await db.update(usersTable).set({ spins: val }).where(eq(usersTable.id, targetId));
      }
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
      await send(`✅ اللفات الجديدة للمستخدم ${targetId}: <b>${u.spins}</b>`, { parse_mode: "HTML" });
      if (Math.abs(val) > 0) {
        try { await bot.sendMessage(targetId, `🎰 تمت إضافة <b>${Math.abs(val)} لفة</b> لحسابك!\nلفاتك الحالية: <b>${u.spins}</b>`, { parse_mode: "HTML" }); } catch { /**/ }
      }
      return true;
    }

    // ── Required channel: add username ──
    if (state.step === "ch_add_username") {
      const username = text.replace(/^@/, "").trim();
      if (!username) { await send("❌ يوزرنيم غير صحيح"); return true; }
      adminConvState.set(userId, { step: "ch_add_title", data: { username } });
      await send(`✅ القناة: @${esc(username)}\nأدخل <b>اسم القناة</b> للعرض (أو - لاستخدام @${esc(username)}):`, { parse_mode: "HTML" });
      return true;
    }
    if (state.step === "ch_add_title") {
      const { username } = state.data as { username: string };
      const title = text === "-" ? `@${username}` : text.trim();
      adminConvState.set(userId, { step: "ch_add_link", data: { username, title } });
      await send(`✅ الاسم: ${esc(title)}\nأدخل <b>رابط الدعوة</b> للقناة (https://t.me/...) أو - لاستخدام الرابط العام:`, { parse_mode: "HTML" });
      return true;
    }
    if (state.step === "ch_add_link") {
      const { username, title } = state.data as { username: string; title: string };
      const inviteLink = text === "-" ? `https://t.me/${username}` : text.trim();
      clearState();
      const chRaw = await getSetting("required_channels");
      let channels: { username: string; title: string; inviteLink: string }[] = [];
      try { channels = JSON.parse(chRaw ?? "[]"); } catch { /* ignore */ }

      let verifyNote = "";
      try {
        const botInfo = await bot.getMe();
        const member = await bot.getChatMember(`@${username}`, botInfo.id);
        if (!["administrator", "creator"].includes(member.status)) {
          verifyNote = `\n\n⚠️ <b>ملاحظة:</b> البوت ليس مشرفاً في القناة. اجعله مشرفاً لضمان عمل فحص الاشتراك بشكل صحيح.`;
        }
      } catch {
        verifyNote = `\n\n⚠️ <b>ملاحظة:</b> تعذر التحقق من القناة. تأكد أن البوت عضو أو مشرف في @${esc(username)}.`;
      }

      channels.push({ username, title, inviteLink });
      await setSetting("required_channels", JSON.stringify(channels));
      clearAllSubCache();
      await send(
        `✅ <b>تمت إضافة القناة المطلوبة:</b>\n@${esc(username)} — ${esc(title)}\n\n` +
        `جميع مستخدمي البوت سيُطلب منهم الاشتراك في هذه القناة عند الاستخدام.${verifyNote}`,
        { parse_mode: "HTML" }
      );
      const tmp = await send("جاري التحميل...");
      await showRequiredChannelsMenu(bot, chatId, tmp.message_id);
      return true;
    }

    // ── Add admin: enter @username or ID ──
    if (state.step === "admin_add_id") {
      let targetId: number | null = null;
      let resolvedUsername: string | null = null;

      if (text.startsWith("@")) {
        const uname = text.slice(1);
        try {
          const rows = await db.select({ id: usersTable.id, username: usersTable.username })
            .from(usersTable).where(ilike(usersTable.username, uname)).limit(1);
          if (rows[0]) { targetId = rows[0].id; resolvedUsername = rows[0].username ?? uname; }
        } catch { /**/ }
        if (!targetId) { await send(`❌ لم يتم العثور على مستخدم بالـ يوزرنيم @${esc(uname)}\nيرجى إدخال Telegram ID رقمياً بدلاً منه.`); return true; }
      } else {
        const parsed = parseInt(text);
        if (isNaN(parsed) || parsed <= 0) { await send("❌ أدخل @يوزرنيم أو Telegram ID رقمي صحيح"); return true; }
        targetId = parsed;
        try {
          const rows = await db.select({ username: usersTable.username })
            .from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
          resolvedUsername = rows[0]?.username ?? null;
        } catch { /**/ }
      }

      const label = resolvedUsername ? `@${esc(resolvedUsername)}` : `ID: ${targetId}`;
      adminConvState.set(userId, { step: "admin_add_perms", data: { ...state.data, targetId, resolvedUsername, selectedPerms: [] } });
      await send(`👤 تم التعرف على المستخدم: <b>${label}</b>\n\nاختر الصلاحيات الآن:`, { parse_mode: "HTML" });
      await showAdminPermsEditor(bot, chatId, targetId, [], true);
      return true;
    }

  } catch (err) {
    logger.error({ err }, "Admin text handler error");
    await bot.sendMessage(chatId, "❌ حدث خطأ، يرجى المحاولة مرة أخرى.");
  }

  return false;
}

// Keep for backward compatibility — no longer needed as separate export
export async function handleNewAdminPermsCallback(_bot: TelegramBot, _q: TelegramBot.CallbackQuery): Promise<boolean> {
  return false;
}
