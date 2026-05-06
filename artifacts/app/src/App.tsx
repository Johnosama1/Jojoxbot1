import { lazy, Suspense } from "react";
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
const MANIFEST_URL = `${window.location.origin}${BASE}/api/tonconnect-manifest.json`;

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

function SessionIssuingScreen() {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9998,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(160deg, #050d0a 0%, #0a1a10 100%)",
    }}>
      <div style={{
        width: 48, height: 48, borderRadius: "50%",
        border: "3px solid rgba(74,222,128,0.15)",
        borderTopColor: "#4ade80",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <p style={{ color: "rgba(255,255,255,0.4)", marginTop: 20, fontSize: 14 }}>
        جارٍ التحقق...
      </p>
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

  // ── 2. Session gate: issuing token ────────────────────────────────
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
