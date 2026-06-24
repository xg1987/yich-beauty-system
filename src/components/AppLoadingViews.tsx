import { useEffect, useState } from "react";

export function BrandedLoading({
  message,
  detail = "正在准备页面",
  canRetry = false,
  onRetry,
  primaryLabel = "重新进入",
  secondaryLabel,
  onSecondary,
}: {
  message: string;
  detail?: string;
  canRetry?: boolean;
  onRetry?: () => void;
  primaryLabel?: string;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <div className="loading-page" aria-live="polite">
      <section className="loading-minimal app-data-loading-card" aria-busy={!canRetry}>
        <div className="loading-brand">
          <strong>祝融｜坤锋美业门店系统</strong>
          <small>门店经营管理平台</small>
        </div>
        <div className="loading-progress" aria-hidden="true"><i /></div>
        <strong>{message}</strong>
        <small>{detail}</small>
        {canRetry && (
          <div className="app-route-loading-actions">
            <button className="app-route-loading-primary" type="button" onClick={onRetry ?? (() => window.location.reload())}>
              {primaryLabel}
            </button>
            {secondaryLabel && onSecondary && (
              <button className="app-route-loading-secondary" type="button" onClick={onSecondary}>
                {secondaryLabel}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export function StartupRecovery({ message = "正在更新应用", onRecover }: { message?: string; onRecover: () => void }) {
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setCanRetry(true), 1800);
    return () => window.clearTimeout(timer);
  }, [onRecover]);

  return <BrandedLoading message={message} canRetry={canRetry} onRetry={onRecover} />;
}

export function RouteFallback() {
  return <BrandedLoading message="请稍候" />;
}
