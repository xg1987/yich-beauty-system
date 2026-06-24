import type { UserSession } from "../domain/auth";

const LEGACY_STORE_NAME_KEY = "yich-store-name";
const STORE_NAME_KEY_PREFIX = "yich-store-name:";

function storeNameCacheKey(session: UserSession | undefined) {
  if (!session || session.user.role === "superadmin") return undefined;
  return `${STORE_NAME_KEY_PREFIX}${session.user.id}`;
}

export function readCachedStoreName(session: UserSession | undefined) {
  const key = storeNameCacheKey(session);
  if (!key) return "";
  try {
    return localStorage.getItem(key)?.trim() || "";
  } catch {
    return "";
  }
}

export function writeCachedStoreName(session: UserSession | undefined, storeName: string) {
  try {
    localStorage.removeItem(LEGACY_STORE_NAME_KEY);
    const key = storeNameCacheKey(session);
    if (!key) return;
    const normalizedName = storeName.trim();
    if (normalizedName) {
      localStorage.setItem(key, normalizedName);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // Cache writes are optional and should not block the app on storage-limited devices.
  }
}

export function clearCachedStoreName(session?: UserSession) {
  try {
    localStorage.removeItem(LEGACY_STORE_NAME_KEY);
    const key = storeNameCacheKey(session);
    if (key) localStorage.removeItem(key);
  } catch {
    // Ignore cleanup failures on storage-limited devices.
  }
}
