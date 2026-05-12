const BASE_URL = (import.meta.env.VITE_API_URL ?? "") + "/api";

function getTelegramInitData(): string {
  return (window as unknown as { Telegram?: { WebApp?: { initData: string } } })
    .Telegram?.WebApp?.initData || "";
}

// ── Session token (issued by /api/session/issue after verification) ──
let _sessionToken: string | null = null;

export function setSessionToken(token: string) {
  _sessionToken = token;
}

export function getSessionToken(): string | null {
  return _sessionToken;
}

export function clearSessionToken() {
  _sessionToken = null;
}

// ── Module-level caches ───────────────────────────────────────────────
let _slotsCache: Promise<WheelSlot[]> | null = null;
export function getWheelSlotsOnce(): Promise<WheelSlot[]> {
  if (!_slotsCache) _slotsCache = apiCall<WheelSlot[]>("/wheel");
  return _slotsCache;
}

export type BoostStatus = { active: boolean; multiplier: number; endsAt: string | null };
export async function getBoostStatus(): Promise<BoostStatus> {
  return apiCall<BoostStatus>("/wheel/boost");
}

let _tasksCache: Promise<Task[]> | null = null;
export function getTasksOnce(): Promise<Task[]> {
  if (!_tasksCache) {
    _tasksCache = apiCall<Task[]>("/tasks").catch((err) => {
      _tasksCache = null;
      throw err;
    });
  }
  return _tasksCache;
}

const _completedCache = new Map<number, Promise<number[]>>();
export function getCompletedTasksOnce(userId: number): Promise<number[]> {
  if (!_completedCache.has(userId))
    _completedCache.set(userId, apiCall<number[]>(`/tasks/${userId}/completed`));
  return _completedCache.get(userId)!;
}

const _withdrawalsCache = new Map<number, Promise<Withdrawal[]>>();
export function getWithdrawalsOnce(userId: number): Promise<Withdrawal[]> {
  if (!_withdrawalsCache.has(userId))
    _withdrawalsCache.set(userId, apiCall<Withdrawal[]>(`/withdrawals/${userId}`));
  return _withdrawalsCache.get(userId)!;
}

export async function swapUsdtToTon(userId: number, usdtAmount: number) {
  return apiCall<{ success: boolean; tonAmount: string; tonPrice: number; user: unknown }>(
    `/users/${userId}/swap`,
    { method: "POST", body: JSON.stringify({ usdtAmount }) }
  );
}

export function invalidateUserCaches(userId: number) {
  _completedCache.delete(userId);
  _withdrawalsCache.delete(userId);
  _tasksCache = null;
}

// ── Core fetch wrapper ────────────────────────────────────────────────
export async function apiCall<T>(path: string, options?: RequestInit): Promise<T> {
  const initData = getTelegramInitData();
  const baseHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (initData) baseHeaders["x-telegram-init-data"] = initData;
  if (_sessionToken) baseHeaders["x-session-token"] = _sessionToken;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...baseHeaders,
        ...(options?.headers as Record<string, string> | undefined),
      },
    });
  } catch (err) {
    clearTimeout(timeout);
    const e = new Error("Request timeout or network error") as Error & { status: number; body: unknown };
    e.status = 0;
    e.body = {};
    throw e;
  }
  clearTimeout(timeout);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));

    if (res.status === 401 && err.error === "session_expired") {
      clearSessionToken();
    }

    const e = new Error(err.error || "Request failed") as Error & { status: number; body: unknown };
    e.status = res.status;
    e.body = err;
    throw e;
  }
  return res.json();
}

export const api = {
  getConfig: () => apiCall<{ botUsername: string; referralThreshold: number }>("/config"),

  initUser: (data: { id: number; username?: string; first_name?: string; last_name?: string; photo_url?: string }) =>
    apiCall<User>("/users/init", { method: "POST", body: JSON.stringify(data) }),

  getUser: (id: number) => apiCall<User>(`/users/${id}`),

  issueSession: (userId: number) =>
    apiCall<SessionResult>("/session/issue", { method: "POST", body: JSON.stringify({ userId }) }),

  recheckSession: (userId: number) =>
    apiCall<SessionResult>("/session/recheck", { method: "POST", body: JSON.stringify({ userId }) }),

  spin: (userId: number) =>
    apiCall<{ winner: WheelSlot; user: User; slotIndex: number; slots: WheelSlot[] }>(`/users/${userId}/spin`, { method: "POST" }),

  getTasks: () => apiCall<Task[]>("/tasks"),
  getUserCompletedTasks: (userId: number) => apiCall<number[]>(`/tasks/${userId}/completed`),
  completeTask: (taskId: number, userId: number) =>
    apiCall<{ success: boolean; user: User }>(`/tasks/${taskId}/complete`, { method: "POST", body: JSON.stringify({ userId }) }),

  getWheelSlots: () => apiCall<WheelSlot[]>("/wheel"),

  requestWithdrawal: (data: { userId: number; amount: string; walletAddress: string }) =>
    apiCall("/withdrawals", { method: "POST", body: JSON.stringify(data) }),
  getUserWithdrawals: (userId: number) => apiCall<Withdrawal[]>(`/withdrawals/${userId}`),

  adminGetUsers: (userId: number) => apiCall<User[]>("/admin/users", { headers: { "Content-Type": "application/json", "x-user-id": String(userId) } }),
  adminGetTasks: (userId: number) => apiCall<Task[]>("/admin/tasks", { headers: { "Content-Type": "application/json", "x-user-id": String(userId) } }),
  adminCreateTask: (userId: number, data: Partial<Task>) => apiCall<Task>("/admin/tasks", { method: "POST", body: JSON.stringify(data), headers: { "Content-Type": "application/json", "x-user-id": String(userId) } }),
  adminDeleteTask: (userId: number, id: number) => apiCall(`/admin/tasks/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json", "x-user-id": String(userId) } }),
  adminGetWheel: (userId: number) => apiCall<WheelSlot[]>("/admin/wheel", { headers: { "Content-Type": "application/json", "x-user-id": String(userId) } }),
  adminUpdateWheel: (userId: number, slots: WheelSlot[]) => apiCall<WheelSlot[]>("/admin/wheel", { method: "PUT", body: JSON.stringify({ slots }), headers: { "Content-Type": "application/json", "x-user-id": String(userId) } }),
  adminGetSettings: (userId: number) => apiCall<Record<string, string>>("/admin/settings", { headers: { "Content-Type": "application/json", "x-user-id": String(userId) } }),
  adminUpdateSetting: (userId: number, key: string, value: string) => apiCall("/admin/settings", { method: "PUT", body: JSON.stringify({ key, value }), headers: { "Content-Type": "application/json", "x-user-id": String(userId) } }),
  adminUpdateUserBalance: (adminId: number, userId: number, balance?: number, spins?: number) =>
    apiCall<User>(`/admin/users/${userId}/balance`, { method: "PUT", body: JSON.stringify({ balance, spins }), headers: { "Content-Type": "application/json", "x-user-id": String(adminId) } }),
  adminGetWithdrawals: (userId: number) => apiCall<Withdrawal[]>("/admin/withdrawals", { headers: { "Content-Type": "application/json", "x-user-id": String(userId) } }),
  adminAuditWithdrawal: (adminId: number, wdId: number) => apiCall<AuditResult>(`/admin/withdrawals/${wdId}/audit`, { headers: { "Content-Type": "application/json", "x-user-id": String(adminId) } }),
  adminUpdateWithdrawal: (adminId: number, wdId: number, action: "approve" | "reject", txHash?: string) =>
    apiCall<{ success: boolean; withdrawal: Withdrawal }>(`/admin/withdrawals/${wdId}`, { method: "PUT", body: JSON.stringify({ action, txHash }), headers: { "Content-Type": "application/json", "x-user-id": String(adminId) } }),
  adminBanUser: (adminId: number, userId: number, banned: boolean) =>
    apiCall<{ success: boolean }>(`/admin/users/${userId}/ban`, { method: "PUT", body: JSON.stringify({ banned }), headers: { "Content-Type": "application/json", "x-user-id": String(adminId) } }),
  adminResetVerification: (adminId: number, userId: number) =>
    apiCall<{ success: boolean }>(`/admin/users/${userId}/reset-verification`, { method: "PUT", headers: { "Content-Type": "application/json", "x-user-id": String(adminId) } }),

  adminGetAdmins: (adminId: number) =>
    apiCall<AdminUser[]>("/admin/admins", { headers: { "Content-Type": "application/json", "x-user-id": String(adminId) } }),
  adminAddAdmin: (adminId: number, data: { id: number; username?: string; permissions: AdminPermission[] }) =>
    apiCall<AdminUser>("/admin/admins", { method: "POST", body: JSON.stringify(data), headers: { "Content-Type": "application/json", "x-user-id": String(adminId) } }),
  adminUpdateAdminPerms: (adminId: number, targetId: number, permissions: AdminPermission[]) =>
    apiCall<AdminUser>(`/admin/admins/${targetId}/permissions`, { method: "PUT", body: JSON.stringify({ permissions }), headers: { "Content-Type": "application/json", "x-user-id": String(adminId) } }),
  adminDeleteAdmin: (adminId: number, targetId: number) =>
    apiCall<{ success: boolean }>(`/admin/admins/${targetId}`, { method: "DELETE", headers: { "Content-Type": "application/json", "x-user-id": String(adminId) } }),

  adminCheck: (userId: number) =>
    apiCall<{ isAdmin: boolean }>("/admin/check", { headers: { "Content-Type": "application/json", "x-user-id": String(userId) } }),

  saveWallet: (userId: number, walletAddress: string) =>
    apiCall<{ savedWalletAddress: string }>(`/users/${userId}/wallet`, {
      method: "PUT",
      body: JSON.stringify({ walletAddress }),
    }),

  verifyDevice: (deviceId: string) =>
    apiCall<{ success: boolean; alreadyVerified?: boolean }>("/verify-device", {
      method: "POST",
      body: JSON.stringify({ deviceId }),
    }),

  getUserReferrals: (userId: number) => apiCall<ReferralEntry[]>(`/users/${userId}/referrals`),

  getLeaderboard: (userId?: number) =>
    apiCall<{
      top: Array<{
        rank: number;
        id: number;
        username: string | null;
        firstName: string | null;
        lastName: string | null;
        referralCount: number;
      }>;
      myRank: { rank: number; referralCount: number } | null;
    }>(`/leaderboard${userId ? `?userId=${userId}` : ""}`),

  verifyAccess: (userId: number) =>
    apiCall<VerifyAccessResult>(`/subscription/verify-access?userId=${userId}`),

  recheckSubscription: (userId: number) =>
    apiCall<{ isBlocked: boolean; missingChannels: SubscriptionChannel[] }>(
      "/subscription/recheck",
      { method: "POST", body: JSON.stringify({ userId }) }
    ),

  getSubscriptionStatus: (userId: number) =>
    apiCall<SubscriptionStatus>(`/subscription/status/${userId}`),
};

// ── Types ─────────────────────────────────────────────────────────────

export interface SessionResult {
  token: string;
  expiresAt: number;
  userId: number;
}

export interface User {
  id: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  balance: string;
  tonBalance: string;
  spins: number;
  referralCount: number;
  tasksCompleted: number;
  referredBy: number | null;
  inviterName: string | null;
  savedWalletAddress: string | null;
  createdAt: string;
  isVerified: boolean;
  rewardedSpins: number;
  isBlockedForLeaving: boolean;
  isVisible: boolean | null;
}

export interface ReferralEntry {
  id: number;
  name: string;
  username: string | null;
  photoUrl: string | null;
  status: "pending" | "approved";
  joinedAt: string;
}

export interface Task {
  id: number;
  title: string;
  description: string | null;
  url: string | null;
  icon: string | null;
  channelPhotoUrl: string | null;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export interface WheelSlot {
  id: number;
  amount: string;
  probability: number;
  displayOrder: number;
}

export interface Withdrawal {
  id: number;
  userId: number;
  amount: string;
  walletAddress: string;
  status: string;
  createdAt: string;
}

export type AdminPermission = "canUnban" | "canWarn" | "canReceiveWithdrawals" | "canEditWheel";

export interface AdminUser {
  id: number;
  username: string | null;
  role: string;
  addedAt: string;
  permissions: AdminPermission[];
}

export interface SubscriptionChannel {
  username: string;
  title: string;
  inviteLink: string;
}

export interface SubscriptionStatus {
  enforced: boolean;
  isBlocked: boolean;
  missingChannels: SubscriptionChannel[];
  requiredChannels: SubscriptionChannel[];
}

export interface VerifyAccessResult {
  allowed: boolean;
  enforced: boolean;
  message?: string;
  missingChannels: SubscriptionChannel[];
  requiredChannels: SubscriptionChannel[];
}

export interface AuditFinding {
  level: "danger" | "warning" | "info";
  text: string;
}

export interface AuditResult {
  withdrawal: Withdrawal;
  user: User;
  riskScore: number;
  findings: AuditFinding[];
  stats: {
    accountAgeDays: number;
    balance: string;
    tonBalance: string;
    tasksCompleted: number;
    referralCount: number;
    rewardedSpins: number;
    estimatedSpinsEarned: number;
    estimatedMaxBalance: string;
    avgExpectedBalance: string;
    pendingWithdrawalsCount: number;
    totalWithdrawn: string;
    allWithdrawalsCount: number;
    isDeviceVerified: boolean;
    isBlockedForLeaving: boolean;
    isBanned: boolean;
  };
}
