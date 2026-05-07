import { useUser } from "../lib/userContext";
import { useEffect, useRef, useState } from "react";
import lottie from "lottie-web";
import usdtAnimData from "../../public/usdt-anim.json";
import { useWinModalOpen } from "../lib/winModal";

function DevAvatar({ src, name, gradient }: { src: string; name: string; gradient: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div style={{
        width: 36, height: 36, borderRadius: "50%",
        background: gradient,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontWeight: 900, color: "#fff", fontSize: 15, flexShrink: 0,
      }}>
        {name[0].toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={name}
      onError={() => setFailed(true)}
      style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0,
        background: gradient }}
    />
  );
}

function StarSticker() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const anim = lottie.loadAnimation({
      container: ref.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path: "/star2.json",
    });
    return () => anim.destroy();
  }, []);
  return <div ref={ref} style={{ width: 18, height: 18, flexShrink: 0 }} />;
}

function UsdtSticker() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const anim = lottie.loadAnimation({
      container: ref.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      animationData: usdtAnimData as any,
    });
    return () => anim.destroy();
  }, []);
  return <div ref={ref} style={{ width: 28, height: 28, flexShrink: 0, marginLeft: -4, marginRight: -2 }} />;
}

export default function TopBar() {
  const { user } = useUser();
  const stickerRef = useRef<HTMLDivElement>(null);
  const winModalOpen = useWinModalOpen();
  const [showInfo, setShowInfo] = useState(false);

  const userDisplay = user ? (user.firstName || user.username || "User") : "...";
  const balance = user ? parseFloat(user.balance).toFixed(2) : "0.00";

  useEffect(() => {
    if (!stickerRef.current) return;
    const anim = lottie.loadAnimation({
      container: stickerRef.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path: "/sticker-cap.json",
    });
    return () => anim.destroy();
  }, []);

  if (winModalOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: "max(env(safe-area-inset-top, 0px), 10px)",
        left: 12,
        right: 12,
        height: 54,
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 8px 6px 6px",
        borderRadius: 999,
        background: "rgba(15,15,30,0.55)",
        backdropFilter: "blur(24px) saturate(160%)",
        WebkitBackdropFilter: "blur(24px) saturate(160%)",
        border: "1px solid rgba(255,255,255,0.10)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
        direction: "ltr",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1, position: "relative" }}>
        {/* Info popup */}
        {showInfo && (
          <>
            <div
              onClick={() => setShowInfo(false)}
              style={{ position: "fixed", inset: 0, zIndex: 199 }}
            />
            <div style={{
              position: "absolute",
              top: 50, left: 0,
              zIndex: 200,
              background: "rgba(15,15,35,0.96)",
              backdropFilter: "blur(24px)",
              WebkitBackdropFilter: "blur(24px)",
              border: "1px solid rgba(251,191,36,0.30)",
              borderRadius: 18,
              padding: "16px 20px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.60)",
              minWidth: 210,
            }}>
              <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, fontWeight: 700, letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" }}>
                Bot Developers
              </div>
              <a
                href="https://t.me/J_O_H_N8"
                target="_blank"
                rel="noreferrer"
                style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, textDecoration: "none" }}
                onClick={() => setShowInfo(false)}
              >
                <DevAvatar src="/dev-john.jpg" name="John" gradient="linear-gradient(135deg,#fbbf24,#f59e0b)" />
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <div style={{ color: "#fff", fontWeight: 800, fontSize: 14 }}>John</div>
                    <StarSticker />
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.40)", fontSize: 11 }}>@J_O_H_N8 · Developer</div>
                </div>
              </a>
              <a
                href="https://t.me/KINGCRYPTO771"
                target="_blank"
                rel="noreferrer"
                style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}
                onClick={() => setShowInfo(false)}
              >
                <DevAvatar src="/dev-ammar.jpg" name="Ammar" gradient="linear-gradient(135deg,#7c3aed,#4f46e5)" />
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <div style={{ color: "#fff", fontWeight: 800, fontSize: 14 }}>𝗔𝗺𝗺𝗮𝗿</div>
                    <StarSticker />
                  </div>
                  <div style={{ color: "rgba(255,255,255,0.40)", fontSize: 11 }}>@KINGCRYPTO771 · Developer</div>
                </div>
              </a>
            </div>
          </>
        )}

        {user?.photoUrl ? (
          <img
            src={user.photoUrl}
            alt="avatar"
            onClick={() => setShowInfo(v => !v)}
            style={{
              width: 42, height: 42, borderRadius: "50%", objectFit: "cover",
              border: "2px solid rgba(251,191,36,0.55)",
              boxShadow: "0 0 14px rgba(251,191,36,0.30)",
              flexShrink: 0, cursor: "pointer",
            }}
          />
        ) : (
          <div
            onClick={() => setShowInfo(v => !v)}
            style={{
              width: 42, height: 42, borderRadius: "50%",
              background: "linear-gradient(135deg, rgba(139,92,246,0.45), rgba(30,24,80,0.85))",
              border: "2px solid rgba(251,191,36,0.55)",
              boxShadow: "0 0 14px rgba(251,191,36,0.25)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 900, color: "#fbbf24", fontSize: 16,
              flexShrink: 0, cursor: "pointer",
            }}>
            {userDisplay[0]?.toUpperCase()}
          </div>
        )}

        <div style={{ minWidth: 0, overflow: "hidden" }}>
          {/* Username row with sticker */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{
              color: "#fff", fontWeight: 800, fontSize: 13, lineHeight: 1.15,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {userDisplay}
            </div>
            {/* Lottie sticker */}
            <div
              ref={stickerRef}
              style={{ width: 28, height: 28, flexShrink: 0 }}
            />
          </div>
          {user?.username && (
            <div style={{
              color: "rgba(255,255,255,0.45)", fontSize: 10, marginTop: 1,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            }}>
              @{user.username}
            </div>
          )}
        </div>
      </div>

      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        background: "linear-gradient(135deg, rgba(251,191,36,0.20), rgba(245,158,11,0.10))",
        border: "1px solid rgba(251,191,36,0.38)",
        borderRadius: 999,
        padding: "8px 14px",
        boxShadow: "0 0 18px rgba(251,191,36,0.18), inset 0 1px 0 rgba(255,255,255,0.08)",
        flexShrink: 0,
      }}>
        <UsdtSticker />
        <div style={{ color: "#fbbf24", fontWeight: 900, fontSize: 14, letterSpacing: 0.3, lineHeight: 1 }}>
          {balance}
          <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.70, marginLeft: 4 }}>USDT</span>
        </div>
      </div>
    </div>
  );
}
