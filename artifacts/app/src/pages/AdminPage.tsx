import { useState, useEffect, useCallback } from "react";
import { useUser } from "../lib/userContext";
import { api, Task, WheelSlot, User, AdminUser, SubscriptionChannel, Withdrawal, AuditResult } from "../lib/api";
import {
  Shield, Plus, Trash2, Power, PowerOff, RefreshCw,
  Radio, Cog, Users, LayoutDashboard, ListChecks, Sliders,
  AlertTriangle, CheckCircle, XCircle, Ban, Search, ChevronDown, ChevronUp, Clock
} from "lucide-react";

type Tab = "overview" | "channels" | "tasks" | "wheel" | "users" | "settings" | "withdrawals";

export default function AdminPage() {
  const { user, isAdmin } = useUser();
  const [tab, setTab] = useState<Tab>("overview");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [wheelSlots, setWheelSlots] = useState<WheelSlot[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [requiredChannels, setRequiredChannels] = useState<SubscriptionChannel[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [auditingId, setAuditingId] = useState<number | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; type: "ok" | "err" } | null>(null);

  // Channel form state
  const [chUsername, setChUsername] = useState("");
  const [chTitle, setChTitle] = useState("");
  const [chLink, setChLink] = useState("");

  const flash = (text: string, type: "ok" | "err" = "ok") => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3500);
  };

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [t, w, u, s, wds] = await Promise.all([
        api.adminGetTasks(user.id),
        api.adminGetWheel(user.id),
        api.adminGetUsers(user.id),
        api.adminGetSettings(user.id),
        api.adminGetWithdrawals(user.id),
      ]);
      setTasks(t);
      setWheelSlots(w);
      setUsers(u);
      setSettings(s);
      setWithdrawals(wds.slice().reverse());
      try {
        setRequiredChannels(s["required_channels"] ? JSON.parse(s["required_channels"]) : []);
      } catch {
        setRequiredChannels([]);
      }
    } catch {
      flash("خطأ في تحميل البيانات", "err");
    } finally {
      setLoading(false);
    }
  }, [user]);

  const openAudit = async (wdId: number) => {
    if (!user) return;
    if (auditingId === wdId) { setAuditingId(null); setAuditResult(null); return; }
    setAuditingId(wdId);
    setAuditResult(null);
    setAuditLoading(true);
    try {
      const result = await api.adminAuditWithdrawal(user.id, wdId);
      setAuditResult(result);
    } catch {
      flash("فشل تحميل التحليل", "err");
      setAuditingId(null);
    } finally {
      setAuditLoading(false);
    }
  };

  const handleWithdrawalAction = async (wdId: number, action: "approve" | "reject") => {
    if (!user || actionLoading) return;
    setActionLoading(true);
    try {
      await api.adminUpdateWithdrawal(user.id, wdId, action);
      flash(action === "approve" ? "تم قبول طلب السحب ✅" : "تم رفض طلب السحب ✅");
      setAuditingId(null);
      setAuditResult(null);
      const wds = await api.adminGetWithdrawals(user.id);
      setWithdrawals(wds.slice().reverse());
    } catch {
      flash("فشل تنفيذ الإجراء", "err");
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetVerification = async (userId: number) => {
    if (!user || actionLoading) return;
    setActionLoading(true);
    try {
      await api.adminResetVerification(user.id, userId);
      flash("تم إعادة التحقق — سيُعاد فحص الجهاز في المرة القادمة ✅");
      if (auditResult) {
        setAuditResult(prev => prev ? {
          ...prev,
          stats: { ...prev.stats, isDeviceVerified: false },
        } : null);
      }
    } catch {
      flash("فشل إعادة التحقق", "err");
    } finally {
      setActionLoading(false);
    }
  };

  const handleBanUser = async (userId: number, banned: boolean) => {
    if (!user || actionLoading) return;
    setActionLoading(true);
    try {
      await api.adminBanUser(user.id, userId, banned);
      flash(banned ? "تم حظر المستخدم ✅" : "تم رفع الحظر ✅");
      if (auditResult) {
        setAuditResult(prev => prev ? {
          ...prev,
          user: { ...prev.user, isVisible: banned ? false : true },
          stats: { ...prev.stats, isBanned: banned },
        } : null);
      }
      const [wds, us] = await Promise.all([
        api.adminGetWithdrawals(user.id),
        api.adminGetUsers(user.id),
      ]);
      setWithdrawals(wds.slice().reverse());
      setUsers(us);
    } catch {
      flash("فشل تنفيذ الإجراء", "err");
    } finally {
      setActionLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin, loadData]);

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center page-content px-4">
        <Shield size={60} className="text-red-500 mb-4" />
        <h2 className="text-xl font-black text-red-400">ممنوع الوصول</h2>
        <p className="text-purple-400 text-sm mt-2 text-center">هذه الصفحة للأدمن فقط</p>
      </div>
    );
  }

  const saveSetting = async (key: string, value: string) => {
    if (!user || saving) return;
    setSaving(true);
    try {
      await api.adminUpdateSetting(user.id, key, value);
      setSettings((prev) => ({ ...prev, [key]: value }));
      flash("تم الحفظ بنجاح ✓");
    } catch {
      flash("فشل الحفظ", "err");
    } finally {
      setSaving(false);
    }
  };

  const saveChannels = async (channels: SubscriptionChannel[]) => {
    setRequiredChannels(channels);
    await saveSetting("required_channels", JSON.stringify(channels));
  };

  const addChannel = async () => {
    const username = chUsername.replace(/^@/, "").trim();
    if (!username) { flash("أدخل يوزرنيم القناة", "err"); return; }
    const newCh: SubscriptionChannel = {
      username,
      title: chTitle.trim() || `@${username}`,
      inviteLink: chLink.trim() || `https://t.me/${username}`,
    };
    const next = [...requiredChannels, newCh];
    setChUsername(""); setChTitle(""); setChLink("");
    await saveChannels(next);
  };

  const removeChannel = async (idx: number) => {
    await saveChannels(requiredChannels.filter((_, i) => i !== idx));
  };

  const botEnabled = settings["bot_enabled"] !== "false";
  const showUserCount = settings["show_user_count"] === "true";
  const totalProbability = wheelSlots.reduce((s, r) => s + (r.probability || 0), 0);

  const pendingWithdrawalsCount = withdrawals.filter(w => w.status === "pending").length;

  const TABS: { id: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "overview", label: "نظرة عامة", icon: <LayoutDashboard size={15} /> },
    { id: "channels", label: "القنوات", icon: <Radio size={15} /> },
    { id: "tasks", label: "المهام", icon: <ListChecks size={15} /> },
    { id: "wheel", label: "العجلة", icon: <Sliders size={15} /> },
    { id: "users", label: "المستخدمون", icon: <Users size={15} /> },
    { id: "withdrawals", label: "السحوبات", icon: <Search size={15} />, badge: pendingWithdrawalsCount },
    { id: "settings", label: "الإعدادات", icon: <Cog size={15} /> },
  ];

  return (
    <div className="min-h-screen page-content" dir="rtl">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={22} className="text-yellow-400" />
          <h1 className="text-xl font-black gold-text">لوحة التحكم</h1>
        </div>
        <button
          onClick={() => loadData()}
          disabled={loading}
          className="p-2 rounded-xl bg-purple-900/40 text-purple-300 active:scale-95 transition-transform"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Flash message */}
      {msg && (
        <div className={`mx-4 mb-3 rounded-xl px-3 py-2 text-sm ${msg.type === "ok" ? "bg-green-900/30 border border-green-700/50 text-green-400" : "bg-red-900/30 border border-red-700/50 text-red-400"}`}>
          {msg.text}
        </div>
      )}

      {/* Tab bar */}
      <div className="px-4 mb-4">
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                tab === t.id
                  ? "bg-yellow-400 text-black"
                  : "bg-purple-900/40 text-purple-300"
              }`}
            >
              {t.icon}
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span className={`absolute -top-1 -left-1 w-4 h-4 rounded-full text-[10px] font-black flex items-center justify-center ${tab === t.id ? "bg-red-600 text-white" : "bg-red-500 text-white"}`}>
                  {t.badge > 9 ? "9+" : t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw size={28} className="animate-spin text-yellow-400" />
          </div>
        ) : (
          <>
            {/* ─── OVERVIEW ─── */}
            {tab === "overview" && (
              <div className="space-y-4">
                {/* Bot control */}
                <div className={`rounded-2xl p-4 border ${botEnabled ? "bg-green-900/20 border-green-700/40" : "bg-red-900/20 border-red-700/40"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="font-bold text-white">حالة البوت</h3>
                      <p className={`text-sm mt-0.5 ${botEnabled ? "text-green-400" : "text-red-400"}`}>
                        {botEnabled ? "🟢 يعمل بشكل طبيعي" : "🔴 وضع الصيانة مفعّل"}
                      </p>
                    </div>
                    <button
                      disabled={saving}
                      onClick={() => saveSetting("bot_enabled", botEnabled ? "false" : "true")}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm text-black transition-all active:scale-95 ${botEnabled ? "bg-red-400" : "bg-green-400"}`}
                    >
                      {botEnabled ? <PowerOff size={15} /> : <Power size={15} />}
                      {botEnabled ? "إيقاف" : "تشغيل"}
                    </button>
                  </div>
                  {!botEnabled && (
                    <p className="text-red-300 text-xs mt-2">
                      ⚠️ المستخدمون لا يمكنهم استخدام البوت الآن. سيرون رسالة صيانة.
                    </p>
                  )}
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "إجمالي المستخدمين", value: users.length, color: "text-blue-300" },
                    { label: "المهام النشطة", value: tasks.filter((t) => t.isActive).length, color: "text-green-300" },
                    { label: "خانات العجلة", value: wheelSlots.length, color: "text-yellow-300" },
                    { label: "القنوات الإجبارية", value: requiredChannels.length, color: "text-purple-300" },
                  ].map((s) => (
                    <div key={s.label} className="bg-purple-900/30 border border-purple-700/40 rounded-2xl p-4">
                      <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                      <p className="text-purple-400 text-xs mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* Wheel probability indicator */}
                <div className="bg-purple-900/30 border border-purple-700/40 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-white text-sm">مجموع نسب العجلة</h3>
                    <span className={`font-black text-lg ${totalProbability === 100 ? "text-green-400" : totalProbability > 100 ? "text-red-400" : "text-yellow-400"}`}>
                      {totalProbability}%
                    </span>
                  </div>
                  <div className="w-full bg-purple-800/50 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${totalProbability === 100 ? "bg-green-400" : totalProbability > 100 ? "bg-red-400" : "bg-yellow-400"}`}
                      style={{ width: `${Math.min(totalProbability, 100)}%` }}
                    />
                  </div>
                  <p className={`text-xs mt-1.5 ${totalProbability === 100 ? "text-green-400" : "text-yellow-400"}`}>
                    {totalProbability === 100 ? "✅ الإعداد مثالي" : totalProbability > 100 ? "⚠️ تجاوز 100% — يرجى التعديل" : "⚠️ المجموع أقل من 100%"}
                  </p>
                </div>

                {/* Required channels quick view */}
                {requiredChannels.length > 0 && (
                  <div className="bg-purple-900/30 border border-purple-700/40 rounded-2xl p-4">
                    <h3 className="font-bold text-white text-sm mb-2">القنوات الإجبارية</h3>
                    <div className="space-y-1.5">
                      {requiredChannels.map((ch, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-purple-300">
                          <Radio size={11} className="text-yellow-400 shrink-0" />
                          <span>{ch.title || `@${ch.username}`}</span>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setTab("channels")} className="mt-2 text-yellow-400 text-xs font-bold">
                      إدارة القنوات ←
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ─── CHANNELS ─── */}
            {tab === "channels" && (
              <div className="space-y-4">
                <div className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Radio size={16} className="text-yellow-400" />
                    <h2 className="font-bold text-white">القنوات الإجبارية</h2>
                  </div>
                  <p className="text-purple-400 text-xs mb-4">
                    يجب على كل مستخدم (جديد أو قديم) الاشتراك في هذه القنوات لاستخدام البوت.
                  </p>

                  {requiredChannels.length === 0 ? (
                    <div className="bg-purple-900/30 rounded-xl p-4 text-center mb-4">
                      <Radio size={24} className="text-purple-600 mx-auto mb-1" />
                      <p className="text-purple-400 text-sm">لا توجد قنوات مطلوبة حالياً.</p>
                      <p className="text-purple-500 text-xs mt-1">المستخدمون يمكنهم الاستخدام بدون قيود.</p>
                    </div>
                  ) : (
                    <div className="space-y-2 mb-4">
                      {requiredChannels.map((ch, i) => (
                        <div
                          key={i}
                          className="bg-black/20 border border-purple-700/30 rounded-xl p-3 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <p className="text-white font-bold text-sm truncate">{ch.title}</p>
                            <p className="text-purple-400 text-xs">@{ch.username}</p>
                            {ch.inviteLink && (
                              <p className="text-purple-500 text-xs truncate">{ch.inviteLink}</p>
                            )}
                          </div>
                          <button
                            onClick={() => removeChannel(i)}
                            disabled={saving}
                            className="shrink-0 p-2 rounded-xl bg-red-900/30 text-red-400 active:scale-90 transition-transform"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add channel form */}
                  <div className="border-t border-purple-700/30 pt-4">
                    <p className="text-white font-bold text-sm mb-3 flex items-center gap-1.5">
                      <Plus size={15} className="text-yellow-400" />
                      إضافة قناة جديدة
                    </p>
                    <div className="space-y-2">
                      <input
                        className="w-full bg-black/30 border border-purple-700/50 rounded-xl px-3 py-2 text-white text-sm placeholder-purple-600 focus:outline-none focus:border-yellow-400/50"
                        value={chUsername}
                        onChange={(e) => setChUsername(e.target.value)}
                        placeholder="@channel_username"
                        dir="ltr"
                      />
                      <input
                        className="w-full bg-black/30 border border-purple-700/50 rounded-xl px-3 py-2 text-white text-sm placeholder-purple-600 focus:outline-none focus:border-yellow-400/50"
                        value={chTitle}
                        onChange={(e) => setChTitle(e.target.value)}
                        placeholder="اسم القناة للعرض"
                      />
                      <input
                        className="w-full bg-black/30 border border-purple-700/50 rounded-xl px-3 py-2 text-white text-sm placeholder-purple-600 focus:outline-none focus:border-yellow-400/50"
                        value={chLink}
                        onChange={(e) => setChLink(e.target.value)}
                        placeholder="رابط الدعوة (اختياري)"
                        dir="ltr"
                      />
                      <button
                        onClick={addChannel}
                        disabled={saving || !chUsername.trim()}
                        className="w-full py-2.5 rounded-xl font-bold text-black text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50"
                        style={{ background: "linear-gradient(135deg, #ffd700, #ffaa00)" }}
                      >
                        <Plus size={16} />
                        {saving ? "جارٍ الحفظ..." : "إضافة القناة"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ─── TASKS ─── */}
            {tab === "tasks" && (
              <div className="space-y-3">
                {tasks.length === 0 ? (
                  <div className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-6 text-center">
                    <ListChecks size={32} className="text-purple-600 mx-auto mb-2" />
                    <p className="text-purple-400 text-sm">لا توجد مهام بعد.</p>
                    <p className="text-purple-500 text-xs mt-1">أضف المهام من بوت الأدمن في Telegram.</p>
                  </div>
                ) : tasks.map((task) => (
                  <div key={task.id} className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-4 flex items-center gap-3">
                    {task.channelPhotoUrl ? (
                      <img src={task.channelPhotoUrl} alt="" className="w-10 h-10 rounded-full object-cover shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-purple-800/50 flex items-center justify-center text-xl shrink-0">
                        {task.icon || "⭐"}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-white font-bold text-sm truncate">{task.title}</p>
                      {task.description && <p className="text-purple-400 text-xs truncate">{task.description}</p>}
                    </div>
                    <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${task.isActive ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}`}>
                      {task.isActive ? "نشط" : "معطل"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* ─── WHEEL ─── */}
            {tab === "wheel" && (
              <div className="space-y-3">
                <div className={`rounded-2xl p-3 border text-center ${totalProbability === 100 ? "bg-green-900/20 border-green-700/40" : "bg-yellow-900/20 border-yellow-700/40"}`}>
                  <span className={`font-black text-lg ${totalProbability === 100 ? "text-green-400" : "text-yellow-400"}`}>
                    المجموع: {totalProbability}%
                  </span>
                  <p className={`text-xs mt-0.5 ${totalProbability === 100 ? "text-green-400" : "text-yellow-400"}`}>
                    {totalProbability === 100 ? "✅ مثالي" : "⚠️ يجب أن يساوي 100%"}
                  </p>
                </div>
                {wheelSlots.length === 0 ? (
                  <div className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-6 text-center">
                    <p className="text-purple-400 text-sm">لا توجد خانات في العجلة.</p>
                  </div>
                ) : wheelSlots.map((slot) => (
                  <div key={slot.id} className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-4 flex items-center justify-between">
                    <div>
                      <p className="text-white font-black">{parseFloat(String(slot.amount)).toFixed(3)} TON</p>
                      <p className="text-purple-400 text-xs">الاحتمالية: {slot.probability}%</p>
                    </div>
                    <div className="w-16 bg-purple-800/50 rounded-full h-2">
                      <div
                        className="h-2 rounded-full bg-yellow-400"
                        style={{ width: `${Math.min(slot.probability, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ─── USERS ─── */}
            {tab === "users" && (
              <div className="space-y-3">
                <div className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-3 flex items-center justify-between">
                  <span className="text-white font-bold">إجمالي المستخدمين</span>
                  <span className="text-yellow-400 font-black text-xl">{users.length}</span>
                </div>
                <div className="space-y-2">
                  {users.slice(0, 50).map((u) => (
                    <div key={u.id} className="bg-purple-900/20 border border-purple-700/40 rounded-xl p-3 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-purple-800/60 flex items-center justify-center text-sm font-black text-purple-300 shrink-0">
                        {u.firstName?.charAt(0) || "?"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm font-bold truncate">
                          {u.firstName} {u.lastName}
                          {u.username && <span className="text-purple-400 font-normal"> @{u.username}</span>}
                        </p>
                        <p className="text-purple-500 text-xs">{parseFloat(String(u.balance)).toFixed(3)} TON · {u.spins} لفات</p>
                      </div>
                      {u.isVisible === false && (
                        <span className="text-red-400 text-xs font-bold shrink-0">محظور</span>
                      )}
                    </div>
                  ))}
                  {users.length > 50 && (
                    <p className="text-purple-500 text-xs text-center">عرض أول 50 مستخدم فقط.</p>
                  )}
                </div>
              </div>
            )}

            {/* ─── WITHDRAWALS ─── */}
            {tab === "withdrawals" && (
              <div className="space-y-3">
                {/* Summary */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "معلق", value: withdrawals.filter(w => w.status === "pending").length, color: "text-yellow-400" },
                    { label: "مقبول", value: withdrawals.filter(w => w.status === "approved").length, color: "text-green-400" },
                    { label: "مرفوض", value: withdrawals.filter(w => w.status === "rejected").length, color: "text-red-400" },
                  ].map(s => (
                    <div key={s.label} className="bg-purple-900/30 border border-purple-700/40 rounded-xl p-3 text-center">
                      <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
                      <p className="text-purple-400 text-xs">{s.label}</p>
                    </div>
                  ))}
                </div>

                {withdrawals.length === 0 ? (
                  <div className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-8 text-center">
                    <Clock size={32} className="text-purple-600 mx-auto mb-2" />
                    <p className="text-purple-400 text-sm">لا توجد طلبات سحب بعد</p>
                  </div>
                ) : withdrawals.map((wd) => {
                  const isPending = wd.status === "pending";
                  const isExpanded = auditingId === wd.id;
                  const statusColor = wd.status === "approved" ? "text-green-400 bg-green-900/30 border-green-700/40"
                    : wd.status === "rejected" ? "text-red-400 bg-red-900/30 border-red-700/40"
                    : "text-yellow-400 bg-yellow-900/20 border-yellow-700/40";
                  const statusLabel = wd.status === "approved" ? "مقبول" : wd.status === "rejected" ? "مرفوض" : "معلق";

                  return (
                    <div key={wd.id} className={`rounded-2xl border overflow-hidden ${isPending ? "border-yellow-700/40 bg-yellow-900/10" : "border-purple-700/30 bg-purple-900/20"}`}>
                      {/* Withdrawal card header */}
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-white font-bold text-sm">طلب سحب #{wd.id}</p>
                            <p className="text-purple-400 text-xs">المستخدم: {wd.userId}</p>
                            <p className="text-xs text-purple-500 mt-0.5">{new Date(wd.createdAt).toLocaleString("ar-SA")}</p>
                          </div>
                          <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full border ${statusColor}`}>{statusLabel}</span>
                        </div>
                        <div className="bg-black/20 rounded-xl p-2.5 mb-3">
                          <p className="text-yellow-400 font-black text-lg">{parseFloat(wd.amount).toFixed(4)} TON</p>
                          <p className="text-purple-400 text-xs font-mono truncate" dir="ltr">{wd.walletAddress}</p>
                        </div>

                        {/* Audit toggle button */}
                        <button
                          onClick={() => openAudit(wd.id)}
                          className={`w-full py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 ${isExpanded ? "bg-purple-700/60 text-purple-200" : "bg-purple-800/60 text-purple-300"}`}
                        >
                          <Shield size={13} />
                          {isExpanded ? "إخفاء تحليل الاحتيال" : "تحليل الاحتيال"}
                          {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>
                      </div>

                      {/* Audit panel */}
                      {isExpanded && (
                        <div className="border-t border-purple-700/30 bg-black/20 p-4 space-y-4">
                          {auditLoading ? (
                            <div className="flex items-center justify-center py-6">
                              <RefreshCw size={22} className="animate-spin text-yellow-400" />
                              <span className="text-purple-400 text-sm mr-2">جارٍ تحليل نشاط المستخدم...</span>
                            </div>
                          ) : auditResult && auditResult.withdrawal.id === wd.id ? (
                            <>
                              {/* Risk Score Gauge */}
                              <div className="bg-purple-900/40 rounded-2xl p-4 text-center">
                                <p className="text-purple-400 text-xs mb-2">درجة الخطورة</p>
                                <div className="relative w-28 h-28 mx-auto">
                                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                                    <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(88,28,135,0.4)" strokeWidth="12" />
                                    <circle
                                      cx="50" cy="50" r="40" fill="none"
                                      stroke={auditResult.riskScore >= 70 ? "#ef4444" : auditResult.riskScore >= 40 ? "#f59e0b" : "#22c55e"}
                                      strokeWidth="12"
                                      strokeDasharray={`${(auditResult.riskScore / 100) * 251} 251`}
                                      strokeLinecap="round"
                                    />
                                  </svg>
                                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className={`text-2xl font-black ${auditResult.riskScore >= 70 ? "text-red-400" : auditResult.riskScore >= 40 ? "text-yellow-400" : "text-green-400"}`}>
                                      {auditResult.riskScore}
                                    </span>
                                    <span className="text-purple-400 text-[10px]">/ 100</span>
                                  </div>
                                </div>
                                <p className={`text-sm font-black mt-1 ${auditResult.riskScore >= 70 ? "text-red-400" : auditResult.riskScore >= 40 ? "text-yellow-400" : "text-green-400"}`}>
                                  {auditResult.riskScore >= 70 ? "⚠️ خطير جداً — احتمال احتيال" : auditResult.riskScore >= 40 ? "⚠️ مشبوه — يحتاج مراجعة" : "✅ آمن — مستخدم عادي"}
                                </p>
                              </div>

                              {/* User stats */}
                              <div className="grid grid-cols-2 gap-2">
                                {[
                                  ...(auditResult.stats.ipSuspicious ? [{ label: "🚨 IP مكرر", value: "نفس IP من حساب آخر" }] : []),
                                  { label: "رصيد USDT", value: `${parseFloat(auditResult.stats.balance).toFixed(3)}` },
                                  { label: "رصيد TON", value: `${parseFloat(auditResult.stats.tonBalance).toFixed(4)}` },
                                  { label: "عمر الحساب", value: `${auditResult.stats.accountAgeDays} يوم` },
                                  { label: "مهام مكتملة", value: String(auditResult.stats.tasksCompleted) },
                                  { label: "إحالات ناجحة", value: String(auditResult.stats.referralCount) },
                                  { label: "دورات مكافأة", value: String(auditResult.stats.rewardedSpins) },
                                  { label: "أقصى رصيد متوقع", value: `${auditResult.stats.estimatedMaxBalance}` },
                                  { label: "إجمالي السحوبات", value: `${auditResult.stats.totalWithdrawn} TON` },
                                ].map(s => (
                                  <div key={s.label} className="bg-purple-900/30 rounded-xl p-2.5">
                                    <p className="text-purple-400 text-[10px]">{s.label}</p>
                                    <p className="text-white text-sm font-bold">{s.value}</p>
                                  </div>
                                ))}
                              </div>

                              {/* Findings */}
                              <div>
                                <p className="text-white font-bold text-xs mb-2">نتائج التحليل</p>
                                <div className="space-y-1.5">
                                  {auditResult.findings.map((f, i) => (
                                    <div key={i} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-xs ${
                                      f.level === "danger" ? "bg-red-900/30 border border-red-700/40 text-red-300"
                                      : f.level === "warning" ? "bg-yellow-900/20 border border-yellow-700/30 text-yellow-300"
                                      : "bg-purple-900/30 border border-purple-700/30 text-purple-300"
                                    }`}>
                                      {f.level === "danger" ? <AlertTriangle size={12} className="shrink-0 mt-0.5 text-red-400" />
                                        : f.level === "warning" ? <AlertTriangle size={12} className="shrink-0 mt-0.5 text-yellow-400" />
                                        : <CheckCircle size={12} className="shrink-0 mt-0.5 text-purple-400" />}
                                      <span>{f.text}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Activity Log */}
                              {auditResult.activityLog && auditResult.activityLog.length > 0 && (
                                <div>
                                  <p className="text-white font-bold text-xs mb-2">سجل النشاط الكامل</p>
                                  <div className="relative pr-4 space-y-0">
                                    <div className="absolute right-[7px] top-2 bottom-2 w-0.5 bg-purple-700/40" />
                                    {auditResult.activityLog.map((entry, i) => {
                                      const d = new Date(entry.time);
                                      const dateStr = d.toLocaleDateString("ar-SA", { day: "2-digit", month: "2-digit", year: "2-digit" });
                                      const timeStr = d.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
                                      return (
                                        <div key={i} className="flex items-start gap-2 pb-2">
                                          <div className={`w-3.5 h-3.5 rounded-full shrink-0 mt-0.5 z-10 border-2 ${
                                            entry.type === "danger" ? "bg-red-500 border-red-700"
                                            : entry.type === "warning" ? "bg-yellow-400 border-yellow-600"
                                            : "bg-purple-500 border-purple-700"
                                          }`} />
                                          <div className="flex-1 min-w-0">
                                            <p className={`text-xs leading-tight ${
                                              entry.type === "danger" ? "text-red-300"
                                              : entry.type === "warning" ? "text-yellow-300"
                                              : "text-purple-200"
                                            }`}>{entry.event}</p>
                                            <p className="text-purple-500 text-[10px]">{dateStr} {timeStr}</p>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Action buttons — only if still pending */}
                              {wd.status === "pending" && (
                                <div className="space-y-2 pt-1">
                                  <p className="text-purple-400 text-xs font-bold text-center">إجراءات الأدمن</p>
                                  <div className="flex gap-2">
                                    <button
                                      disabled={actionLoading}
                                      onClick={() => handleWithdrawalAction(wd.id, "approve")}
                                      className="flex-1 py-2.5 rounded-xl text-sm font-black text-black bg-green-400 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                                    >
                                      <CheckCircle size={15} />
                                      قبول السحب
                                    </button>
                                    <button
                                      disabled={actionLoading}
                                      onClick={() => handleWithdrawalAction(wd.id, "reject")}
                                      className="flex-1 py-2.5 rounded-xl text-sm font-black text-white bg-red-600 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                                    >
                                      <XCircle size={15} />
                                      رفض وإعادة
                                    </button>
                                  </div>
                                  <button
                                    disabled={actionLoading || auditResult.stats.isBanned}
                                    onClick={() => handleBanUser(auditResult.user.id, !auditResult.stats.isBanned)}
                                    className={`w-full py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50 ${
                                      auditResult.stats.isBanned
                                        ? "bg-purple-700/50 text-purple-300"
                                        : "bg-orange-900/60 border border-orange-700/50 text-orange-300"
                                    }`}
                                  >
                                    <Ban size={15} />
                                    {auditResult.stats.isBanned ? "المستخدم محظور بالفعل" : "حظر المستخدم + رفض السحب"}
                                  </button>
                                  {!auditResult.stats.isBanned && (
                                    <p className="text-purple-500 text-[10px] text-center">الحظر يمنع المستخدم من اللعب والسحب مستقبلاً</p>
                                  )}
                                  <button
                                    disabled={actionLoading}
                                    onClick={() => handleResetVerification(auditResult.user.id)}
                                    className="w-full py-2.5 rounded-xl text-sm font-black flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50 bg-blue-900/50 border border-blue-700/50 text-blue-300 mt-1"
                                  >
                                    🔄 إعادة التحقق
                                  </button>
                                  <p className="text-blue-500/60 text-[10px] text-center">يُعيد فحص الجهاز — إذا كان متعدد الحسابات سيُحظر</p>
                                </div>
                              )}

                              {/* Already processed */}
                              {wd.status !== "pending" && (
                                <div className={`rounded-xl p-3 text-center text-sm font-bold ${wd.status === "approved" ? "bg-green-900/30 text-green-400" : "bg-red-900/30 text-red-400"}`}>
                                  {wd.status === "approved" ? "✅ تمت الموافقة على هذا السحب" : "❌ تم رفض هذا السحب"}
                                </div>
                              )}
                            </>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ─── SETTINGS ─── */}
            {tab === "settings" && (
              <div className="space-y-4">
                {/* Referral Commission Threshold */}
                <div className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-yellow-400 font-black text-base">👥</span>
                    <h3 className="text-white font-bold text-sm">حد عمولة الإحالة</h3>
                  </div>
                  <p className="text-purple-400 text-xs mb-3">
                    عدد الإحالات المطلوبة للحصول على دورة مجانية — القيمة الحالية: <span className="text-yellow-400 font-bold">{parseInt(settings["referral_threshold"]) || 5}</span>
                  </p>
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={settings["referral_threshold"] ?? "5"}
                      onChange={e => setSettings(prev => ({ ...prev, referral_threshold: e.target.value }))}
                      className="flex-1 bg-purple-800/50 text-white text-sm rounded-xl px-3 py-2 border border-purple-700/40 outline-none"
                      placeholder="مثال: 5"
                    />
                    <button
                      disabled={saving}
                      onClick={async () => {
                        const raw = settings["referral_threshold"] ?? "5";
                        const val = parseInt(raw);
                        if (isNaN(val) || val < 1) { flash("يجب أن يكون الرقم 1 على الأقل", "err"); return; }
                        await saveSetting("referral_threshold", String(val));
                      }}
                      className="px-4 py-2 rounded-xl text-sm font-bold bg-yellow-400 text-black transition-all active:scale-95 disabled:opacity-50"
                    >
                      حفظ
                    </button>
                  </div>
                  <p className="text-purple-500 text-xs mt-2">
                    كل {parseInt(settings["referral_threshold"]) || 5} إحالات ناجحة = دورة مجانية واحدة للمُحيل
                  </p>
                </div>

                {/* Task Threshold */}
                <div className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-yellow-400 font-black text-base">✅</span>
                    <h3 className="text-white font-bold text-sm">شرط اللفة من المهام</h3>
                  </div>
                  <p className="text-purple-400 text-xs mb-3">
                    عدد المهام المطلوبة للحصول على دورة مجانية — القيمة الحالية: <span className="text-yellow-400 font-bold">{parseInt(settings["task_threshold"]) || 5}</span>
                  </p>
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={settings["task_threshold"] ?? "5"}
                      onChange={e => setSettings(prev => ({ ...prev, task_threshold: e.target.value }))}
                      className="flex-1 bg-purple-800/50 text-white text-sm rounded-xl px-3 py-2 border border-purple-700/40 outline-none"
                      placeholder="مثال: 5"
                    />
                    <button
                      disabled={saving}
                      onClick={async () => {
                        const val = parseInt(settings["task_threshold"] ?? "5");
                        if (isNaN(val) || val < 1) { flash("يجب أن يكون الرقم 1 على الأقل", "err"); return; }
                        await saveSetting("task_threshold", String(val));
                      }}
                      className="px-4 py-2 rounded-xl text-sm font-bold bg-yellow-400 text-black transition-all active:scale-95 disabled:opacity-50"
                    >
                      حفظ
                    </button>
                  </div>
                  <p className="text-purple-500 text-xs mt-2">
                    كل {parseInt(settings["task_threshold"]) || 5} مهام مكتملة = دورة مجانية واحدة
                  </p>
                </div>

                {/* Min Withdrawal */}
                <div className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-yellow-400 font-black text-base">💸</span>
                    <h3 className="text-white font-bold text-sm">الحد الأدنى للسحب (TON)</h3>
                  </div>
                  <p className="text-purple-400 text-xs mb-3">
                    أقل مبلغ يمكن للمستخدم سحبه — القيمة الحالية: <span className="text-yellow-400 font-bold">{parseFloat(settings["min_withdrawal"] ?? "0.1").toFixed(2)} TON</span>
                  </p>
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      min="0.01"
                      max="1000"
                      step="0.01"
                      value={settings["min_withdrawal"] ?? "0.1"}
                      onChange={e => setSettings(prev => ({ ...prev, min_withdrawal: e.target.value }))}
                      className="flex-1 bg-purple-800/50 text-white text-sm rounded-xl px-3 py-2 border border-purple-700/40 outline-none"
                      placeholder="مثال: 0.1"
                      dir="ltr"
                    />
                    <button
                      disabled={saving}
                      onClick={async () => {
                        const val = parseFloat(settings["min_withdrawal"] ?? "0.1");
                        if (isNaN(val) || val < 0.01) { flash("يجب أن يكون 0.01 على الأقل", "err"); return; }
                        await saveSetting("min_withdrawal", val.toFixed(4));
                      }}
                      className="px-4 py-2 rounded-xl text-sm font-bold bg-yellow-400 text-black transition-all active:scale-95 disabled:opacity-50"
                    >
                      حفظ
                    </button>
                  </div>
                  <p className="text-purple-500 text-xs mt-2">
                    المستخدمون لا يمكنهم سحب أقل من {parseFloat(settings["min_withdrawal"] ?? "0.1").toFixed(2)} TON في طلب واحد
                  </p>
                </div>

                {/* Bot enabled toggle */}
                <div className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-white font-bold text-sm">تشغيل / إيقاف البوت</h3>
                      <p className="text-purple-400 text-xs mt-0.5">إيقاف البوت يفعّل وضع الصيانة</p>
                    </div>
                    <button
                      disabled={saving}
                      onClick={() => saveSetting("bot_enabled", botEnabled ? "false" : "true")}
                      className={`relative w-14 h-7 rounded-full transition-all ${botEnabled ? "bg-green-500" : "bg-purple-800"}`}
                    >
                      <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all shadow ${botEnabled ? "right-1" : "left-1"}`} />
                    </button>
                  </div>
                </div>

                {/* Show user count toggle */}
                <div className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-white font-bold text-sm">إظهار عدد المستخدمين</h3>
                      <p className="text-purple-400 text-xs mt-0.5">للجميع في الواجهة الرئيسية</p>
                    </div>
                    <button
                      disabled={saving}
                      onClick={() => saveSetting("show_user_count", showUserCount ? "false" : "true")}
                      className={`relative w-14 h-7 rounded-full transition-all ${showUserCount ? "bg-yellow-400" : "bg-purple-800"}`}
                    >
                      <div className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all shadow ${showUserCount ? "right-1" : "left-1"}`} />
                    </button>
                  </div>
                </div>

                {/* Spin Power Multiplier */}
                <div className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-yellow-400 font-black text-base">⚡</span>
                    <h3 className="text-white font-bold text-sm">مضاعف الجوائز (Power)</h3>
                  </div>
                  <p className="text-purple-400 text-xs mb-3">
                    تضاعف جميع جوائز العجلة بالقيمة المحددة — مثال: Power ×2 يجعل الجائزة 1$ تصبح 2$
                  </p>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((p) => (
                      <button
                        key={p}
                        disabled={saving}
                        onClick={() => saveSetting("spin_power", String(p))}
                        className={`flex-1 py-2 rounded-xl text-sm font-black transition-all active:scale-95 ${
                          (parseInt(settings["spin_power"]) || 1) === p
                            ? "bg-yellow-400 text-black"
                            : "bg-purple-800/50 text-purple-300"
                        }`}
                      >
                        ×{p}
                      </button>
                    ))}
                  </div>
                  <p className="text-purple-500 text-xs mt-2">
                    Power الحالي: <span className="text-yellow-400 font-bold">×{parseInt(settings["spin_power"]) || 1}</span>
                  </p>
                </div>

                {/* Boost Schedule */}
                <div className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-yellow-400 font-black text-base">🕐</span>
                    <h3 className="text-white font-bold text-sm">جدولة وقت الـ Boost</h3>
                  </div>
                  <p className="text-purple-400 text-xs mb-3">
                    اضبط وقت بداية ونهاية الـ Power Boost — اتركهما فارغين لتفعيله بشكل دائم
                  </p>
                  <div className="flex flex-col gap-2">
                    <div>
                      <label className="text-purple-300 text-xs mb-1 block">بداية الـ Boost</label>
                      <input
                        type="datetime-local"
                        value={settings["boost_starts_at"] ? new Date(settings["boost_starts_at"]).toISOString().slice(0, 16) : ""}
                        onChange={e => setSettings(prev => ({
                          ...prev,
                          boost_starts_at: e.target.value ? new Date(e.target.value).toISOString() : "",
                        }))}
                        style={{ colorScheme: "dark" }}
                        className="w-full bg-purple-800/50 text-white text-sm rounded-xl px-3 py-2 border border-purple-700/40 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-purple-300 text-xs mb-1 block">نهاية الـ Boost</label>
                      <input
                        type="datetime-local"
                        value={settings["boost_ends_at"] ? new Date(settings["boost_ends_at"]).toISOString().slice(0, 16) : ""}
                        onChange={e => setSettings(prev => ({
                          ...prev,
                          boost_ends_at: e.target.value ? new Date(e.target.value).toISOString() : "",
                        }))}
                        style={{ colorScheme: "dark" }}
                        className="w-full bg-purple-800/50 text-white text-sm rounded-xl px-3 py-2 border border-purple-700/40 outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      disabled={saving}
                      onClick={async () => {
                        if (!user || saving) return;
                        setSaving(true);
                        try {
                          await Promise.all([
                            api.adminUpdateSetting(user.id, "boost_starts_at", settings["boost_starts_at"] || ""),
                            api.adminUpdateSetting(user.id, "boost_ends_at",   settings["boost_ends_at"]   || ""),
                          ]);
                          flash("تم حفظ جدولة الـ Boost ✅");
                        } catch { flash("فشل الحفظ", "err"); }
                        setSaving(false);
                      }}
                      className="flex-1 py-2 rounded-xl text-sm font-bold bg-yellow-400 text-black transition-all active:scale-95 disabled:opacity-50"
                    >
                      حفظ الجدول
                    </button>
                    <button
                      disabled={saving}
                      onClick={async () => {
                        if (!user || saving) return;
                        setSaving(true);
                        try {
                          setSettings(prev => ({ ...prev, boost_starts_at: "", boost_ends_at: "" }));
                          await Promise.all([
                            api.adminUpdateSetting(user.id, "boost_starts_at", ""),
                            api.adminUpdateSetting(user.id, "boost_ends_at",   ""),
                          ]);
                          flash("تم مسح التوقيت — Boost دائم ✅");
                        } catch { flash("فشل الحفظ", "err"); }
                        setSaving(false);
                      }}
                      className="flex-1 py-2 rounded-xl text-sm font-bold bg-purple-800/50 text-purple-300 transition-all active:scale-95 disabled:opacity-50"
                    >
                      مسح التوقيت
                    </button>
                  </div>
                  {(settings["boost_starts_at"] || settings["boost_ends_at"]) && (
                    <p className="text-purple-500 text-xs mt-2">
                      {settings["boost_starts_at"] && <span>يبدأ: <span className="text-yellow-400">{new Date(settings["boost_starts_at"]).toLocaleString("ar-SA")}</span></span>}
                      {settings["boost_starts_at"] && settings["boost_ends_at"] && " — "}
                      {settings["boost_ends_at"] && <span>ينتهي: <span className="text-yellow-400">{new Date(settings["boost_ends_at"]).toLocaleString("ar-SA")}</span></span>}
                    </p>
                  )}
                  {!settings["boost_starts_at"] && !settings["boost_ends_at"] && (parseInt(settings["spin_power"]) || 1) > 1 && (
                    <p className="text-green-400 text-xs mt-2 font-bold">⚡ Boost نشط الآن (بلا توقيت)</p>
                  )}
                </div>

                {/* Withdraw mode */}
                <div className="bg-purple-900/20 border border-purple-700/40 rounded-2xl p-4">
                  <h3 className="text-white font-bold text-sm mb-3">وضع السحب</h3>
                  <div className="flex gap-2">
                    {["manual", "auto"].map((mode) => (
                      <button
                        key={mode}
                        disabled={saving}
                        onClick={() => saveSetting("withdraw_mode", mode)}
                        className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                          (settings["withdraw_mode"] || "manual") === mode
                            ? "bg-yellow-400 text-black"
                            : "bg-purple-800/50 text-purple-300"
                        }`}
                      >
                        {mode === "manual" ? "🔴 يدوي" : "🟢 تلقائي"}
                      </button>
                    ))}
                  </div>
                  <p className="text-purple-500 text-xs mt-2">
                    {(settings["withdraw_mode"] || "manual") === "manual"
                      ? "الأدمن يوافق يدوياً على كل طلب سحب."
                      : "الموافقة والتحويل تتم تلقائياً عند الطلب."}
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
