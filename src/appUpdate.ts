import packageJson from "../package.json";

type HealthPayload = {
  ok?: boolean;
  version?: string;
};

export type AppUpdateStatus = {
  currentVersion: string;
  serverVersion?: string;
  updateAvailable: boolean;
  checkedAt: string;
  error?: string;
};

const API_BASE_URL = (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL ?? "";
export const CURRENT_APP_VERSION = packageJson.version;
const CHECK_INTERVAL_MS = 60_000;
const STARTUP_CHECK_DELAY_MS = 3_000;
const DISMISSED_UPDATE_KEY = "yich-dismissed-update-version";
export const APP_UPDATE_AVAILABLE_EVENT = "yich-app-update-available";

let promptedVersion = "";

export function installAppUpdateChecker() {
  if (typeof window === "undefined") return () => undefined;

  const runStartupCheck = () => {
    void checkForAppUpdate({ allowAutoPrompt: true });
  };
  const runBackgroundCheck = () => {
    void checkForAppUpdate({ allowAutoPrompt: false });
  };

  const startupTimer = window.setTimeout(runStartupCheck, STARTUP_CHECK_DELAY_MS);
  const interval = window.setInterval(runBackgroundCheck, CHECK_INTERVAL_MS);

  window.addEventListener("focus", runBackgroundCheck);
  window.addEventListener("online", runBackgroundCheck);
  window.addEventListener("pageshow", runBackgroundCheck);
  document.addEventListener("visibilitychange", runBackgroundCheck);

  return () => {
    window.clearTimeout(startupTimer);
    window.clearInterval(interval);
    window.removeEventListener("focus", runBackgroundCheck);
    window.removeEventListener("online", runBackgroundCheck);
    window.removeEventListener("pageshow", runBackgroundCheck);
    document.removeEventListener("visibilitychange", runBackgroundCheck);
  };
}

async function checkForAppUpdate({ allowAutoPrompt }: { allowAutoPrompt: boolean }) {
  try {
    const status = await checkAppUpdateStatus();
    const serverVersion = status.serverVersion;
    if (!status.updateAvailable || !serverVersion) return;

    const autoPrompt = allowAutoPrompt
      && serverVersion !== promptedVersion
      && serverVersion !== readSessionValue(DISMISSED_UPDATE_KEY);
    if (autoPrompt) {
      promptedVersion = serverVersion;
    }

    window.dispatchEvent(new CustomEvent(APP_UPDATE_AVAILABLE_EVENT, {
      detail: { currentVersion: CURRENT_APP_VERSION, serverVersion, autoPrompt },
    }));
  } catch {
    // Network failures should not interrupt daily store operations.
  }
}

export async function checkAppUpdateStatus(): Promise<AppUpdateStatus> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health?clientVersion=${encodeURIComponent(CURRENT_APP_VERSION)}&t=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
    if (!response.ok) throw new Error("版本检测失败");

    const payload = (await response.json()) as HealthPayload;
    const serverVersion = payload.version?.trim();
    return {
      currentVersion: CURRENT_APP_VERSION,
      serverVersion,
      updateAvailable: Boolean(serverVersion && isVersionGreater(serverVersion, CURRENT_APP_VERSION)),
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      currentVersion: CURRENT_APP_VERSION,
      updateAvailable: false,
      checkedAt: new Date().toISOString(),
      error: "版本检测失败，请稍后重试",
    };
  }
}

export function dismissAppUpdatePrompt(serverVersion: string) {
  writeSessionValue(DISMISSED_UPDATE_KEY, serverVersion);
}

export async function reloadForAppUpdate(serverVersion: string) {
  await clearBrowserCaches();

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("__yich_update", serverVersion);
  nextUrl.searchParams.set("__yich_t", `${Date.now()}`);
  window.location.replace(nextUrl.toString());
}

export function isVersionGreater(nextVersion: string, currentVersion: string) {
  const nextParts = versionParts(nextVersion);
  const currentParts = versionParts(currentVersion);
  const length = Math.max(nextParts.length, currentParts.length);
  for (let index = 0; index < length; index += 1) {
    const nextPart = nextParts[index] ?? 0;
    const currentPart = currentParts[index] ?? 0;
    if (nextPart > currentPart) return true;
    if (nextPart < currentPart) return false;
  }
  return false;
}

function versionParts(version: string) {
  return version
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

async function clearBrowserCaches() {
  if (!("caches" in window)) return;
  const cacheNames = await window.caches.keys();
  await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
}

function readSessionValue(key: string) {
  try {
    return window.sessionStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeSessionValue(key: string, value: string) {
  try {
    window.sessionStorage?.setItem(key, value);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}
