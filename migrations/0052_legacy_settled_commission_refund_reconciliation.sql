-- Reconcile refunds created by releases that rewrote the positive commission
-- row instead of recording an auditable negative adjustment. Only commissions
-- with reliable settlement evidence are eligible; pending commissions are
-- intentionally excluded.

CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON refunds(orderId);
CREATE INDEX IF NOT EXISTS idx_commissions_order_id ON commissions(orderId);

DROP TABLE IF EXISTS migration0052RefundTotals;
DROP TABLE IF EXISTS migration0052SettledOriginals;
DROP TABLE IF EXISTS migration0052ExistingReversals;

CREATE TABLE migration0052RefundTotals (
  orderId TEXT PRIMARY KEY,
  totalRefund REAL NOT NULL
);

INSERT INTO migration0052RefundTotals (orderId, totalRefund)
SELECT
  orderId,
  ROUND(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 2)
FROM refunds
GROUP BY orderId
HAVING SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) > 0;

CREATE TABLE migration0052SettledOriginals (
  commissionId TEXT PRIMARY KEY,
  storeId TEXT,
  staffId TEXT NOT NULL,
  orderId TEXT NOT NULL,
  type TEXT NOT NULL,
  baseAmount REAL NOT NULL,
  rate REAL NOT NULL,
  originalCommissionAmount REAL NOT NULL,
  originalPaidAmount REAL NOT NULL,
  totalRefund REAL NOT NULL,
  settledAt TEXT NOT NULL
);

INSERT INTO migration0052SettledOriginals (
  commissionId,
  storeId,
  staffId,
  orderId,
  type,
  baseAmount,
  rate,
  originalCommissionAmount,
  originalPaidAmount,
  totalRefund,
  settledAt
)
WITH commissionSettlementTimes AS (
  SELECT
    commission.*,
    COALESCE(
      NULLIF(TRIM(commission.settledAt), ''),
      (
        SELECT CASE
          WHEN json_valid(settlement.payload_json)
            THEN NULLIF(json_extract(settlement.payload_json, '$.createdAt'), '')
        END
        FROM commissionSettlements AS settlement
        WHERE settlement.id = commission.settlementId
        LIMIT 1
      )
    ) AS reliableSettledAt
  FROM commissions AS commission
)
SELECT
  commission.id,
  COALESCE(
    NULLIF(TRIM(commission.storeId), ''),
    NULLIF(TRIM(orders.storeId), ''),
    (SELECT NULLIF(TRIM(staff.storeId), '') FROM staff WHERE staff.id = commission.staffId LIMIT 1),
    commission.storeId
  ),
  commission.staffId,
  commission.orderId,
  commission.type,
  MAX(0, commission.baseAmount),
  commission.rate,
  CASE
    WHEN commission.rate > 0 AND commission.baseAmount > 0
      THEN CAST(ROUND(commission.baseAmount * commission.rate, 0) AS REAL)
    ELSE MAX(0, commission.amount)
  END,
  ROUND(MAX(0, orders.paidAmount) + refundTotals.totalRefund, 2),
  refundTotals.totalRefund,
  commission.reliableSettledAt
FROM commissionSettlementTimes AS commission
JOIN orders
  ON orders.id = commission.orderId
JOIN migration0052RefundTotals AS refundTotals
  ON refundTotals.orderId = commission.orderId
WHERE commission.amount >= 0
  AND commission.baseAmount >= 0
  AND instr(commission.id, 'cmr_') <> 1
  AND commission.status IN ('已结算', '已冲销')
  AND commission.rate > 0
  AND commission.baseAmount > 0
  AND commission.reliableSettledAt IS NOT NULL
  AND julianday(commission.reliableSettledAt) IS NOT NULL
  AND NULLIF(TRIM(commission.settlementId), '') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM commissionSettlements AS settlement,
      json_each(
        CASE WHEN json_valid(settlement.payload_json) THEN settlement.payload_json ELSE '{}' END,
        '$.commissionIds'
      ) AS settledCommissionId
    WHERE settlement.id = commission.settlementId
      AND json_valid(settlement.payload_json)
      AND json_extract(settlement.payload_json, '$.type') = '员工提成'
      AND settledCommissionId.value = commission.id
  )
  -- A refund at or before settlement may already have reduced the amount that
  -- was actually paid by a legacy release. Skip those ambiguous rows rather
  -- than risk reversing the same commission twice.
  AND NOT EXISTS (
    SELECT 1
    FROM refunds AS earlierRefund
    WHERE earlierRefund.orderId = commission.orderId
      AND earlierRefund.amount > 0
      AND (
        julianday(earlierRefund.createdAt) IS NULL
        OR julianday(earlierRefund.createdAt) <= julianday(commission.reliableSettledAt)
      )
  )
  AND orders.paidAmount >= 0
  AND NOT EXISTS (
    SELECT 1
    FROM refunds AS invalidRefund
    WHERE invalidRefund.orderId = commission.orderId
      AND (
        invalidRefund.amount <= 0
        OR julianday(invalidRefund.createdAt) IS NULL
      )
  )
  AND ROUND(MAX(0, orders.paidAmount) + refundTotals.totalRefund, 2) > 0;

CREATE TABLE migration0052ExistingReversals (
  commissionId TEXT PRIMARY KEY,
  reversedAmount REAL NOT NULL,
  reversedBaseAmount REAL NOT NULL
);

INSERT INTO migration0052ExistingReversals (commissionId, reversedAmount, reversedBaseAmount)
SELECT
  original.commissionId,
  ROUND(SUM(MAX(0, -adjustment.amount)), 2),
  ROUND(SUM(MAX(0, -adjustment.baseAmount)), 2)
FROM migration0052SettledOriginals AS original
JOIN commissions AS adjustment
  ON adjustment.orderId = original.orderId
WHERE adjustment.amount < 0
  AND instr(adjustment.id, 'cmr_') = 1
  AND substr(adjustment.id, -(length(original.commissionId) + 1)) = '_' || original.commissionId
GROUP BY original.commissionId;

INSERT INTO commissions (
  id,
  storeId,
  staffId,
  orderId,
  type,
  baseAmount,
  rate,
  amount,
  status,
  createdAt,
  settledAt,
  settlementId
)
WITH commissionStates AS (
  SELECT
    original.*,
    MIN(original.originalPaidAmount, MAX(0, original.totalRefund)) AS cumulativeRefund,
    COALESCE(existing.reversedAmount, 0) AS existingReversedAmount,
    COALESCE(existing.reversedBaseAmount, 0) AS existingReversedBaseAmount
  FROM migration0052SettledOriginals AS original
  LEFT JOIN migration0052ExistingReversals AS existing
    ON existing.commissionId = original.commissionId
), cumulativeTargets AS (
  SELECT
    state.*,
    MAX(
      0,
      state.originalCommissionAmount
      - CAST(ROUND(
        state.originalCommissionAmount
          * (state.originalPaidAmount - state.cumulativeRefund)
          / state.originalPaidAmount,
        0
      ) AS REAL)
    ) AS targetReversedAmount,
    ROUND(MAX(
      0,
      state.baseAmount
      - ROUND(
        state.baseAmount
          * (state.originalPaidAmount - state.cumulativeRefund)
          / state.originalPaidAmount,
        2
      )
    ), 2) AS targetReversedBaseAmount
  FROM commissionStates AS state
), missingAdjustments AS (
  SELECT
    target.*,
    MAX(0, target.targetReversedAmount - target.existingReversedAmount) AS missingAmount,
    ROUND(MAX(0, target.targetReversedBaseAmount - target.existingReversedBaseAmount), 2) AS missingBaseAmount
  FROM cumulativeTargets AS target
)
SELECT
  'cmr_m0052_' || missing.commissionId,
  missing.storeId,
  missing.staffId,
  missing.orderId,
  missing.type,
  -missing.missingBaseAmount,
  missing.rate,
  -missing.missingAmount,
  '待结算',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL,
  NULL
FROM missingAdjustments AS missing
WHERE missing.missingAmount > 0;

DROP TABLE migration0052ExistingReversals;
DROP TABLE migration0052SettledOriginals;
DROP TABLE migration0052RefundTotals;
