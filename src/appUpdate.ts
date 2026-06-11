import packageJson from "../package.json";

type HealthPayload = {
  ok?: boolean;
  version?: string;
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
const CURRENT_VERSION = packageJson.version;
const CHECK_INTERVAL_MS = 60_000;
const STARTUP_CHECK_DELAY_MS = 3_000;
const DEFER_RELOAD_MS = 15_000;
const LAST_RELOAD_KEY = "yich-last-version-reload";
const RELOAD_COOLDOWN_MS = 30_000;

let reloadScheduled = false;

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
  if (reloadScheduled) return;

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

    scheduleReload(serverVersion);
  } catch {
    // Network failures should not interrupt daily store operations.
  }
}

function scheduleReload(serverVersion: string) {
  if (reloadScheduled || recentlyReloadedForVersion(serverVersion)) return;
  reloadScheduled = true;

  const reload = async () => {
    markReloadForVersion(serverVersion);
    await clearBrowserCaches();

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("__yich_update", serverVersion);
    nextUrl.searchParams.set("__yich_t", `${Date.now()}`);
    window.location.replace(nextUrl.toString());
  };

  if (hasActiveEditingTarget()) {
    window.setTimeout(() => void reload(), DEFER_RELOAD_MS);
    return;
  }

  void reload();
}

function recentlyReloadedForVersion(serverVersion: string) {
  const raw = window.sessionStorage.getItem(LAST_RELOAD_KEY);
  if (!raw) return false;

  const [version, timestampText] = raw.split(":");
  const timestamp = Number(timestampText);
  return version === serverVersion && Number.isFinite(timestamp) && Date.now() - timestamp < RELOAD_COOLDOWN_MS;
}

function markReloadForVersion(serverVersion: string) {
  window.sessionStorage.setItem(LAST_RELOAD_KEY, `${serverVersion}:${Date.now()}`);
}

function hasActiveEditingTarget() {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;
  return Boolean(activeElement.closest("input, textarea, select, [contenteditable='true']"));
}

async function clearBrowserCaches() {
  if (!("caches" in window)) return;
  const cacheNames = await window.caches.keys();
  await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
}
