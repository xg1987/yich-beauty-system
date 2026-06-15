CREATE TABLE IF NOT EXISTS aiGenerationLocks (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  ownerId TEXT NOT NULL,
  kind TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_generation_locks_scope_expires ON aiGenerationLocks(scope, expiresAt);
CREATE INDEX IF NOT EXISTS idx_ai_generation_locks_owner_kind ON aiGenerationLocks(ownerId, kind);
