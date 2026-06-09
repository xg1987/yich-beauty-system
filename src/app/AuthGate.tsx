import { lazy, Suspense } from "react";
import { useApiData } from "../hooks/useApiData";

const AuthenticatedApp = lazy(() => import("./AuthenticatedApp"));
const LoginPage = lazy(() => import("../pages/auth/LoginPage"));

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
  const apiState = useApiData();
  if (!apiState.session) {
    return (
      <Suspense fallback={<RouteFallback />}>
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
    <Suspense fallback={<RouteFallback />}>
      <AuthenticatedApp apiState={apiState} />
    </Suspense>
  );
}
