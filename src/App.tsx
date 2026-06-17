import { Component, lazy, Suspense, useEffect } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { cleanUpdateRecoveryQuery, isRecoverableLoadError, recoverFromStaleAssets } from "./appRecovery";
import AuthGate from "./app/AuthGate";
import { RouteFallback, StartupRecovery } from "./components/AppLoadingViews";

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
    </AppErrorBoundary>
  );
}

function AppRoutes() {
  const pathname = window.location.pathname;
  if (pathname === "/download") {
    return (
      <Suspense fallback={<RouteFallback />}>
        <DownloadGuidePage />
      </Suspense>
    );
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
    <>
      <AuthGate />
      <Suspense fallback={null}>
        <PwaInstallPrompt />
      </Suspense>
    </>
  );
}
