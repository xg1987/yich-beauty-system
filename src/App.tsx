import { Component, lazy, Suspense, useEffect, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import DownloadGuidePage from "./pages/public/DownloadGuidePage";
import { installAppUpdateChecker } from "./appUpdate";
import PwaInstallPrompt from "./components/PwaInstallPrompt";

const AuthGate = lazy(() => import("./app/AuthGate"));
const PublicStoreRoute = lazy(() => import("./pages/public/PublicStoreRoute"));
const PublicSignatureRoute = lazy(() => import("./pages/public/PublicSignatureRoute"));
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

function StartupRecovery({ message = "正在更新应用" }: { message?: string }) {
  const [canRetry, setCanRetry] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setCanRetry(true), 1800);
    void recoverFromStaleAssets();
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="loading-page">
      <section className="loading-minimal">
        <div className="loading-brand">
          <strong>祝融坤锋美业</strong>
          <small>美业门店管理系统</small>
        </div>
        <div className="loading-progress" aria-hidden="true"><i /></div>
        <small>{message}</small>
        {canRetry && (
          <div className="loading-actions">
            <button className="loading-action-primary" type="button" onClick={() => window.location.reload()}>
              重新进入
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo) {
    if (isRecoverableLoadError(error)) {
      void recoverFromStaleAssets();
    }
  }

  render() {
    if (this.state.hasError) return <StartupRecovery />;
    return this.props.children;
  }
}

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
  useEffect(() => {
    const uninstallChecker = installAppUpdateChecker();
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
      uninstallChecker();
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
    <>
      <Suspense fallback={<RouteFallback />}>
        <AuthGate />
      </Suspense>
      <PwaInstallPrompt />
    </>
  );
}
