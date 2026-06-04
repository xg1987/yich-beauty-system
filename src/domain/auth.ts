import type { SystemConfig, ViewKey } from "./types";
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
  | "logs:view"
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

const allPermissions: Permission[] = [
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
  "logs:view",
  "settings:view",
];

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

export function normalizeUserSession(session: UserSession, systemConfigs?: SystemConfig[]): UserSession {
  const role = effectiveRoleForUser(session.user);
  return {
    ...session,
    user: {
      ...session.user,
      role,
      roleName: role === "superadmin" ? "系统管理员" : session.user.roleName,
      permissions: permissionsForRole(role, systemConfigs),
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
    "staff:manage",
    "commissions:settle",
    "inventory:manage",
    "reports:view",
    "approvals:manage",
    "logs:view",
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
    "logs:view",
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
    "logs:view",
    "settings:view",
  ],
  frontdesk: ["dashboard:view", "appointments:manage", "customers:manage", "settings:view"],
  therapist: ["dashboard:view", "appointments:manage", "customers:manage", "staff:view", "settings:view"],
  finance: ["dashboard:view", "pos:manage", "staff:view", "commissions:settle", "reports:view", "approvals:manage", "settings:view"],
};

export function defaultRolePermissionTemplates() {
  return structuredClone(rolePermissions);
}

export function parseRolePermissionTemplates(systemConfigs?: SystemConfig[]) {
  const configValue = systemConfigs?.find((item) => item.key === "role_permissions")?.value;
  if (!configValue) return defaultRolePermissionTemplates();
  try {
    return normalizeRolePermissionTemplates(JSON.parse(configValue));
  } catch {
    return defaultRolePermissionTemplates();
  }
}

export function serializeRolePermissionTemplates(templates: Partial<Record<RoleKey, Permission[]>>) {
  return JSON.stringify(normalizeRolePermissionTemplates(templates));
}

export function normalizeRolePermissionTemplates(input: unknown): Record<RoleKey, Permission[]> {
  const nextTemplates = defaultRolePermissionTemplates();
  if (!input || typeof input !== "object") return nextTemplates;
  const inputRecord = input as Partial<Record<RoleKey, unknown>>;
  (Object.keys(nextTemplates) as RoleKey[]).forEach((role) => {
    const values = Array.isArray(inputRecord[role]) ? inputRecord[role] : nextTemplates[role];
    const permissions = values.filter((permission): permission is Permission =>
      typeof permission === "string" && allPermissions.includes(permission as Permission),
    );
    nextTemplates[role] = Array.from(new Set(permissions));
  });
  nextTemplates.superadmin = Array.from(new Set([...nextTemplates.superadmin, "dashboard:view", "settings:view"]));
  return nextTemplates;
}

export function permissionsForRole(role: RoleKey, systemConfigs?: SystemConfig[]) {
  return parseRolePermissionTemplates(systemConfigs)[role] ?? rolePermissions[role];
}

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
  logs: "logs:view",
  accounts: "settings:view",
  permissions: "settings:view",
  usage: "settings:view",
  roomSettings: "settings:view",
  settings: "settings:view",
};

export const platformOnlyViews = new Set<ViewKey>(["accounts", "permissions", "usage"]);

export function canAccessView(session: UserSession, view: ViewKey) {
  if (platformOnlyViews.has(view) && effectiveRoleForUser(session.user) !== "superadmin") return false;
  return session.user.permissions.includes(viewPermissions[view]);
}

export function hasPermission(session: UserSession, permission: Permission) {
  return session.user.permissions.includes(permission);
}
