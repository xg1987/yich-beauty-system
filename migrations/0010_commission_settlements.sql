ALTER TABLE commissions ADD COLUMN settledAt TEXT;
ALTER TABLE commissions ADD COLUMN settlementId TEXT;

CREATE TABLE IF NOT EXISTS commissionSettlements (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);
