import type { UserSession } from "../domain/auth";

const LEGACY_STORE_NAME_KEY = "yich-store-name";
const STORE_NAME_KEY_PREFIX = "yich-store-name:";

function storeNameCacheKey(session: UserSession | undefined) {
  if (!session || session.user.role === "superadmin") return undefined;
  return `${STORE_NAME_KEY_PREFIX}${session.user.id}`;
}

export function readCachedStoreName(session: UserSession | undefined) {
  const key = storeNameCacheKey(session);
  return key ? localStorage.getItem(key)?.trim() || "" : "";
}

export function writeCachedStoreName(session: UserSession | undefined, storeName: string) {
  localStorage.removeItem(LEGACY_STORE_NAME_KEY);
  const key = storeNameCacheKey(session);
  if (!key) return;
  const normalizedName = storeName.trim();
  if (normalizedName) {
    localStorage.setItem(key, normalizedName);
  } else {
    localStorage.removeItem(key);
  }
}

export function clearCachedStoreName(session?: UserSession) {
  localStorage.removeItem(LEGACY_STORE_NAME_KEY);
  const key = storeNameCacheKey(session);
  if (key) localStorage.removeItem(key);
}
