import { lazy, Suspense } from "react";
import { BrandedLoading } from "../components/AppLoadingViews";
import { useApiData } from "../hooks/useApiData";

const AuthenticatedApp = lazy(() => import("./AuthenticatedApp"));
const LoginPage = lazy(() => import("../pages/auth/LoginPage"));

function LoginRouteFallback() {
  return <BrandedLoading message="正在打开系统" detail="请稍候" />;
}

function AppRouteFallback() {
  return <BrandedLoading message="正在进入系统" detail="正在准备业务页面" />;
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
