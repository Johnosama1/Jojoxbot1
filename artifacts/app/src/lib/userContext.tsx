import React, { createContext, useContext, useEffect, useState } from "react";
import { api, User, WheelSlot, getWheelSlotsOnce, getTasksOnce, getCompletedTasksOnce, getWithdrawalsOnce, setSessionToken, SubscriptionChannel } from "./api";
import { getTelegramUser, initTelegramApp, getMockUser } from "./telegram";

// ── Session states ───────────────────────────────────────────────────
export type SessionState =
  | "pending"           // not yet checked
  | "issuing"           // in-flight request
  | "ready"             // token issued, app usable
  | "blocked"           // subscription check failed
  | "banned"            // user banned
  | "maintenance";      // bot under maintenance

export interface BlockedInfo {
  missingChannels: SubscriptionChannel[];
  requiredChannels: SubscriptionChannel[];
}

interface UserContextType {
  user: User | null;
  loading: boolean;
  initialized: boolean;
  refresh: () => Promise<void>;
  retryInit: () => void;
  isAdmin: boolean;
  banned: boolean;
  slots: WheelSlot[];
  sessionState: SessionState;
  blockedInfo: BlockedInfo | null;
  recheckSession: () => Promise<void>;
}

const UserContext = createContext<UserContextType>({
  user: null,
  loading: true,
  initialized: false,
  refresh: async () => {},
  retryInit: () => {},
  isAdmin: false,
  banned: false,
  slots: [],
  sessionState: "pending",
  blockedInfo: null,
  recheckSession: async () => {},
});

const OWNER_USERNAME = "J_O_H_N8";
const OWNER_ID = 6145230334;

// ── LocalStorage cache helpers ──────────────────────────────────────
const CACHE_TTL = 5 * 60 * 1000;

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw) as { ts: number; data: T };
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

function writeCache(key: string, data: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch { /* storage full */ }
}

// ────────────────────────────────────────────────────────────────────
const SPLASH_START = Date.now();
const MIN_SPLASH_MS = 400;

const hideSplash = () => {
  const elapsed = Date.now() - SPLASH_START;
  const delay = Math.max(0, MIN_SPLASH_MS - elapsed);
  setTimeout(() => {
    const splash = document.getElementById("splash");
    if (splash && !splash.classList.contains("hidden")) {
      splash.classList.add("hidden");
      setTimeout(() => splash.remove(), 600);
    }
  }, delay);
};

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [banned, setBanned] = useState(false);
  const [slots, setSlots] = useState<WheelSlot[]>([]);
  const [sessionState, setSessionState] = useState<SessionState>("pending");
  const [blockedInfo, setBlockedInfo] = useState<BlockedInfo | null>(null);
  const [isAdminState, setIsAdminState] = useState(false);

  // ── Issue (or re-issue) session token ─────────────────────────────
  const doIssueSession = async (userId: number, retryCount = 0) => {
    setSessionState("issuing");
    try {
      const result = await api.issueSession(userId);
      setSessionToken(result.token);
      setBlockedInfo(null);
      setSessionState("ready");
    } catch (e: unknown) {
      const err = e as { status?: number; body?: { error?: string; missingChannels?: SubscriptionChannel[]; requiredChannels?: SubscriptionChannel[] } };
      if (err?.status === 503 && err.body?.error === "maintenance") {
        setSessionState("maintenance");
      } else if (err?.status === 403) {
        if (err.body?.error === "banned") {
          setBanned(true);
          setSessionState("banned");
        } else {
          setBlockedInfo({
            missingChannels: err.body?.missingChannels ?? [],
            requiredChannels: err.body?.requiredChannels ?? [],
          });
          setSessionState("blocked");
        }
      } else if (err?.status === 401 && err.body?.error === "invalid_auth" && retryCount < 2) {
        // initData might not be ready yet — retry after a short delay
        console.warn(`Session auth failed (invalid_auth), retry #${retryCount + 1} in 800ms…`);
        await new Promise(r => setTimeout(r, 800));
        return doIssueSession(userId, retryCount + 1);
      } else if (err?.status === 0) {
        // Network error — fail open (server unreachable)
        console.warn("Session issue: network error — fail open", e);
        setSessionState("ready");
      } else {
        // Other unexpected error — fail open to avoid locking out users
        console.warn("Session issue failed (fail-open):", err?.body?.error ?? e);
        setSessionState("ready");
      }
    }
  };

  // ── Re-check after user says they rejoined ─────────────────────────
  const recheckSession = async () => {
    if (!user) return;
    setSessionState("issuing");
    try {
      const result = await api.recheckSession(user.id);
      setSessionToken(result.token);
      setBlockedInfo(null);
      setSessionState("ready");
    } catch (e: unknown) {
      const err = e as { status?: number; body?: { error?: string; missingChannels?: SubscriptionChannel[]; requiredChannels?: SubscriptionChannel[] } };
      if (err?.status === 503 && err.body?.error === "maintenance") {
        setSessionState("maintenance");
      } else if (err?.status === 403) {
        setBlockedInfo({
          missingChannels: err.body?.missingChannels ?? [],
          requiredChannels: err.body?.requiredChannels ?? [],
        });
        setSessionState("blocked");
      } else {
        // Fail open
        setSessionState("ready");
      }
    }
  };

  const init = async () => {
    try {
      // ── Clear storage on version bump ──────────────────────────────
      const APP_VER = "3.1";
      const VER_KEY = "jjx_app_ver";
      if (localStorage.getItem(VER_KEY) !== APP_VER) {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem(VER_KEY, APP_VER);
      }

      initTelegramApp();
      const tgUser = getTelegramUser() ?? getMockUser();

      // ── Step 1: Show cached data INSTANTLY ────────────────────────
      const cachedUser = readCache<User>(`user:${tgUser.id}`);
      const cachedSlots = readCache<WheelSlot[]>("slots");
      if (cachedUser && cachedSlots) {
        setUser(cachedUser);
        setSlots(cachedSlots);
        setLoading(false);
      }
      hideSplash();

      // ── Step 2: Init user + slots in parallel ─────────────────────
      const slotsPromise = getWheelSlotsOnce();
      getTasksOnce().catch(() => {});

      const freshUser = await api.initUser({
        id: tgUser.id,
        username: tgUser.username ?? undefined,
        first_name: tgUser.first_name ?? undefined,
        last_name: tgUser.last_name ?? undefined,
        photo_url: tgUser.photo_url ?? undefined,
      });

      const freshSlots = await slotsPromise.catch(() => cachedSlots ?? [] as WheelSlot[]);
      setUser(freshUser);
      setSlots(freshSlots as WheelSlot[]);
      writeCache(`user:${freshUser.id}`, freshUser);
      writeCache("slots", freshSlots);
      hideSplash();
      setLoading(false);
      setInitialized(true);

      // ── Step 3: Issue session token (central gate) ────────────────
      await doIssueSession(freshUser.id);

      // ── Step 4: Check admin status ────────────────────────────────
      // Quick check by known owner ID/username first, then API for sub-admins
      if (freshUser.id === OWNER_ID || freshUser.username === OWNER_USERNAME) {
        setIsAdminState(true);
      } else {
        api.adminCheck(freshUser.id).then(() => setIsAdminState(true)).catch(() => setIsAdminState(false));
      }

      // ── Step 5: Pre-warm secondary caches ─────────────────────────
      getCompletedTasksOnce(freshUser.id).catch(() => {});
      getWithdrawalsOnce(freshUser.id).catch(() => {});

    } catch (e: unknown) {
      if (e instanceof Error && e.message === "محظور") {
        setBanned(true);
        setSessionState("banned");
        setLoading(false);
        setInitialized(true);
        hideSplash();
      } else {
        console.warn("Failed to init user — retrying in 4s:", e);
        // Auto-retry once after 4 seconds (handles Neon DB cold start)
        setTimeout(async () => {
          try {
            initTelegramApp();
            const tgUser = getTelegramUser() ?? getMockUser();
            const freshUser = await api.initUser({
              id: tgUser.id,
              username: tgUser.username ?? undefined,
              first_name: tgUser.first_name ?? undefined,
              last_name: tgUser.last_name ?? undefined,
              photo_url: tgUser.photo_url ?? undefined,
            });
            const freshSlots = await getWheelSlotsOnce().catch(() => [] as WheelSlot[]);
            setUser(freshUser);
            setSlots(freshSlots as WheelSlot[]);
            writeCache(`user:${freshUser.id}`, freshUser);
            writeCache("slots", freshSlots);
            await doIssueSession(freshUser.id);
          } catch (retryErr) {
            console.error("Retry also failed:", retryErr);
          } finally {
            setLoading(false);
            setInitialized(true);
            hideSplash();
            setSessionState((prev) => prev === "pending" ? "ready" : prev);
          }
        }, 4000);
        return; // don't set initialized yet — let retry handle it
      }
    }
  };

  const retryInit = () => {
    setLoading(true);
    setInitialized(false);
    setUser(null);
    setSessionState("pending");
    init();
  };

  const refresh = async () => {
    if (!user) return;
    try {
      const u = await api.getUser(user.id);
      setUser(u);
      writeCache(`user:${u.id}`, u);
    } catch (e) {
      console.error("Failed to refresh user", e);
    }
  };

  useEffect(() => {
    init();
  }, []);

  return (
    <UserContext.Provider value={{
      user, loading, initialized, refresh, retryInit, isAdmin: isAdminState, banned, slots,
      sessionState, blockedInfo, recheckSession,
    }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
