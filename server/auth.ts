import { randomUUID } from "node:crypto";
import { effectiveRoleForUser, effectiveRoleNameForUser, normalizeUserSession, permissionsForRole, type UserSession } from "../src/domain/auth";
import type { AuthUser, SystemConfig } from "../src/domain/types";
import { verifyPasswordWithLegacySupport, isLegacyPlaintextPassword } from "../src/lib/password";

const sessions = new Map<string, UserSession>();

export type LoginResult = {
  session: UserSession;
  /** Whether the stored password was still plaintext and should be migrated */
  needsPasswordMigration: boolean;
  /** The user id that needs migration (only meaningful when needsPasswordMigration = true) */
  userIdNeedingMigration?: string;
};

export async function login(account: string, password: string, users: AuthUser[], systemConfigs?: SystemConfig[]): Promise<LoginResult> {
  const user = users.find((item) => item.account === account);
  if (!user) {
    throw new Error("账号或密码不正确");
  }

  const { ok, needsMigration } = await verifyPasswordWithLegacySupport(password, user.password);

  if (!ok) {
    throw new Error("账号或密码不正确");
  }
  if (user.status === "pending") {
    throw new Error("账号正在等待店长审批，请通过后再登录");
  }
  if (user.status !== "active") {
    throw new Error("账号或密码不正确");
  }

  const session = buildSession(randomUUID(), user, systemConfigs);

  sessions.set(session.token, session);

  return {
    session,
    needsPasswordMigration: needsMigration,
    userIdNeedingMigration: needsMigration ? user.id : undefined,
  };
}

export function getSession(authorizationHeader: string | undefined): UserSession | undefined {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, "");
  const session = token ? sessions.get(token) : undefined;
  return session ? normalizeUserSession(session) : undefined;
}

export function refreshSessionUser(token: string, user: AuthUser, systemConfigs?: SystemConfig[]): UserSession {
  const session = buildSession(token, user, systemConfigs);
  sessions.set(token, session);
  return session;
}

export function buildSession(token: string, user: AuthUser, systemConfigs?: SystemConfig[]): UserSession {
  const role = effectiveRoleForUser(user);
  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      account: user.account,
      avatarUrl: user.avatarUrl,
      role,
      roleName: effectiveRoleNameForUser(user),
      staffId: user.staffId,
      permissions: permissionsForRole(role, systemConfigs),
    },
  };
}

/** Helper for callers that want to know if a stored password is still legacy plaintext */
export { isLegacyPlaintextPassword };
