import { Component, lazy, Suspense, useEffect } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { cleanUpdateRecoveryQuery, isRecoverableLoadError, recoverFromStaleAssets } from "./appRecovery";
import AuthGate from "./app/AuthGate";
import { RouteFallback, StartupRecovery } from "./components/AppLoadingViews";

const AppUpdateLayer = lazy(() => import("./components/AppUpdateLayer").then((module) => ({ default: module.AppUpdateLayer })));
const DownloadGuidePage = lazy(() => import("./pages/public/DownloadGuidePage"));
const PublicStoreRoute = lazy(() => import("./pages/public/PublicStoreRoute"));
const PublicSignatureRoute = lazy(() => import("./pages/public/PublicSignatureRoute"));
const PwaInstallPrompt = lazy(() => import("./components/PwaInstallPrompt"));

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; recovering: boolean }> {
  state = { hasError: false, recovering: false };

  static getDerivedStateFromError(error: unknown) {
    if (isRecoverableLoadError(error)) return { hasError: false, recovering: true };
    return { hasError: true, recovering: false };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    if (isRecoverableLoadError(error)) {
      void recoverFromStaleAssets();
    }
  }

  render() {
    if (this.state.recovering) return <RouteFallback />;
    if (this.state.hasError) return <StartupRecovery onRecover={() => void recoverFromStaleAssets()} />;
    return this.props.children;
  }
}

export default function App() {
  useEffect(() => {
    cleanUpdateRecoveryQuery();
    const handlePreloadError = (event: Event) => {
      event.preventDefault();
      void recoverFromStaleAssets();
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!isRecoverableLoadError(event.reason)) return;
      event.preventDefault();
      void recoverFromStaleAssets();
    };

    window.addEventListener("vite:preloadError", handlePreloadError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("vite:preloadError", handlePreloadError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return (
    <AppErrorBoundary>
      <AppRoutes />
      <Suspense fallback={null}>
        <AppUpdateLayer />
      </Suspense>
    </AppErrorBoundary>
  );
}

function AppRoutes() {
  const pathname = window.location.pathname;
  if (pathname === "/download") {
    return (
      <Suspense fallback={<PublicRouteFallback label="下载中心" />}>
        <DownloadGuidePage />
      </Suspense>
    );
  }

  const publicStoreMatch = pathname.match(/^\/store\/([^/]+)/);
  if (publicStoreMatch) {
    return (
      <Suspense fallback={<PublicRouteFallback label="线上店铺" />}>
        <PublicStoreRoute shareCode={decodeURIComponent(publicStoreMatch[1])} />
      </Suspense>
    );
  }

  const publicSignatureMatch = pathname.match(/^\/signature\/([^/]+)/);
  if (publicSignatureMatch) {
    return (
      <Suspense fallback={<PublicSignatureFallback />}>
        <PublicSignatureRoute token={decodeURIComponent(publicSignatureMatch[1])} />
      </Suspense>
    );
  }

  return (
    <>
      <AuthGate />
      <Suspense fallback={null}>
        <PwaInstallPrompt />
      </Suspense>
    </>
  );
}

function PublicSignatureFallback() {
  return (
    <div className="public-store-page signature-page signature-page-pending signature-route-loading">
      <main className="public-store-shell">
        <section className="public-store-panel">
          <div className="signature-grid">
            <section className="signature-detail signature-loading-card" aria-busy="true">
              <div className="signature-loading-title">确认内容</div>
              <div className="signature-loading-line" />
              <div className="signature-loading-list">
                <span />
                <span />
                <span />
              </div>
            </section>
            <section className="signature-form signature-loading-card" aria-busy="true">
              <div className="signature-loading-title">签名确认</div>
              <div className="signature-loading-input" />
              <div className="signature-loading-canvas" />
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}

function PublicRouteFallback({ label }: { label: string }) {
  return (
    <div className="public-route-fallback">
      <section>
        <strong>{label}</strong>
        <span>正在打开</span>
      </section>
    </div>
  );
}
