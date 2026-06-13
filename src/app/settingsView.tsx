import { type FormEvent, useState } from "react";
import { ArrowLeft, Bell, Copy, LockKeyhole, MessageCircle, Save, Sparkles, UserRound } from "lucide-react";
import { UserAvatar } from "../components/business/UserAvatar";
import type { AppData, UserRole, ViewKey } from "../domain/types";
import type { UserSession } from "../domain/auth";
import packageJson from "../../package.json";

type ThemeMode = "day" | "night";
const APP_VERSION = packageJson.version;
const APP_BUILD_DATE = "2026-06-12";

function displayRoleName(user: { account: string; role: UserRole; roleName: string }) {
  if (user.role === "superadmin") return "系统管理员";
  if (user.role === "owner" || user.role === "manager") return "店长";
  if (user.role === "therapist") return "服务人员";
  return user.roleName === "老板" || user.roleName === "主管" ? "店长" : user.roleName;
}

async function copyTextToClipboard(text: string) {
  const value = text.trim();
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {}
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
}

const AVATAR_COMPRESSION_STEPS = [
  { size: 360, quality: 0.72 },
  { size: 300, quality: 0.64 },
  { size: 240, quality: 0.56 },
  { size: 180, quality: 0.48 },
  { size: 128, quality: 0.42 },
];
const AVATAR_MAX_DATA_URL_LENGTH = 150_000;

function renderAvatarDataUrl(image: HTMLImageElement, maxSize: number, quality: number) {
  const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("头像处理失败，请重新选择图片");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function normalizeAvatarSource(source: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      try {
        for (const step of AVATAR_COMPRESSION_STEPS) {
          const dataUrl = renderAvatarDataUrl(image, step.size, step.quality);
          if (dataUrl.length <= AVATAR_MAX_DATA_URL_LENGTH) {
            resolve(dataUrl);
            return;
          }
        }
        reject(new Error("头像无法自动压缩，请换一张图片后再保存"));
      } catch (caught) {
        reject(caught instanceof Error ? caught : new Error("头像处理失败，请重新选择图片"));
      }
    };

    image.onerror = () => {
      reject(new Error("头像读取失败，请重新选择图片"));
    };

    image.src = source;
  });
}

async function normalizeAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("请选择图片文件");
  }
  const imageUrl = URL.createObjectURL(file);
  try {
    return await normalizeAvatarSource(imageUrl);
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function dataUrlToFile(dataUrl: string, filename: string) {
  const [meta, base64] = dataUrl.split(",");
  const match = /data:(.*?);base64/.exec(meta);
  const type = match?.[1] ?? "image/jpeg";
  const binary = window.atob(base64 ?? "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], filename, { type });
}

function isR2AvatarUrl(value: string) {
  return value.startsWith("/api/assets/");
}

function accountAvatarErrorMessage(caught: unknown, fallback: string) {
  const message = caught instanceof Error ? caught.message : fallback;
  if (/SQLITE_TOOBIG|string or blob too big|413|Payload Too Large|头像文件过大/i.test(message)) {
    return "头像文件过大，请重新上传头像";
  }
  if (message.includes("R2 Bucket") || message.includes("未绑定 R2")) {
    return "头像存储服务未配置，请联系管理员";
  }
  return message;
}

export function SettingsView({
  session,
  setView,
  returnView = "dashboard",
  updateProfile,
  uploadAccountAvatar,
  themeMode,
  setThemeMode,
}: {
  session: UserSession;
  setView: (view: ViewKey) => void;
  returnView?: ViewKey;
  updateProfile: (body: { name: string; avatarUrl?: string }) => Promise<{ session: UserSession; data: AppData }>;
  uploadAccountAvatar: (file: File) => Promise<{ avatarUrl: string; key: string; size: number }>;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}) {
  const displayName = session.user.role === "superadmin" || session.user.name.toLowerCase().includes("admin") ? "admin" : session.user.name;
  const displayRole = displayRoleName(session.user);
  const [activePanel, setActivePanel] = useState<"profile" | "security" | "appearance" | "notice">("profile");
  const [profileName, setProfileName] = useState(displayName);
  const [avatarUrl, setAvatarUrl] = useState(session.user.avatarUrl ?? "");
  const [signature, setSignature] = useState("以诚待人，以礼从商。传递华夏智慧，服务雅士人生。");
  const [copiedWechat, setCopiedWechat] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profileError, setProfileError] = useState<string | undefined>();
  const [avatarProcessing, setAvatarProcessing] = useState(false);

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    setSaved(false);
    setProfileError(undefined);
    setAvatarProcessing(true);
    try {
      const compactAvatarUrl = await normalizeAvatarFile(file);
      const uploaded = await uploadAccountAvatar(dataUrlToFile(compactAvatarUrl, "avatar.jpg"));
      setAvatarUrl(uploaded.avatarUrl);
    } catch (caught) {
      setProfileError(accountAvatarErrorMessage(caught, "头像处理失败，请重新选择图片"));
    } finally {
      setAvatarProcessing(false);
    }
  };

  const copyWechat = () => {
    void copyTextToClipboard("yichen_admin").then((copied) => {
      if (!copied) return;
      setCopiedWechat(true);
      window.setTimeout(() => setCopiedWechat(false), 1400);
    });
  };

  const saveSettings = (event: FormEvent) => {
    event.preventDefault();
    setProfileError(undefined);
    setAvatarProcessing(true);
    void (async () => {
      let nextAvatarUrl = avatarUrl;
      if (nextAvatarUrl && !isR2AvatarUrl(nextAvatarUrl)) {
        const compactAvatarUrl = nextAvatarUrl.startsWith("data:image/") ? nextAvatarUrl : await normalizeAvatarSource(nextAvatarUrl);
        const uploaded = await uploadAccountAvatar(dataUrlToFile(compactAvatarUrl, "avatar.jpg"));
        nextAvatarUrl = uploaded.avatarUrl;
      }
      if (nextAvatarUrl && !isR2AvatarUrl(nextAvatarUrl)) {
        throw new Error("头像存储失败，请重新上传头像");
      }
      await updateProfile({ name: profileName.trim() || displayName, avatarUrl: nextAvatarUrl });
      setAvatarUrl(nextAvatarUrl);
    })()
      .then(() => {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1400);
      })
      .catch((caught) => {
        setProfileError(accountAvatarErrorMessage(caught, "账号资料保存失败，请稍后重试"));
      })
      .finally(() => {
        setAvatarProcessing(false);
      });
  };

  const settingTabs = [
    { key: "profile", label: "个人信息", icon: UserRound },
    { key: "security", label: "账户与安全", icon: LockKeyhole },
    { key: "appearance", label: "外观模式", icon: Sparkles },
    { key: "notice", label: "推送通知", icon: Bell },
  ] as const;

  return (
    <div className="settings-profile-page">
      <header className="settings-profile-title">
        <button type="button" aria-label="返回" title="返回" onClick={() => setView(returnView)}>
          <ArrowLeft size={22} />
        </button>
        <h1>系统设置</h1>
      </header>

      <section className="settings-contact-card">
        <div className="settings-contact-copy">
          <MessageCircle size={18} />
          <div>
            <strong>联系管理员</strong>
            <span>系统使用问题 · 账号问题 · 业务问题 都可以加管理员微信咨询</span>
          </div>
        </div>
        <div className="settings-wechat-line">
          <span>微信号</span>
          <strong>yichen_admin</strong>
          <button type="button" onClick={copyWechat}>
            <Copy size={16} />
            {copiedWechat ? "已复制" : "复制"}
          </button>
        </div>
      </section>

      <div className="settings-profile-layout">
        <nav className="settings-profile-nav" aria-label="系统设置分类">
          {settingTabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                className={activePanel === item.key ? "active" : ""}
                onClick={() => setActivePanel(item.key)}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <form className="settings-profile-card" onSubmit={saveSettings}>
          <label className="settings-avatar-editor">
            <span className="settings-avatar-frame">
              <UserAvatar avatarUrl={avatarUrl} size={52} showImage />
            </span>
            <span>{avatarProcessing ? "头像处理中" : "点击更换头像"}</span>
            <input type="file" accept="image/*" onChange={(event) => void uploadAvatar(event.target.files?.[0])} />
          </label>

          {profileError && <div className="settings-profile-message error">{profileError}</div>}
          {saved && !profileError && <div className="settings-profile-message success">头像和资料已保存</div>}

          {activePanel === "profile" && (
            <>
              <div className="settings-field-grid">
                <label>
                  真实姓名
                  <input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
                </label>
                <label>
                  职位
                  <input value={displayRole} readOnly />
                </label>
              </div>
              <label className="settings-signature-field">
                个性签名
                <textarea value={signature} onChange={(event) => setSignature(event.target.value)} />
              </label>
            </>
          )}

          {activePanel === "security" && (
            <div className="settings-static-panel">
              <strong>账户与安全</strong>
              <span>账号：{session.user.account}</span>
              <span>角色：{displayRole}</span>
            </div>
          )}

          {activePanel === "appearance" && (
            <div className="settings-static-panel">
              <strong>外观模式</strong>
              <div className="settings-mode-toggle">
                <button type="button" className={themeMode === "day" ? "active" : ""} onClick={() => setThemeMode("day")}>日间模式</button>
                <button type="button" className={themeMode === "night" ? "active" : ""} onClick={() => setThemeMode("night")}>夜间模式</button>
              </div>
            </div>
          )}

          {activePanel === "notice" && (
            <div className="settings-static-panel">
              <strong>推送通知</strong>
              <span>预约、审批、库存预警会在顶部通知中显示。</span>
            </div>
          )}

          <div className="settings-save-row">
            <button className="primary-button" type="submit" disabled={avatarProcessing}>
              <Save size={18} />
              {avatarProcessing ? "处理中" : saved ? "已保存" : "保存设置"}
            </button>
          </div>
        </form>
      </div>

      <footer className="settings-version" aria-label="软件版本">
        <strong>祝融｜坤锋美业门店系统 · v{APP_VERSION}</strong>
        <span>© 2026 祝融｜坤锋 · 构建于 {APP_BUILD_DATE}</span>
      </footer>
    </div>
  );
}

