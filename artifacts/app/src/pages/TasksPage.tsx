import { useState, useEffect } from "react";
import { useUser } from "../lib/userContext";
import { api, Task, getTasksOnce, getCompletedTasksOnce, invalidateUserCaches } from "../lib/api";
import { CheckCircle, ExternalLink, Clock, Zap, Sparkles } from "lucide-react";

export default function TasksPage() {
  const { user, refresh, initialized, retryInit } = useUser();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completed, setCompleted] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<number | null>(null);
  const [urlOpened, setUrlOpened] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<{ taskId: number; text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!initialized) return;
    if (!user) { setLoading(false); return; }
    Promise.all([getTasksOnce(), getCompletedTasksOnce(user.id)])
      .then(([t, c]) => {
        setTasks(t);
        setCompleted(c);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user, initialized]);

  const handleOpenUrl = (task: Task) => {
    window.open(task.url!, "_blank");
    setUrlOpened((prev) => new Set([...prev, task.id]));
  };

  const handleVerify = async (task: Task) => {
    if (!user || completing !== null) return;
    setCompleting(task.id);
    try {
      await api.completeTask(task.id, user.id);
      invalidateUserCaches(user.id);
      setCompleted((prev) => [...prev, task.id]);
      setMessage({ taskId: task.id, text: "✅ Task completed!", type: "success" });
      await refresh();
    } catch (e: unknown) {
      setMessage({ taskId: task.id, text: e instanceof Error ? e.message : "Failed", type: "error" });
    } finally {
      setCompleting(null);
      setTimeout(() => setMessage(null), 4000);
    }
  };

  const handleComplete = async (task: Task) => {
    if (!user || completing !== null) return;
    if (task.url) {
      if (!urlOpened.has(task.id)) { handleOpenUrl(task); return; }
      await handleVerify(task);
    } else {
      await handleVerify(task);
    }
  };

  const progressToNextSpin = user ? (user.tasksCompleted % 5) : 0;
  const remaining = 5 - progressToNextSpin;
  const pct = (progressToNextSpin / 5) * 100;

  const activeTasks = tasks.filter((t) => !completed.includes(t.id));
  const doneTasks = tasks.filter((t) => completed.includes(t.id));

  return (
    <div className="page-content" style={{ display: "flex", flexDirection: "column" }}>

      {/* ── Sticky Progress Bar wrapper ── */}
      <div style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        padding: "12px 12px 0",
        background: "linear-gradient(to bottom, rgba(8,6,22,1) 85%, rgba(8,6,22,0))",
      }}>
      {/* ── Hero Progress Card ── */}
      <div className="slide-up" style={{
        position: "relative",
        padding: "16px 16px 14px",
        borderRadius: 22,
        overflow: "hidden",
        background:
          "radial-gradient(120% 100% at 0% 0%, rgba(251,191,36,0.18) 0%, rgba(139,92,246,0.10) 45%, rgba(8,6,22,0.85) 100%)",
        border: "1px solid rgba(251,191,36,0.22)",
        backdropFilter: "blur(22px) saturate(160%)",
        WebkitBackdropFilter: "blur(22px) saturate(160%)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}>
        {/* sheen */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "radial-gradient(80% 60% at 100% 0%, rgba(251,191,36,0.12), transparent 60%)",
        }} />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 12, flexShrink: 0,
            background: "linear-gradient(135deg, rgba(251,191,36,0.30), rgba(245,158,11,0.10))",
            border: "1px solid rgba(251,191,36,0.40)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 14px rgba(251,191,36,0.25)",
          }}>
            <Sparkles size={18} color="#fbbf24" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 14, lineHeight: 1.2 }}>
              Earn a free spin
            </div>
            <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, marginTop: 2 }}>
              {remaining === 0 ? "🎉 Spin unlocked! Go to home" : `${remaining} more ${remaining === 1 ? "task" : "tasks"} to unlock`}
            </div>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "rgba(0,0,0,0.30)", border: "1px solid rgba(251,191,36,0.32)",
            borderRadius: 999, padding: "5px 11px",
            boxShadow: "0 0 10px rgba(251,191,36,0.12)",
          }}>
            <Zap size={11} color="#fbbf24" fill="#fbbf24" />
            <span style={{ color: "#fbbf24", fontWeight: 900, fontSize: 12, letterSpacing: 0.3 }}>
              {progressToNextSpin}<span style={{ opacity: 0.5 }}>/5</span>
            </span>
          </div>
        </div>

        {/* Step bubbles */}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginBottom: 10 }}>
          {Array.from({ length: 5 }, (_, i) => {
            const done = i < progressToNextSpin;
            return (
              <div key={i} style={{
                flex: 1, height: 8, borderRadius: 999,
                background: done
                  ? "linear-gradient(90deg, #fde68a, #fbbf24, #f59e0b)"
                  : "rgba(255,255,255,0.07)",
                boxShadow: done ? "0 0 8px rgba(251,191,36,0.45)" : "inset 0 1px 0 rgba(255,255,255,0.04)",
                transition: "all 0.4s",
              }} />
            );
          })}
        </div>

      </div>
      </div>{/* ── end sticky wrapper ── */}

      {/* ── Scrollable tasks content ── */}
      <div style={{ padding: "8px 12px 24px", display: "flex", flexDirection: "column", gap: 8 }}>

      {/* ── Section title ── */}
      {!loading && activeTasks.length > 0 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "2px 4px", marginTop: 2,
        }}>
          <span style={{
            color: "rgba(255,255,255,0.85)", fontWeight: 800, fontSize: 13,
            letterSpacing: 0.3,
          }}>
            Available Tasks
          </span>
          <span style={{
            color: "rgba(255,255,255,0.40)", fontSize: 11, fontWeight: 600,
          }}>
            {activeTasks.length} available
          </span>
        </div>
      )}

      {/* ── Tasks list ── */}
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "36px 0" }}>
          <div style={{
            width: 34, height: 34, borderRadius: "50%",
            border: "2.5px solid rgba(251,191,36,0.70)", borderTopColor: "transparent",
            animation: "spin 0.75s linear infinite",
          }} />
        </div>
      ) : (initialized && !user) ? (
        <div style={{
          textAlign: "center", padding: "40px 18px", borderRadius: 22, marginTop: 4,
          background: "rgba(255,255,255,0.025)", border: "1px dashed rgba(255,100,100,0.20)",
        }}>
          <div style={{ fontSize: 38, marginBottom: 10 }}>⚠️</div>
          <p style={{ color: "rgba(255,255,255,0.70)", fontSize: 13, fontWeight: 700, margin: 0 }}>
            Connection Error
          </p>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, marginTop: 5, marginBottom: 16 }}>
            Could not reach the server
          </p>
          <button
            onClick={retryInit}
            style={{
              padding: "10px 24px", borderRadius: 12, border: "1px solid rgba(251,191,36,0.40)",
              background: "rgba(251,191,36,0.10)", color: "#fbbf24", fontWeight: 700,
              fontSize: 13, fontFamily: "inherit", cursor: "pointer",
            }}
          >
            🔄 Retry Connection
          </button>
        </div>
      ) : activeTasks.length === 0 ? (
        <div style={{
          textAlign: "center", padding: "40px 18px", borderRadius: 22, marginTop: 4,
          background: "rgba(255,255,255,0.025)", border: "1px dashed rgba(255,255,255,0.10)",
        }}>
          <div style={{ fontSize: 38, marginBottom: 10, opacity: 0.5 }}>
            {tasks.length === 0 ? "📋" : "✅"}
          </div>
          <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 700, margin: 0 }}>
            {tasks.length === 0 ? "No tasks available" : "All tasks completed!"}
          </p>
          <p style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, marginTop: 5 }}>
            {tasks.length === 0 ? "Check back soon for new rewards" : "You've completed all available tasks"}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {activeTasks.map((task) => {
            const isDone = completed.includes(task.id);
            const isExpiring = task.expiresAt && new Date(task.expiresAt).getTime() - Date.now() < 3600000;
            const isOpened = urlOpened.has(task.id);
            const showOpen = task.url && !isOpened && !isDone;

            return (
              <div key={task.id} className="slide-up" style={{
                position: "relative",
                padding: "12px 12px",
                borderRadius: 18,
                backdropFilter: "blur(18px)",
                WebkitBackdropFilter: "blur(18px)",
                border: isDone ? "1px solid rgba(16,185,129,0.28)" : "1px solid rgba(255,255,255,0.08)",
                background: isDone
                  ? "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(8,6,22,0.65))"
                  : "linear-gradient(135deg, rgba(20,16,42,0.65), rgba(8,6,22,0.78))",
                boxShadow: "0 4px 18px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.04)",
                opacity: isDone ? 0.78 : 1,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  {/* Task icon */}
                  <div style={{
                    width: 46, height: 46, borderRadius: 14, flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22, overflow: "hidden", position: "relative",
                    background: isDone
                      ? "rgba(16,185,129,0.12)"
                      : "linear-gradient(135deg, rgba(139,92,246,0.18), rgba(56,189,248,0.10))",
                    border: isDone
                      ? "1.5px solid rgba(16,185,129,0.32)"
                      : "1.5px solid rgba(139,92,246,0.25)",
                    boxShadow: isDone
                      ? "0 0 12px rgba(16,185,129,0.18)"
                      : "0 0 12px rgba(139,92,246,0.15)",
                  }}>
                    {task.channelPhotoUrl ? (
                      <img src={task.channelPhotoUrl} alt={task.title}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                      />
                    ) : (task.icon || "⭐")}
                  </div>

                  {/* Task info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
                      <span style={{
                        color: isDone ? "rgba(255,255,255,0.65)" : "#fff",
                        fontWeight: 700, fontSize: 13.5,
                        textDecoration: isDone ? "line-through" : "none",
                        textDecorationColor: "rgba(255,255,255,0.30)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        flex: 1, minWidth: 0,
                      }}>{task.title}</span>
                      {isExpiring && !isDone && (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 3,
                          color: "#fb923c", fontSize: 9, flexShrink: 0, fontWeight: 700,
                          background: "rgba(249,115,22,0.14)", padding: "2px 7px", borderRadius: 999,
                          border: "1px solid rgba(249,115,22,0.28)",
                        }}>
                          <Clock size={9} /> Soon
                        </span>
                      )}
                    </div>
                    {task.description && (
                      <p style={{
                        color: "rgba(255,255,255,0.40)", fontSize: 11.5, fontWeight: 500,
                        margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>
                        {task.description}
                      </p>
                    )}
                    {!isDone && (
                      <div style={{
                        display: "inline-flex", alignItems: "center", gap: 3, marginTop: 5,
                        background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.22)",
                        borderRadius: 999, padding: "2px 8px",
                      }}>
                        <Zap size={9} color="#fbbf24" fill="#fbbf24" />
                        <span style={{ color: "#fbbf24", fontSize: 9.5, fontWeight: 800, letterSpacing: 0.2 }}>
                          +1/5 → spin
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Action button */}
                  <div style={{ flexShrink: 0 }}>
                    {isDone ? (
                      <div style={{
                        width: 36, height: 36, borderRadius: 12,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "rgba(16,185,129,0.15)",
                        border: "1px solid rgba(16,185,129,0.30)",
                        boxShadow: "0 0 10px rgba(16,185,129,0.15)",
                      }}>
                        <CheckCircle size={19} color="#34d399" />
                      </div>
                    ) : (
                      <button
                        onClick={() => handleComplete(task)}
                        disabled={completing === task.id}
                        style={{
                          display: "flex", alignItems: "center", gap: 4,
                          padding: "9px 14px", borderRadius: 12, fontWeight: 800, fontSize: 12,
                          border: "none", cursor: "pointer", fontFamily: "inherit",
                          background: showOpen
                            ? "linear-gradient(135deg, #60a5fa, #3b82f6)"
                            : "linear-gradient(135deg, #fde68a, #fbbf24, #f59e0b)",
                          color: showOpen ? "#fff" : "#0a0600",
                          boxShadow: showOpen
                            ? "0 4px 14px rgba(59,130,246,0.45)"
                            : "0 4px 14px rgba(251,191,36,0.45)",
                          opacity: completing === task.id ? 0.55 : 1,
                          whiteSpace: "nowrap",
                          transition: "all 0.2s",
                        }}
                      >
                        {showOpen
                          ? <><ExternalLink size={11} /> Open</>
                          : completing === task.id ? "..." : <><CheckCircle size={11} /> Verify</>}
                      </button>
                    )}
                  </div>
                </div>

                {message?.taskId === task.id && (
                  <div style={{
                    fontSize: 11, marginTop: 9, padding: "7px 10px", borderRadius: 10,
                    background: message.type === "success" ? "rgba(16,185,129,0.10)" : "rgba(248,113,113,0.10)",
                    color: message.type === "success" ? "#34d399" : "#fca5a5",
                    border: `1px solid ${message.type === "success" ? "rgba(16,185,129,0.22)" : "rgba(248,113,113,0.22)"}`,
                    display: "flex", alignItems: "center", gap: 5, fontWeight: 600,
                  }}>
                    {message.text}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>{/* ── end scrollable tasks content ── */}
    </div>
  );
}
