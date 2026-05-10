import { useState, useEffect, useRef } from "react";
import { useUser } from "../lib/userContext";
import { apiCall } from "../lib/api";
import lottie from "lottie-web";
import contestData from "../../public/lb-sticker2.json";
import crownData   from "../../public/lb-sticker1.json";
import crown2Data  from "../../public/crown2.json";
import usdtData    from "../../public/usdt-anim.json";
import medal2Data  from "../../public/medal-2nd.json";
import medal3Data  from "../../public/medal-3rd.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function useLottie(data: any, size: number, loop = true) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const anim = lottie.loadAnimation({
      container: ref.current,
      renderer: "svg",
      loop,
      autoplay: true,
      animationData: data,
    });
    return () => anim.destroy();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={ref} style={{ width: size, height: size, flexShrink: 0 }} />;
}

function ContestSticker()  { return useLottie(contestData, 150); }
function CrownSticker()    { return useLottie(crownData, 34); }
function Crown2Sticker()   { return useLottie(crown2Data, 28); }
function UsdtSticker()     { return useLottie(usdtData, 32); }
function Medal2Sticker()   { return useLottie(medal2Data, 40); }
function Medal3Sticker()   { return useLottie(medal3Data, 40); }

interface LeaderEntry {
  rank: number;
  id: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  referralCount: number;
}

interface LeaderboardData {
  top: LeaderEntry[];
  myRank: { rank: number; referralCount: number } | null;
}

function displayName(entry: LeaderEntry): string {
  const full = [entry.firstName, entry.lastName].filter(Boolean).join(" ");
  return full || entry.username || "User";
}

function getInitial(e: LeaderEntry) {
  return (e.firstName?.[0] || e.username?.[0] || "?").toUpperCase();
}

// Avatar background colors cycling
const AVATAR_COLORS = [
  "#dc2626", "#ea580c", "#ca8a04", "#16a34a",
  "#0891b2", "#2563eb", "#7c3aed", "#db2777",
];

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div style={{ width: 44, height: 44, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Crown2Sticker />
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div style={{ width: 44, height: 44, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Medal2Sticker />
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div style={{ width: 44, height: 44, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Medal3Sticker />
      </div>
    );
  }
  return (
    <div style={{
      width: 44, height: 44, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <span style={{ color: "rgba(255,255,255,0.55)", fontWeight: 800, fontSize: 14 }}>
        {rank}
      </span>
    </div>
  );
}

export default function LeaderboardPage() {
  const { user } = useUser();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const url = user ? `/leaderboard?userId=${user.id}` : "/leaderboard";
    apiCall<LeaderboardData>(url)
      .then(setData)
      .catch(() => setError("Failed to load leaderboard"))
      .finally(() => setLoading(false));
  }, [user?.id]);

  return (
    <div
      className="page-content"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0 14px 24px",
        overflowY: "auto",
      }}
    >
      {/* ── Contest sticker ── */}
      <div style={{ marginTop: 4, marginBottom: -8 }}>
        <ContestSticker />
      </div>

      {/* ── Title ── */}
      <h1 style={{
        color: "#fff",
        fontSize: 30,
        fontWeight: 900,
        fontStyle: "italic",
        margin: "4px 0 18px",
        textAlign: "center",
        textShadow: "0 2px 14px rgba(0,0,0,0.60)",
        letterSpacing: 0.4,
      }}>
        Leaderboard
      </h1>

      {/* ── Loading ── */}
      {loading && (
        <div style={{ padding: "40px 0" }}>
          <div style={{
            width: 34, height: 34, borderRadius: "50%",
            border: "2.5px solid rgba(251,191,36,0.70)", borderTopColor: "transparent",
            animation: "spin 0.75s linear infinite",
          }} />
        </div>
      )}

      {/* ── Error ── */}
      {error && (
        <div style={{ color: "#f87171", fontSize: 13, padding: "20px 0" }}>{error}</div>
      )}

      {/* ── Empty ── */}
      {!loading && !error && data?.top.length === 0 && (
        <div style={{
          textAlign: "center", padding: "40px 20px",
          color: "rgba(255,255,255,0.40)", fontSize: 13,
        }}>
          🎯 Be the first on the leaderboard!
        </div>
      )}

      {/* ── List ── */}
      {!loading && data && data.top.length > 0 && (
        <div style={{
          width: "100%",
          borderRadius: 22,
          background: "rgba(10,8,28,0.60)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.09)",
          overflow: "visible",
          boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
        }}>
          {data.top.map((entry, idx) => {
            const isMe = entry.id === user?.id;
            const avatarBg = AVATAR_COLORS[idx % AVATAR_COLORS.length];
            const isLast = idx === data.top.length - 1;

            return (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: isMe
                    ? "rgba(251,191,36,0.10)"
                    : idx % 2 === 0
                      ? "rgba(255,255,255,0.02)"
                      : "transparent",
                  borderBottom: isLast ? "none" : "1px solid rgba(255,255,255,0.05)",
                  gap: 10,
                }}
              >
                {/* Rank badge */}
                <RankBadge rank={entry.rank} />

                {/* Avatar */}
                <div style={{
                  width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
                  background: avatarBg,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontWeight: 900, fontSize: 16, color: "#fff",
                  border: isMe ? "2px solid #fbbf24" : "2px solid rgba(255,255,255,0.10)",
                  boxShadow: isMe ? "0 0 12px rgba(251,191,36,0.40)" : "none",
                  overflow: "hidden",
                }}>
                  {entry.photoUrl ? (
                    <img
                      src={entry.photoUrl}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : getInitial(entry)}
                </div>

                {/* Name */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 4 }}>
                  <p style={{
                    color: isMe ? "#fbbf24" : "#fff",
                    fontWeight: isMe ? 800 : 600,
                    fontSize: 13,
                    margin: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {displayName(entry)}{isMe ? " · You" : ""}
                  </p>
                </div>

                {/* Score */}
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end",
                    color: "#fff",
                    fontWeight: 900,
                    fontSize: 15,
                    lineHeight: 1,
                    letterSpacing: -0.3,
                  }}>
                    {entry.referralCount.toLocaleString()}
                    <span style={{ color: "#fbbf24", fontSize: 13 }}>✦</span>
                  </div>
                  <div style={{
                    color: "rgba(255,255,255,0.40)",
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 0.8,
                    marginTop: 2,
                    textTransform: "uppercase",
                  }}>
                    referrals
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── My rank (if not in top list) ── */}
      {!loading && data?.myRank && user && !data.top.find(e => e.id === user.id) && (
        <div style={{
          width: "100%",
          marginTop: 10,
          padding: "12px 14px",
          borderRadius: 16,
          background: "rgba(251,191,36,0.12)",
          border: "1px solid rgba(251,191,36,0.38)",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <RankBadge rank={data.myRank.rank} />
          <div style={{
            width: 40, height: 40, borderRadius: "50%", flexShrink: 0,
            background: "#7c3aed",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 900, fontSize: 16, color: "#fff",
            border: "2px solid #fbbf24",
          }}>
            {(user.firstName?.[0] || user.username?.[0] || "?").toUpperCase()}
          </div>
          <p style={{ flex: 1, color: "#fbbf24", fontWeight: 800, fontSize: 13, margin: 0 }}>You</p>
          <div style={{ textAlign: "right" }}>
            <div style={{ color: "#fbbf24", fontWeight: 900, fontSize: 15, display: "flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
              {data.myRank.referralCount.toLocaleString()}
              <span style={{ color: "#fbbf24", fontSize: 13 }}>✦</span>
            </div>
            <div style={{ color: "rgba(251,191,36,0.50)", fontSize: 9, fontWeight: 700, letterSpacing: 0.8 }}>
              REFERRALS
            </div>
          </div>
        </div>
      )}

      {!loading && data && data.top.length > 0 && (
        <p style={{
          textAlign: "center", color: "rgba(255,255,255,0.18)",
          fontSize: 10, marginTop: 12, marginBottom: 0,
        }}>
          Rankings update every 10 seconds
        </p>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
