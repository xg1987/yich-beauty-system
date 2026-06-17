import { useEffect, useState } from "react";

function NeutralLoading({ message, canRetry = false, onRetry }: { message: string; canRetry?: boolean; onRetry?: () => void }) {
  return (
    <div className="app-route-loading" aria-live="polite">
      <section className="app-route-loading-card" aria-busy={!canRetry}>
        <span className="app-route-loading-mark" aria-hidden="true" />
        <strong>{message}</strong>
        <small>正在准备页面</small>
        {canRetry && (
          <div className="app-route-loading-actions">
            <button className="app-route-loading-primary" type="button" onClick={onRetry ?? (() => window.location.reload())}>
              重新进入
            </button>
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

  return <NeutralLoading message={message} canRetry={canRetry} onRetry={onRecover} />;
}

export function RouteFallback() {
  return <NeutralLoading message="请稍候" />;
}
