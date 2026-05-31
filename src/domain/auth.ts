import type { ViewKey } from "./types";
import type { UserRole } from "./types";

export type RoleKey = UserRole;

export type Permission =
  | "dashboard:view"
  | "appointments:manage"
  | "pos:manage"
  | "customers:manage"
  | "catalog:manage"
  | "staff:view"
  | "staff:manage"
  | "commissions:settle"
  | "inventory:manage"
  | "reports:view"
  | "approvals:manage"
  | "settings:view";

export type UserSession = {
  token: string;
  user: {
    id: string;
    name: string;
    account: string;
    avatarUrl?: string;
    role: RoleKey;
    roleName: string;
    staffId?: string;
    permissions: Permission[];
  };
};

export const platformAdminAccounts = ["admin@yich.local", "13827445244"];

export function isPlatformAdminAccount(account: string) {
  return platformAdminAccounts.includes(account.trim().toLowerCase());
}

export function effectiveRoleForUser(user: { account: string; role: UserRole }): UserRole {
  return user.role === "superadmin" || isPlatformAdminAccount(user.account) ? "superadmin" : user.role;
}

export function effectiveRoleNameForUser(user: { account: string; role: UserRole; roleName: string }) {
  return effectiveRoleForUser(user) === "superadmin" ? "系统管理员" : user.roleName;
}

export function normalizeUserSession(session: UserSession): UserSession {
  const role = effectiveRoleForUser(session.user);
  return {
    ...session,
    user: {
      ...session.user,
      role,
      roleName: role === "superadmin" ? "系统管理员" : session.user.roleName,
      permissions: rolePermissions[role],
    },
  };
}

export const rolePermissions: Record<RoleKey, Permission[]> = {
  superadmin: [
    "dashboard:view",
    "appointments:manage",
    "pos:manage",
    "customers:manage",
    "catalog:manage",
    "staff:view",
    "inventory:manage",
    "reports:view",
    "approvals:manage",
    "settings:view",
  ],
  owner: [
    "dashboard:view",
    "appointments:manage",
    "pos:manage",
    "customers:manage",
    "catalog:manage",
    "staff:view",
    "staff:manage",
    "commissions:settle",
    "inventory:manage",
    "reports:view",
    "approvals:manage",
    "settings:view",
  ],
  manager: [
    "dashboard:view",
    "appointments:manage",
    "pos:manage",
    "customers:manage",
    "catalog:manage",
    "staff:view",
    "staff:manage",
    "commissions:settle",
    "inventory:manage",
    "reports:view",
    "approvals:manage",
    "settings:view",
  ],
  frontdesk: ["dashboard:view", "appointments:manage", "pos:manage", "customers:manage"],
  therapist: ["dashboard:view", "appointments:manage", "customers:manage", "staff:view"],
  finance: ["dashboard:view", "pos:manage", "staff:view", "commissions:settle", "reports:view", "approvals:manage"],
};

export const viewPermissions: Record<ViewKey, Permission> = {
  dashboard: "dashboard:view",
  appointments: "appointments:manage",
  pos: "pos:manage",
  customers: "customers:manage",
  catalog: "catalog:manage",
  staff: "staff:view",
  inventory: "inventory:manage",
  reports: "reports:view",
  approvals: "approvals:manage",
  logs: "settings:view",
  settings: "settings:view",
};

export function canAccessView(session: UserSession, view: ViewKey) {
  return session.user.permissions.includes(viewPermissions[view]);
}

export function hasPermission(session: UserSession, permission: Permission) {
  return session.user.permissions.includes(permission);
}
