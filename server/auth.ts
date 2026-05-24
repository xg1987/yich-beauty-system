import { randomUUID } from "node:crypto";
import { rolePermissions, type UserSession } from "../src/domain/auth";
import type { AuthUser } from "../src/domain/types";

const sessions = new Map<string, UserSession>();

export function login(account: string, password: string, users: AuthUser[]): UserSession {
  const user = users.find((item) => item.account === account && item.password === password && item.status === "active");
  if (!user) {
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
  return session;
}

export function getSession(authorizationHeader: string | undefined): UserSession | undefined {
  const token = authorizationHeader?.replace(/^Bearer\s+/i, "");
  return token ? sessions.get(token) : undefined;
}

export function demoLoginAccounts(users: AuthUser[]) {
  return users.filter((user) => user.status === "active").map(({ account, name, roleName }) => ({ account, name, roleName }));
}
