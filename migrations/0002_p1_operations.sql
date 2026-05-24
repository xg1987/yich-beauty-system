ALTER TABLE memberCards ADD COLUMN serviceIds_json TEXT;
ALTER TABLE orders ADD COLUMN discountAmount REAL NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN adjustmentReason TEXT;
ALTER TABLE orders ADD COLUMN approvalId TEXT;
ALTER TABLE dailyCloses ADD COLUMN status TEXT NOT NULL DEFAULT '已锁定';
ALTER TABLE dailyCloses ADD COLUMN reversedBy TEXT;
ALTER TABLE dailyCloses ADD COLUMN reversedAt TEXT;

CREATE TABLE IF NOT EXISTS staffShifts (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvalRequests (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customerServiceRecords (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customerFollowUps (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS purchaseOrders (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stocktakes (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);
