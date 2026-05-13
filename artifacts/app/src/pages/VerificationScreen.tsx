import { useState, useEffect, useRef } from "react";
import { api } from "../lib/api";
import TgEmoji from "../components/TgEmoji";
import EmojiText from "../components/EmojiText";

const STYLES = `
@keyframes vf-fadein {
  from { opacity: 0; transform: scale(0.92) translateY(18px); }
  to   { opacity: 1; transform: scale(1)    translateY(0); }
}
@keyframes vf-slide {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes vf-pulse {
  0%, 100% { transform: scale(1); }
  50%       { transform: scale(1.08); }
}
@keyframes vf-spin-slow {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes vf-ripple {
  0%   { transform: scale(0); opacity: 0.5; }
  100% { transform: scale(2.5); opacity: 0; }
}
@keyframes vf-success-pop {
  0%   { transform: scale(0.5); opacity: 0; }
  60%  { transform: scale(1.15); }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes vf-banned-shake {
  0%,100% { transform: translateX(0); }
  20%     { transform: translateX(-8px); }
  40%     { transform: translateX(8px); }
  60%     { transform: translateX(-5px); }
  80%     { transform: translateX(5px); }
}
@keyframes vf-countdown-ring {
  from { stroke-dashoffset: 100; }
  to   { stroke-dashoffset: 0; }
}

.vf-card {
  animation: vf-fadein 0.45s cubic-bezier(0.34,1.56,0.64,1) both;
}
.vf-emoji-top {
  animation: vf-pulse 2.8s ease-in-out infinite;
  display: inline-block;
}
.vf-row-0 { animation: vf-slide 0.4s 0.15s both; }
.vf-row-1 { animation: vf-slide 0.4s 0.25s both; }
.vf-row-2 { animation: vf-slide 0.4s 0.35s both; }
.vf-row-3 { animation: vf-slide 0.4s 0.45s both; }
.vf-row-4 { animation: vf-slide 0.4s 0.55s both; }
.vf-row-5 { animation: vf-slide 0.4s 0.65s both; }

.vf-btn {
  position: relative; overflow: hidden;
  transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
}
.vf-btn:not(:disabled):active {
  transform: scale(0.96);
  box-shadow: 0 2px 12px rgba(92,64,255,0.35) !important;
}
.vf-btn::after {
  content: '';
  position: absolute; inset: 50% 50%; border-radius: 50%;
  background: rgba(255,255,255,0.25);
  animation: none;
}
.vf-btn:not(:disabled):active::after {
  animation: vf-ripple 0.5s ease-out forwards;
}

.vf-success-icon { animation: vf-success-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) both; }
.vf-banned-icon  { animation: vf-banned-shake 0.55s 0.1s both; }
`;

async function collectDeviceFingerprint(): Promise<string> {
  const signals: string[] = [
    navigator.userAgent,
    navigator.language,
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(navigator.hardwareConcurrency || 0),
    String((navigator as unknown as { deviceMemory?: number }).deviceMemory || 0),
    String(navigator.maxTouchPoints || 0),
  ];
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 220; canvas.height = 30;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.textBaseline = "alphabetic";
      ctx.font = "14px Arial";
      ctx.fillStyle = "#7c6eff";
      ctx.fillRect(0, 0, 10, 10);
      ctx.fillStyle = "rgba(0,200,120,0.8)";
      ctx.fillText("JojoxVerify🎰2025", 2, 20);
      signals.push(canvas.toDataURL().slice(-64));
    }
  } catch { signals.push(""); }
  // Send raw signals (not hash) so server can do weighted similarity matching
  return signals.join("|||");
}

function closeMiniApp() {
  const tg = (window as unknown as { Telegram?: { WebApp?: { close(): void } } }).Telegram?.WebApp;
  if (tg) tg.close();
}

interface Props {
  firstName: string;
  onVerified: () => void;
  onBanned: () => void;
}
type Status = "idle" | "loading" | "success" | "banned" | "error";

export default function VerificationScreen({ firstName, onVerified, onBanned }: Props) {
  const [status, setStatus]     = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [countdown, setCountdown] = useState(3);
  const styleInjected = useRef(false);

  useEffect(() => {
    if (styleInjected.current) return;
    styleInjected.current = true;
    const el = document.createElement("style");
    el.textContent = STYLES;
    document.head.appendChild(el);
    return () => { el.remove(); };
  }, []);

  useEffect(() => {
    if (status !== "banned" && status !== "success") return;
    setCountdown(3);
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(interval);
          closeMiniApp();
          if (status === "banned") onBanned(); else onVerified();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  const handleVerify = async () => {
    setStatus("loading");
    setErrorMsg("");
    try {
      const deviceId = await collectDeviceFingerprint();
      await api.verifyDevice(deviceId);
      setStatus("success");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unexpected error";
      if (msg === "محظور") { setStatus("banned"); return; }
      setErrorMsg(msg);
      setStatus("error");
    }
  };

  const WRAP: React.CSSProperties = {
    position: "fixed", inset: 0, zIndex: 9999,
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    padding: "28px 20px",
  };

  if (status === "success") {
    return (
      <div style={{ ...WRAP, background: "radial-gradient(ellipse at 50% 0%, #062010 0%, #020e06 100%)" }}>
        <div className="vf-card" style={{
          background: "linear-gradient(145deg, rgba(12,40,22,0.98), rgba(6,24,12,0.98))",
          border: "1px solid rgba(34,197,94,0.35)",
          borderRadius: 26, padding: "40px 28px",
          maxWidth: 340, width: "100%", textAlign: "center",
          boxShadow: "0 24px 64px rgba(0,0,0,0.65), 0 0 60px rgba(34,197,94,0.08)",
        }}>
          <div className="vf-success-icon" style={{ fontSize: 76, marginBottom: 18, lineHeight: 1 }}>✅</div>
          <h2 className="vf-row-0" style={{ color: "#22c55e", fontSize: 22, fontWeight: 900, margin: "0 0 10px" }}>
            Device verified successfully!
          </h2>
          <p className="vf-row-1" style={{ color: "rgba(255,255,255,0.65)", fontSize: 14, lineHeight: 1.8, margin: "0 0 22px" }}>
            Welcome to Jo-jokes 🎰<br />You can now enter and start winning.
          </p>
          <div className="vf-row-2" style={{
            background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.18)",
            borderRadius: 14, padding: "13px 16px",
            color: "rgba(255,255,255,0.4)", fontSize: 13,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <span style={{ animation: "vf-spin-slow 3s linear infinite", display: "inline-block" }}>🔄</span>
            Closing in {countdown} seconds...
          </div>
        </div>
      </div>
    );
  }

  if (status === "banned") {
    return (
      <div style={{ ...WRAP, background: "radial-gradient(ellipse at 50% 0%, #200606 0%, #0e0202 100%)" }}>
        <div className="vf-card" style={{
          background: "linear-gradient(145deg, rgba(42,6,6,0.98), rgba(24,4,4,0.98))",
          border: "1px solid rgba(239,68,68,0.38)",
          borderRadius: 26, padding: "40px 28px",
          maxWidth: 340, width: "100%", textAlign: "center",
          boxShadow: "0 24px 64px rgba(0,0,0,0.65), 0 0 60px rgba(239,68,68,0.08)",
        }}>
          <div className="vf-banned-icon" style={{ fontSize: 76, marginBottom: 18, lineHeight: 1 }}>
            <TgEmoji id="6132089060933505983" fallback="🚫" size={72} />
          </div>
          <h2 className="vf-row-0" style={{ color: "#ef4444", fontSize: 20, fontWeight: 900, margin: "0 0 14px" }}>
            تم كشف تعدد حسابات وتم حظر حسابك
          </h2>
          <div className="vf-row-1" style={{
            background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: 16, padding: "14px 16px", marginBottom: 18, textAlign: "right",
          }}>
            {[
              { id: "6127546183830212440", fb: "🛑", text: "هذا الجهاز مرتبط بحساب آخر." },
              { id: "6132089060933505983", fb: "🚫", text: "تم حظر حسابك تلقائياً." },
              { id: "5420323339723881652", fb: "⚠️", text: "جهاز واحد = حساب واحد فقط." },
            ].map(({ id, fb, text }, i) => (
              <div key={id} className={`vf-row-${i + 2}`} style={{
                display: "flex", alignItems: "center", gap: 10,
                marginBottom: i < 2 ? 10 : 0, fontSize: 13, color: "rgba(255,255,255,0.72)",
              }}>
                <TgEmoji id={id} fallback={fb} size={17} />
                <span>{text}</span>
              </div>
            ))}
          </div>
          <div className="vf-row-5" style={{
            background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)",
            borderRadius: 12, padding: "11px 14px",
            color: "rgba(255,255,255,0.38)", fontSize: 13,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            <TgEmoji id="5375338737028841420" fallback="🔄" size={15} />
            Closing in {countdown} seconds...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...WRAP, background: "radial-gradient(ellipse at 50% 0%, #0f0f22 0%, #07071a 100%)" }}>
      <div className="vf-card" style={{
        background: "linear-gradient(145deg, rgba(22,22,46,0.97), rgba(14,14,30,0.97))",
        border: "1px solid rgba(124,110,255,0.28)",
        borderRadius: 26, padding: "36px 26px",
        maxWidth: 340, width: "100%", textAlign: "center",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 80px rgba(92,64,255,0.06)",
      }}>
        {/* ── Top icon — EmojiText parses 🎡(ID) automatically ── */}
        <div className="vf-row-0" style={{ marginBottom: 14 }}>
          <span className="vf-emoji-top" style={{ lineHeight: 1, display: "inline-block" }}>
            <EmojiText text="🎡(5226711870492126219)" size={68} />
          </span>
        </div>

        <h2 className="vf-row-1" style={{
          color: "#fff", fontSize: 23, fontWeight: 900, margin: "0 0 8px",
          textShadow: "0 0 28px rgba(124,110,255,0.4)",
        }}>
          Welcome, {firstName}!
        </h2>

        <p className="vf-row-2" style={{
          color: "rgba(255,255,255,0.52)", fontSize: 13.5,
          lineHeight: 1.85, margin: "0 0 22px",
        }}>
          A quick step to verify your account<br />
          and secure your Jo-jokes platform.
        </p>

        {/* ── Feature list — full text lines with inline emoji IDs ── */}
        <div className="vf-row-3" style={{
          background: "rgba(124,110,255,0.07)", border: "1px solid rgba(124,110,255,0.18)",
          borderRadius: 16, padding: "14px 18px", marginBottom: 22, textAlign: "left",
        }}>
          {[
            "✅(6132003286141637383) One account per device",
            "🔒(5296369303661067030) Your data is never shared",
            "☄️(5224607267797606837) Verification takes one second",
          ].map((line, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 10,
              marginBottom: i < 2 ? 10 : 0,
              fontSize: 13.5, color: "rgba(255,255,255,0.78)",
            }}>
              <EmojiText text={line} size={18} />
            </div>
          ))}
        </div>

        {status === "error" && (
          <div className="vf-row-4" style={{
            background: "rgba(255,90,90,0.08)", border: "1px solid rgba(255,90,90,0.25)",
            borderRadius: 12, padding: "10px 14px",
            marginBottom: 14, color: "#ff7a7a", fontSize: 13,
          }}>
            ⚠️ {errorMsg}
          </div>
        )}

        {/* ── CTA button — emoji parsed from text ── */}
        <div className="vf-row-5">
          <button
            className="vf-btn"
            onClick={handleVerify}
            disabled={status === "loading"}
            style={{
              width: "100%", padding: "16px 20px",
              background: status === "loading"
                ? "rgba(92,64,255,0.38)"
                : "linear-gradient(135deg, #7c6eff 0%, #5a4ee0 100%)",
              color: "#fff", border: "none", borderRadius: 15,
              fontSize: 16, fontWeight: 800,
              cursor: status === "loading" ? "not-allowed" : "pointer",
              letterSpacing: 0.4,
              boxShadow: status === "loading" ? "none" : "0 6px 28px rgba(92,64,255,0.45)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
            }}
          >
            {status === "loading" ? (
              <>
                <span style={{ animation: "vf-spin-slow 0.8s linear infinite", display: "inline-block" }}>⏳</span>
                Verifying...
              </>
            ) : (
              <EmojiText text="🔒(5296369303661067030) Verify & Enter Now" size={18} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
