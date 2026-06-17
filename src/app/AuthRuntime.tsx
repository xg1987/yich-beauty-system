import { lazy, Suspense } from "react";
import { useApiData } from "../hooks/useApiData";

const AuthenticatedApp = lazy(() => import("./AuthenticatedApp"));
const LoginPage = lazy(() => import("../pages/auth/LoginPage"));

function LoginRouteFallback() {
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

function AppRouteFallback() {
  return (
    <div className="app-route-loading" aria-live="polite">
      <section className="app-route-loading-card" aria-busy="true">
        <span className="app-route-loading-mark" aria-hidden="true" />
        <strong>正在进入系统</strong>
        <small>正在准备业务页面</small>
      </section>
    </div>
  );
}

export default function AuthRuntime() {
  const apiState = useApiData();
  if (!apiState.session) {
    return (
      <Suspense fallback={<LoginRouteFallback />}>
        <LoginPage
          onLogin={apiState.login}
          onJoin={apiState.joinInvite}
          authenticate={apiState.authenticate}
          loading={apiState.loading}
          error={apiState.error}
        />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<AppRouteFallback />}>
      <AuthenticatedApp apiState={apiState} />
    </Suspense>
  );
}
