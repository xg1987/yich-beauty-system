ALTER TABLE products ADD COLUMN category TEXT;
ALTER TABLE products ADD COLUMN subcategory TEXT;
ALTER TABLE products ADD COLUMN shelfLifeMonths REAL;
ALTER TABLE products ADD COLUMN expiryAt TEXT;
ALTER TABLE inventoryLogs ADD COLUMN expiryAt TEXT;
