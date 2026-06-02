import { ChevronRight, LogOut, Settings } from "lucide-react";
import type { UserSession } from "../../domain/auth";
import { UserAvatar } from "./UserAvatar";

type AccountMenuProps = {
  session: UserSession;
  logout: () => void;
  openSettings: () => void;
};

function menuDisplayName(session: UserSession) {
  return session.user.role === "superadmin" || session.user.name.toLowerCase().includes("admin") ? "admin" : session.user.name;
}

function menuRoleName(session: UserSession) {
  if (menuDisplayName(session) === "admin") return "管理员";
  if (session.user.role === "owner" || session.user.role === "manager") return "店长";
  return session.user.roleName === "老板" || session.user.roleName === "主管" ? "店长" : session.user.roleName;
}

export function AccountMenu({ session, logout, openSettings }: AccountMenuProps) {
  return (
    <aside className="account-menu" aria-label="账号菜单">
      <div className="account-menu-user">
        <div className="account-menu-avatar"><UserAvatar size={34} /></div>
        <div>
          <strong>{menuDisplayName(session)}</strong>
          <span>{menuRoleName(session)}</span>
        </div>
      </div>
      <button type="button" onClick={openSettings}>
        <Settings size={17} />
        <span>系统设置</span>
        <ChevronRight className="account-menu-chevron" size={16} />
      </button>
      <button className="danger" type="button" onClick={logout}>
        <LogOut size={17} />
        <span>退出登录</span>
      </button>
    </aside>
  );
}

export default AccountMenu;
