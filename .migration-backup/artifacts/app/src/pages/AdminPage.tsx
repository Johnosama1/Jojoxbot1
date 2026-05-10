import { useState, useEffect, useCallback } from "react";
import { useUser } from "../lib/userContext";
import { api, Task, WheelSlot, User, AdminUser, SubscriptionChannel } from "../lib/api";
import {
  Shield, Plus, Trash2, Power, PowerOff, RefreshCw,
  Radio, Cog, Users, LayoutDashboard, ListChecks, Sliders
} from "lucide-react";

type Tab = "overview" | "channels" | "tasks" | "wheel" | "users" | "settings";

export default function AdminPage() {
  const { user, isAdmin } = useUser();
  const [tab, setTab] = useState<Tab>("overview");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [wheelSlots, setWheelSlots] = useState<WheelSlot[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [requiredChannels, setRequiredChannels] = useState<SubscriptionChannel[]>([]);
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
      const [t, w, u, s] = await Promise.all([
        api.adminGetTasks(user.id),
        api.adminGetWheel(user.id),
        api.adminGetUsers(user.id),
        api.adminGetSettings(user.id),
      ]);
      setTasks(t);
      setWheelSlots(w);
      setUsers(u);
      setSettings(s);
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

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "overview", label: "نظرة عامة", icon: <LayoutDashboard size={15} /> },
    { id: "channels", label: "القنوات", icon: <Radio size={15} /> },
    { id: "tasks", label: "المهام", icon: <ListChecks size={15} /> },
    { id: "wheel", label: "العجلة", icon: <Sliders size={15} /> },
    { id: "users", label: "المستخدمون", icon: <Users size={15} /> },
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
              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                tab === t.id
                  ? "bg-yellow-400 text-black"
                  : "bg-purple-900/40 text-purple-300"
              }`}
            >
              {t.icon}
              {t.label}
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

            {/* ─── SETTINGS ─── */}
            {tab === "settings" && (
              <div className="space-y-4">
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
