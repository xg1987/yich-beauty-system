import { randomUUID } from "node:crypto";
import { rolePermissions, type RoleKey, type UserSession } from "../src/domain/auth";

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

const sessions = new Map<string, UserSession>();

export function login(account: string, password: string): UserSession {
  const user = demoUsers.find((item) => item.account === account && item.password === password);
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

export function demoLoginAccounts() {
  return demoUsers.map(({ account, name, roleName }) => ({ account, name, roleName }));
}
