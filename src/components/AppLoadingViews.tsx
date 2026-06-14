import { useEffect, useState } from "react";

function LoadingMinimal({ message, canRetry = false }: { message: string; canRetry?: boolean }) {
  return (
    <div className="loading-page">
      <section className="loading-minimal">
        <div className="loading-brand">
          <strong>祝融坤锋美业</strong>
          <small>美业门店管理系统</small>
        </div>
        <div className="loading-progress" aria-hidden="true"><i /></div>
        <small>{message}</small>
        {canRetry && <div className="loading-actions"><button className="loading-action-primary" type="button" onClick={() => window.location.reload()}>重新进入</button></div>}
      </section>
    </div>
  );
}

export function StartupRecovery({ message = "正在更新应用", onRecover }: { message?: string; onRecover: () => void }) {
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setCanRetry(true), 1800);
    onRecover();
    return () => window.clearTimeout(timer);
  }, [onRecover]);

  return <LoadingMinimal message={message} canRetry={canRetry} />;
}

export function RouteFallback() {
  return <LoadingMinimal message="请稍候" />;
}
