import { lazy, Suspense, useEffect, useRef, useState } from "react";
import lottie from "lottie-web";
import { useLocation, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TonConnectUIProvider } from "@tonconnect/ui-react";
import { UserProvider, useUser } from "./lib/userContext";
import TabBar from "./components/TabBar";
import AnimatedBackground from "./components/AnimatedBackground";
import TopBar from "./components/TopBar";
import HomePage from "./pages/HomePage";
import SubscriptionBlockedScreen from "./pages/SubscriptionBlockedScreen";

const TasksPage       = lazy(() => import("./pages/TasksPage"));
const ReferralPage    = lazy(() => import("./pages/ReferralPage"));
const WithdrawPage    = lazy(() => import("./pages/WithdrawPage"));
const AdminPage       = lazy(() => import("./pages/AdminPage"));
const LeaderboardPage = lazy(() => import("./pages/LeaderboardPage"));
const WalletPage      = lazy(() => import("./pages/WalletPage"));

const queryClient = new QueryClient();

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const MANIFEST_URL = `${window.location.origin}/api/tonconnect-manifest.json`;

function BannedScreen() {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(160deg, #0a0f0a 0%, #0e1a10 100%)",
      padding: "32px 24px", textAlign: "center", gap: 20,
    }}>
      <div style={{ fontSize: 72 }}>🚫</div>
      <div style={{
        background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.35)",
        borderRadius: 20, padding: "28px 24px", maxWidth: 320,
      }}>
        <h2 style={{ color: "#f87171", fontWeight: 900, fontSize: 22, margin: "0 0 12px" }}>
          Your account has been banned
        </h2>
        <p style={{ color: "rgba(255,255,255,0.55)", fontSize: 14, margin: 0, lineHeight: 1.7 }}>
          You cannot access this application.
          <br />Contact support if you believe this is a mistake.
        </p>
      </div>
    </div>
  );
}

function MaintenanceLottie() {
  const ref = useRef<HTMLDivElement>(null);
  const [animData, setAnimData] = useState<object | null>(null);

  useEffect(() => {
    // Load maintenance animation data only when maintenance screen is actually shown
    import("../public/maintenance-anim.json").then((m) => setAnimData(m.default as object));
  }, []);

  useEffect(() => {
    if (!ref.current || !animData) return;
    const anim = lottie.loadAnimation({
      container: ref.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData: animData,
    });
    return () => anim.destroy();
  }, [animData]);
  return (
    <div style={{ position: "relative", marginBottom: 16 }}>
      <div style={{
        position: "absolute", inset: -24,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(251,191,36,0.12) 0%, transparent 70%)",
        animation: "blink 2.5s ease-in-out infinite",
        pointerEvents: "none",
      }} />
      <div ref={ref} style={{ width: 160, height: 160, position: "relative" }} />
    </div>
  );
}

function MaintenanceScreen() {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(160deg, #05080f 0%, #0a0f1a 50%, #080d15 100%)",
      padding: "32px 24px", textAlign: "center",
    }}>
      <MaintenanceLottie />

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
      `}</style>

      <div style={{
        background: "rgba(251,191,36,0.06)",
        border: "1px solid rgba(251,191,36,0.25)",
        borderRadius: 24,
        padding: "32px 28px",
        maxWidth: 340,
        width: "100%",
        boxShadow: "0 0 60px rgba(251,191,36,0.08)",
      }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          background: "rgba(251,191,36,0.15)", border: "1px solid rgba(251,191,36,0.3)",
          borderRadius: 20, padding: "4px 14px", marginBottom: 18,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fbbf24", display: "inline-block", animation: "blink 1.2s ease-in-out infinite" }} />
          <span style={{ color: "#fbbf24", fontSize: 12, fontWeight: 700, letterSpacing: "0.06em" }}>MAINTENANCE</span>
        </div>

        <h2 style={{ color: "#fef3c7", fontWeight: 900, fontSize: 22, margin: "0 0 14px", lineHeight: 1.3 }}>
          🚧 البوت تحت الصيانة
        </h2>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, margin: "0 0 24px", lineHeight: 1.8, direction: "rtl" }}>
          نحن نعمل على تحديث وتحسين التطبيق.
          <br />سيعود قريباً إن شاء الله! ⚡
        </p>

        <div style={{
          background: "rgba(0,0,0,0.3)", borderRadius: 14,
          padding: "14px 16px",
          border: "1px solid rgba(255,255,255,0.06)",
        }}>
          <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, margin: 0, lineHeight: 1.7, direction: "rtl" }}>
            يرجى إغلاق التطبيق والمحاولة مرة أخرى بعد قليل
          </p>
        </div>
      </div>
    </div>
  );
}

function SessionIssuingScreen() {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9998,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "rgba(5,8,6,0.72)",
      backdropFilter: "blur(4px)",
    }}>
      <style>{`
        @keyframes ssPulse {
          0%,100% { box-shadow: 0 0 28px 8px rgba(255,185,30,0.45), 0 0 60px 20px rgba(255,140,20,0.18); }
          50%      { box-shadow: 0 0 48px 16px rgba(255,215,60,0.70), 0 0 90px 30px rgba(255,160,30,0.30); }
        }
        @keyframes ssDot {
          0%,80%,100% { opacity:0.25; transform:scale(0.75); }
          40%         { opacity:1;    transform:scale(1);    }
        }
      `}</style>

      <img
        src="/logo.png"
        alt="Jo-jokes"
        style={{
          width: 180, height: 180,
          borderRadius: "50%",
          objectFit: "cover",
          border: "3px solid rgba(255,185,30,0.6)",
          animation: "ssPulse 2s ease-in-out infinite",
          marginBottom: 28,
        }}
      />

      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 10, height: 10, borderRadius: "50%",
            background: i === 1 ? "#a855f7" : "#fbbf24",
            animation: "ssDot 1.2s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`,
          }} />
        ))}
      </div>
    </div>
  );
}

const PageFallback = () => (
  <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }} />
);

const ROUTES = [
  { path: "/",            Component: HomePage,        lazy: false },
  { path: "/tasks",       Component: TasksPage,       lazy: true  },
  { path: "/referral",    Component: ReferralPage,    lazy: true  },
  { path: "/leaderboard", Component: LeaderboardPage, lazy: true  },
  { path: "/wallet",      Component: WalletPage,      lazy: true  },
  { path: "/withdraw",    Component: WithdrawPage,    lazy: true  },
  { path: "/admin",       Component: AdminPage,       lazy: true  },
] as const;

function PersistentRouter() {
  const [location] = useLocation();
  const { banned, user, loading, initialized, refresh, sessionState, blockedInfo, recheckSession } = useUser();

  // ── 1. Banned ─────────────────────────────────────────────────────
  if (banned || sessionState === "banned") return <BannedScreen />;

  // ── 2. Maintenance mode ───────────────────────────────────────────
  if (sessionState === "maintenance") return <MaintenanceScreen />;

  // ── 3. Session gate: issuing token ────────────────────────────────
  if (sessionState === "issuing") return <SessionIssuingScreen />;

  // ── 3. Subscription blocked ───────────────────────────────────────
  if (sessionState === "blocked" && blockedInfo) {
    return (
      <SubscriptionBlockedScreen
        userId={user?.id ?? 0}
        missingChannels={blockedInfo.missingChannels}
        requiredChannels={blockedInfo.requiredChannels}
        onUnblocked={async () => {
          await recheckSession();
          if (user) await refresh();
        }}
      />
    );
  }

  const hideTopBar = location === "/referral" || location === "/leaderboard" || location === "/wallet";

  return (
    <>
      {!hideTopBar && <TopBar />}
      {ROUTES.map(({ path, Component, lazy: isLazy }) => {
        const isActive =
          path === "/"
            ? location === "/" || location === ""
            : location === path || location.startsWith(path + "/");

        return (
          <div
            key={path}
            style={{
              display: isActive ? "flex" : "none",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {isLazy ? (
              <Suspense fallback={<PageFallback />}>
                <Component />
              </Suspense>
            ) : (
              <Component />
            )}
          </div>
        );
      })}
      {location !== "/wallet" && <TabBar />}
    </>
  );
}

function App() {
  return (
    <TonConnectUIProvider manifestUrl={MANIFEST_URL}>
      <QueryClientProvider client={queryClient}>
        <UserProvider>
          <AnimatedBackground />
          <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <PersistentRouter />
            </WouterRouter>
          </div>
        </UserProvider>
      </QueryClientProvider>
    </TonConnectUIProvider>
  );
}

export default App;
