import { rolePermissions, type UserSession } from "../domain/auth";
import type { AuthUser } from "../domain/types";
import type { D1DatabaseBinding } from "./d1Types";

export async function loginWithD1(db: D1DatabaseBinding, account: string, password: string): Promise<UserSession> {
  const user = (await readAuthUsers(db)).find((item) => item.account === account && item.password === password && item.status === "active");
  if (!user) {
    throw new Error("账号或密码不正确");
  }

  const session = buildSession(crypto.randomUUID(), user);
  await db
    .prepare("INSERT INTO sessions (token, userId, createdAt) VALUES (?, ?, ?)")
    .bind(session.token, user.id, new Date().toISOString())
    .run();
  return session;
}

export async function getSessionFromD1(db: D1DatabaseBinding, authorizationHeader: string | null): Promise<UserSession | undefined> {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, "");
  if (!token) return undefined;

  const sessionRow = await db.prepare("SELECT userId FROM sessions WHERE token = ?").bind(token).first<{ userId: string }>();
  if (!sessionRow) return undefined;

  const user = (await readAuthUsers(db)).find((item) => item.id === sessionRow.userId && item.status === "active");
  return user ? buildSession(token, user) : undefined;
}

export function demoLoginAccounts(users: AuthUser[]) {
  return users.filter((user) => user.status === "active").map(({ account, name, roleName }) => ({ account, name, roleName }));
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
