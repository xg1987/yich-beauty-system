/**
 * Session lifetime configuration shared by the Cloudflare (D1) and local
 * Node backends. Sessions used to never expire and could not be revoked; both
 * backends now stamp an expiry and reject/clear sessions past it.
 */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

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
