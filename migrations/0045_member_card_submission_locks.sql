CREATE TABLE IF NOT EXISTS memberCardSubmissionLocks (
  id TEXT PRIMARY KEY,
  storeId TEXT NOT NULL,
  memberCardId TEXT,
  signatureId TEXT,
  createdAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_member_card_submission_created
  ON memberCardSubmissionLocks(createdAt);
