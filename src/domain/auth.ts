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
    role: RoleKey;
    roleName: string;
    staffId?: string;
    permissions: Permission[];
  };
};

export const rolePermissions: Record<RoleKey, Permission[]> = {
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
