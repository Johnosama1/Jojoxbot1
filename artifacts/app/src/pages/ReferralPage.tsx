import { useState, useEffect, useRef } from "react";
import { useUser } from "../lib/userContext";
import { api, ReferralEntry } from "../lib/api";
import { Share2, Copy, CheckCheck, UserCheck, Clock, User, Users } from "lucide-react";
import { useLocation } from "wouter";
import lottie from "lottie-web";
import stickerMoneyData from "../../public/sticker-money.json";
import leaderboardStickerData from "../../public/leaderboard-sticker.json";

export default function ReferralPage() {
  const { user, initialized, retryInit } = useUser();
  const [copied, setCopied] = useState(false);
  const [botUsername, setBotUsername] = useState("Jojox1bot");
  const [referrals, setReferrals] = useState<ReferralEntry[]>([]);
  const [loadingReferrals, setLoadingReferrals] = useState(false);
  const stickerRef = useRef<HTMLDivElement>(null);
  const leaderboardStickerRef = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!stickerRef.current) return;
    const anim = lottie.loadAnimation({
      container: stickerRef.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData: stickerMoneyData as object,
    });
    return () => anim.destroy();
  }, []);

  useEffect(() => {
    if (!leaderboardStickerRef.current) return;
    const anim = lottie.loadAnimation({
      container: leaderboardStickerRef.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData: leaderboardStickerData as object,
    });
    return () => anim.destroy();
  }, []);

  useEffect(() => {
    api.getConfig().then((c) => setBotUsername(c.botUsername)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    setLoadingReferrals(true);
    api.getUserReferrals(user.id)
      .then(setReferrals)
      .catch(() => {})
      .finally(() => setLoadingReferrals(false));
  }, [user?.id]);

  const refLink = user ? `https://t.me/${botUsername}?start=ref_${user.id}` : "";
  const progress = user ? user.referralCount % 5 : 0;
  const remaining = 5 - progress;
  const loadFailed = initialized && !user;

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
    const text = `🎰 العب عجلة الحظ على Jo-jokes واربح USDT!\n\n🎡 فرصة تكسب من 0.05 إلى 4 USDT في كل دوران\n🎁 اشترك عبر رابطي:\n${refLink}`;
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(text)}`
      );
    } else {
      window.open(
        `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent(text)}`,
        "_blank"
      );
    }
  };

  const approvedCount = referrals.filter(r => r.status === "approved").length;
  const pendingCount  = referrals.filter(r => r.status === "pending").length;

  return (
    <div
      className="page-content"
      style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}
    >
      {/* ── Sticky Header ── */}
      <div style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        padding: "10px 16px 8px",
        background: "transparent",
        flexShrink: 0,
      }}>
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <h1 style={{
              color: "#fff", fontSize: 22, fontWeight: 900, fontStyle: "italic",
              margin: 0, letterSpacing: 0.3, textShadow: "0 2px 12px rgba(0,0,0,0.55)",
            }}>
              Invite Friends
            </h1>
            {user?.inviterName && (
              <p style={{
                color: "rgba(251,191,36,0.75)", fontSize: 11, margin: "2px 0 0",
                fontWeight: 600, display: "flex", alignItems: "center", gap: 4,
              }}>
                <User size={11} /> Invited by {user.inviterName}
              </p>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{
          background: "rgba(10,8,28,0.65)",
          backdropFilter: "blur(18px)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 16,
          padding: "10px 14px",
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 12, lineHeight: 1.2 }}>
              Referral Progress
              <div style={{ color: "rgba(255,255,255,0.40)", fontSize: 10, fontWeight: 500, marginTop: 1 }}>
                {remaining === 0 ? "🎉 Free spin unlocked!" : `${remaining} more for next spin`}
              </div>
            </div>
            <div style={{
              padding: "4px 11px", borderRadius: 999,
              border: "1.5px solid rgba(251,191,36,0.55)",
              color: "#fbbf24", fontSize: 11, fontWeight: 800,
              background: "rgba(251,191,36,0.10)",
            }}>
              {progress}/5 ✦
            </div>
          </div>
          <div style={{ display: "flex", gap: 5 }}>
            {Array.from({ length: 5 }, (_, i) => {
              const done = i < progress;
              return (
                <div key={i} style={{
                  flex: 1, height: 6, borderRadius: 999,
                  background: done ? "linear-gradient(90deg, #34d399, #fbbf24)" : "rgba(255,255,255,0.07)",
                  boxShadow: done ? "0 0 6px rgba(52,211,153,0.45)" : "none",
                  transition: "all 0.4s",
                }} />
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        padding: "8px 16px calc(80px + env(safe-area-inset-bottom, 0px) + 16px)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        {/* Lottie + tagline */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div ref={stickerRef} style={{ width: 90, height: 90, flexShrink: 0 }} />
          <p style={{
            color: "rgba(255,255,255,0.55)", fontSize: 11, fontStyle: "italic",
            textAlign: "center", margin: 0, lineHeight: 1.5, maxWidth: 230,
          }}>
            Share your link and earn free spins from your friends' activity
          </p>
        </div>

        {/* Invite button + copy */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={shareLink}
            disabled={!refLink}
            style={{
              flex: 1, padding: "14px", borderRadius: 18, border: "none",
              cursor: refLink ? "pointer" : "not-allowed", fontFamily: "inherit",
              fontWeight: 900, fontSize: 15,
              background: "linear-gradient(135deg, #fde68a, #fbbf24, #f59e0b)",
              color: "#0a0600",
              boxShadow: "0 6px 24px rgba(251,191,36,0.50)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              animation: refLink ? "pulse-gold 2.4s ease-in-out infinite" : "none",
              opacity: refLink ? 1 : 0.6,
            }}
          >
            <Share2 size={16} /> Invite Friends
          </button>
        </div>

        {/* Leaderboard button + Ref link row (separate side by side) */}
        <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
          {/* Leaderboard button — separate */}
          <button
            onClick={() => setLocation("/leaderboard")}
            style={{
              flexShrink: 0, width: 46, borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.12)",
              cursor: "pointer", padding: 0,
              background: "rgba(255,255,255,0.05)",
              backdropFilter: "blur(14px)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <img
              src="/sad-icon.png"
              alt="leaderboard"
              style={{ width: 30, height: 30, objectFit: "contain", filter: "brightness(0) invert(1)", pointerEvents: "none" }}
            />
          </button>

          {/* Ref link — separate, shows short preview but copies full link */}
          <div style={{
            flex: 1, display: "flex", alignItems: "center", gap: 6, padding: "7px 10px",
            borderRadius: 14, background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.10)", backdropFilter: "blur(14px)",
            minWidth: 0,
          }}>
            <p style={{
              color: "rgba(255,255,255,0.45)", fontSize: 9.5, flex: 1,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              margin: 0, fontFamily: "monospace", direction: "ltr", textAlign: "left",
              letterSpacing: 0,
            }}>
              {refLink
                ? refLink.replace("https://t.me/", "t.me/").replace(/\?start=.*/, "?start=…")
                : (loadFailed ? "⚠️ Connection error" : "Loading…")}
            </p>
            <button
              onClick={handleCopy}
              disabled={!refLink}
              style={{
                padding: "5px 10px", borderRadius: 8, border: "none",
                cursor: refLink ? "pointer" : "not-allowed",
                background: copied ? "rgba(16,185,129,0.22)" : "rgba(255,255,255,0.10)",
                flexShrink: 0, transition: "all 0.2s",
                display: "flex", alignItems: "center", gap: 3,
                color: copied ? "#34d399" : "rgba(255,255,255,0.70)",
                fontSize: 10, fontWeight: 700, fontFamily: "inherit",
                opacity: refLink ? 1 : 0.5,
              }}
            >
              {copied ? <><CheckCheck size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
            </button>
          </div>
        </div>

        {/* Retry button when connection failed */}
        {loadFailed && (
          <button
            onClick={retryInit}
            style={{
              width: "100%", padding: "11px", borderRadius: 14, border: "1px solid rgba(251,191,36,0.40)",
              background: "rgba(251,191,36,0.10)", color: "#fbbf24", fontWeight: 700,
              fontSize: 13, fontFamily: "inherit", cursor: "pointer",
            }}
          >
            🔄 Retry Connection
          </button>
        )}

        {/* ── Referrals list ── */}
        <div style={{
          borderRadius: 18,
          background: "rgba(10,8,28,0.60)",
          backdropFilter: "blur(18px)",
          border: "1px solid rgba(255,255,255,0.09)",
          overflow: "hidden",
        }}>
          {/* Section header */}
          <div style={{
            padding: "12px 16px 10px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <span style={{ color: "#fff", fontWeight: 800, fontSize: 13 }}>
              Invited Users
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              {approvedCount > 0 && (
                <span style={{
                  padding: "3px 9px", borderRadius: 999, fontSize: 10, fontWeight: 700,
                  background: "rgba(16,185,129,0.18)", border: "1px solid rgba(16,185,129,0.35)",
                  color: "#34d399",
                }}>
                  {approvedCount} successful
                </span>
              )}
              {pendingCount > 0 && (
                <span style={{
                  padding: "3px 9px", borderRadius: 999, fontSize: 10, fontWeight: 700,
                  background: "rgba(251,191,36,0.14)", border: "1px solid rgba(251,191,36,0.30)",
                  color: "#fbbf24",
                }}>
                  {pendingCount} pending
                </span>
              )}
            </div>
          </div>

          {loadingReferrals && (
            <div style={{ padding: "24px", textAlign: "center" }}>
              <div style={{
                width: 24, height: 24, borderRadius: "50%",
                border: "2px solid rgba(251,191,36,0.50)", borderTopColor: "transparent",
                animation: "spin 0.75s linear infinite", margin: "0 auto",
              }} />
            </div>
          )}

          {!loadingReferrals && referrals.length === 0 && (
            <div style={{
              padding: "28px 16px", textAlign: "center",
              color: "rgba(255,255,255,0.30)", fontSize: 12,
            }}>
              <Users size={28} style={{ color: "rgba(255,255,255,0.12)", marginBottom: 8 }} />
              <p style={{ margin: 0 }}>No referrals yet — share your link to invite friends!</p>
            </div>
          )}

          {!loadingReferrals && referrals.map((r, idx) => {
            const isApproved = r.status === "approved";
            const isLast = idx === referrals.length - 1;
            // Extract first alphabetic/numeric char, skipping emojis
            const initial = (r.name.match(/[a-zA-Z0-9\u0600-\u06FF\u0400-\u04FF]/)?.[0] ?? Array.from(r.name)[0] ?? "?").toUpperCase();
            return (
              <div key={r.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "11px 16px",
                borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)",
                background: idx % 2 === 0 ? "rgba(255,255,255,0.015)" : "transparent",
              }}>
                {/* Avatar: photo or letter */}
                <div style={{
                  width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
                  background: isApproved
                    ? "linear-gradient(135deg, rgba(16,185,129,0.30), rgba(16,185,129,0.10))"
                    : "linear-gradient(135deg, rgba(251,191,36,0.30), rgba(251,191,36,0.10))",
                  border: `1.5px solid ${isApproved ? "rgba(16,185,129,0.50)" : "rgba(251,191,36,0.50)"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  overflow: "hidden",
                  boxShadow: `0 0 8px ${isApproved ? "rgba(16,185,129,0.20)" : "rgba(251,191,36,0.18)"}`,
                }}>
                  {r.photoUrl ? (
                    <img
                      src={r.photoUrl}
                      alt={r.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <span style={{ color: isApproved ? "#34d399" : "#fbbf24", fontSize: 16, fontWeight: 900, lineHeight: 1 }}>
                      {initial}
                    </span>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    color: "#fff", fontWeight: 700, fontSize: 13, margin: 0,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {r.name}
                  </p>
                  <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 10, margin: "1px 0 0",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.username ? `@${r.username}` : new Date(r.joinedAt).toLocaleDateString()}
                  </p>
                </div>

                {/* Status badge */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "5px 10px", borderRadius: 999, flexShrink: 0,
                  background: isApproved ? "rgba(16,185,129,0.14)" : "rgba(251,191,36,0.12)",
                  border: `1px solid ${isApproved ? "rgba(16,185,129,0.32)" : "rgba(251,191,36,0.28)"}`,
                  color: isApproved ? "#34d399" : "#fbbf24",
                  fontSize: 10, fontWeight: 700,
                }}>
                  {isApproved ? <UserCheck size={11} /> : <Clock size={11} />}
                  {isApproved ? "Successful" : "Pending Review"}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
