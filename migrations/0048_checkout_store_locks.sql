CREATE TABLE IF NOT EXISTS checkoutStoreLocks (
  storeId TEXT PRIMARY KEY,
  ownerId TEXT NOT NULL,
  expiresAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkout_store_locks_expires_at
  ON checkoutStoreLocks(expiresAt);
