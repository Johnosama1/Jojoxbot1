import { useState, useEffect } from "react";
import { useUser } from "../lib/userContext";
import { api, Task, WheelSlot, User, AdminUser, AdminPermission, SubscriptionChannel } from "../lib/api";
import { Shield, Plus, Power, PowerOff } from "lucide-react";

export default function AdminPage() {
  const { user, isAdmin } = useUser();
  const [activeTab, setActiveTab] = useState<"tasks" | "wheel" | "users" | "settings" | "withdrawals" | "admins">("tasks");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [wheelSlots, setWheelSlots] = useState<WheelSlot[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [requiredChannels, setRequiredChannels] = useState<SubscriptionChannel[]>([]);
  const [channelUsername, setChannelUsername] = useState("");
  const [channelTitle, setChannelTitle] = useState("");
  const [channelInviteLink, setChannelInviteLink] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const showMsg = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(""), 3000);
  };

  const loadData = async () => {
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
        const raw = s["required_channels"];
        setRequiredChannels(raw ? JSON.parse(raw) : []);
      } catch {
        setRequiredChannels([]);
      }
    } catch {
      showMsg("خطأ في تحميل البيانات - تأكد من صلاحيات الأدمن");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center page-content px-4">
        <Shield size={60} className="text-red-500 mb-4" />
        <h2 className="text-xl font-black text-red-400">ممنوع الوصول</h2>
        <p className="text-purple-400 text-sm mt-2 text-center">هذه الصفحة للأدمن فقط</p>
      </div>
    );
  }

  const handleSaveSetting = async (key: string, value: string) => {
    if (!user) return;
    await api.adminUpdateSetting(user.id, key, value);
    await loadData();
    showMsg("تم الحفظ!");
  };

  const saveRequiredChannels = async (channels: SubscriptionChannel[]) => {
    if (!user) return;
    await handleSaveSetting("required_channels", JSON.stringify(channels));
  };

  const botEnabled = settings["bot_enabled"] !== "false";

  return (
    <div className="min-h-screen page-content" dir="rtl">
      <div className="px-4 pt-6 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <Shield size={24} className="text-yellow-400" />
          <h1 className="text-2xl font-black gold-text">لوحة التحكم</h1>
        </div>
        <p className="text-purple-400 text-sm">مرحباً @{user?.username}</p>
      </div>

      {msg && (
        <div className="mx-4 mb-4 bg-green-900/30 border border-green-700/50 rounded-xl px-3 py-2">
          <p className="text-green-400 text-sm">{msg}</p>
        </div>
      )}

      <div className="px-4">
        <div className="bg-purple-900/30 border border-purple-700/50 rounded-2xl p-4 mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-white font-bold">حالة البوت</h3>
            <p className="text-purple-300 text-sm">يمكنك إيقافه أو تشغيله في أي وقت</p>
          </div>
          <button
            onClick={() => handleSaveSetting("bot_enabled", botEnabled ? "false" : "true")}
            className={`px-4 py-2 rounded-xl font-bold text-black flex items-center gap-2 ${botEnabled ? "bg-red-400" : "bg-green-400"}`}
          >
            {botEnabled ? <PowerOff size={16} /> : <Power size={16} />}
            {botEnabled ? "إيقاف البوت" : "تشغيل البوت"}
          </button>
        </div>
      </div>

      <div className="px-4 pt-2">
        <div className="bg-purple-900/30 border border-purple-700/50 rounded-2xl p-4">
          <h3 className="text-white font-bold mb-3">إعدادات أخرى</h3>
          <div className="flex items-center justify-between">
            <p className="text-purple-300 text-sm">إظهار عدد المستخدمين للجميع</p>
            <button
              onClick={() => handleSaveSetting("show_user_count", settings["show_user_count"] === "true" ? "false" : "true")}
              className={`relative w-12 h-6 rounded-full transition-all ${settings["show_user_count"] === "true" ? "bg-yellow-400" : "bg-purple-800"}`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${settings["show_user_count"] === "true" ? "right-1" : "left-1"}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4">
        <div className="bg-purple-900/30 border border-purple-700/50 rounded-2xl p-4">
          <h3 className="text-white font-bold mb-3">القنوات المطلوبة</h3>
          <div className="space-y-2 mb-3">
            {requiredChannels.length === 0 ? (
              <p className="text-purple-300 text-sm">لا توجد قنوات مطلوبة حالياً.</p>
            ) : requiredChannels.map((ch, index) => (
              <div key={`${ch.username}-${index}`} className="flex items-center justify-between gap-2 text-sm text-purple-200 bg-black/20 rounded-xl px-3 py-2">
                <span>{ch.title || `@${ch.username}`}</span>
                <button
                  className="text-red-300 font-bold"
                  onClick={() => saveRequiredChannels(requiredChannels.filter((_, i) => i !== index))}
                >
                  حذف
                </button>
              </div>
            ))}
          </div>
          <div className="grid gap-2">
            <input className="bg-black/30 border border-purple-700/50 rounded-xl px-3 py-2 text-white text-sm" value={channelUsername} onChange={(e) => setChannelUsername(e.target.value)} placeholder="@channel" />
            <input className="bg-black/30 border border-purple-700/50 rounded-xl px-3 py-2 text-white text-sm" value={channelTitle} onChange={(e) => setChannelTitle(e.target.value)} placeholder="اسم القناة" />
            <input className="bg-black/30 border border-purple-700/50 rounded-xl px-3 py-2 text-white text-sm" value={channelInviteLink} onChange={(e) => setChannelInviteLink(e.target.value)} placeholder="رابط الدعوة" />
            <button
              className="bg-yellow-400 text-black rounded-xl py-2 font-bold"
              onClick={() => {
                if (!channelUsername.trim()) return;
                const next = [...requiredChannels, { username: channelUsername.replace(/^@/, ""), title: channelTitle.trim(), inviteLink: channelInviteLink.trim() }];
                setChannelUsername("");
                setChannelTitle("");
                setChannelInviteLink("");
                saveRequiredChannels(next);
              }}
            >
              إضافة قناة
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4">
        <button
          onClick={() => setActiveTab(activeTab === "tasks" ? "wheel" : "tasks")}
          className="w-full py-3 rounded-xl font-bold text-black mb-4 flex items-center justify-center gap-2"
          style={{ background: "linear-gradient(135deg, #ffd700, #ffaa00)" }}
        >
          <Plus size={18} />
          {activeTab === "tasks" ? "إظهار العجلة" : "إظهار المهام"}
        </button>
      </div>

      <div className="px-4">
        <div className="text-white text-sm">{loading ? "جارٍ التحميل..." : `عدد المهام: ${tasks.length} | عدد المستخدمين: ${users.length} | عدد الخانات: ${wheelSlots.length}`}</div>
      </div>
    </div>
  );
}
