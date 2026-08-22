CREATE TABLE IF NOT EXISTS orderAppointmentConflictAudit (
  detachedOrderId TEXT PRIMARY KEY,
  storeId TEXT,
  appointmentId TEXT NOT NULL,
  retainedOrderId TEXT NOT NULL,
  reason TEXT NOT NULL,
  detectedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Older databases may contain more than one non-refunded order linked to the
-- same appointment. Keep the earliest link, preserve every order, and record
-- each detached link before the unique index is created.
WITH ranked_active_orders AS (
  SELECT
    id,
    storeId,
    appointmentId,
    FIRST_VALUE(id) OVER (
      PARTITION BY COALESCE(NULLIF(TRIM(storeId), ''), ''), appointmentId
      ORDER BY createdAt ASC, rowid ASC, id ASC
    ) AS retainedOrderId,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(NULLIF(TRIM(storeId), ''), ''), appointmentId
      ORDER BY createdAt ASC, rowid ASC, id ASC
    ) AS appointmentOrderRank
  FROM orders
  WHERE appointmentId IS NOT NULL
    AND TRIM(appointmentId) <> ''
    AND status <> '已退款'
)
INSERT OR IGNORE INTO orderAppointmentConflictAudit (
  detachedOrderId,
  storeId,
  appointmentId,
  retainedOrderId,
  reason
)
SELECT
  id,
  storeId,
  appointmentId,
  retainedOrderId,
  'migration-0051-active-appointment-duplicate'
FROM ranked_active_orders
WHERE appointmentOrderRank > 1;

WITH ranked_active_orders AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(NULLIF(TRIM(storeId), ''), ''), appointmentId
      ORDER BY createdAt ASC, rowid ASC, id ASC
    ) AS appointmentOrderRank
  FROM orders
  WHERE appointmentId IS NOT NULL
    AND TRIM(appointmentId) <> ''
    AND status <> '已退款'
)
UPDATE orders
SET appointmentId = NULL
WHERE id IN (
  SELECT id
  FROM ranked_active_orders
  WHERE appointmentOrderRank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_active_appointment
  ON orders(COALESCE(NULLIF(TRIM(storeId), ''), ''), appointmentId)
  WHERE appointmentId IS NOT NULL
    AND TRIM(appointmentId) <> ''
    AND status <> '已退款';

-- A paid order means the appointment has left the cashier queue even when its
-- service-completion signature is still pending. Materialize each source once
-- so a large history does not repeatedly scan signatures and orders for every
-- appointment. These staging tables are migration-only and are dropped below.
DROP TABLE IF EXISTS migration0051SignedOrderTimes;
DROP TABLE IF EXISTS migration0051ActiveOrderLinks;
DROP TABLE IF EXISTS migration0051AppointmentCompletion;

CREATE TABLE migration0051SignedOrderTimes (
  orderId TEXT PRIMARY KEY,
  signedAt TEXT NOT NULL
);

INSERT INTO migration0051SignedOrderTimes (orderId, signedAt)
WITH extractedSignatures AS (
  SELECT
    CASE
      WHEN json_valid(signature.payload_json)
      THEN json_extract(signature.payload_json, '$.orderId')
    END AS orderId,
    CASE
      WHEN json_valid(signature.payload_json) THEN
        CASE
          WHEN json_extract(signature.payload_json, '$.title') = '服务完成确认签名'
            AND json_extract(signature.payload_json, '$.status') = '已签名'
          THEN NULLIF(json_extract(signature.payload_json, '$.signedAt'), '')
        END
    END AS signedAt
  FROM customerSignatures AS signature
)
SELECT
  orderId,
  MIN(signedAt) AS signedAt
FROM extractedSignatures
WHERE NULLIF(TRIM(COALESCE(orderId, '')), '') IS NOT NULL
  AND NULLIF(TRIM(COALESCE(signedAt, '')), '') IS NOT NULL
GROUP BY orderId;

CREATE TABLE migration0051ActiveOrderLinks (
  orderId TEXT PRIMARY KEY,
  appointmentId TEXT NOT NULL,
  orderCreatedAt TEXT NOT NULL
);

INSERT INTO migration0051ActiveOrderLinks (orderId, appointmentId, orderCreatedAt)
SELECT
  linkedOrder.id,
  appointment.id,
  linkedOrder.createdAt
FROM orders AS linkedOrder
JOIN appointments AS appointment
  ON appointment.id = linkedOrder.appointmentId
WHERE linkedOrder.appointmentId IS NOT NULL
  AND TRIM(linkedOrder.appointmentId) <> ''
  AND linkedOrder.status <> '已退款'
  AND (
    linkedOrder.storeId = appointment.storeId
    OR COALESCE(TRIM(linkedOrder.storeId), '') = ''
    OR COALESCE(TRIM(appointment.storeId), '') = ''
  );

CREATE INDEX migration0051ActiveOrderLinksAppointment
  ON migration0051ActiveOrderLinks(appointmentId);

CREATE TABLE migration0051AppointmentCompletion (
  appointmentId TEXT PRIMARY KEY,
  signedAt TEXT,
  orderCreatedAt TEXT NOT NULL
);

INSERT INTO migration0051AppointmentCompletion (appointmentId, signedAt, orderCreatedAt)
SELECT
  activeLink.appointmentId,
  MIN(signedOrder.signedAt) AS signedAt,
  MIN(activeLink.orderCreatedAt) AS orderCreatedAt
FROM migration0051ActiveOrderLinks AS activeLink
LEFT JOIN migration0051SignedOrderTimes AS signedOrder
  ON signedOrder.orderId = activeLink.orderId
GROUP BY activeLink.appointmentId;

-- Prefer a signed service-completion timestamp; otherwise use the earliest
-- retained non-refunded order timestamp. Signature rows remain untouched.
UPDATE appointments
SET
  status = '已完成',
  completedAt = COALESCE(
    (
      SELECT COALESCE(completion.signedAt, completion.orderCreatedAt)
      FROM migration0051AppointmentCompletion AS completion
      WHERE completion.appointmentId = appointments.id
    ),
    completedAt,
    CURRENT_TIMESTAMP
  ),
  canceledAt = NULL,
  cancelReason = NULL,
  noShowAt = NULL,
  updatedAt = COALESCE(
    (
      SELECT COALESCE(completion.signedAt, completion.orderCreatedAt)
      FROM migration0051AppointmentCompletion AS completion
      WHERE completion.appointmentId = appointments.id
    ),
    updatedAt,
    CURRENT_TIMESTAMP
  )
WHERE status <> '已完成'
  AND id IN (SELECT appointmentId FROM migration0051AppointmentCompletion);

DROP TABLE migration0051AppointmentCompletion;
DROP TABLE migration0051ActiveOrderLinks;
DROP TABLE migration0051SignedOrderTimes;
