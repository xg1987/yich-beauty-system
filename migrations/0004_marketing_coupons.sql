CREATE TABLE IF NOT EXISTS couponTemplates (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customerCoupons (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

ALTER TABLE orders ADD COLUMN couponId TEXT;
