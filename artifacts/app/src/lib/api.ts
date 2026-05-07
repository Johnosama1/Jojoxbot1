export const api = {
  adminGetTasks: (userId: number) => apiCall<Task[]>('/admin/tasks', { headers: { 'Content-Type': 'application/json', 'x-user-id': String(userId) } }),
  adminGetWheel: (userId: number) => apiCall<WheelSlot[]>('/admin/wheel', { headers: { 'Content-Type': 'application/json', 'x-user-id': String(userId) } }),
  adminGetSettings: (userId: number) => apiCall<Record<string, string>>('/admin/settings', { headers: { 'Content-Type': 'application/json', 'x-user-id': String(userId) } }),
  adminUpdateSetting: (userId: number, key: string, value: string) => apiCall('/admin/settings', { method: 'PUT', body: JSON.stringify({ key, value }), headers: { 'Content-Type': 'application/json', 'x-user-id': String(userId) } }),
  adminGetUsers: (userId: number) => apiCall<User[]>('/admin/users', { headers: { 'Content-Type': 'application/json', 'x-user-id': String(userId) } }),
  adminGetAdmins: (adminId: number) => apiCall<AdminUser[]>('/admin/admins', { headers: { 'Content-Type': 'application/json', 'x-user-id': String(adminId) } }),
  adminGetWithdrawals: (userId: number) => apiCall<Withdrawal[]>('/admin/withdrawals', { headers: { 'Content-Type': 'application/json', 'x-user-id': String(userId) } }),
  adminUpdateUserBalance: (adminId: number, userId: number, balance?: number, spins?: number) => apiCall<User>(`/admin/users/${userId}/balance`, { method: 'PUT', body: JSON.stringify({ balance, spins }), headers: { 'Content-Type': 'application/json', 'x-user-id': String(adminId) } }),
  adminResetVerification: (adminId: number, userId: number) => apiCall<{ success: boolean }>(`/admin/users/${userId}/reset-verification`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-user-id': String(adminId) } }),
  adminCheck: (userId: number) => apiCall<{ isAdmin: boolean }>('/admin/check', { headers: { 'Content-Type': 'application/json', 'x-user-id': String(userId) } }),
};
