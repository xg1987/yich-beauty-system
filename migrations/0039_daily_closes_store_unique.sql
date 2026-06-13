CREATE TABLE IF NOT EXISTS dailyCloses_store_unique (
  id TEXT PRIMARY KEY,
  storeId TEXT,
  businessDate TEXT NOT NULL,
  revenue REAL NOT NULL,
  refundAmount REAL NOT NULL,
  orderCount INTEGER NOT NULL,
  cashAmount REAL NOT NULL,
  wechatAmount REAL NOT NULL,
  alipayAmount REAL NOT NULL,
  cardAmount REAL NOT NULL,
  memberCardAmount REAL NOT NULL,
  commissionAmount REAL NOT NULL,
  createdBy TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '已锁定',
  reversedBy TEXT,
  reversedAt TEXT,
  UNIQUE(storeId, businessDate)
);

INSERT INTO dailyCloses_store_unique (
  id,
  storeId,
  businessDate,
  revenue,
  refundAmount,
  orderCount,
  cashAmount,
  wechatAmount,
  alipayAmount,
  cardAmount,
  memberCardAmount,
  commissionAmount,
  createdBy,
  createdAt,
  status,
  reversedBy,
  reversedAt
)
SELECT
  id,
  storeId,
  businessDate,
  revenue,
  refundAmount,
  orderCount,
  cashAmount,
  wechatAmount,
  alipayAmount,
  cardAmount,
  memberCardAmount,
  commissionAmount,
  createdBy,
  createdAt,
  status,
  reversedBy,
  reversedAt
FROM dailyCloses;

DROP TABLE dailyCloses;
ALTER TABLE dailyCloses_store_unique RENAME TO dailyCloses;

CREATE INDEX IF NOT EXISTS idx_daily_closes_store_date ON dailyCloses(storeId, businessDate);
