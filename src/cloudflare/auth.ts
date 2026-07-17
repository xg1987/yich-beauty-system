import { effectiveRoleForUser, effectiveRoleNameForUser, permissionsForRole, type UserSession } from "../domain/auth";
import type { AuthUser, SystemConfig } from "../domain/types";
import type { D1DatabaseBinding } from "./d1Types";
import { verifyPasswordWithLegacySupport, isLegacyPlaintextPassword } from "../lib/password";
import { newSessionExpiry, isSessionExpired } from "../lib/session";

export type LoginResult = {
  session: UserSession;
  /** Whether the stored password was still plaintext and should be migrated */
  needsPasswordMigration: boolean;
  /** The user id that needs migration (only meaningful when needsPasswordMigration = true) */
  userIdNeedingMigration?: string;
};

export async function loginWithD1(db: D1DatabaseBinding, account: string, password: string): Promise<LoginResult> {
  const [user, systemConfigs] = await Promise.all([
    readAuthUserByAccount(db, account),
    readSystemConfigs(db),
  ]);
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

  const token = crypto.randomUUID();
  const session = buildSession(token, user, systemConfigs);

  await db
    .prepare("INSERT INTO sessions (token, userId, createdAt, expiresAt) VALUES (?, ?, ?, ?)")
    .bind(token, user.id, new Date().toISOString(), newSessionExpiry())
    .run();

  return {
    session,
    needsPasswordMigration: needsMigration,
    userIdNeedingMigration: needsMigration ? user.id : undefined,
  };
}

export async function getSessionFromD1(db: D1DatabaseBinding, authorizationHeader: string | null): Promise<UserSession | undefined> {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return undefined;

  const sessionRow = await db
    .prepare("SELECT userId, expiresAt FROM sessions WHERE token = ?")
    .bind(token)
    .first<{ userId: string; expiresAt: string | null }>();
  if (!sessionRow) return undefined;
  if (isSessionExpired(sessionRow.expiresAt)) {
    await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return undefined;
  }

  const [user, systemConfigs] = await Promise.all([
    readAuthUserById(db, sessionRow.userId),
    readSystemConfigs(db),
  ]);
  return user?.status === "active" ? buildSession(token, user, systemConfigs) : undefined;
}

/** Server-side logout: remove the session row so the token can no longer be used. */
export async function destroySessionInD1(db: D1DatabaseBinding, authorizationHeader: string | null): Promise<void> {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return;
  await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

async function readAuthUserByAccount(db: D1DatabaseBinding, account: string) {
  const row = await db
    .prepare("SELECT payload_json FROM authUsers WHERE json_extract(payload_json, '$.account') = ? LIMIT 1")
    .bind(account)
    .first<{ payload_json: string }>();
  return row ? JSON.parse(row.payload_json) as AuthUser : undefined;
}

async function readAuthUserById(db: D1DatabaseBinding, id: string) {
  const row = await db
    .prepare("SELECT payload_json FROM authUsers WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ payload_json: string }>();
  return row ? JSON.parse(row.payload_json) as AuthUser : undefined;
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

async function readSystemConfigs(db: D1DatabaseBinding) {
  const result = await db.prepare("SELECT payload_json FROM systemConfigs ORDER BY rowid ASC").all<{ payload_json: string }>();
  return (result.results ?? []).map((row) => JSON.parse(row.payload_json) as SystemConfig);
}

/** Helper for callers that want to know if a stored password is still legacy plaintext */
export { isLegacyPlaintextPassword };
