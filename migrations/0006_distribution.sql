CREATE TABLE IF NOT EXISTS distributors (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referralRelations (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS distributionCommissions (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

ALTER TABLE orders ADD COLUMN distributorId TEXT;
