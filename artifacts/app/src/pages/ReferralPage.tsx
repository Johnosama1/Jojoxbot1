import { useState, useEffect, useRef } from "react";
import { useUser } from "../lib/userContext";
import { api } from "../lib/api";
import { Share2, Copy, CheckCheck } from "lucide-react";
import { useLocation } from "wouter";
import lottie from "lottie-web";
import stickerMoneyData from "../../public/sticker-money.json";

export default function ReferralPage() {
  const { user } = useUser();
  const [copied, setCopied] = useState(false);
  const [botUsername, setBotUsername] = useState("Jojox1bot");
  const stickerRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!stickerRef.current) return;
    const anim = lottie.loadAnimation({
      container: stickerRef.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      animationData: stickerMoneyData as any,
    });
    return () => anim.destroy();
  }, []);

  useEffect(() => {
    api.getConfig().then((c) => setBotUsername(c.botUsername)).catch(() => {});
  }, []);

  const refLink = user ? `https://t.me/${botUsername}?start=ref_${user.id}` : "";
  const progress = user ? user.referralCount % 5 : 0;
  const remaining = 5 - progress;

  const handleCopy = async () => {
    if (!refLink) return;
    try {
      await navigator.clipboard.writeText(refLink);
    } catch {
      const el = document.createElement("textarea");
      el.value = refLink;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareLink = () => {
    const text = `🎰 Play the Lucky Wheel on Jo-jokes and win TON!\n\n🎡 Win from 0.05 to 4 TON per spin\n🎁 Join with my link:\n${refLink}`;
    window.open(
      `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(text)}`,
      "_blank"
    );
  };

  return (
    <div
      className="page-content"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: "calc(80px + env(safe-area-inset-bottom, 0px) + 24px)",
        gap: 0,
      }}
    >
      <div
        ref={stickerRef}
        style={{ width: 130, height: 130, marginTop: 8, flexShrink: 0 }}
      />

      <h1
        style={{
          color: "#fff",
          fontSize: 28,
          fontWeight: 900,
          fontStyle: "italic",
          margin: "0 0 6px",
          textAlign: "center",
          textShadow: "0 2px 12px rgba(0,0,0,0.55)",
          letterSpacing: 0.3,
        }}
      >
        Invite Friends
      </h1>

      <p
        style={{
          color: "rgba(255,255,255,0.65)",
          fontSize: 12,
          fontStyle: "italic",
          textAlign: "center",
          margin: "0 0 18px",
          lineHeight: 1.5,
          maxWidth: 260,
          textShadow: "0 1px 6px rgba(0,0,0,0.45)",
        }}
      >
        Share your invite link and earn free spins from your friends' activity
      </p>

      <div
        style={{
          width: "100%",
          borderRadius: 20,
          background: "rgba(10,8,28,0.65)",
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          border: "1px solid rgba(255,255,255,0.10)",
          padding: "14px 16px 16px",
          marginBottom: 12,
          boxShadow: "0 6px 28px rgba(0,0,0,0.40)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div>
            <div
              style={{ color: "#fff", fontWeight: 800, fontSize: 13, lineHeight: 1.2 }}
            >
              Your Referral Progress
            </div>
            <div style={{ color: "rgba(255,255,255,0.40)", fontSize: 11, marginTop: 2 }}>
              {remaining === 0
                ? "🎉 Free spin unlocked!"
                : `${remaining} more friends for next spin`}
            </div>
          </div>
          <div
            style={{
              padding: "6px 13px",
              borderRadius: 999,
              border: "1.5px solid rgba(251,191,36,0.55)",
              color: "#fbbf24",
              fontSize: 12,
              fontWeight: 800,
              background: "rgba(251,191,36,0.10)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <span>{progress}/5</span>
            <span style={{ fontSize: 14, lineHeight: 1 }}>✦</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          {Array.from({ length: 5 }, (_, i) => {
            const done = i < progress;
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 999,
                  background: done
                    ? "linear-gradient(90deg, #34d399, #fbbf24)"
                    : "rgba(255,255,255,0.07)",
                  boxShadow: done ? "0 0 8px rgba(52,211,153,0.45)" : "none",
                  transition: "all 0.4s",
                }}
              />
            );
          })}
        </div>
      </div>

      <div style={{ width: "100%", display: "flex", gap: 10, marginBottom: 10 }}>
        <button
          onClick={shareLink}
          disabled={!refLink}
          style={{
            flex: 1,
            padding: "17px",
            borderRadius: 18,
            border: "none",
            cursor: refLink ? "pointer" : "not-allowed",
            fontFamily: "inherit",
            fontWeight: 900,
            fontSize: 16,
            background: "linear-gradient(135deg, #fde68a, #fbbf24, #f59e0b)",
            color: "#0a0600",
            boxShadow: "0 6px 24px rgba(251,191,36,0.50)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            animation: refLink ? "pulse-gold 2.4s ease-in-out infinite" : "none",
            opacity: refLink ? 1 : 0.6,
          }}
        >
          <Share2 size={18} />
          Invite Friends
        </button>

        <button
          onClick={() => setLocation("/leaderboard")}
          style={{
            width: 58,
            flexShrink: 0,
            borderRadius: 18,
            border: "none",
            cursor: "pointer",
            background: "#ffffff",
            boxShadow: "0 6px 24px rgba(0,0,0,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          <img
            src="/leaderboard-icon.png"
            alt="Leaderboard"
            style={{ width: 30, height: 30, objectFit: "contain" }}
          />
        </button>
      </div>

      <div
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 13px",
          borderRadius: 14,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.10)",
          backdropFilter: "blur(14px)",
        }}
      >
        <p
          style={{
            color: "rgba(255,255,255,0.50)",
            fontSize: 11,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            margin: 0,
            fontFamily: "monospace",
            direction: "ltr",
            textAlign: "left",
          }}
        >
          {refLink || "جارٍ التحميل..."}
        </p>
        <button
          onClick={handleCopy}
          disabled={!refLink}
          style={{
            padding: "7px 12px",
            borderRadius: 9,
            border: "none",
            cursor: refLink ? "pointer" : "not-allowed",
            background: copied ? "rgba(16,185,129,0.22)" : "rgba(255,255,255,0.10)",
            flexShrink: 0,
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
            gap: 5,
            color: copied ? "#34d399" : "rgba(255,255,255,0.70)",
            fontSize: 11,
            fontWeight: 700,
            fontFamily: "inherit",
            opacity: refLink ? 1 : 0.5,
          }}
        >
          {copied ? <><CheckCheck size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
        </button>
      </div>
    </div>
  );
}
