import { randomUUID } from "node:crypto";
import { effectiveRoleForUser, effectiveRoleNameForUser, normalizeUserSession, rolePermissions, type UserSession } from "../src/domain/auth";
import type { AuthUser } from "../src/domain/types";
import { verifyPasswordWithLegacySupport, isLegacyPlaintextPassword } from "../src/lib/password";

const sessions = new Map<string, UserSession>();

export type LoginResult = {
  session: UserSession;
  /** Whether the stored password was still plaintext and should be migrated */
  needsPasswordMigration: boolean;
  /** The user id that needs migration (only meaningful when needsPasswordMigration = true) */
  userIdNeedingMigration?: string;
};

export async function login(account: string, password: string, users: AuthUser[]): Promise<LoginResult> {
  const user = users.find((item) => item.account === account && item.status === "active");
  if (!user) {
    throw new Error("账号或密码不正确");
  }

  const { ok, needsMigration } = await verifyPasswordWithLegacySupport(password, user.password);

  if (!ok) {
    throw new Error("账号或密码不正确");
  }

  const session = buildSession(randomUUID(), user);

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

export function refreshSessionUser(token: string, user: AuthUser): UserSession {
  const session = buildSession(token, user);
  sessions.set(token, session);
  return session;
}

export function buildSession(token: string, user: AuthUser): UserSession {
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
      permissions: rolePermissions[role],
    },
  };
}

/** Helper for callers that want to know if a stored password is still legacy plaintext */
export { isLegacyPlaintextPassword };
