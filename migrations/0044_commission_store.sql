-- Give commissions an explicit storeId so store-level settlement and daily
-- close can no longer sum other stores' commissions. Previously commissions
-- carried no store and were only scoped at read time via a staff JOIN, which
-- left superadmin-triggered settle/daily-close summing across all stores.
ALTER TABLE commissions ADD COLUMN storeId TEXT;

-- Backfill existing commissions from their staff member's store.
UPDATE commissions
SET storeId = (SELECT staff.storeId FROM staff WHERE staff.id = commissions.staffId)
WHERE storeId IS NULL;

CREATE INDEX IF NOT EXISTS idx_commissions_store ON commissions(storeId);
