import { useState, useEffect } from "react";
import { useUser } from "../lib/userContext";
import { api, Task, WheelSlot, User, AdminUser, AdminPermission } from "../lib/api";
import { Shield, Plus, Trash2, Settings, Users, Sliders, ListTodo, ChevronDown, ChevronUp, CreditCard, UserCog } from "lucide-react";

export default function AdminPage() {
  const { user, isAdmin } = useUser();
  const [activeTab, setActiveTab] = useState<"tasks" | "wheel" | "users" | "settings" | "withdrawals" | "admins">("tasks");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [wheelSlots, setWheelSlots] = useState<WheelSlot[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  // Task form
  const [newTask, setNewTask] = useState({ title: "", description: "", url: "", icon: "⭐", expiresAt: "" });
  const [showTaskForm, setShowTaskForm] = useState(false);

  // User edit
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [editBalance, setEditBalance] = useState("");
  const [editSpins, setEditSpins] = useState("");

  // Wheel edit
  const [editedSlots, setEditedSlots] = useState<WheelSlot[]>([]);

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
      setEditedSlots(w);
      setUsers(u);
      setSettings(s);
    } catch (e) {
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

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newTask.title) return;
    try {
      await api.adminCreateTask(user.id, {
        title: newTask.title,
        description: newTask.description || undefined,
        url: newTask.url || undefined,
        icon: newTask.icon,
        expiresAt: newTask.expiresAt ? newTask.expiresAt : undefined,
      });
      setNewTask({ title: "", description: "", url: "", icon: "⭐", expiresAt: "" });
      setShowTaskForm(false);
      await loadData();
      showMsg("تم إضافة المهمة بنجاح!");
    } catch (e) {
      showMsg("فشل إضافة المهمة");
    }
  };

  const handleDeleteTask = async (id: number) => {
    if (!user) return;
    try {
      await api.adminDeleteTask(user.id, id);
      await loadData();
      showMsg("تم حذف المهمة");
    } catch (e) {
      showMsg("فشل الحذف");
    }
  };

  const handleSaveWheel = async () => {
    if (!user) return;
    try {
      await api.adminUpdateWheel(user.id, editedSlots);
      await loadData();
      showMsg("تم حفظ إعدادات العجلة!");
    } catch (e) {
      showMsg("فشل الحفظ");
    }
  };

  const handleUpdateUser = async (userId: number) => {
    if (!user) return;
    try {
      const b = editBalance !== "" ? parseFloat(editBalance) : undefined;
      const s = editSpins !== "" ? parseInt(editSpins) : undefined;
      await api.adminUpdateUserBalance(user.id, userId, b, s);
      setEditUserId(null);
      setEditBalance("");
      setEditSpins("");
      await loadData();
      showMsg("تم تحديث المستخدم!");
    } catch (e) {
      showMsg("فشل التحديث");
    }
  };

  const handleResetVerification = async (userId: number) => {
    if (!user) return;
    try {
      await api.adminResetVerification(user.id, userId);
      showMsg("✅ تم إعادة التحقق للمستخدم");
    } catch (e) {
      showMsg("فشل إعادة التحقق");
    }
  };

  const handleSaveSetting = async (key: string, value: string) => {
    if (!user) throw new Error("No user");
    await api.adminUpdateSetting(user.id, key, value);
    await loadData();
    showMsg("تم الحفظ!");
  };

  const totalProbability = editedSlots.reduce((s, sl) => s + sl.probability, 0);

  const tabs = [
    { id: "tasks", label: "المهام", icon: ListTodo },
    { id: "wheel", label: "العجلة", icon: Sliders },
    { id: "users", label: "المستخدمين", icon: Users },
    { id: "admins", label: "الأدمنز", icon: UserCog },
    { id: "settings", label: "الإعدادات", icon: Settings },
    { id: "withdrawals", label: "السحوبات", icon: CreditCard },
  ] as const;

  return (
    <div className="min-h-screen page-content" dir="rtl">
      {/* Header */}
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

      {/* Tabs */}
      <div className="flex overflow-x-auto gap-2 px-4 pb-3 scrollbar-hide">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold whitespace-nowrap flex-shrink-0 transition-all"
              style={{
                background: activeTab === tab.id ? "linear-gradient(135deg, #ffd700, #ffaa00)" : "rgba(147,51,234,0.2)",
                color: activeTab === tab.id ? "#000" : "#a78bfa",
                border: activeTab === tab.id ? "none" : "1px solid rgba(147,51,234,0.4)",
              }}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="px-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            {/* Tasks Tab */}
            {activeTab === "tasks" && (
              <div>
                <button
                  onClick={() => setShowTaskForm(!showTaskForm)}
                  className="w-full py-3 rounded-xl font-bold text-black mb-4 flex items-center justify-center gap-2"
                  style={{ background: "linear-gradient(135deg, #ffd700, #ffaa00)" }}
                >
                  <Plus size={18} />
                  إضافة مهمة جديدة
                  {showTaskForm ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {showTaskForm && (
                  <form onSubmit={handleCreateTask} className="bg-purple-900/30 border border-purple-700/50 rounded-2xl p-4 mb-4 flex flex-col gap-3">
                    {[
                      { label: "عنوان المهمة *", key: "title", type: "text", placeholder: "اسم المهمة" },
                      { label: "الوصف", key: "description", type: "text", placeholder: "وصف اختياري" },
                      { label: "الرابط", key: "url", type: "url", placeholder: "https://" },
                      { label: "الأيقونة", key: "icon", type: "text", placeholder: "⭐" },
                      { label: "ينتهي في (اختياري)", key: "expiresAt", type: "datetime-local", placeholder: "" },
                    ].map((f) => (
                      <div key={f.key}>
                        <label className="text-purple-300 text-xs mb-1 block">{f.label}</label>
                        <input
                          type={f.type}
                          value={(newTask as Record<string, string>)[f.key]}
                          onChange={(e) => setNewTask((prev) => ({ ...prev, [f.key]: e.target.value }))}
                          placeholder={f.placeholder}
                          required={f.key === "title"}
                          className="w-full bg-purple-900/40 border border-purple-700/50 rounded-xl px-3 py-2 text-white text-sm placeholder-purple-600 focus:outline-none"
                        />
                      </div>
                    ))}
                    <button type="submit" className="w-full py-3 rounded-xl font-bold text-black" style={{ background: "linear-gradient(135deg, #ffd700, #ffaa00)" }}>
                      إضافة
                    </button>
                  </form>
                )}

                <div className="flex flex-col gap-3">
                  {tasks.map((task) => (
                    <div key={task.id} className="bg-purple-900/20 border border-purple-700/40 rounded-xl p-3 flex items-start gap-3">
                      {/* Channel photo or icon */}
                      {task.channelPhotoUrl ? (
                        <img
                          src={task.channelPhotoUrl}
                          alt={task.title}
                          style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "2px solid rgba(147,51,234,0.5)" }}
                        />
                      ) : (
                        <span className="text-2xl flex-shrink-0">{task.icon}</span>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-bold text-sm">{task.title}</p>
                        {task.description && <p className="text-purple-400 text-xs">{task.description}</p>}
                        {task.expiresAt && (
                          <p className="text-orange-400 text-xs mt-1">
                            ينتهي: {new Date(task.expiresAt).toLocaleString("ar")}
                          </p>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full mt-1 inline-block ${task.isActive ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}`}>
                          {task.isActive ? "نشط" : "معطل"}
                        </span>
                      </div>
                      <button onClick={() => handleDeleteTask(task.id)} className="p-2 text-red-400 hover:bg-red-900/20 rounded-lg transition-all">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Wheel Tab */}
            {activeTab === "wheel" && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-white font-bold">إعدادات العجلة</h2>
                  <span className={`text-xs px-2 py-1 rounded-full font-bold ${totalProbability === 100 ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}`}>
                    مجموع النسب: {totalProbability}%
                  </span>
                </div>
                <p className="text-purple-400 text-xs mb-4">
                  مجموع النسب يجب أن يساوي 100%. 0% يعني الخانة لن تظهر أبداً.
                </p>
                <div className="flex flex-col gap-3 mb-4">
                  {editedSlots.map((slot, i) => (
                    <div key={slot.id} className="bg-purple-900/30 border border-purple-700/50 rounded-xl p-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-black text-black flex-shrink-0"
                          style={{ background: "linear-gradient(135deg, #ffd700, #ffaa00)" }}
                        >
                          #{i + 1}
                        </div>
                        <div className="flex-1 flex gap-2">
                          <div className="flex-1">
                            <label className="text-purple-400 text-xs">المبلغ (USDT)</label>
                            <input
                              type="number"
                              step="0.01"
                              value={slot.amount}
                              onChange={(e) => setEditedSlots((prev) => prev.map((s) => s.id === slot.id ? { ...s, amount: e.target.value } : s))}
                              className="w-full bg-purple-900/40 border border-purple-700/50 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none"
                            />
                          </div>
                          <div className="w-24">
                            <label className="text-purple-400 text-xs">النسبة %</label>
                            <input
                              type="number"
                              min="0"
                              max="100"
                              value={slot.probability}
                              onChange={(e) => setEditedSlots((prev) => prev.map((s) => s.id === slot.id ? { ...s, probability: parseInt(e.target.value) || 0 } : s))}
                              className="w-full bg-purple-900/40 border border-purple-700/50 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleSaveWheel}
                  disabled={totalProbability !== 100}
                  className="w-full py-3 rounded-xl font-bold text-black disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #ffd700, #ffaa00)" }}
                >
                  {totalProbability !== 100 ? `مجموع النسب = ${totalProbability}% (يجب أن يكون 100%)` : "حفظ إعدادات العجلة"}
                </button>
              </div>
            )}

            {/* Users Tab */}
            {activeTab === "users" && (
              <div>
                <div className="bg-purple-900/30 border border-purple-700/50 rounded-xl p-3 mb-4 text-center">
                  <p className="text-3xl font-black text-yellow-400">{users.length}</p>
                  <p className="text-purple-400 text-sm">إجمالي المستخدمين</p>
                </div>
                <div className="flex flex-col gap-2">
                  {users.map((u) => (
                    <div key={u.id} className="bg-purple-900/20 border border-purple-700/40 rounded-xl p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-purple-800 flex items-center justify-center text-sm font-bold text-yellow-400">
                          {(u.firstName || u.username || "?")[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-bold truncate">{u.firstName || "بدون اسم"}</p>
                          <p className="text-purple-400 text-xs">{u.username ? `@${u.username}` : u.id}</p>
                          <p className="text-yellow-400 text-xs">{parseFloat(u.balance).toFixed(2)} USDT | {parseFloat((u as any).tonBalance || '0').toFixed(3)} TON | {u.spins} لفة</p>
                        </div>
                        <div className="flex flex-col gap-1 items-end">
                          <button
                            onClick={() => setEditUserId(editUserId === u.id ? null : u.id)}
                            className="p-2 text-yellow-400 hover:bg-yellow-900/20 rounded-lg text-xs font-bold"
                          >
                            تعديل
                          </button>
                          <button
                            onClick={() => handleResetVerification(u.id)}
                            className="px-2 py-1 text-blue-400 hover:bg-blue-900/20 rounded-lg text-xs font-bold whitespace-nowrap"
                            title="إعادة التحقق"
                          >
                            🔄 تحقق
                          </button>
                        </div>
                      </div>
                      {editUserId === u.id && (
                        <div className="mt-3 flex flex-col gap-2">
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className="text-purple-400 text-xs">الرصيد (USDT)</label>
                              <input
                                type="number"
                                step="0.0001"
                                value={editBalance}
                                onChange={(e) => setEditBalance(e.target.value)}
                                placeholder={u.balance}
                                className="w-full bg-purple-900/40 border border-purple-700/50 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none"
                              />
                            </div>
                            <div className="flex-1">
                              <label className="text-purple-400 text-xs">عدد اللفات</label>
                              <input
                                type="number"
                                value={editSpins}
                                onChange={(e) => setEditSpins(e.target.value)}
                                placeholder={String(u.spins)}
                                className="w-full bg-purple-900/40 border border-purple-700/50 rounded-lg px-2 py-1.5 text-white text-sm focus:outline-none"
                              />
                            </div>
                          </div>
                          <button
                            onClick={() => handleUpdateUser(u.id)}
                            className="py-2 rounded-lg font-bold text-black text-sm"
                            style={{ background: "linear-gradient(135deg, #ffd700, #ffaa00)" }}
                          >
                            حفظ
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Settings Tab */}
            {activeTab === "settings" && (
              <div className="flex flex-col gap-4">
                <div className="bg-purple-900/30 border border-purple-700/50 rounded-2xl p-4">
                  <h3 className="text-white font-bold mb-3">معرف المالك (للإشعارات)</h3>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      defaultValue={settings["owner_telegram_id"] || ""}
                      id="owner-id-input"
                      placeholder="Telegram User ID"
                      className="flex-1 bg-purple-900/40 border border-purple-700/50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none"
                    />
                    <button
                      onClick={() => {
                        const val = (document.getElementById("owner-id-input") as HTMLInputElement).value;
                        handleSaveSetting("owner_telegram_id", val);
                      }}
                      className="px-4 py-2 rounded-xl font-bold text-black text-sm"
                      style={{ background: "linear-gradient(135deg, #ffd700, #ffaa00)" }}
                    >
                      حفظ
                    </button>
                  </div>
                </div>

                <div className="bg-purple-900/30 border border-purple-700/50 rounded-2xl p-4">
                  <h3 className="text-white font-bold mb-3">إظهار عدد المستخدمين</h3>
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

                <RequiredChannelsManager userId={user!.id} settings={settings} onSave={handleSaveSetting} />
              </div>
            )}

            {/* Admins Tab */}
            {activeTab === "admins" && (
              <AdminsTab userId={user!.id} />
            )}

            {/* Withdrawals Tab */}
            {activeTab === "withdrawals" && (
              <WithdrawalsTab userId={user!.id} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Permission definitions ────────────────────────────────────────────
const PERMISSION_DEFS: { key: AdminPermission; label: string; description: string; emoji: string }[] = [
  { key: "canUnban",               label: "رفع الحظر",           description: "يمكنه إعادة تفعيل حسابات المحظورين",        emoji: "🔓" },
  { key: "canWarn",                label: "تحذير المستخدمين",    description: "يمكنه إرسال تحذيرات للمستخدمين عبر البوت",   emoji: "⚠️" },
  { key: "canReceiveWithdrawals",  label: "إشعارات السحب",       description: "يستقبل طلبات السحب مثل المالك تماماً",        emoji: "💸" },
  { key: "canEditWheel",          label: "تعديل العجلة",         description: "يمكنه تغيير مبالغ ونسب أقسام العجلة",         emoji: "🎡" },
];

function AdminsTab({ userId }: { userId: number }) {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [formId, setFormId] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPerms, setFormPerms] = useState<AdminPermission[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPerms, setEditPerms] = useState<AdminPermission[]>([]);
  const [saving, setSaving] = useState(false);

  const flash = (text: string) => { setMsg(text); setTimeout(() => setMsg(""), 3000); };

  const load = () => {
    setLoading(true);
    api.adminGetAdmins(userId).then(setAdmins).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [userId]);

  const toggleFormPerm = (p: AdminPermission) =>
    setFormPerms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);

  const toggleEditPerm = (p: AdminPermission) =>
    setEditPerms((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const numId = parseInt(formId);
    if (isNaN(numId) || numId <= 0) { flash("❌ ID غير صحيح"); return; }
    setSaving(true);
    try {
      await api.adminAddAdmin(userId, { id: numId, username: formUsername || undefined, permissions: formPerms });
      setFormId(""); setFormUsername(""); setFormPerms([]);
      setShowForm(false);
      load();
      flash("✅ تم إضافة الأدمن بنجاح!");
    } catch (e: any) { flash("❌ " + (e.message || "فشل الإضافة")); }
    finally { setSaving(false); }
  };

  const handleSavePerms = async (targetId: number) => {
    setSaving(true);
    try {
      await api.adminUpdateAdminPerms(userId, targetId, editPerms);
      setEditingId(null);
      load();
      flash("✅ تم حفظ الصلاحيات!");
    } catch (e: any) { flash("❌ " + (e.message || "فشل الحفظ")); }
    finally { setSaving(false); }
  };

  const handleDelete = async (targetId: number) => {
    if (!confirm("هل أنت متأكد من حذف هذا الأدمن؟")) return;
    try {
      await api.adminDeleteAdmin(userId, targetId);
      load();
      flash("✅ تم حذف الأدمن");
    } catch (e: any) { flash("❌ " + (e.message || "فشل الحذف")); }
  };

  if (loading) return <div className="flex justify-center py-8"><div className="w-8 h-8 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" /></div>;

  return (
    <div>
      {msg && (
        <div className="mb-4 bg-green-900/30 border border-green-700/50 rounded-xl px-3 py-2">
          <p className="text-green-400 text-sm">{msg}</p>
        </div>
      )}

      {/* Add admin button */}
      <button
        onClick={() => setShowForm(!showForm)}
        className="w-full py-3 rounded-xl font-bold text-black mb-4 flex items-center justify-center gap-2"
        style={{ background: "linear-gradient(135deg, #ffd700, #ffaa00)" }}
      >
        <Plus size={18} />
        إضافة أدمن جديد
        {showForm ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {/* Add admin form */}
      {showForm && (
        <form onSubmit={handleAdd} className="bg-purple-900/30 border border-purple-700/50 rounded-2xl p-4 mb-4 flex flex-col gap-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-purple-300 text-xs mb-1 block">Telegram User ID *</label>
              <input
                type="number"
                value={formId}
                onChange={(e) => setFormId(e.target.value)}
                placeholder="123456789"
                required
                className="w-full bg-purple-900/40 border border-purple-700/50 rounded-xl px-3 py-2 text-white text-sm placeholder-purple-600 focus:outline-none"
              />
            </div>
            <div className="flex-1">
              <label className="text-purple-300 text-xs mb-1 block">يوزرنيم (اختياري)</label>
              <input
                type="text"
                value={formUsername}
                onChange={(e) => setFormUsername(e.target.value)}
                placeholder="@username"
                className="w-full bg-purple-900/40 border border-purple-700/50 rounded-xl px-3 py-2 text-white text-sm placeholder-purple-600 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-purple-300 text-xs mb-2 block font-bold">الصلاحيات</label>
            <div className="flex flex-col gap-2">
              {PERMISSION_DEFS.map((p) => (
                <label key={p.key} className="flex items-start gap-3 cursor-pointer bg-purple-900/20 border border-purple-700/30 rounded-xl px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={formPerms.includes(p.key)}
                    onChange={() => toggleFormPerm(p.key)}
                    className="mt-0.5 accent-yellow-400 w-4 h-4 flex-shrink-0"
                  />
                  <div>
                    <p className="text-white text-sm font-bold">{p.emoji} {p.label}</p>
                    <p className="text-purple-400 text-xs">{p.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 rounded-xl font-bold text-black disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #ffd700, #ffaa00)" }}
          >
            {saving ? "جاري الإضافة..." : "إضافة الأدمن"}
          </button>
        </form>
      )}

      {/* Admins list */}
      <div className="flex flex-col gap-3">
        {admins.length === 0 && (
          <p className="text-purple-400 text-center py-8 text-sm">لا يوجد أدمنز مضافين بعد</p>
        )}
        {admins.map((admin) => (
          <div key={admin.id} className="bg-purple-900/20 border border-purple-700/40 rounded-xl p-3">
            {/* Header row */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-yellow-900/40 border border-yellow-500/40 flex items-center justify-center flex-shrink-0">
                <UserCog size={16} className="text-yellow-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-bold">
                  {admin.username ? `@${admin.username}` : `ID: ${admin.id}`}
                </p>
                <p className="text-purple-500 text-xs">{admin.id}</p>
                {/* Active permissions summary */}
                <div className="flex flex-wrap gap-1 mt-1">
                  {admin.permissions.length === 0 ? (
                    <span className="text-xs text-red-400/70">لا توجد صلاحيات</span>
                  ) : (
                    admin.permissions.map((pk) => {
                      const def = PERMISSION_DEFS.find((d) => d.key === pk);
                      return def ? (
                        <span key={pk} className="text-xs bg-yellow-900/30 text-yellow-400 border border-yellow-500/30 px-1.5 py-0.5 rounded-full">
                          {def.emoji} {def.label}
                        </span>
                      ) : null;
                    })
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-1 items-end flex-shrink-0">
                <button
                  onClick={() => { setEditingId(editingId === admin.id ? null : admin.id); setEditPerms(admin.permissions); }}
                  className="px-2 py-1 text-yellow-400 text-xs font-bold hover:bg-yellow-900/20 rounded-lg"
                >
                  تعديل
                </button>
                <button
                  onClick={() => handleDelete(admin.id)}
                  className="px-2 py-1 text-red-400 text-xs font-bold hover:bg-red-900/20 rounded-lg"
                >
                  حذف
                </button>
              </div>
            </div>

            {/* Edit permissions panel */}
            {editingId === admin.id && (
              <div className="mt-3 border-t border-purple-700/30 pt-3">
                <p className="text-purple-300 text-xs font-bold mb-2">تعديل الصلاحيات:</p>
                <div className="flex flex-col gap-2 mb-3">
                  {PERMISSION_DEFS.map((p) => (
                    <label key={p.key} className="flex items-start gap-3 cursor-pointer bg-purple-900/20 border border-purple-700/30 rounded-xl px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={editPerms.includes(p.key)}
                        onChange={() => toggleEditPerm(p.key)}
                        className="mt-0.5 accent-yellow-400 w-4 h-4 flex-shrink-0"
                      />
                      <div>
                        <p className="text-white text-sm font-bold">{p.emoji} {p.label}</p>
                        <p className="text-purple-400 text-xs">{p.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
                <button
                  onClick={() => handleSavePerms(admin.id)}
                  disabled={saving}
                  className="w-full py-2 rounded-xl font-bold text-black text-sm disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, #ffd700, #ffaa00)" }}
                >
                  {saving ? "جاري الحفظ..." : "حفظ الصلاحيات"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Required Channels Manager ─────────────────────────────────────────
function RequiredChannelsManager({
  userId,
  settings,
  onSave,
}: {
  userId: number;
  settings: Record<string, string>;
  onSave: (key: string, value: string) => Promise<void>;
}) {
  const [channels, setChannels] = useState<{ username: string; title: string; inviteLink: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newLink, setNewLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 3000); };

  useEffect(() => {
    try {
      const raw = settings["required_channels"];
      if (raw) setChannels(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [settings]);

  const save = async (updated: typeof channels) => {
    setSaving(true);
    try {
      await onSave("required_channels", JSON.stringify(updated));
      setChannels(updated);
      flash("✅ تم الحفظ");
    } catch {
      flash("❌ خطأ في الحفظ");
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    const username = newUsername.replace(/^@/, "").trim();
    if (!username) { flash("❌ أدخل يوزرنيم القناة"); return; }
    const title = newTitle.trim() || `@${username}`;
    const inviteLink = newLink.trim() || `https://t.me/${username}`;
    const updated = [...channels, { username, title, inviteLink }];
    await save(updated);
    setNewUsername(""); setNewTitle(""); setNewLink("");
    setShowForm(false);
  };

  const handleDelete = async (idx: number) => {
    const updated = channels.filter((_, i) => i !== idx);
    await save(updated);
  };

  return (
    <div className="bg-purple-900/30 border border-purple-700/50 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-bold">🔒 القنوات المطلوبة للاشتراك</h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-3 py-1 rounded-xl text-xs font-bold text-white"
          style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
        >
          {showForm ? "إلغاء" : "➕ إضافة"}
        </button>
      </div>
      <p className="text-purple-400 text-xs mb-3 leading-relaxed">
        المستخدمون الذين حصلوا على مكافآت (لفات) مقابل الانضمام لهذه القنوات سيُحظر عليهم الوصول إذا غادروها.
      </p>

      {msg && (
        <div className="mb-2 text-sm text-center py-1 rounded-lg bg-purple-900/50 text-yellow-300">{msg}</div>
      )}

      {channels.length === 0 && !showForm && (
        <p className="text-purple-500 text-sm text-center py-2">لا توجد قنوات مطلوبة</p>
      )}

      <div className="flex flex-col gap-2 mb-3">
        {channels.map((ch, idx) => (
          <div key={ch.username} className="flex items-center justify-between bg-purple-900/40 rounded-xl px-3 py-2">
            <div>
              <p className="text-white text-sm font-bold">{ch.title}</p>
              <p className="text-purple-400 text-xs">@{ch.username}</p>
            </div>
            <button
              onClick={() => handleDelete(idx)}
              disabled={saving}
              className="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded-lg bg-red-900/20"
            >
              🗑️ حذف
            </button>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="flex flex-col gap-2 border border-purple-600/40 rounded-xl p-3 bg-purple-950/30">
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder="@يوزرنيم القناة (مثال: mychannel)"
            className="bg-purple-900/40 border border-purple-700/50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none w-full"
            dir="ltr"
          />
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="اسم القناة للعرض (اختياري)"
            className="bg-purple-900/40 border border-purple-700/50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none w-full"
          />
          <input
            type="text"
            value={newLink}
            onChange={(e) => setNewLink(e.target.value)}
            placeholder="رابط الدعوة https://t.me/... (اختياري)"
            className="bg-purple-900/40 border border-purple-700/50 rounded-xl px-3 py-2 text-white text-sm focus:outline-none w-full"
            dir="ltr"
          />
          <button
            onClick={handleAdd}
            disabled={saving || !newUsername.trim()}
            className="py-2 rounded-xl font-bold text-white text-sm"
            style={{ background: saving ? "rgba(99,102,241,0.3)" : "linear-gradient(135deg, #6366f1, #8b5cf6)" }}
          >
            {saving ? "جاري الحفظ..." : "✅ إضافة القناة"}
          </button>
        </div>
      )}
    </div>
  );
}

function statusBadge(status: string) {
  switch (status) {
    case "pending":    return { label: "⏳ انتظار",          cls: "bg-orange-900/40 text-orange-400 border-orange-700/40" };
    case "approved":   return { label: "✔ موافق - قيد الإرسال", cls: "bg-blue-900/40 text-blue-300 border-blue-700/40" };
    case "processing": return { label: "⚙️ جاري الإرسال",    cls: "bg-blue-900/40 text-blue-300 border-blue-700/40" };
    case "completed":  return { label: "✅ مكتمل",            cls: "bg-green-900/40 text-green-400 border-green-700/40" };
    case "rejected":   return { label: "✗ مرفوض",            cls: "bg-red-900/40 text-red-400 border-red-700/40" };
    case "failed":     return { label: "❌ فشل الإرسال",      cls: "bg-red-900/40 text-red-400 border-red-700/40" };
    default:           return { label: status,                 cls: "bg-purple-900/40 text-purple-400 border-purple-700/40" };
  }
}

function WithdrawalsTab({ userId }: { userId: number }) {
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  const load = () => {
    setLoading(true);
    api.adminGetWithdrawals(userId).then(setWithdrawals).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [userId]);

  const filtered = filter === "all" ? withdrawals : withdrawals.filter((w) => w.status === filter);

  const counts: Record<string, number> = {};
  for (const w of withdrawals) counts[w.status] = (counts[w.status] || 0) + 1;

  const filterTabs = [
    { key: "all",        label: "الكل" },
    { key: "pending",    label: "انتظار" },
    { key: "approved",   label: "موافق" },
    { key: "completed",  label: "مكتمل" },
    { key: "rejected",   label: "مرفوض" },
    { key: "failed",     label: "فشل" },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-white font-bold">طلبات السحب ({withdrawals.length})</h2>
        <button
          onClick={load}
          disabled={loading}
          className="px-3 py-1.5 rounded-xl text-xs font-bold text-black disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #ffd700, #ffaa00)" }}
        >
          {loading ? "⏳" : "🔄 تحديث"}
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex overflow-x-auto gap-1.5 pb-2 mb-3 scrollbar-hide">
        {filterTabs.map((f) => {
          const cnt = f.key === "all" ? withdrawals.length : (counts[f.key] || 0);
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="flex-shrink-0 px-2.5 py-1 rounded-lg text-xs font-bold transition-all"
              style={{
                background: filter === f.key ? "linear-gradient(135deg, #ffd700, #ffaa00)" : "rgba(147,51,234,0.2)",
                color: filter === f.key ? "#000" : "#a78bfa",
                border: filter === f.key ? "none" : "1px solid rgba(147,51,234,0.4)",
              }}
            >
              {f.label}{cnt > 0 ? ` (${cnt})` : ""}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><div className="w-8 h-8 rounded-full border-2 border-yellow-400 border-t-transparent animate-spin" /></div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.length === 0 && <p className="text-purple-400 text-center py-8 text-sm">لا توجد طلبات</p>}
          {filtered.map((w) => {
            const badge = statusBadge(w.status);
            return (
              <div key={w.id} className="bg-purple-900/20 border border-purple-700/40 rounded-xl p-3">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="text-xs text-purple-500 mb-0.5">#{w.id} • مستخدم {w.userId}</p>
                    <p className="text-yellow-400 font-black text-base">{parseFloat(w.amount).toFixed(4)} TON</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-bold border ${badge.cls}`}>
                    {badge.label}
                  </span>
                </div>
                <p className="text-purple-300 text-xs font-mono break-all mb-1">{w.walletAddress}</p>
                <div className="flex justify-between items-center mt-1">
                  <p className="text-purple-500 text-xs">
                    {new Date(w.createdAt).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" })}
                  </p>
                  {w.txHash && (
                    <p className="text-purple-400 text-xs font-mono">tx: {String(w.txHash).slice(0, 12)}...</p>
                  )}
                  {w.errorMsg && (
                    <p className="text-red-400 text-xs truncate max-w-[120px]" title={w.errorMsg}>⚠ {w.errorMsg}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
