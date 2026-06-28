import { lazy, Suspense, useEffect, useState } from "react";
import { BrandedLoading } from "../components/AppLoadingViews";
import { useApiData } from "../hooks/useApiData";

const loadAuthenticatedApp = () => import("./AuthenticatedApp");
const AuthenticatedApp = lazy(loadAuthenticatedApp);
const LoginPage = lazy(() => import("../pages/auth/LoginPage"));

function LoginRouteFallback() {
  return <BrandedLoading message="正在打开系统" detail="请稍候" />;
}

function AppRouteFallback({ onLogout }: { onLogout: () => void }) {
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setCanRetry(true), 8_000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <BrandedLoading
      message={canRetry ? "进入较慢" : "正在进入系统"}
      detail={canRetry ? "网络较慢，可重试或返回登录" : "正在准备业务页面"}
      canRetry={canRetry}
      onRetry={() => window.location.reload()}
      secondaryLabel="返回登录"
      onSecondary={onLogout}
    />
  );
}

export default function AuthRuntime() {
  const apiState = useApiData();
  useEffect(() => {
    void loadAuthenticatedApp().catch(() => undefined);
  }, []);

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
    <Suspense fallback={<AppRouteFallback onLogout={apiState.logout} />}>
      <AuthenticatedApp apiState={apiState} />
    </Suspense>
  );
}
