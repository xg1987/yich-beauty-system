const RECOVERY_RELOAD_KEY = "yich-app-recovery-reload";
const RECOVERY_RELOAD_COOLDOWN_MS = 20_000;
const UPDATE_QUERY_KEYS = ["__yich_update", "__yich_t", "__yich_recover"];

export function isRecoverableLoadError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|Unable to preload|Loading chunk|ChunkLoadError|dynamically imported module/i.test(message);
}

export async function recoverFromStaleAssets() {
  if (typeof window === "undefined") return false;
  if (recentlyRecovered()) return false;
  window.sessionStorage.setItem(RECOVERY_RELOAD_KEY, `${Date.now()}`);
  await clearAppCaches();
  const nextUrl = new URL(window.location.href);
  UPDATE_QUERY_KEYS.forEach((key) => nextUrl.searchParams.delete(key));
  nextUrl.searchParams.set("__yich_recover", `${Date.now()}`);
  window.location.replace(nextUrl.toString());
  return true;
}

export function cleanUpdateRecoveryQuery() {
  const nextUrl = new URL(window.location.href);
  const hadUpdateQuery = UPDATE_QUERY_KEYS.some((key) => nextUrl.searchParams.has(key));
  if (!hadUpdateQuery) return;
  UPDATE_QUERY_KEYS.forEach((key) => nextUrl.searchParams.delete(key));
  window.history.replaceState(window.history.state, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
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
