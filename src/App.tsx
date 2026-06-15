import { Component, lazy, Suspense, useEffect, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { APP_UPDATE_AVAILABLE_EVENT, dismissAppUpdatePrompt, installAppUpdateChecker, reloadForAppUpdate } from "./appUpdate";
import { cleanUpdateRecoveryQuery, isRecoverableLoadError, recoverFromStaleAssets } from "./appRecovery";
import AuthGate from "./app/AuthGate";
import { RouteFallback, StartupRecovery } from "./components/AppLoadingViews";
import { AppUpdatePrompt, appUpdateInfoFromEvent } from "./components/AppUpdatePrompt";
import type { AppUpdateInfo } from "./components/AppUpdatePrompt";

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
  const [pendingUpdate, setPendingUpdate] = useState<AppUpdateInfo | null>(null);
  const [updateRefreshing, setUpdateRefreshing] = useState(false);

  useEffect(() => {
    cleanUpdateRecoveryQuery();
    const uninstallChecker = installAppUpdateChecker();
    const handleAppUpdate = (event: Event) => {
      const info = appUpdateInfoFromEvent(event);
      if (info?.autoPrompt) setPendingUpdate(info);
    };
    const handlePreloadError = (event: Event) => {
      event.preventDefault();
      void recoverFromStaleAssets();
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!isRecoverableLoadError(event.reason)) return;
      event.preventDefault();
      void recoverFromStaleAssets();
    };

    window.addEventListener(APP_UPDATE_AVAILABLE_EVENT, handleAppUpdate);
    window.addEventListener("vite:preloadError", handlePreloadError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      uninstallChecker();
      window.removeEventListener(APP_UPDATE_AVAILABLE_EVENT, handleAppUpdate);
      window.removeEventListener("vite:preloadError", handlePreloadError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  const dismissUpdate = () => {
    if (pendingUpdate) dismissAppUpdatePrompt(pendingUpdate.serverVersion);
    setPendingUpdate(null);
  };

  const updateNow = () => {
    if (!pendingUpdate) return;
    setUpdateRefreshing(true);
    void reloadForAppUpdate(pendingUpdate.serverVersion);
  };

  return (
    <AppErrorBoundary>
      <AppRoutes />
      {pendingUpdate && (
        <AppUpdatePrompt
          info={pendingUpdate}
          updating={updateRefreshing}
          onDismiss={dismissUpdate}
          onUpdate={updateNow}
        />
      )}
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
