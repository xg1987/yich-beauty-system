CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  level TEXT NOT NULL,
  source TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  lastVisit TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  duration INTEGER NOT NULL,
  consumableProductId TEXT,
  consumableQty REAL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  unit TEXT NOT NULL,
  price REAL NOT NULL,
  cost REAL NOT NULL,
  stock REAL NOT NULL,
  warningStock REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL,
  staffId TEXT NOT NULL,
  serviceId TEXT NOT NULL,
  startAt TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staffUnavailableSlots (
  id TEXT PRIMARY KEY,
  staffId TEXT NOT NULL,
  startAt TEXT NOT NULL,
  endAt TEXT NOT NULL,
  reason TEXT NOT NULL,
  createdBy TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberCards (
  id TEXT PRIMARY KEY,
  customerId TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  balance REAL NOT NULL,
  remainingTimes INTEGER NOT NULL,
  expiresAt TEXT NOT NULL,
  status TEXT NOT NULL,
  serviceId TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  orderNo TEXT NOT NULL,
  customerId TEXT NOT NULL,
  staffId TEXT NOT NULL,
  serviceId TEXT NOT NULL,
  productId TEXT,
  cardId TEXT,
  totalAmount REAL NOT NULL,
  paidAmount REAL NOT NULL,
  payMethod TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  orderId TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT NOT NULL,
  createdBy TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commissions (
  id TEXT PRIMARY KEY,
  staffId TEXT NOT NULL,
  orderId TEXT NOT NULL,
  type TEXT NOT NULL,
  baseAmount REAL NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventoryLogs (
  id TEXT PRIMARY KEY,
  productId TEXT NOT NULL,
  type TEXT NOT NULL,
  delta REAL NOT NULL,
  stockAfter REAL NOT NULL,
  note TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberCardTransactions (
  id TEXT PRIMARY KEY,
  memberCardId TEXT NOT NULL,
  orderId TEXT,
  type TEXT NOT NULL,
  amountDelta REAL NOT NULL,
  timesDelta INTEGER NOT NULL,
  balanceAfter REAL NOT NULL,
  remainingTimesAfter INTEGER NOT NULL,
  note TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operationLogs (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  action TEXT NOT NULL,
  targetType TEXT NOT NULL,
  targetId TEXT NOT NULL,
  summary TEXT NOT NULL,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dailyCloses (
  id TEXT PRIMARY KEY,
  businessDate TEXT NOT NULL UNIQUE,
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
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
