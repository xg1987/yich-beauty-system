import { rolePermissions, type RoleKey, type UserSession } from "../domain/auth";
import type { D1DatabaseBinding } from "./d1Types";

type DemoUser = {
  id: string;
  name: string;
  account: string;
  password: string;
  role: RoleKey;
  roleName: string;
  staffId?: string;
};

const demoUsers: DemoUser[] = [
  { id: "u_owner", name: "林老板", account: "owner@demo.local", password: "yich-demo", role: "owner", roleName: "老板" },
  { id: "u_manager", name: "林店长", account: "admin@demo.local", password: "yich-demo", role: "manager", roleName: "店长" },
  { id: "u_frontdesk", name: "阿宁", account: "frontdesk@demo.local", password: "yich-demo", role: "frontdesk", roleName: "前台", staffId: "s3" },
  { id: "u_therapist", name: "小雅", account: "therapist@demo.local", password: "yich-demo", role: "therapist", roleName: "美容师", staffId: "s2" },
  { id: "u_finance", name: "财务", account: "finance@demo.local", password: "yich-demo", role: "finance", roleName: "财务" },
];

export async function loginWithD1(db: D1DatabaseBinding, account: string, password: string): Promise<UserSession> {
  const user = demoUsers.find((item) => item.account === account && item.password === password);
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

  const user = demoUsers.find((item) => item.id === sessionRow.userId);
  return user ? buildSession(token, user) : undefined;
}

export function demoLoginAccounts() {
  return demoUsers.map(({ account, name, roleName }) => ({ account, name, roleName }));
}

function buildSession(token: string, user: DemoUser): UserSession {
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
