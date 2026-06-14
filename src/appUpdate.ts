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

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";
export const CURRENT_APP_VERSION = packageJson.version;
const CHECK_INTERVAL_MS = 60_000;
const STARTUP_CHECK_DELAY_MS = 3_000;
const DISMISSED_UPDATE_KEY = "yich-dismissed-update-version";
const AUTO_PROMPT_DATE_KEY = "yich-update-auto-prompt-date";
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
    const status = await checkAppUpdateStatus();
    const serverVersion = status.serverVersion;
    if (!status.updateAvailable || !serverVersion) return;

    const autoPrompt = !hasAutoPromptedToday()
      && serverVersion !== promptedVersion
      && serverVersion !== readSessionValue(DISMISSED_UPDATE_KEY);
    if (autoPrompt) {
      promptedVersion = serverVersion;
      markAutoPromptedToday();
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
      updateAvailable: Boolean(serverVersion && serverVersion !== CURRENT_APP_VERSION),
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

async function clearBrowserCaches() {
  if (!("caches" in window)) return;
  const cacheNames = await window.caches.keys();
  await Promise.all(cacheNames.map((cacheName) => window.caches.delete(cacheName)));
}

function todayKey() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function hasAutoPromptedToday() {
  return readLocalValue(AUTO_PROMPT_DATE_KEY) === todayKey();
}

function markAutoPromptedToday() {
  writeLocalValue(AUTO_PROMPT_DATE_KEY, todayKey());
}

function readLocalValue(key: string) {
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLocalValue(key: string, value: string) {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
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
