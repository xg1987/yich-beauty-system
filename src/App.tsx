import { Component, lazy, Suspense, useEffect, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { APP_UPDATE_AVAILABLE_EVENT, dismissAppUpdatePrompt, installAppUpdateChecker, reloadForAppUpdate } from "./appUpdate";
import { RouteFallback, StartupRecovery } from "./components/AppLoadingViews";
import { AppUpdatePrompt, appUpdateInfoFromEvent } from "./components/AppUpdatePrompt";
import type { AppUpdateInfo } from "./components/AppUpdatePrompt";

const AuthGate = lazy(() => import("./app/AuthGate"));
const DownloadGuidePage = lazy(() => import("./pages/public/DownloadGuidePage"));
const PublicStoreRoute = lazy(() => import("./pages/public/PublicStoreRoute"));
const PublicSignatureRoute = lazy(() => import("./pages/public/PublicSignatureRoute"));
const PwaInstallPrompt = lazy(() => import("./components/PwaInstallPrompt"));
const RECOVERY_RELOAD_KEY = "yich-app-recovery-reload";
const RECOVERY_RELOAD_COOLDOWN_MS = 20_000;

function isRecoverableLoadError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|Unable to preload|Loading chunk|ChunkLoadError|dynamically imported module/i.test(message);
}

function recentlyRecovered() {
  const timestamp = Number(window.sessionStorage.getItem(RECOVERY_RELOAD_KEY));
  return Number.isFinite(timestamp) && Date.now() - timestamp < RECOVERY_RELOAD_COOLDOWN_MS;
}

async function clearAppCaches() {
  if (!("caches" in window)) return;
  const cacheNames = await window.caches.keys();
  await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
}

async function recoverFromStaleAssets() {
  if (recentlyRecovered()) return;
  window.sessionStorage.setItem(RECOVERY_RELOAD_KEY, `${Date.now()}`);
  await clearAppCaches();
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("__yich_recover", `${Date.now()}`);
  window.location.replace(nextUrl.toString());
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    if (isRecoverableLoadError(error)) return;
  }

  render() {
    if (this.state.hasError) return <StartupRecovery onRecover={() => void recoverFromStaleAssets()} />;
    return this.props.children;
  }
}

export default function App() {
  const [pendingUpdate, setPendingUpdate] = useState<AppUpdateInfo | null>(null);
  const [updateRefreshing, setUpdateRefreshing] = useState(false);
  const [assetRecoveryPending, setAssetRecoveryPending] = useState(false);

  useEffect(() => {
    const uninstallChecker = installAppUpdateChecker();
    const handleAppUpdate = (event: Event) => {
      const info = appUpdateInfoFromEvent(event);
      if (info?.autoPrompt) setPendingUpdate(info);
    };
    const handlePreloadError = (event: Event) => {
      event.preventDefault();
      setAssetRecoveryPending(true);
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!isRecoverableLoadError(event.reason)) return;
      event.preventDefault();
      setAssetRecoveryPending(true);
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
      {assetRecoveryPending ? <StartupRecovery message="系统有新版本，点击后重新进入" onRecover={() => void recoverFromStaleAssets()} /> : <AppRoutes />}
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
      <Suspense fallback={<RouteFallback />}>
        <AuthGate />
      </Suspense>
      <Suspense fallback={null}>
        <PwaInstallPrompt />
      </Suspense>
    </>
  );
}
