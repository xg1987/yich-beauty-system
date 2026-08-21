import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  clearSessionPayload,
  isSessionExpired,
  newSessionExpiry,
  persistSessionPayload,
  readSessionPayload,
  SESSION_STORAGE_KEY,
  SESSION_TTL_MS,
  shouldUpgradeLegacyShortSession,
} from "../src/lib/session";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

class WriteBlockedStorage extends MemoryStorage {
  override setItem(_key: string, _value: string) {
    throw new Error("persistent storage blocked");
  }
}

class RemoveBlockedStorage extends MemoryStorage {
  override removeItem(_key: string) {
    throw new Error("storage cleanup blocked");
  }
}

const local = new MemoryStorage();
const session = new MemoryStorage();

const fixture = {
  token: "session-persistence-token",
  user: {
    id: "session-user",
    name: "会话验证用户",
    account: "session@test.local",
    role: "owner",
    roleName: "老板",
    storeId: "session-store",
    permissions: [],
  },
};
const payload = JSON.stringify(fixture);
const isValidFixturePayload = (value: string) => {
  const parsed = JSON.parse(value) as { token?: unknown };
  return typeof parsed.token === "string";
};

clearSessionPayload(local, session);
persistSessionPayload(local, session, payload);
assert.equal(JSON.parse(local.getItem(SESSION_STORAGE_KEY) ?? "{}").token, fixture.token, "save should persist the session in localStorage");
assert.equal(session.getItem(SESSION_STORAGE_KEY), null, "save should remove the obsolete sessionStorage copy");

const reopened = readSessionPayload(local, session, isValidFixturePayload);
assert.equal(JSON.parse(reopened ?? "{}").token, fixture.token, "read should restore a session from localStorage after an app restart");

clearSessionPayload(local, session);
session.setItem(SESSION_STORAGE_KEY, payload);
const migrated = readSessionPayload(local, session, isValidFixturePayload);
assert.equal(JSON.parse(migrated ?? "{}").token, fixture.token, "read should keep a v0.1.336 sessionStorage user signed in");
assert.equal(JSON.parse(local.getItem(SESSION_STORAGE_KEY) ?? "{}").token, fixture.token, "legacy session should migrate into localStorage");
assert.equal(session.getItem(SESSION_STORAGE_KEY), null, "successful migration should remove the legacy sessionStorage copy");

const blockedLocal = new WriteBlockedStorage();
const retainedLegacySession = new MemoryStorage();
retainedLegacySession.setItem(SESSION_STORAGE_KEY, payload);
const retained = readSessionPayload(blockedLocal, retainedLegacySession, isValidFixturePayload);
assert.equal(JSON.parse(retained ?? "{}").token, fixture.token, "failed migration should still return the active legacy session");
assert.equal(retainedLegacySession.getItem(SESSION_STORAGE_KEY), payload, "failed migration should not log out an existing v0.1.336 user");

const stalePersistentPayload = JSON.stringify({ ...fixture, token: "stale-v0.1.335-token" });
const currentSessionPayload = JSON.stringify({ ...fixture, token: "current-v0.1.336-token" });
clearSessionPayload(local, session);
local.setItem(SESSION_STORAGE_KEY, stalePersistentPayload);
session.setItem(SESSION_STORAGE_KEY, currentSessionPayload);
const preferredCurrent = readSessionPayload(local, session, isValidFixturePayload);
assert.equal(JSON.parse(preferredCurrent ?? "{}").token, "current-v0.1.336-token", "upgrade should prefer the currently signed-in sessionStorage account");
assert.equal(JSON.parse(local.getItem(SESSION_STORAGE_KEY) ?? "{}").token, "current-v0.1.336-token", "migration should replace a stale persistent account");
assert.equal(session.getItem(SESSION_STORAGE_KEY), null, "successful conflict migration should remove the legacy copy");

clearSessionPayload(local, session);
local.setItem(SESSION_STORAGE_KEY, payload);
session.setItem(SESSION_STORAGE_KEY, "{broken-json");
const validPersistentFallback = readSessionPayload(local, session, isValidFixturePayload);
assert.equal(JSON.parse(validPersistentFallback ?? "{}").token, fixture.token, "bad sessionStorage JSON should not hide a valid persistent login");
assert.equal(session.getItem(SESSION_STORAGE_KEY), null, "bad sessionStorage JSON should be discarded independently");

const blockedSaveLocal = new WriteBlockedStorage();
const fallbackSaveSession = new MemoryStorage();
persistSessionPayload(blockedSaveLocal, fallbackSaveSession, payload);
assert.equal(fallbackSaveSession.getItem(SESSION_STORAGE_KEY), payload, "blocked localStorage should fall back to a page session instead of failing login");

const blockedCleanupSession = new RemoveBlockedStorage();
local.setItem(SESSION_STORAGE_KEY, payload);
blockedCleanupSession.setItem(SESSION_STORAGE_KEY, payload);
clearSessionPayload(local, blockedCleanupSession);
assert.equal(local.getItem(SESSION_STORAGE_KEY), null, "a blocked sessionStorage cleanup must not prevent localStorage logout cleanup");

local.setItem(SESSION_STORAGE_KEY, payload);
session.setItem(SESSION_STORAGE_KEY, payload);
clearSessionPayload(local, session);
assert.equal(local.getItem(SESSION_STORAGE_KEY), null, "logout should clear localStorage");
assert.equal(session.getItem(SESSION_STORAGE_KEY), null, "logout should clear sessionStorage");
assert.equal(readSessionPayload(local, session, isValidFixturePayload), null, "cleared storage should not restore a session");

const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
const issuedAt = Date.parse("2026-08-21T00:00:00.000Z");
const expiresAt = newSessionExpiry(issuedAt);
assert.equal(SESSION_TTL_MS, thirtyDaysMs, "session lifetime should be 30 days");
assert.equal(Date.parse(expiresAt) - issuedAt, thirtyDaysMs, "new session expiry should be 30 days after login");
assert.equal(isSessionExpired(expiresAt, issuedAt + thirtyDaysMs - 1), false, "session should remain valid immediately before expiry");
assert.equal(isSessionExpired(expiresAt, issuedAt + thirtyDaysMs), true, "session should expire at the 30-day boundary");
assert.equal(
  shouldUpgradeLegacyShortSession(
    new Date(issuedAt).toISOString(),
    new Date(issuedAt + 8 * 60 * 60 * 1000).toISOString(),
    issuedAt + 60 * 60 * 1000,
  ),
  true,
  "an active eight-hour v0.1.336 session should be upgraded on first use",
);
assert.equal(
  shouldUpgradeLegacyShortSession(
    new Date(issuedAt).toISOString(),
    new Date(issuedAt + 8 * 60 * 60 * 1000).toISOString(),
    issuedAt + 9 * 60 * 60 * 1000,
  ),
  false,
  "an expired short session must never be revived",
);
assert.equal(
  shouldUpgradeLegacyShortSession(
    new Date(issuedAt).toISOString(),
    new Date(issuedAt + thirtyDaysMs).toISOString(),
    issuedAt + 60 * 60 * 1000,
  ),
  false,
  "a normal thirty-day session should not be repeatedly extended",
);

const migrationDb = new DatabaseSync(":memory:");
migrationDb.exec("CREATE TABLE sessions (token TEXT PRIMARY KEY, userId TEXT NOT NULL, createdAt TEXT NOT NULL, expiresAt TEXT)");
const migrationNow = Date.now();
const activeShortCreatedAt = new Date(migrationNow - 60 * 60 * 1000).toISOString();
const activeShortExpiresAt = new Date(migrationNow + 7 * 60 * 60 * 1000).toISOString();
const expiredShortCreatedAt = new Date(migrationNow - 10 * 60 * 60 * 1000).toISOString();
const expiredShortExpiresAt = new Date(migrationNow - 2 * 60 * 60 * 1000).toISOString();
const longCreatedAt = new Date(migrationNow - 24 * 60 * 60 * 1000).toISOString();
const longExpiresAt = new Date(migrationNow + 29 * 24 * 60 * 60 * 1000).toISOString();
const insertSession = migrationDb.prepare("INSERT INTO sessions (token, userId, createdAt, expiresAt) VALUES (?, 'u1', ?, ?)");
insertSession.run("active-short", activeShortCreatedAt, activeShortExpiresAt);
insertSession.run("expired-short", expiredShortCreatedAt, expiredShortExpiresAt);
insertSession.run("long-session", longCreatedAt, longExpiresAt);
migrationDb.exec(readFileSync(new URL("../migrations/0050_restore_session_persistence.sql", import.meta.url), "utf8"));
const migratedRows = migrationDb.prepare("SELECT token, expiresAt FROM sessions ORDER BY token").all() as Array<{ token: string; expiresAt: string }>;
const migratedExpiry = (token: string) => migratedRows.find((row) => row.token === token)?.expiresAt;
const activeMigratedMs = Date.parse(migratedExpiry("active-short") ?? "");
assert.ok(
  activeMigratedMs >= migrationNow + thirtyDaysMs - 60_000 && activeMigratedMs <= migrationNow + thirtyDaysMs + 60_000,
  "migration should extend only an active eight-hour session to about thirty days from rollout",
);
assert.equal(migratedExpiry("expired-short"), expiredShortExpiresAt, "migration must not revive an expired eight-hour session");
assert.equal(migratedExpiry("long-session"), longExpiresAt, "migration must not change an existing long session");
migrationDb.close();

console.log("Session persistence verification passed.");
