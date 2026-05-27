import { rolePermissions, type UserSession } from "../domain/auth";
import type { AuthUser } from "../domain/types";
import type { D1DatabaseBinding } from "./d1Types";
import { verifyPasswordWithLegacySupport, isLegacyPlaintextPassword } from "../lib/password";

export type LoginResult = {
  session: UserSession;
  /** Whether the stored password was still plaintext and should be migrated */
  needsPasswordMigration: boolean;
  /** The user id that needs migration (only meaningful when needsPasswordMigration = true) */
  userIdNeedingMigration?: string;
};

export async function loginWithD1(db: D1DatabaseBinding, account: string, password: string): Promise<LoginResult> {
  if (isLegacySampleCredential(account, password)) {
    throw new Error("账号或密码不正确");
  }

  const users = await readAuthUsers(db);
  const user = users.find((item) => item.account === account && item.status === "active");
  if (!user) {
    throw new Error("账号或密码不正确");
  }

  const { ok, needsMigration } = await verifyPasswordWithLegacySupport(password, user.password);
  if (!ok) {
    throw new Error("账号或密码不正确");
  }

  const token = crypto.randomUUID();
  const session = buildSession(token, user);

  await db
    .prepare("INSERT INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)")
    .bind(token, user.id, new Date().toISOString())
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

  const sessionRow = await db.prepare("SELECT userId FROM sessions WHERE token = ?").bind(token).first<{ userId: string }>();
  if (!sessionRow) return undefined;

  const user = (await readAuthUsers(db)).find((item) => item.id === sessionRow.userId && item.status === "active");
  return user ? buildSession(token, user) : undefined;
}

async function readAuthUsers(db: D1DatabaseBinding) {
  const result = await db.prepare("SELECT payload_json FROM authUsers ORDER BY rowid ASC").all<{ payload_json: string }>();
  return (result.results ?? []).map((row) => JSON.parse(row.payload_json) as AuthUser);
}

function buildSession(token: string, user: AuthUser): UserSession {
  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      account: user.account,
      role: user.role,
      roleName: user.roleName,
      staffId: user.staffId,
      permissions: rolePermissions[user.role],
    },
  };
}

function isLegacySampleCredential(account: string, password: string) {
  return account.endsWith("@demo.local") || password === "yich-demo";
}

/** Helper for callers that want to know if a stored password is still legacy plaintext */
export { isLegacyPlaintextPassword };
