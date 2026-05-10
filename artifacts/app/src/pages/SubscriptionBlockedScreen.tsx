import { useState } from "react";

export interface MissingChannel {
  username: string;
  title: string;
  inviteLink: string;
}

interface Props {
  userId: number;
  missingChannels: MissingChannel[];
  requiredChannels: MissingChannel[];
  onUnblocked: () => Promise<void>;
}

export default function SubscriptionBlockedScreen({
  missingChannels,
  onUnblocked,
}: Props) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRecheck = async () => {
    setChecking(true);
    setError(null);
    try {
      await onUnblocked();
    } catch {
      setError("لا تزال غير مشترك في القنوات المطلوبة");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9000,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(160deg, #0a0812 0%, #120820 50%, #0d0a1a 100%)",
      padding: "28px 20px", textAlign: "center", gap: 0,
      overflowY: "auto",
    }}>
      <div style={{ fontSize: 64, marginBottom: 20, filter: "drop-shadow(0 0 24px rgba(239,68,68,0.5))" }}>
        ⛔
      </div>

      <div style={{
        background: "rgba(239,68,68,0.08)",
        border: "1px solid rgba(239,68,68,0.3)",
        borderRadius: 24,
        padding: "28px 22px",
        maxWidth: 360,
        width: "100%",
        marginBottom: 20,
      }}>
        <h2 style={{
          color: "#f87171",
          fontWeight: 900,
          fontSize: 20,
          margin: "0 0 10px",
          lineHeight: 1.4,
        }}>
          غادرت قناة مطلوبة!
        </h2>
        <p style={{
          color: "rgba(255,255,255,0.6)",
          fontSize: 13,
          margin: "0 0 20px",
          lineHeight: 1.7,
          direction: "rtl",
        }}>
          حصلت على مكافآت مقابل الانضمام للقنوات المطلوبة.
          يجب عليك البقاء مشتركاً للاستمرار في استخدام التطبيق.
        </p>

        <div style={{
          background: "rgba(0,0,0,0.3)",
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 6,
        }}>
          <p style={{
            color: "rgba(255,255,255,0.5)",
            fontSize: 12,
            margin: "0 0 10px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: 600,
          }}>
            القنوات المطلوبة للانضمام
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {missingChannels.map((ch) => {
              const link = ch.inviteLink || `https://t.me/${ch.username.replace(/^@/, "")}`;
              return (
                <a
                  key={ch.username}
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    background: "rgba(239,68,68,0.12)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    borderRadius: 12,
                    padding: "10px 14px",
                    textDecoration: "none",
                    transition: "transform 0.15s",
                  }}
                >
                  <span style={{ fontSize: 20 }}>📢</span>
                  <div style={{ flex: 1, textAlign: "right", direction: "rtl" }}>
                    <div style={{ color: "#fff", fontWeight: 700, fontSize: 14 }}>
                      {ch.title || `@${ch.username}`}
                    </div>
                    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>
                      ⚠️ غير مشترك
                    </div>
                  </div>
                  <span style={{
                    background: "rgba(99,102,241,0.8)",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: 8,
                    whiteSpace: "nowrap",
                  }}>
                    انضمام ➞
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      </div>

      {error && (
        <div style={{
          color: "#f87171", fontSize: 13, marginBottom: 12,
          background: "rgba(239,68,68,0.1)", borderRadius: 10,
          padding: "8px 16px", border: "1px solid rgba(239,68,68,0.2)",
        }}>
          {error}
        </div>
      )}

      <button
        onClick={handleRecheck}
        disabled={checking}
        style={{
          width: "100%",
          maxWidth: 360,
          padding: "16px",
          borderRadius: 16,
          border: "none",
          background: checking
            ? "rgba(99,102,241,0.4)"
            : "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
          color: "#fff",
          fontSize: 16,
          fontWeight: 800,
          cursor: checking ? "not-allowed" : "pointer",
          boxShadow: checking ? "none" : "0 4px 20px rgba(99,102,241,0.4)",
          transition: "all 0.2s",
          marginBottom: 12,
        }}
      >
        {checking ? "⏳ جاري التحقق..." : "🔄 تحققت من الاشتراك"}
      </button>

      <p style={{
        color: "rgba(255,255,255,0.3)",
        fontSize: 11,
        margin: 0,
        direction: "rtl",
        lineHeight: 1.6,
      }}>
        بعد الانضمام، اضغط زر التحقق أعلاه لاستعادة الوصول
      </p>
    </div>
  );
}
