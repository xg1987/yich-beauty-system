import type { AuthUser, UserRole } from "../domain/types";

const HIDDEN_ACCOUNT_LIST_ACCOUNTS = new Set(["admin@yich.local"]);
const VISIBLE_PLATFORM_ADMIN_ACCOUNT = "13827445244";

function normalizedAccount(account: string) {
  return account.trim().toLowerCase();
}

export function isVisibleAccount(user: { account: string }) {
  return !HIDDEN_ACCOUNT_LIST_ACCOUNTS.has(normalizedAccount(user.account));
}

export function isVisiblePlatformAdmin(user: { account: string; role: UserRole }) {
  return normalizedAccount(user.account) === VISIBLE_PLATFORM_ADMIN_ACCOUNT || user.role === "superadmin";
}

export function displayRoleName(user: { account: string; role: UserRole; roleName: string }) {
  if (isVisiblePlatformAdmin(user)) return "系统管理员";
  if (user.role === "owner" || user.role === "manager") return "店长";
  if (user.role === "therapist") return "服务人员";
  return user.roleName === "老板" || user.roleName === "主管" ? "店长" : user.roleName;
}

export function displayStaffRole(role: string) {
  return role === "老板" || role === "主管" ? "店长" : role;
}

export function displayUserRole(role: UserRole) {
  const labels: Record<UserRole, string> = {
    superadmin: "系统管理员",
    owner: "店长",
    manager: "店长",
    frontdesk: "前台",
    therapist: "服务人员",
    finance: "财务",
  };
  return labels[role];
}

export function displayAuthUserStatus(status: AuthUser["status"]) {
  if (status === "active") return "启用";
  if (status === "pending") return "待审核";
  return "停用";
}

export function authUserStatusTone(status: AuthUser["status"]) {
  if (status === "active") return "ok" as const;
  if (status === "pending") return undefined;
  return "warn" as const;
}
