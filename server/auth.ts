import { randomUUID } from "node:crypto";
import { effectiveRoleForUser, effectiveRoleNameForUser, normalizeUserSession, permissionsForRole, type UserSession } from "../src/domain/auth";
import type { AuthUser, SystemConfig } from "../src/domain/types";
import { verifyPasswordWithLegacySupport, isLegacyPlaintextPassword } from "../src/lib/password";
import { SESSION_TTL_MS } from "../src/lib/session";

const sessions = new Map<string, { session: UserSession; expiresAt: number }>();
const loginAttempts = new Map<string, { attempts: number; windowStartedAt: number; lockedUntil?: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

export type LoginResult = {
  session: UserSession;
  /** Whether the stored password was still plaintext and should be migrated */
  needsPasswordMigration: boolean;
  /** The user id that needs migration (only meaningful when needsPasswordMigration = true) */
  userIdNeedingMigration?: string;
};

export async function login(account: string, password: string, users: AuthUser[], systemConfigs?: SystemConfig[], clientKey = "local"): Promise<LoginResult> {
  const attemptKey = `${clientKey.trim().toLowerCase()}:${account.trim().toLowerCase()}`;
  const now = Date.now();
  const attempt = loginAttempts.get(attemptKey);
  if (attempt?.lockedUntil && attempt.lockedUntil > now) throw new Error("登录尝试过多，请15分钟后再试");
  if (attempt && attempt.windowStartedAt + LOGIN_WINDOW_MS <= now) loginAttempts.delete(attemptKey);
  const recordFailure = () => {
    const current = loginAttempts.get(attemptKey);
    const next = !current || current.windowStartedAt + LOGIN_WINDOW_MS <= now
      ? { attempts: 1, windowStartedAt: now }
      : { ...current, attempts: current.attempts + 1 };
    if (next.attempts >= LOGIN_MAX_FAILURES) next.lockedUntil = now + LOGIN_WINDOW_MS;
    loginAttempts.set(attemptKey, next);
  };
  const user = users.find((item) => item.account === account);
  if (!user) {
    recordFailure();
    throw new Error("账号或密码不正确");
  }

  const { ok, needsMigration } = await verifyPasswordWithLegacySupport(password, user.password);

  if (!ok) {
    recordFailure();
    throw new Error("账号或密码不正确");
  }
  loginAttempts.delete(attemptKey);
  if (user.status === "pending") {
    throw new Error("账号正在等待店长审批，请通过后再登录");
  }
  if (user.status !== "active") {
    throw new Error("账号或密码不正确");
  }

  const session = buildSession(randomUUID(), user, systemConfigs);

  sessions.set(session.token, { session, expiresAt: Date.now() + SESSION_TTL_MS });

  return {
    session,
    needsPasswordMigration: needsMigration,
    userIdNeedingMigration: needsMigration ? user.id : undefined,
  };
}

export function getSession(authorizationHeader: string | undefined): UserSession | undefined {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, "");
  const entry = token ? sessions.get(token) : undefined;
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    sessions.delete(token!);
    return undefined;
  }
  return normalizeUserSession(entry.session);
}

/** Server-side logout: forget the token so it can no longer be used. */
export function destroySession(authorizationHeader: string | undefined): void {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, "");
  if (token) sessions.delete(token);
}

export function refreshSessionUser(token: string, user: AuthUser, systemConfigs?: SystemConfig[]): UserSession {
  const session = buildSession(token, user, systemConfigs);
  const existing = sessions.get(token);
  sessions.set(token, { session, expiresAt: existing?.expiresAt ?? Date.now() + SESSION_TTL_MS });
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
      storeId: role === "superadmin" ? undefined : user.storeId,
      staffId: user.staffId,
      permissions: permissionsForRole(role, systemConfigs),
    },
  };
}

/** Helper for callers that want to know if a stored password is still legacy plaintext */
export { isLegacyPlaintextPassword };
