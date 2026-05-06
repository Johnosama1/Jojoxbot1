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

export const OWNER_USERNAME = "J_O_H_N8";

type AdminPermission = "canUnban" | "canWarn" | "canReceiveWithdrawals" | "canEditWheel";

const ALL_PERMS: AdminPermission[] = ["canUnban", "canWarn", "canReceiveWithdrawals", "canEditWheel"];

export const PERM_LABELS: Record<AdminPermission, string> = {
  canUnban:              "🔓 رفع الحظر",
  canWarn:               "⚠️ تحذير المستخدمين",
  canReceiveWithdrawals: "💸 إدارة السحوبات",
  canEditWheel:          "🎡 تعديل العجلة",
};

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
  const opts = { parse_mode: "Markdown" as const, reply_markup: keyboard };
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
    `🎛 *لوحة التحكم — Jo-jokes*\n\n` +
    `👥 المستخدمون: *${usersRes?.c ?? 0}*\n` +
    `💸 طلبات السحب المعلقة: *${pendingRes?.c ?? 0}*\n\n` +
    `اختر من القائمة:`;

  const rows: TelegramBot.InlineKeyboardButton[][] = [];

  // Row 1: Wheel + Tasks (owner only for tasks)
  const row1: TelegramBot.InlineKeyboardButton[] = [];
  if (!info || info.isOwner || hasPerm(info, "canEditWheel"))
    row1.push({ text: "🎡 العجلة", callback_data: "adm:wheel" });
  if (!info || info.isOwner)
    row1.push({ text: "📋 المهام", callback_data: "adm:tasks" });
  if (row1.length) rows.push(row1);

  // Row 2: Users + Withdrawals
  const row2: TelegramBot.InlineKeyboardButton[] = [];
  if (!info || info.isOwner || hasPerm(info, "canUnban") || hasPerm(info, "canWarn"))
    row2.push({ text: "👥 المستخدمون", callback_data: "adm:users" });
  if (!info || info.isOwner || hasPerm(info, "canReceiveWithdrawals"))
    row2.push({ text: "💸 السحوبات", callback_data: "adm:wd" });
  if (row2.length) rows.push(row2);

  // Row 3: Settings + Stats (owner only)
  if (!info || info.isOwner) {
    rows.push([
      { text: "⚙️ الإعدادات", callback_data: "adm:settings" },
      { text: "📊 الإحصائيات", callback_data: "adm:stats" },
    ]);
  }

  // Row 4: Admins management (owner only)
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
  let text = `🎡 *إعدادات العجلة*\n${totalIcon} مجموع النسب: *${total}%* (يجب أن يساوي 100%)\n\n`;
  slots.forEach((s) => {
    const icon = s.probability > 0 ? "🟢" : "⚫";
    text += `${icon} ${parseFloat(s.amount).toFixed(3)} TON — *${s.probability}%*\n`;
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
  let text = "📋 *إدارة المهام*\n\n";
  if (tasks.length === 0) text += "لا توجد مهام بعد.\n";
  else tasks.forEach((t) => { text += `${t.isActive ? "✅" : "❌"} [${t.id}] ${t.title}\n`; });
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
    `👥 *إدارة المستخدمين*\n\n` +
    `إجمالي المستخدمين: *${res?.c ?? 0}*\n\n` +
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
  const safeName = `${u.firstName || "—"} ${u.lastName || ""}`.trim();
  const safeUsername = u.username ? `@${u.username}` : "—";
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

  // Balance & spins — owner only
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

  // Ban/unban — owner can do both; canUnban can only unban
  const banRow: TelegramBot.InlineKeyboardButton[] = [];
  if (info.isOwner) {
    banRow.push(banned
      ? { text: "✅ رفع الحظر", callback_data: `adm:u:unban:${u.id}` }
      : { text: "🚫 حظر المستخدم", callback_data: `adm:u:ban:${u.id}` }
    );
  } else if (hasPerm(info, "canUnban") && banned) {
    banRow.push({ text: "✅ رفع الحظر", callback_data: `adm:u:unban:${u.id}` });
  }

  // Warn — canWarn or owner
  if (hasPerm(info, "canWarn")) {
    banRow.push({ text: "⚠️ تحذير", callback_data: `adm:u:warn:${u.id}` });
  }
  if (banRow.length) rows.push(banRow);

  // Reset verification — owner only
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
    let text = `💸 *طلبات السحب المعلقة*\nمعلق: ${pending.length} | الإجمالي: ${allRes?.c ?? 0}\n\n`;
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
      chList = chs.length === 0 ? "لا توجد قنوات مطلوبة" : chs.map((c, i) => `${i + 1}. ${c.title || `@${c.username}`}`).join("\n");
    } catch { /* ignore */ }
  }
  const text =
    `⚙️ *إعدادات البوت*\n\n` +
    `وضع السحب الحالي: ${modeLabel}\n\n` +
    `*يدوي* ← المالك يوافق يدوياً على كل طلب.\n` +
    `*تلقائي* ← موافقة وتحويل تلقائي.\n\n` +
    `🔒 *القنوات المطلوبة للاشتراك:*\n${chList}`;
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
    : channels.map((c, i) => `${i + 1}. ${c.title || `@${c.username}`} (@${c.username})`).join("\n");

  const text =
    `🔒 *إدارة القنوات المطلوبة*\n\n` +
    `هذه القنوات تصبح *إلزامية* للمستخدمين الذين حصلوا على لفات مجانية منها.\n\n` +
    `*القنوات الحالية:*\n${listText}`;

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

// ─────────────────────────── STATS ───────────────────────────

async function showStats(bot: TelegramBot, chatId: number, messageId?: number) {
  const [users] = await db.select({ c: count() }).from(usersTable);
  const [pending] = await db.select({ c: count() }).from(withdrawalsTable).where(eq(withdrawalsTable.status, "pending"));
  const [approved] = await db.select({ c: count() }).from(withdrawalsTable).where(eq(withdrawalsTable.status, "approved"));
  const [tasks] = await db.select({ c: count() }).from(tasksTable).where(eq(tasksTable.isActive, true));
  const [slots] = await db.select({ c: count() }).from(wheelSlotsTable);
  const text =
    `📊 *الإحصائيات*\n\n` +
    `👥 المستخدمون: *${users?.c ?? 0}*\n` +
    `📋 المهام النشطة: *${tasks?.c ?? 0}*\n` +
    `🎡 خانات العجلة: *${slots?.c ?? 0}*\n` +
    `💸 السحوبات المعلقة: *${pending?.c ?? 0}*\n` +
    `✅ السحوبات الموافق عليها: *${approved?.c ?? 0}*`;
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

  let text = `👮 *إدارة المشرفين*\n\nعدد المشرفين: *${admins.length}*\n\n`;
  if (admins.length === 0) {
    text += "لا يوجد مشرفون مضافون بعد.\n";
  } else {
    for (const a of admins) {
      const name = a.username ? `@${a.username}` : `ID: ${a.id}`;
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
    ? `👮 *إضافة مشرف جديد*\n🆔 ID: \`${targetId}\`\n\nاختر الصلاحيات ثم اضغط تأكيد:`
    : `✏️ *تعديل صلاحيات المشرف*\n🆔 ID: \`${targetId}\`\n\nاختر الصلاحيات ثم اضغط حفظ:`;

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
  // parts[0] = "adm", parts[1] = section, parts[2] = action, ...
  const sec = parts[1];   // "main"|"wheel"|"tasks"|"users"|"wd"|"settings"|"stats"|"admins"|"w"|"t"|"u"|"set"
  const act = parts[2];
  const p1  = parts[3];
  const p2  = parts[4];
  const p3  = parts[5];

  try {
    // ── Main navigation ──
    if (data === "adm:main")     { await showAdminMenu(bot, chatId, msgId, info); return true; }
    if (data === "adm:stats")    { if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; } await showStats(bot, chatId, msgId); return true; }
    if (data === "adm:settings") { if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; } await showSettingsMenu(bot, chatId, msgId); return true; }

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
        await bot.sendMessage(chatId, "🎡 *إضافة خانة جديدة*\n\nأدخل *المبلغ* بـ TON (مثال: `0.5` أو `5`):", { parse_mode: "Markdown" });
      } else if (act === "del" && p1) {
        await db.delete(wheelSlotsTable).where(eq(wheelSlotsTable.id, parseInt(p1)));
        await showWheelMenu(bot, chatId, msgId);
      } else if (act === "e" && p1) {
        const [slot] = await db.select().from(wheelSlotsTable).where(eq(wheelSlotsTable.id, parseInt(p1))).limit(1);
        if (slot) {
          adminConvState.set(userId, { step: "wheel_edit_amount", data: { slotId: parseInt(p1), chatId, msgId } });
          await bot.sendMessage(chatId,
            `✏️ تعديل الخانة *${parseFloat(slot.amount).toFixed(3)} TON*\n\nأدخل المبلغ الجديد (أو - للإبقاء على *${parseFloat(slot.amount).toFixed(3)}*):`,
            { parse_mode: "Markdown" });
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
            `📋 المهمة #${t.id}\n\n${t.icon || "⭐"} ${t.title}\nالوصف: ${t.description || "—"}\nالرابط: ${t.url || "—"}\nالحالة: ${t.isActive ? "✅ نشطة" : "❌ معطلة"}`,
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
        await bot.sendMessage(chatId, "📝 أدخل *عنوان المهمة*:", { parse_mode: "Markdown" });
      }
      return true;
    }

    // ── Users ──
    if (sec === "u") {
      if (!info.isOwner && !hasPerm(info, "canUnban") && !hasPerm(info, "canWarn")) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }

      if (act === "search") {
        adminConvState.set(userId, { step: "user_search", data: {} });
        await bot.sendMessage(chatId, "🔍 أدخل *Telegram ID* أو *@يوزرنيم*:", { parse_mode: "Markdown" });
      } else if (act === "addbal" && p1) {
        if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        adminConvState.set(userId, { step: "user_addbal", data: { targetId: parseInt(p1) } });
        await bot.sendMessage(chatId, `💰 كم تريد *إضافة* لرصيد المستخدم ${p1}؟\n(مثال: 5 أو 0.5)`, { parse_mode: "Markdown" });
      } else if (act === "subbal" && p1) {
        if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        adminConvState.set(userId, { step: "user_subbal", data: { targetId: parseInt(p1) } });
        await bot.sendMessage(chatId, `💸 كم تريد *خصم* من رصيد المستخدم ${p1}؟`, { parse_mode: "Markdown" });
      } else if (act === "bal" && p1) {
        if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        adminConvState.set(userId, { step: "user_balance", data: { targetId: parseInt(p1) } });
        await bot.sendMessage(chatId, `✏️ أدخل الرصيد الجديد للمستخدم ${p1}:`, { parse_mode: "Markdown" });
      } else if (act === "spins" && p1) {
        if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        adminConvState.set(userId, { step: "user_spins", data: { targetId: parseInt(p1) } });
        await bot.sendMessage(chatId, `🎰 أدخل اللفات للمستخدم ${p1}\n(مثال: 10 أو +5 أو -2)`, { parse_mode: "Markdown" });
      } else if (act === "ban" && p1) {
        if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        const targetId = parseInt(p1);
        await db.update(usersTable).set({ isVisible: false }).where(eq(usersTable.id, targetId));
        try { await bot.sendMessage(targetId, "🚫 تم حظر حسابك. تواصل مع الدعم لمزيد من المعلومات."); } catch { /**/ }
        const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
        await bot.sendMessage(chatId, `🚫 تم حظر المستخدم ${u?.firstName || targetId} (${targetId}).`);
      } else if (act === "unban" && p1) {
        if (!info.isOwner && !hasPerm(info, "canUnban")) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        const targetId = parseInt(p1);
        // Unban: restore visibility, auto-verify so user skips verification screen
        await db.update(usersTable).set({
          isVisible: true,
          isBlockedForLeaving: false,
          ipVerifiedAt: new Date(),
          verificationToken: null,
        }).where(eq(usersTable.id, targetId));
        try { await bot.sendMessage(targetId, "✅ تم رفع الحظر عن حسابك. يمكنك الاستخدام الآن! 🎉"); } catch { /**/ }
        const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
        await bot.sendMessage(chatId, `✅ تم رفع الحظر عن المستخدم ${u?.firstName || targetId} (${targetId}) — يمكنه الاستخدام مباشرة بدون إعادة تحقق.`);
      } else if (act === "warn" && p1) {
        if (!info.isOwner && !hasPerm(info, "canWarn")) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        adminConvState.set(userId, { step: "user_warn", data: { targetId: parseInt(p1) } });
        await bot.sendMessage(chatId, "⚠️ أدخل نص التحذير الذي سيُرسل للمستخدم:");
      } else if (act === "resetv" && p1) {
        if (!info.isOwner) { await bot.sendMessage(chatId, "⛔ ليس لديك صلاحية"); return true; }
        const targetId = parseInt(p1);
        await db.update(usersTable).set({ ipVerifiedAt: null, deviceId: null, verificationToken: null }).where(eq(usersTable.id, targetId));
        const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
        await bot.sendMessage(chatId, `🔄 تمت إعادة التحقق للمستخدم ${u?.firstName || targetId} (${targetId}).`);
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
            `💸 *طلب سحب #${w.id}*\n\n👤 ${u?.firstName || "—"} @${u?.username || "—"}\n🆔 ${w.userId}\n💰 *${parseFloat(w.amount).toFixed(4)} TON*\n📍 ${w.walletAddress}\nالحالة: *${w.status}*`,
            {
              chat_id: chatId, message_id: msgId, parse_mode: "Markdown",
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

      // Required channels sub-menu
      if (act === "channels") { await showRequiredChannelsMenu(bot, chatId, msgId); return true; }

      if (act === "ch") {
        if (p1 === "add") {
          adminConvState.set(userId, { step: "ch_add_username", data: {} });
          await bot.sendMessage(chatId, "📢 *إضافة قناة مطلوبة*\n\nأدخل @يوزرنيم القناة:", { parse_mode: "Markdown" });
          return true;
        }
        if (p1 === "del" && p2 !== undefined) {
          const idx = parseInt(p2);
          const chRaw = await getSetting("required_channels");
          let channels: { username: string; title: string; inviteLink: string }[] = [];
          try { channels = JSON.parse(chRaw ?? "[]"); } catch { /* ignore */ }
          channels.splice(idx, 1);
          await setSetting("required_channels", JSON.stringify(channels));
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
        await bot.sendMessage(chatId, "👮 *إضافة مشرف جديد*\n\nأدخل *@يوزرنيم* أو *Telegram ID* للمستخدم:", { parse_mode: "Markdown" });
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
        // p1 = targetId, p2 = permission, p3 = "1" (new) or "0" (edit)
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

        // Look up username from our DB (no external Telegram API call)
        let tgUsername: string | null = null;
        try {
          const rows = await db.select({ username: usersTable.username })
            .from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
          tgUsername = rows[0]?.username ?? null;
        } catch { /* ignore — username is optional */ }

        // Use raw SQL to avoid any ORM serialization issues with JSONB
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
        const nameStr = tgUsername ? ` (@${tgUsername})` : "";
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
    try { await bot.sendMessage(chatId, `❌ خطأ: ${errDetail}`); } catch { /**/ }
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
    await bot.sendMessage(chatId, `✅ تمت إضافة المهمة: *${title}* (مع صورة مخصصة 🖼)`, { parse_mode: "Markdown" });
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
      await send(`💡 المبلغ: *${amount} TON*\nأدخل الآن *النسبة* (0–100):`, { parse_mode: "Markdown" });
      return true;
    }
    if (state.step === "wheel_add_prob") {
      const prob = parseInt(text);
      if (isNaN(prob) || prob < 0 || prob > 100) { await send("❌ أدخل رقماً بين 0 و100"); return true; }
      const { amount } = state.data as { amount: number };
      const [maxOrder] = await db.select({ m: sql<number>`max(display_order)` }).from(wheelSlotsTable);
      await db.insert(wheelSlotsTable).values({ amount: String(amount), probability: prob, displayOrder: ((maxOrder?.m as number) || 0) + 1 });
      clearState();
      await send(`✅ تمت إضافة الخانة: *${amount} TON* بنسبة *${prob}%*`, { parse_mode: "Markdown" });
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
      await send(`💡 المبلغ: *${newAmount} TON*\nأدخل النسبة الجديدة (0–100) أو - للإبقاء على *${slot.probability}%*:`, { parse_mode: "Markdown" });
      return true;
    }
    if (state.step === "wheel_edit_prob") {
      const { slotId, newAmount } = state.data as { slotId: number; newAmount: number };
      const [slot] = await db.select().from(wheelSlotsTable).where(eq(wheelSlotsTable.id, slotId)).limit(1);
      const newProb = text === "-" ? slot.probability : parseInt(text);
      if (isNaN(newProb) || newProb < 0 || newProb > 100) { await send("❌ أدخل رقماً بين 0 و100، أو - للإبقاء"); return true; }
      await db.update(wheelSlotsTable).set({ amount: String(newAmount), probability: newProb }).where(eq(wheelSlotsTable.id, slotId));
      clearState();
      await send(`✅ تم التحديث: *${newAmount} TON* — *${newProb}%*`, { parse_mode: "Markdown" });
      const tmp = await send("جاري التحميل...");
      await showWheelMenu(bot, chatId, tmp.message_id);
      return true;
    }

    // ── Task flow ──
    if (state.step === "task_title") {
      adminConvState.set(userId, { step: "task_desc", data: { ...state.data, title: text } });
      await send("📝 أدخل *وصف المهمة* (أو - للتخطي):", { parse_mode: "Markdown" });
      return true;
    }
    if (state.step === "task_desc") {
      adminConvState.set(userId, { step: "task_url", data: { ...state.data, description: text === "-" ? null : text } });
      await send("🔗 أدخل *رابط المهمة* (مثال: https://t.me/...) أو -:", { parse_mode: "Markdown" });
      return true;
    }
    if (state.step === "task_url") {
      adminConvState.set(userId, { step: "task_icon", data: { ...state.data, url: text === "-" ? null : text } });
      await send("🖼 أرسل *صورة القناة* (أو *إيموجي* أو - للتخطي):", { parse_mode: "Markdown" });
      return true;
    }
    if (state.step === "task_icon") {
      const { title, description, url } = state.data as { title: string; description: string | null; url: string | null };
      const icon = text === "-" ? "⭐" : text;
      let channelPhotoUrl: string | null = null;
      if (url) { const m = url.match(/t\.me\/([A-Za-z0-9_]+)/); if (m) { try { channelPhotoUrl = await getChannelPhotoUrl(bot, m[1]); } catch { /**/ } } }
      await db.insert(tasksTable).values({ title, description, url, icon, channelPhotoUrl, isActive: true });
      clearState();
      await send(`✅ تمت إضافة المهمة: *${title}*${channelPhotoUrl ? " (تم جلب صورة القناة ✅)" : ""}`, { parse_mode: "Markdown" });
      const tmp = await send("جاري التحميل...");
      await showTasksMenu(bot, chatId, tmp.message_id);
      return true;
    }

    // ── User search ──
    if (state.step === "user_search") {
      clearState();
      const info = await getAdminInfo(userId, undefined);
      if (!info) return false;
      let u: typeof usersTable.$inferSelect | undefined;
      if (text.startsWith("@")) {
        const uname = text.replace("@", "");
        u = (await db.select().from(usersTable).where(ilike(usersTable.username, uname)).limit(1))[0];
      } else {
        const targetId = parseInt(text);
        if (isNaN(targetId)) { await send("❌ أدخل ID رقمي صحيح أو @يوزرنيم"); return true; }
        u = (await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1))[0];
      }
      if (!u) { await send("❌ لم يتم العثور على مستخدم بهذا المعرف"); return true; }
      await showUserCard(bot, chatId, u, info);
      return true;
    }

    // ── User warn ──
    if (state.step === "user_warn") {
      const { targetId } = state.data as { targetId: number };
      clearState();
      try { await bot.sendMessage(targetId, `⚠️ *تحذير من الإدارة:*\n\n${text}`, { parse_mode: "Markdown" }); } catch { /**/ }
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
      await send(`✅ تمت إضافة *${val} TON* للمستخدم ${targetId}\nالرصيد الجديد: *${parseFloat(u.balance).toFixed(4)} TON*`, { parse_mode: "Markdown" });
      try { await bot.sendMessage(targetId, `💰 تمت إضافة *${val} TON* لرصيدك!\nرصيدك الحالي: *${parseFloat(u.balance).toFixed(4)} TON*`, { parse_mode: "Markdown" }); } catch { /**/ }
      return true;
    }
    if (state.step === "user_subbal") {
      const { targetId } = state.data as { targetId: number };
      clearState();
      const val = parseFloat(text);
      if (isNaN(val) || val <= 0) { await send("❌ أدخل قيمة موجبة صحيحة"); return true; }
      await db.update(usersTable).set({ balance: sql`GREATEST(balance - ${val}, 0)` }).where(eq(usersTable.id, targetId));
      const [u] = await db.select().from(usersTable).where(eq(usersTable.id, targetId)).limit(1);
      await send(`✅ تم خصم *${val} TON* من المستخدم ${targetId}\nالرصيد الجديد: *${parseFloat(u.balance).toFixed(4)} TON*`, { parse_mode: "Markdown" });
      try { await bot.sendMessage(targetId, `📉 تم خصم *${val} TON* من رصيدك.\nرصيدك الحالي: *${parseFloat(u.balance).toFixed(4)} TON*`, { parse_mode: "Markdown" }); } catch { /**/ }
      return true;
    }
    if (state.step === "user_balance") {
      const { targetId } = state.data as { targetId: number };
      clearState();
      const val = parseFloat(text);
      if (isNaN(val) || val < 0) { await send("❌ أدخل قيمة صحيحة (0 أو أكبر)"); return true; }
      await db.update(usersTable).set({ balance: String(val) }).where(eq(usersTable.id, targetId));
      await send(`✅ تم تحديد رصيد المستخدم ${targetId} إلى *${val} TON*`, { parse_mode: "Markdown" });
      try { await bot.sendMessage(targetId, `💰 تم تحديث رصيدك إلى *${val} TON*`, { parse_mode: "Markdown" }); } catch { /**/ }
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
      await send(`✅ اللفات الجديدة للمستخدم ${targetId}: *${u.spins}*`, { parse_mode: "Markdown" });
      if (Math.abs(val) > 0) {
        try { await bot.sendMessage(targetId, `🎰 تمت إضافة *${Math.abs(val)} لفة* لحسابك!\nلفاتك الحالية: *${u.spins}*`, { parse_mode: "Markdown" }); } catch { /**/ }
      }
      return true;
    }

    // ── Required channel: add username ──
    if (state.step === "ch_add_username") {
      const username = text.replace(/^@/, "").trim();
      if (!username) { await send("❌ يوزرنيم غير صحيح"); return true; }
      adminConvState.set(userId, { step: "ch_add_title", data: { username } });
      await send(`✅ القناة: @${username}\nأدخل *اسم القناة* للعرض (أو - لاستخدام @${username}):`, { parse_mode: "Markdown" });
      return true;
    }
    if (state.step === "ch_add_title") {
      const { username } = state.data as { username: string };
      const title = text === "-" ? `@${username}` : text.trim();
      adminConvState.set(userId, { step: "ch_add_link", data: { username, title } });
      await send(`✅ الاسم: ${title}\nأدخل *رابط الدعوة* للقناة (https://t.me/...) أو - لاستخدام الرابط العام:`, { parse_mode: "Markdown" });
      return true;
    }
    if (state.step === "ch_add_link") {
      const { username, title } = state.data as { username: string; title: string };
      const inviteLink = text === "-" ? `https://t.me/${username}` : text.trim();
      clearState();
      const chRaw = await getSetting("required_channels");
      let channels: { username: string; title: string; inviteLink: string }[] = [];
      try { channels = JSON.parse(chRaw ?? "[]"); } catch { /* ignore */ }
      channels.push({ username, title, inviteLink });
      await setSetting("required_channels", JSON.stringify(channels));
      await send(`✅ *تمت إضافة القناة المطلوبة:*\n@${username} — ${title}\n\nالمستخدمون الذين سبق أن حصلوا على مكافآت سيُطلب منهم البقاء مشتركين.`, { parse_mode: "Markdown" });
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
        if (!targetId) { await send(`❌ لم يتم العثور على مستخدم بالـ يوزرنيم @${uname}\nيرجى إدخال Telegram ID رقمياً بدلاً منه.`); return true; }
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

      const label = resolvedUsername ? `@${resolvedUsername}` : `ID: ${targetId}`;
      adminConvState.set(userId, { step: "admin_add_perms", data: { ...state.data, targetId, resolvedUsername, selectedPerms: [] } });
      await send(`👤 تم التعرف على المستخدم: *${label}*\n\nاختر الصلاحيات الآن:`, { parse_mode: "Markdown" });
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
