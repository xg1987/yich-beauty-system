import packageJson from "../package.json";

type HealthPayload = {
  ok?: boolean;
  version?: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const CURRENT_VERSION = packageJson.version;
const CHECK_INTERVAL_MS = 60_000;
const STARTUP_CHECK_DELAY_MS = 3_000;
const DISMISSED_UPDATE_KEY = "yich-dismissed-update-version";
export const APP_UPDATE_AVAILABLE_EVENT = "yich-app-update-available";

let promptedVersion = "";

export function installAppUpdateChecker() {
  if (typeof window === "undefined") return () => undefined;

  const runCheck = () => {
    void checkForAppUpdate();
  };

  const startupTimer = window.setTimeout(runCheck, STARTUP_CHECK_DELAY_MS);
  const interval = window.setInterval(runCheck, CHECK_INTERVAL_MS);

  window.addEventListener("focus", runCheck);
  window.addEventListener("online", runCheck);
  window.addEventListener("pageshow", runCheck);
  document.addEventListener("visibilitychange", runCheck);

  return () => {
    window.clearTimeout(startupTimer);
    window.clearInterval(interval);
    window.removeEventListener("focus", runCheck);
    window.removeEventListener("online", runCheck);
    window.removeEventListener("pageshow", runCheck);
    document.removeEventListener("visibilitychange", runCheck);
  };
}

async function checkForAppUpdate() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/health?clientVersion=${encodeURIComponent(CURRENT_VERSION)}&t=${Date.now()}`, {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
    if (!response.ok) return;

    const payload = (await response.json()) as HealthPayload;
    const serverVersion = payload.version?.trim();
    if (!serverVersion || serverVersion === CURRENT_VERSION) return;
    if (serverVersion === promptedVersion || serverVersion === window.sessionStorage.getItem(DISMISSED_UPDATE_KEY)) return;

    promptedVersion = serverVersion;
    window.dispatchEvent(new CustomEvent(APP_UPDATE_AVAILABLE_EVENT, {
      detail: { currentVersion: CURRENT_VERSION, serverVersion },
    }));
  } catch {
    // Network failures should not interrupt daily store operations.
  }
}

export function dismissAppUpdatePrompt(serverVersion: string) {
  window.sessionStorage.setItem(DISMISSED_UPDATE_KEY, serverVersion);
}

export async function reloadForAppUpdate(serverVersion: string) {
  await clearBrowserCaches();

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("__yich_update", serverVersion);
  nextUrl.searchParams.set("__yich_t", `${Date.now()}`);
  window.location.replace(nextUrl.toString());
}

async function clearBrowserCaches() {
  if (!("caches" in window)) return;
  const cacheNames = await window.caches.keys();
  await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
}
