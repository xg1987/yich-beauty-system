/**
 * Session lifetime configuration shared by the Cloudflare (D1) and local
 * Node backends. Sessions used to never expire and could not be revoked; both
 * backends now stamp an expiry and reject/clear sessions past it.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_STORAGE_KEY = "yich-system-session";

type SessionStorageArea = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SessionPayloadValidator = (payload: string) => boolean;

export function readSessionPayload(
  persistentStorage: SessionStorageArea,
  legacySessionStorage: SessionStorageArea,
  isValidPayload: SessionPayloadValidator = () => true,
) {
  // v0.1.336 wrote the currently signed-in account to sessionStorage while an
  // older localStorage token could still exist. Prefer and migrate the current
  // session so an upgrade cannot unexpectedly switch the user or store.
  const legacySession = readValidStorageValue(legacySessionStorage, isValidPayload);
  if (legacySession) {
    try {
      persistentStorage.setItem(SESSION_STORAGE_KEY, legacySession);
      removeStorageValue(legacySessionStorage);
    } catch {
      // Keep the valid legacy session in sessionStorage when migration cannot
      // be persisted, so an already signed-in v0.1.336 user is not logged out.
    }
    return legacySession;
  }

  return readValidStorageValue(persistentStorage, isValidPayload);
}

export function persistSessionPayload(persistentStorage: SessionStorageArea, fallbackSessionStorage: SessionStorageArea, payload: string) {
  try {
    persistentStorage.setItem(SESSION_STORAGE_KEY, payload);
    if (!removeStorageValue(fallbackSessionStorage)) {
      // If cleanup is blocked but writing is still allowed, keep both copies in
      // sync so sessionStorage precedence cannot revive an older account.
      writeStorageValue(fallbackSessionStorage, payload);
    }
  } catch {
    // Some tablets can exhaust or disable persistent storage. Retain the
    // current browser session instead of blocking an otherwise valid login.
    writeStorageValue(fallbackSessionStorage, payload);
  }
}

export function clearSessionPayload(persistentStorage: SessionStorageArea, legacySessionStorage: SessionStorageArea) {
  removeStorageValue(persistentStorage);
  removeStorageValue(legacySessionStorage);
}

function readStorageValue(storage: SessionStorageArea) {
  try {
    return storage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readValidStorageValue(storage: SessionStorageArea, isValidPayload: SessionPayloadValidator) {
  const payload = readStorageValue(storage);
  if (!payload) return null;
  try {
    if (isValidPayload(payload)) return payload;
  } catch {
    // Invalid or partial JSON must not hide a valid session in the other store.
  }
  removeStorageValue(storage);
  return null;
}

function writeStorageValue(storage: SessionStorageArea, payload: string) {
  try {
    storage.setItem(SESSION_STORAGE_KEY, payload);
  } catch {
    // Callers retain their in-memory session when both stores are unavailable.
  }
}

function removeStorageValue(storage: SessionStorageArea) {
  try {
    storage.removeItem(SESSION_STORAGE_KEY);
    return true;
  } catch {
    // Each storage is cleared independently so one blocked store cannot prevent
    // the other location from being cleaned up during logout or invalidation.
    return false;
  }
}

/** ISO timestamp for a freshly issued session's expiry. */
export function newSessionExpiry(fromMs: number = Date.now()): string {
  return new Date(fromMs + SESSION_TTL_MS).toISOString();
}

/** True when an ISO expiry timestamp is in the past (empty/NULL treated as valid). */
export function isSessionExpired(expiresAt: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!expiresAt) return false;
  const parsed = Date.parse(expiresAt);
  if (Number.isNaN(parsed)) return false;
  return parsed <= nowMs;
}

/** True only for still-active sessions issued by v0.1.336's eight-hour policy. */
export function shouldUpgradeLegacyShortSession(
  createdAt: string | null | undefined,
  expiresAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!createdAt || !expiresAt || isSessionExpired(expiresAt, nowMs)) return false;
  const createdMs = Date.parse(createdAt);
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(createdMs) || !Number.isFinite(expiresMs)) return false;
  const lifetimeMs = expiresMs - createdMs;
  return lifetimeMs >= 7 * 60 * 60 * 1000 && lifetimeMs <= 9 * 60 * 60 * 1000;
}
