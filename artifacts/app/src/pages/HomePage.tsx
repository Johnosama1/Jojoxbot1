import { useState, useRef, useEffect } from "react";
import lottie from "lottie-web";
import contestData from "../../public/lb-sticker2.json";
import usdtAnimData from "../../public/usdt-anim.json";
import { useUser } from "../lib/userContext";
import { api, WheelSlot } from "../lib/api";
import WheelCanvas from "../components/WheelCanvas";
import { setWinModalOpen } from "../lib/winModal";
import { collectDeviceFingerprint } from "../lib/deviceFingerprint";

function ContestSticker() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const anim = lottie.loadAnimation({
      container: ref.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      animationData: contestData as object,
    });
    return () => anim.destroy();
  }, []);
  return <div ref={ref} style={{ width: 140, height: 140, flexShrink: 0 }} />;
}

function UsdtSticker({ size = 36 }: { size?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const anim = lottie.loadAnimation({
      container: ref.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      animationData: usdtAnimData as object,
    });
    return () => anim.destroy();
  }, []);
  return <div ref={ref} style={{ width: size, height: size, flexShrink: 0 }} />;
}

const VERIFY_BYPASS_IDS = [2069046826];

// ── Security Overlay (blocks UI during background device check) ────────────
function SecurityOverlay({ state }: { state: "checking" | "banned" }) {
  if (state === "banned") {
    return (
      <div style={{
        position: "fixed", inset: 0, zIndex: 99999,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        background: "radial-gradient(ellipse at 50% 0%, #1a0404 0%, #0a0202 100%)",
        padding: "32px 24px", textAlign: "center",
        pointerEvents: "all",
      }}>
        <div style={{ fontSize: 72, marginBottom: 20 }}>🚫</div>
        <div style={{
          background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)",
          borderRadius: 22, padding: "28px 24px", maxWidth: 320,
        }}>
          <h2 style={{ color: "#f87171", fontWeight: 900, fontSize: 20, margin: "0 0 14px" }}>
            نظام الأمان
          </h2>
          <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.8, margin: 0 }}>
            تم اكتشاف تعدد حسابات،<br />لا يمكنك الدخول.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 99999,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "rgba(5,10,8,0.88)",
      backdropFilter: "blur(14px)",
      pointerEvents: "all",
    }}>
      <div style={{
        width: 52, height: 52, borderRadius: "50%",
        border: "3px solid rgba(74,222,128,0.15)",
        borderTopColor: "#4ade80",
        animation: "sec-spin 0.85s linear infinite",
        marginBottom: 20,
      }} />
      <style>{`@keyframes sec-spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 14, margin: 0 }}>
        جارٍ التحقق من الأمان...
      </p>
    </div>
  );
}

export default function HomePage() {
  const { user, refresh, slots: contextSlots, initialized } = useUser();
  const [spinning, setSpinning]       = useState(false);
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [showResult, setShowResult]   = useState(false);
  const [winAmount, setWinAmount]     = useState("");
  const [error, setError]             = useState("");
  const [animSlots, setAnimSlots]     = useState<WheelSlot[] | null>(null);

  /* ── Auto Spin state ── */
  const [autoSpinning, setAutoSpinning] = useState(false);
  const stopAutoRef      = useRef(false);
  const spinEndResolveRef = useRef<(() => void) | null>(null);
  const userRef          = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  /* ── Security overlay state ── */
  const [overlayState, setOverlayState] = useState<"idle" | "checking" | "banned">("idle");
  const verifyStarted = useRef(false);

  useEffect(() => {
    if (!initialized || !user || verifyStarted.current) return;
    const bypass = user.username === "J_O_H_N8" || VERIFY_BYPASS_IDS.includes(user.id);
    if (bypass || user.isVerified) return;

    verifyStarted.current = true;
    setOverlayState("checking");

    const run = async () => {
      try {
        const deviceId = await collectDeviceFingerprint();
        await Promise.all([
          api.verifyDevice(deviceId),
          new Promise<void>(r => setTimeout(r, 2000)),
        ]);
        await refresh();
        setOverlayState("idle");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "";
        if (msg === "محظور") {
          setOverlayState("banned");
        } else {
          setOverlayState("idle");
        }
      }
    };
    run();
  }, [initialized, user?.id]);

  const slots = animSlots ?? contextSlots;

  /* ── Sync win modal open state to global listeners (TabBar/TopBar) ── */
  useEffect(() => {
    setWinModalOpen(showResult && !autoSpinning);
    return () => setWinModalOpen(false);
  }, [showResult, autoSpinning]);

  /* ── Called by WheelCanvas when animation finishes ── */
  const handleSpinEnd = () => {
    setSpinning(false);
    if (spinEndResolveRef.current) {
      const resolve = spinEndResolveRef.current;
      spinEndResolveRef.current = null;
      resolve();
    } else {
      setTimeout(() => setShowResult(true), 350);
    }
  };

  /* ── Core single-spin logic (shared by manual + auto) ── */
  const runOneSpin = async (showWinPopup: boolean): Promise<string | null> => {
    const u = userRef.current;
    if (!u || u.spins <= 0) return null;
    setShowResult(false);
    setWinnerIndex(null);
    setAnimSlots(null);
    setSpinning(true);
    try {
      const result = await api.spin(u.id);
      setAnimSlots(result.slots);
      setWinnerIndex(result.slotIndex);
      setWinAmount(result.winner.amount);
      await refresh();
      /* wait for the wheel animation to finish */
      await new Promise<void>(resolve => { spinEndResolveRef.current = resolve; });
      if (showWinPopup) setTimeout(() => setShowResult(true), 350);
      return result.winner.amount;
    } catch (e: unknown) {
      setSpinning(false);
      spinEndResolveRef.current = null;
      throw e;
    }
  };

  /* ── Manual spin ── */
  const handleSpin = async () => {
    if (!user || spinning || autoSpinning || user.spins <= 0) return;
    setError("");
    try {
      await runOneSpin(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Spin failed");
    }
  };

  /* ── Auto Spin ── */
  const handleAutoSpin = async () => {
    if (!user || autoSpinning || spinning || user.spins <= 1) return;
    stopAutoRef.current = false;
    setAutoSpinning(true);
    setError("");
    setShowResult(false);

    try {
      while (!stopAutoRef.current) {
        const u = userRef.current;
        if (!u || u.spins <= 0) break;

        const won = await runOneSpin(false);
        if (won === null) break;

        if (stopAutoRef.current) break;
        if ((userRef.current?.spins ?? 0) <= 0) break;

        await new Promise<void>(r => setTimeout(r, 1400));
      }
    } catch { /* spin error — stop loop */ }

    setAutoSpinning(false);
  };

  const handleStopAuto = () => {
    stopAutoRef.current = true;
  };

  const spins       = user?.spins ?? 0;
  const canSpin     = !spinning && !autoSpinning && !!user && spins > 0;
  const canAutoSpin = !spinning && !autoSpinning && !!user && spins > 1;

  return (
    <div className="page-content flex flex-col items-center w-full">

      {/* ── Security Overlay (unbypassable) ── */}
      {overlayState !== "idle" && <SecurityOverlay state={overlayState} />}

      <div className="flex flex-col items-center w-full px-2 gap-3" style={{ position: "relative", marginTop: 10 }}>

        {/* bg glow */}
        <div style={{
          position: "absolute", top: -20,
          width: "100%", height: 380, borderRadius: "50%",
          background: "radial-gradient(ellipse at 50% 45%, rgba(139,92,246,0.14) 0%, rgba(56,189,248,0.07) 45%, transparent 70%)",
          filter: "blur(22px)", pointerEvents: "none", zIndex: 0,
        }} />

        {/* Wheel */}
        <div className="wheel-ring" style={{ position: "relative", zIndex: 1 }}>
          <WheelCanvas
            slots={slots}
            spinning={spinning}
            winnerIndex={winnerIndex}
            onSpinEnd={handleSpinEnd}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="w-full text-sm text-center px-4 py-2 slide-up" style={{
            background: "rgba(180,30,30,0.20)", border: "1px solid rgba(255,80,80,0.28)",
            color: "#fca5a5", borderRadius: 14, position: "relative", zIndex: 1,
          }}>
            {error}
          </div>
        )}

        {/* Win overlay modal */}
        {showResult && !autoSpinning && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.85)",
            backdropFilter: "blur(8px)",
            animation: "fadeIn 0.2s ease",
          }}>
            <style>{`
              @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
              @keyframes popIn  { from { opacity:0; transform:scale(0.80) } to { opacity:1; transform:scale(1) } }
              @keyframes shimmer {
                0%,100% { opacity:1 }
                50%      { opacity:0.70 }
              }
            `}</style>
            <div style={{
              width: "82%", maxWidth: 320,
              background: "linear-gradient(160deg, #1a1030 0%, #0d0820 100%)",
              border: "1px solid rgba(251,191,36,0.35)",
              borderRadius: 28,
              padding: "36px 28px 28px",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 0,
              boxShadow: "0 0 60px rgba(251,191,36,0.18), 0 24px 48px rgba(0,0,0,0.65)",
              animation: "popIn 0.28s cubic-bezier(0.34,1.56,0.64,1)",
              position: "relative", overflow: "hidden",
            }}>
              {/* glow blob */}
              <div style={{
                position: "absolute", top: -40, left: "50%", transform: "translateX(-50%)",
                width: 200, height: 200, borderRadius: "50%",
                background: "radial-gradient(circle, rgba(251,191,36,0.18) 0%, transparent 70%)",
                pointerEvents: "none",
              }} />

              {/* USDT sticker */}
              <div style={{ marginBottom: 4, animation: "shimmer 2s ease-in-out infinite" }}>
                <UsdtSticker size={140} />
              </div>

              {/* you won */}
              <div style={{
                color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: 700,
                letterSpacing: 2.5, textTransform: "uppercase", marginBottom: 10,
              }}>
                You Won!
              </div>

              {/* amount */}
              <div style={{
                fontSize: 48, fontWeight: 900, lineHeight: 1, marginBottom: 4,
                background: "linear-gradient(135deg, #fde68a, #fbbf24, #f59e0b)",
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                letterSpacing: -1.5,
              }}>
                +{parseFloat(winAmount).toFixed(2)}
              </div>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 4, marginBottom: 24,
              }}>
                <UsdtSticker size={32} />
                <span style={{ color: "#fbbf24", fontSize: 16, fontWeight: 800, letterSpacing: 1 }}>
                  USDT
                </span>
              </div>

              {/* subtext */}
              <div style={{
                color: "rgba(255,255,255,0.32)", fontSize: 11, marginBottom: 24, textAlign: "center", lineHeight: 1.6,
              }}>
                Prize added to your balance!
              </div>

              {/* collect button */}
              <button onClick={() => setShowResult(false)} style={{
                width: "100%", padding: "15px", borderRadius: 18, border: "none",
                background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
                color: "#0a0600", fontSize: 15, fontWeight: 900, fontFamily: "inherit",
                cursor: "pointer", letterSpacing: 0.5,
                boxShadow: "0 6px 24px rgba(251,191,36,0.50)",
              }}>
                Collect
              </button>
            </div>
          </div>
        )}


        {/* Buttons row */}
        <div style={{ display: "flex", gap: 8, width: "100%", maxWidth: 310, position: "relative", zIndex: 1 }}>

          {/* Spin the Wheel */}
          <button
            onClick={handleSpin}
            disabled={!canSpin}
            className={canSpin ? "btn-gold" : "btn-disabled"}
            style={{
              flex: 2, padding: "15px 12px", fontSize: 14, border: "none",
              cursor: canSpin ? "pointer" : "not-allowed", fontFamily: "inherit",
              ...(canSpin ? { animation: "pulse-gold 2.4s ease-in-out infinite" } : {}),
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
              <span style={{
                width: 26, height: 26, borderRadius: "50%",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 900, fontSize: 11,
                background: canSpin ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.06)",
                color: canSpin ? "#0a0600" : "rgba(255,255,255,0.25)", flexShrink: 0,
              }}>
                {spins}
              </span>
              {spinning && !autoSpinning ? "Spinning..." : spins === 0 ? "No spins" : "Spin"}
            </div>
          </button>

          {/* Auto Spin / Stop */}
          {autoSpinning ? (
            <button
              onClick={handleStopAuto}
              style={{
                flex: 1, padding: "15px 10px", fontSize: 13, border: "none",
                borderRadius: 16, fontFamily: "inherit", fontWeight: 800,
                background: "linear-gradient(135deg, #ef4444, #b91c1c)",
                color: "#fff", cursor: "pointer",
                boxShadow: "0 4px 16px rgba(239,68,68,0.40)",
              }}
            >
              ⏹ Stop
            </button>
          ) : (
            <button
              onClick={handleAutoSpin}
              disabled={!canAutoSpin}
              style={{
                flex: 1, padding: "15px 10px", fontSize: 13,
                borderRadius: 16, fontFamily: "inherit", fontWeight: 800,
                background: canAutoSpin
                  ? "linear-gradient(135deg, #6366f1, #4338ca)"
                  : "rgba(255,255,255,0.06)",
                border: canAutoSpin ? "none" : "1px solid rgba(255,255,255,0.10)",
                color: canAutoSpin ? "#fff" : "rgba(255,255,255,0.25)",
                cursor: canAutoSpin ? "pointer" : "not-allowed",
                boxShadow: canAutoSpin ? "0 4px 16px rgba(99,102,241,0.45)" : "none",
                transition: "all 0.2s",
              }}
            >
              ⚡ Auto
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
