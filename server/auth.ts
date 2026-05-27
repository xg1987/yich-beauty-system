import { randomUUID } from "node:crypto";
import { rolePermissions, type UserSession } from "../src/domain/auth";
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
  if (isLegacySampleCredential(account, password)) {
    throw new Error("账号或密码不正确");
  }

  const user = users.find((item) => item.account === account && item.status === "active");
  if (!user) {
    throw new Error("账号或密码不正确");
  }

  const { ok, needsMigration } = await verifyPasswordWithLegacySupport(password, user.password);

  if (!ok) {
    throw new Error("账号或密码不正确");
  }

  const session: UserSession = {
    token: randomUUID(),
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

  sessions.set(session.token, session);

  return {
    session,
    needsPasswordMigration: needsMigration,
    userIdNeedingMigration: needsMigration ? user.id : undefined,
  };
}

export function getSession(authorizationHeader: string | undefined): UserSession | undefined {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, "");
  return token ? sessions.get(token) : undefined;
}

function isLegacySampleCredential(account: string, password: string) {
  return account.endsWith("@demo.local") || password === "yich-demo";
}

/** Helper for callers that want to know if a stored password is still legacy plaintext */
export { isLegacyPlaintextPassword };
