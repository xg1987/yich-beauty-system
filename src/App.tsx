import { lazy, Suspense, useEffect } from "react";
import DownloadGuidePage from "./pages/public/DownloadGuidePage";
import { installAppUpdateChecker } from "./appUpdate";

const AuthGate = lazy(() => import("./app/AuthGate"));
const PublicStoreRoute = lazy(() => import("./pages/public/PublicStoreRoute"));
const PublicSignatureRoute = lazy(() => import("./pages/public/PublicSignatureRoute"));

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

export default function App() {
  useEffect(() => installAppUpdateChecker(), []);

  const pathname = window.location.pathname;
  if (pathname === "/download") {
    return <DownloadGuidePage />;
  }

  const publicStoreMatch = pathname.match(/^\/store\/([^/]+)/);
  if (publicStoreMatch) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <PublicStoreRoute shareCode={decodeURIComponent(publicStoreMatch[1])} />
      </Suspense>
    );
  }

  const publicSignatureMatch = pathname.match(/^\/signature\/([^/]+)/);
  if (publicSignatureMatch) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <PublicSignatureRoute token={decodeURIComponent(publicSignatureMatch[1])} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<RouteFallback />}>
      <AuthGate />
    </Suspense>
  );
}
