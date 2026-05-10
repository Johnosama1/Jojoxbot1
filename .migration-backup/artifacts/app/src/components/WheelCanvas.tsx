import { useRef, useEffect, useState } from "react";
import lottie from "lottie-web";
import { WheelSlot } from "../lib/api";

interface WheelCanvasProps {
  slots: WheelSlot[];
  spinning: boolean;
  winnerIndex: number | null;
  onSpinEnd: () => void;
}

export default function WheelCanvas({ slots, spinning, winnerIndex, onSpinEnd }: WheelCanvasProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const rotationRef  = useRef(0);
  const animFrameRef = useRef<number>(0);
  const glowFrameRef = useRef(0);
  const winFlashRef        = useRef<number | null>(null);
  const usdtAnimCanvasRef  = useRef<HTMLCanvasElement | null>(null);
  const usdtLottieRef      = useRef<HTMLDivElement>(null);
  const botImgRef          = useRef<HTMLImageElement | null>(null);

  const [arrowState, setArrowState] = useState<"idle" | "thrown" | "landing">("idle");

  // Load USDT Lottie animation onto hidden off-screen canvas renderer — deferred to avoid blocking first render
  useEffect(() => {
    let anim: ReturnType<typeof lottie.loadAnimation> | null = null;
    const timer = setTimeout(() => {
      if (!usdtLottieRef.current) return;
      // Dynamic import keeps usdt-anim.json out of the initial bundle
      import("../../public/usdt-anim.json").then((m) => {
        if (!usdtLottieRef.current) return;
        anim = lottie.loadAnimation({
          container: usdtLottieRef.current,
          renderer: "canvas",
          loop: true,
          autoplay: true,
          animationData: m.default as object,
          rendererSettings: { clearCanvas: true },
        });
        anim.addEventListener("DOMLoaded", () => {
          const c = usdtLottieRef.current?.querySelector("canvas");
          if (c) usdtAnimCanvasRef.current = c as HTMLCanvasElement;
        });
      });
    }, 400);
    return () => {
      clearTimeout(timer);
      if (anim) { anim.destroy(); usdtAnimCanvasRef.current = null; }
    };
  }, []);

  // Preload bot logo image immediately — center logo must show as soon as wheel renders
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = "https://i.ibb.co/gZgFjFmZ/cropped-circle-image-1.png";
    img.onload = () => { botImgRef.current = img; };
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  // DRAW
  // ─────────────────────────────────────────────────────────────────────
  const drawWheel = (rotation: number, frame: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const size = canvas.width;
    const cx = size / 2, cy = size / 2;
    const outerR = Math.min(cx, cy) - 8;
    const n = slots.length;
    if (n === 0) return;

    ctx.clearRect(0, 0, size, size);

    // ── Outer glow ring ──
    const glowPulse = 0.55 + 0.08 * Math.sin(frame * 0.04);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, outerR + 10, 0, Math.PI * 2);
    const outerGlow = ctx.createRadialGradient(cx, cy, outerR - 4, cx, cy, outerR + 14);
    outerGlow.addColorStop(0,   `rgba(255,190,40,${glowPulse * 0.5})`);
    outerGlow.addColorStop(0.5, `rgba(255,140,20,${glowPulse * 0.25})`);
    outerGlow.addColorStop(1,   "rgba(0,0,0,0)");
    ctx.fillStyle = outerGlow;
    ctx.fill();
    ctx.restore();

    // ── Clip to wheel circle ──
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, outerR + 1, 0, Math.PI * 2);
    ctx.clip();

    const segAngle = (2 * Math.PI) / n;

    // ── Dark disc background ──
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fillStyle = "#0b1530";
    ctx.fill();

    // ── Segments ──
    for (let i = 0; i < n; i++) {
      const startAngle = rotation + i * segAngle - Math.PI / 2;
      const endAngle   = startAngle + segAngle;
      const isEven     = i % 2 === 0;

      // Subtle alternating fill
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outerR, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = isEven ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0)";
      ctx.fill();

      // Divider lines
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(startAngle) * (outerR * 0.30), cy + Math.sin(startAngle) * (outerR * 0.30));
      ctx.lineTo(cx + Math.cos(startAngle) * outerR, cy + Math.sin(startAngle) * outerR);
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // ── Icon + text in each segment ──
      const midAngle = startAngle + segAngle / 2;
      const labelR   = outerR * 0.63;
      const lrx      = cx + Math.cos(midAngle) * labelR;
      const lry      = cy + Math.sin(midAngle) * labelR;

      ctx.save();
      ctx.translate(lrx, lry);
      ctx.rotate(midAngle + Math.PI / 2);
      ctx.textAlign    = "center";
      ctx.textBaseline = "middle";

      const iconR    = outerR < 120 ? 13 : 20;
      const fontSize = outerR < 110 ? 10 : 13;
      const iconY    = -iconR * 0.4; // icon sits a bit higher

      // ── USDT icon: clipped image ──
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, iconY, iconR, 0, Math.PI * 2);
      ctx.clip();
      const uc = usdtAnimCanvasRef.current;
      if (uc && uc.width > 0 && uc.height > 0) {
        ctx.drawImage(uc, 0, 0, uc.width, uc.height, -iconR, iconY - iconR, iconR * 2, iconR * 2);
      } else {
        const fbGrad = ctx.createRadialGradient(-iconR * 0.25, iconY - iconR * 0.25, 0, 0, iconY, iconR);
        fbGrad.addColorStop(0, "#3ecfa3");
        fbGrad.addColorStop(1, "#1a8c6a");
        ctx.fillStyle = fbGrad;
        ctx.fillRect(-iconR, iconY - iconR, iconR * 2, iconR * 2);
        ctx.fillStyle = "#fff";
        ctx.font = `900 ${Math.round(iconR * 1.1)}px sans-serif`;
        ctx.textAlign    = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("₮", 0, iconY);
      }
      ctx.restore();


      // ── Amount number ──
      const amount = parseFloat(slots[i].amount);
      const label  = amount < 1 ? amount.toString() : amount.toFixed(0);
      const textY  = iconY + iconR + fontSize * 1.35;

      ctx.font        = `900 ${fontSize + 1}px 'Inter', sans-serif`;
      ctx.fillStyle   = "#ffffff";
      ctx.shadowColor = "rgba(255,255,255,0.5)";
      ctx.shadowBlur  = 6;
      ctx.fillText(label, 0, textY);
      ctx.shadowBlur  = 0;

      ctx.restore();
    }

    // ── Winner flash ──
    if (winFlashRef.current !== null) {
      const fl = (frame - winFlashRef.current) * 0.05;
      const flashOpacity = Math.max(0, Math.sin(fl) * 0.38);
      if (flashOpacity > 0 && winnerIndex !== null) {
        const ws = rotation + winnerIndex * segAngle - Math.PI / 2;
        const we = ws + segAngle;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, outerR, ws, we);
        ctx.closePath();
        ctx.fillStyle = `rgba(255,215,60,${flashOpacity})`;
        ctx.fill();
      }
    }

    // End clip
    ctx.restore();

    // ── Outer gold ring ──
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,185,30,0.85)";
    ctx.lineWidth   = 4;
    ctx.stroke();
    // Bright thin inner edge
    ctx.beginPath();
    ctx.arc(cx, cy, outerR - 3, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,180,0.25)";
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.restore();

    // ── White studs at segment joins ──
    for (let i = 0; i < n; i++) {
      const angle = rotation + i * segAngle - Math.PI / 2;
      const sx = cx + Math.cos(angle) * (outerR - 2);
      const sy = cy + Math.sin(angle) * (outerR - 2);
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle   = "#ffffff";
      ctx.shadowColor = "rgba(255,255,255,0.95)";
      ctx.shadowBlur  = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ── Center red button ──
    const centerR = outerR * 0.265;
    ctx.save();
    // Outer glow
    ctx.shadowColor = "rgba(220,40,70,0.7)";
    ctx.shadowBlur  = 22;
    // Gradient fill
    const cGrad = ctx.createRadialGradient(cx - centerR * 0.3, cy - centerR * 0.35, centerR * 0.05, cx, cy, centerR);
    cGrad.addColorStop(0,   "#ff7096");
    cGrad.addColorStop(0.45, "#e8314e");
    cGrad.addColorStop(1,   "#a81235");
    ctx.beginPath();
    ctx.arc(cx, cy, centerR, 0, Math.PI * 2);
    ctx.fillStyle = cGrad;
    ctx.fill();
    ctx.shadowBlur = 0;
    // Border
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth   = 2;
    ctx.stroke();
    // Bot logo image in center (clip to circle)
    if (botImgRef.current) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, centerR - 2, 0, Math.PI * 2);
      ctx.clip();
      const imgSize = (centerR - 2) * 2;
      ctx.drawImage(botImgRef.current, cx - centerR + 2, cy - centerR + 2, imgSize, imgSize);
      ctx.restore();
    }
    ctx.restore();
  };

  // ─────────────────────────────────────────────────────────────────────
  // ANIMATION LOOPS (unchanged logic)
  // ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (spinning) return;
    setArrowState("idle");
    let frame = glowFrameRef.current;
    let lastDraw = 0;
    const IDLE_INTERVAL = 50; // ~20 fps — glow pulse is slow, 20fps is imperceptible from 60fps
    const idle = (now: number) => {
      animFrameRef.current = requestAnimationFrame(idle);
      if (document.hidden) return; // pause when app is backgrounded
      if (now - lastDraw < IDLE_INTERVAL) return;
      lastDraw = now;
      frame++;
      glowFrameRef.current = frame;
      drawWheel(rotationRef.current, frame);
    };
    animFrameRef.current = requestAnimationFrame(idle);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [slots, spinning]);

  useEffect(() => {
    if (!spinning || winnerIndex !== null || slots.length === 0) return;
    cancelAnimationFrame(animFrameRef.current);
    setArrowState("thrown");
    const SPEED = (2 * Math.PI * 3.5) / 1000;
    let last  = performance.now();
    let frame = glowFrameRef.current;
    const animate = (now: number) => {
      const delta = Math.min(now - last, 50);
      last = now; frame++;
      glowFrameRef.current = frame;
      rotationRef.current  = (rotationRef.current + SPEED * delta) % (2 * Math.PI);
      drawWheel(rotationRef.current, frame);
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [spinning, winnerIndex, slots]);

  useEffect(() => {
    if (!spinning || winnerIndex === null || slots.length === 0) return;
    cancelAnimationFrame(animFrameRef.current);
    winFlashRef.current = null;
    setArrowState("landing");

    const SETTLE_MS  = 1500;
    const segAngle   = (2 * Math.PI) / slots.length;
    const finalAngle = (2 * Math.PI - winnerIndex * segAngle) - segAngle / 2;
    const SPIN_SPEED = (2 * Math.PI * 3.5) / 1000;

    const startTime     = performance.now();
    const startRotation = rotationRef.current;
    let settled         = false;
    let settleStartRot  = 0;
    let settleStartTime = 0;
    let frame           = glowFrameRef.current;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      frame++;
      glowFrameRef.current = frame;

      if (elapsed < 400) {
        rotationRef.current = (startRotation + SPIN_SPEED * elapsed) % (2 * Math.PI);
        drawWheel(rotationRef.current, frame);
      } else if (elapsed < 400 + SETTLE_MS) {
        if (!settled) {
          settled         = true;
          settleStartRot  = rotationRef.current;
          settleStartTime = now;
        }
        const se    = now - settleStartTime;
        const t     = se / SETTLE_MS;
        const eased = 1 - Math.pow(1 - t, 4);
        let diff = finalAngle - (settleStartRot % (2 * Math.PI));
        if (diff < 0) diff += 2 * Math.PI;
        const totalTravel   = 2 * Math.PI * 2 + diff;
        rotationRef.current = settleStartRot + eased * totalTravel;
        drawWheel(rotationRef.current, frame);
      } else {
        rotationRef.current = finalAngle;
        winFlashRef.current = frame;
        drawWheel(finalAngle, frame);
        setArrowState("idle");
        onSpinEnd();
        return;
      }
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [spinning, winnerIndex, slots]);

  // ─────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────
  const size    = 390;
  const ARROW_H = 36;

  return (
    <>
      {/* Hidden lottie canvas renderer for USDT animation — fixed off-screen so layout is computed */}
      <div
        ref={usdtLottieRef}
        style={{ position: "fixed", left: -9999, top: 0, width: 80, height: 80, pointerEvents: "none", visibility: "hidden" }}
      />

      <style>{`
        @keyframes arrowBounce {
          0%, 100% { transform: translateX(-50%) translateY(0px);   }
          50%       { transform: translateX(-50%) translateY(-5px);  }
        }
        @keyframes arrowThrown {
          0%   { transform: translateX(-50%) translateY(-5px) rotate(-3deg); }
          100% { transform: translateX(-50%) translateY(2px)  rotate(3deg);  }
        }
        @keyframes arrowLand {
          0%   { transform: translateX(-50%) translateY(-14px) scaleY(0.85); }
          65%  { transform: translateX(-50%) translateY(3px)   scaleY(1.05); }
          85%  { transform: translateX(-50%) translateY(-2px)  scaleY(0.98); }
          100% { transform: translateX(-50%) translateY(0px)   scaleY(1);    }
        }
      `}</style>

      {/* ── Loading placeholder when no slots ── */}
      {slots.length === 0 && (
        <div style={{
          width: size,
          height: size + ARROW_H,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 20,
        }}>
          <style>{`
            @keyframes logoPulse {
              0%, 100% { box-shadow: 0 0 28px 8px rgba(255,185,30,0.45), 0 0 60px 20px rgba(255,140,20,0.18); }
              50%       { box-shadow: 0 0 48px 16px rgba(255,215,60,0.7), 0 0 90px 30px rgba(255,160,30,0.30); }
            }
            @keyframes dotBlink {
              0%, 80%, 100% { opacity: 0.25; transform: scale(0.75); }
              40%           { opacity: 1;    transform: scale(1);    }
            }
          `}</style>

          {/* Logo image with golden glow */}
          <img
            src="/logo.png"
            alt="Jo-jokes"
            style={{
              width: size * 0.72,
              height: size * 0.72,
              borderRadius: "50%",
              objectFit: "cover",
              pointerEvents: "none",
              userSelect: "none",
              animation: "logoPulse 2s ease-in-out infinite",
              border: "3px solid rgba(255,185,30,0.6)",
            }}
          />

          {/* Loading dots */}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 10, height: 10, borderRadius: "50%",
                background: i === 1 ? "#a855f7" : "#fbbf24",
                animation: `dotBlink 1.2s ease-in-out infinite`,
                animationDelay: `${i * 0.2}s`,
              }} />
            ))}
          </div>
        </div>
      )}

      <div style={{ position: "relative", width: size, display: slots.length === 0 ? "none" : undefined }}>

        {/* ── Red triangle pointer ── */}
        <div style={{ height: ARROW_H, position: "relative" }}>
          <div style={{
            position: "absolute",
            bottom: -4,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            pointerEvents: "none",
            filter: "drop-shadow(0 2px 10px rgba(220,40,70,0.8))",
            animation:
              arrowState === "thrown"
                ? "arrowThrown 0.35s ease-in-out infinite alternate"
                : arrowState === "landing"
                ? "arrowLand 0.4s cubic-bezier(0.22,1,0.36,1) forwards"
                : "arrowBounce 1.6s ease-in-out infinite",
          }}>
            <svg width="28" height="32" viewBox="0 0 28 32" fill="none">
              <defs>
                <linearGradient id="triGrad" x1="14" y1="0" x2="14" y2="32" gradientUnits="userSpaceOnUse">
                  <stop offset="0%"   stopColor="#ff6b8a" />
                  <stop offset="100%" stopColor="#b91c3c" />
                </linearGradient>
              </defs>
              {/* Main triangle pointing down */}
              <polygon points="14,32 0,0 28,0" fill="url(#triGrad)" />
              {/* Inner highlight */}
              <polygon points="14,26 4,4 24,4" fill="rgba(255,150,170,0.35)" />
              {/* Top nock cap */}
              <rect x="6" y="0" width="16" height="5" rx="2.5" fill="#ff8fa3" />
            </svg>
          </div>
        </div>

        {/* ── Wheel canvas ── */}
        <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* Outer glow ring behind canvas */}
          <div style={{
            position: "absolute",
            inset: -6,
            borderRadius: "50%",
            background: "radial-gradient(ellipse, rgba(255,185,30,0.12) 60%, transparent 100%)",
            pointerEvents: "none",
          }} />
          <canvas
            ref={canvasRef}
            width={size}
            height={size}
            style={{ position: "relative", zIndex: 1, width: size, height: size, display: "block" }}
          />
        </div>
      </div>
    </>
  );
}
