-- Give sessions an expiry so bearer tokens are no longer valid forever.
-- Previously the sessions table only stored (token, userId, createdAt) and a
-- token, once issued, could be used indefinitely and could not be revoked.
ALTER TABLE sessions ADD COLUMN expiresAt TEXT;

-- Backfill currently active sessions: grant them 30 more days from deploy time
-- (using datetime('now') avoids depending on parsing the existing createdAt
-- ISO string, which older SQLite builds may not accept). After this window the
-- normal per-login expiry takes over.
UPDATE sessions SET expiresAt = datetime('now', '+30 days') WHERE expiresAt IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expiresAt);
