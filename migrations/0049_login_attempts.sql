CREATE TABLE IF NOT EXISTS loginAttempts (
  id TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  windowStartedAt TEXT NOT NULL,
  lockedUntil TEXT
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_locked_until
  ON loginAttempts(lockedUntil);
