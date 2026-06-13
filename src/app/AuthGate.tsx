import { lazy, Suspense } from "react";

const AuthRuntime = lazy(() => import("./AuthRuntime"));

function RouteFallback() {
  return (
    <div className="loading-page">
      <section className="loading-minimal">
        <div className="loading-brand">
          <strong>祝融坤锋美业</strong>
          <small>美业门店管理系统</small>
        </div>
        <div className="loading-progress" aria-hidden="true"><i /></div>
        <small>请稍候</small>
      </section>
    </div>
  );
}

export default function AuthGate() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <AuthRuntime />
    </Suspense>
  );
}
