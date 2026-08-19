ALTER TABLE products ADD COLUMN serviceStockReviewStatus TEXT;
ALTER TABLE products ADD COLUMN serviceStockReviewedAt TEXT;
ALTER TABLE products ADD COLUMN serviceStockReviewedBy TEXT;

UPDATE products
SET
  serviceStockReviewStatus = 'pending',
  serviceStockReviewedAt = NULL,
  serviceStockReviewedBy = NULL;
