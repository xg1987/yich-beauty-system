import { Camera, LogOut, Settings, UserRound } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import type { UserSession } from "../../domain/auth";
import type { AppData } from "../../domain/types";
import { UserAvatar } from "./UserAvatar";

type AccountMenuProps = {
  session: UserSession;
  logout: () => void;
  updateProfile: (body: { name: string; avatarUrl?: string }) => Promise<{ session: UserSession; data: AppData }>;
  openSettings: () => void;
};

export function AccountMenu({ session, logout, updateProfile, openSettings }: AccountMenuProps) {
  const [editing, setEditing] = useState(false);
  const [profileName, setProfileName] = useState(session.user.name);
  const [avatarUrl, setAvatarUrl] = useState(session.user.avatarUrl ?? "");

  useEffect(() => {
    setProfileName(session.user.name);
    setAvatarUrl(session.user.avatarUrl ?? "");
  }, [session.user.name, session.user.avatarUrl]);

  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    void updateProfile({ name: profileName, avatarUrl }).then(() => setEditing(false));
  };

  const uploadAvatar = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatarUrl(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  };

  return (
    <aside className="account-menu" aria-label="账号菜单">
      <div className="account-menu-user">
        <div className="account-menu-avatar"><UserAvatar avatarUrl={avatarUrl} size={22} /></div>
        <div>
          <strong>{session.user.name}</strong>
          <span>{session.user.roleName}</span>
        </div>
      </div>
      {editing && (
        <form className="account-profile-form" onSubmit={saveProfile}>
          <label>
            显示名称
            <input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
          </label>
          <label className="avatar-upload-control">
            <Camera size={16} />
            <span>上传头像</span>
            <input type="file" accept="image/*" onChange={(event) => uploadAvatar(event.target.files?.[0])} />
          </label>
          {avatarUrl && <button type="button" onClick={() => setAvatarUrl("")}>移除头像</button>}
          <button type="submit">保存资料</button>
        </form>
      )}
      <button type="button" onClick={() => setEditing((open) => !open)}>
        <UserRound size={17} />
        <span>个人资料</span>
      </button>
      <button type="button" onClick={openSettings}>
        <Settings size={17} />
        <span>系统设置</span>
      </button>
      <button className="danger" type="button" onClick={logout}>
        <LogOut size={17} />
        <span>退出登录</span>
      </button>
      <div className="account-menu-version">
        v{import.meta.env.PACKAGE_VERSION ?? "0.1.0"}
      </div>
    </aside>
  );
}

export default AccountMenu;
