import assert from "node:assert/strict";
import { canAccessView, normalizeUserSession, platformOnlyViews, rolePermissions, type UserSession } from "../src/domain/auth";
import type { UserRole, ViewKey } from "../src/domain/types";

const allViews: ViewKey[] = [
  "dashboard",
  "appointments",
  "pos",
  "customers",
  "catalog",
  "staff",
  "inventory",
  "reports",
  "approvals",
  "logs",
  "accounts",
  "permissions",
  "usage",
  "settings",
];

const expectedViewsByRole: Record<UserRole, ViewKey[]> = {
  superadmin: allViews,
  owner: ["dashboard", "appointments", "pos", "customers", "catalog", "staff", "inventory", "reports", "approvals", "logs", "settings"],
  manager: ["dashboard", "appointments", "pos", "customers", "catalog", "staff", "inventory", "reports", "approvals", "logs", "settings"],
  frontdesk: ["dashboard", "appointments", "pos", "customers"],
  therapist: ["dashboard", "appointments", "customers", "staff"],
  finance: ["dashboard", "pos", "staff", "reports", "approvals"],
};

function makeSession(role: UserRole, account = `${role}@yich.local`): UserSession {
  return normalizeUserSession({
    token: "verify",
    user: {
      id: `u_${role}`,
      name: role,
      account,
      role,
      roleName: role,
      permissions: rolePermissions[role],
    },
  });
}

for (const role of Object.keys(expectedViewsByRole) as UserRole[]) {
  const session = makeSession(role);
  const expected = new Set(expectedViewsByRole[role]);

  for (const view of allViews) {
    assert.equal(canAccessView(session, view), expected.has(view), `${role} view access mismatch: ${view}`);
  }
}

for (const role of ["owner", "manager", "frontdesk", "therapist", "finance"] as UserRole[]) {
  const session = makeSession(role);
  for (const view of platformOnlyViews) {
    assert.equal(canAccessView(session, view), false, `${role} should not access platform-only view: ${view}`);
  }
}

const phoneAdminSession = makeSession("owner", "13827445244");
assert.equal(phoneAdminSession.user.role, "superadmin", "platform admin phone account should normalize to superadmin");
for (const view of platformOnlyViews) {
  assert.equal(canAccessView(phoneAdminSession, view), true, `platform admin phone account should access ${view}`);
}

console.log("角色页面访问边界验证通过。");
