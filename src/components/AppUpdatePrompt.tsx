export type AppUpdateInfo = {
  currentVersion: string;
  serverVersion: string;
  autoPrompt?: boolean;
};

export function appUpdateInfoFromEvent(event: Event): AppUpdateInfo | null {
  if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== "object") return null;
  const detail = event.detail as Partial<AppUpdateInfo>;
  if (!detail.currentVersion || !detail.serverVersion) return null;
  return { currentVersion: detail.currentVersion, serverVersion: detail.serverVersion, autoPrompt: detail.autoPrompt === true };
}

export function AppUpdatePrompt({
  info,
  updating,
  onDismiss,
  onUpdate,
}: {
  info: AppUpdateInfo;
  updating: boolean;
  onDismiss: () => void;
  onUpdate: () => void;
}) {
  return (
    <div className="app-update-backdrop" role="presentation">
      <section className="app-update-card" role="dialog" aria-modal="true" aria-labelledby="app-update-title">
        <span className="app-update-eyebrow">软件更新</span>
        <h2 id="app-update-title">发现新版本</h2>
        <p>当前版本 v{info.currentVersion}，新版本 v{info.serverVersion} 已发布。更新会刷新当前页面，请先确认正在填写的内容已保存。</p>
        <div className="app-update-version" aria-label="版本信息">
          <span>v{info.currentVersion}</span>
          <b>更新到</b>
          <span>v{info.serverVersion}</span>
        </div>
        <div className="app-update-actions">
          {!info.autoPrompt && <button type="button" className="secondary-button" disabled={updating} onClick={onDismiss}>稍后</button>}
          <button type="button" className="primary-button" disabled={updating} onClick={onUpdate}>{updating ? "更新中..." : "立即更新"}</button>
        </div>
      </section>
    </div>
  );
}
