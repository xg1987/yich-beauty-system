CREATE INDEX IF NOT EXISTS idx_orders_store_created_id
  ON orders(storeId, createdAt DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_orders_store_appointment_status
  ON orders(storeId, appointmentId, status);

CREATE INDEX IF NOT EXISTS idx_member_card_tx_store_cash_created
  ON memberCardTransactions(storeId, createdAt DESC, id DESC)
  WHERE type IN ('开卡', '充值')
    AND CASE WHEN paidAmount IS NOT NULL THEN paidAmount ELSE amountDelta END > 0;

CREATE INDEX IF NOT EXISTS idx_member_card_tx_order_store
  ON memberCardTransactions(orderId, storeId);

CREATE INDEX IF NOT EXISTS idx_customer_service_records_order
  ON customerServiceRecords(json_extract(payload_json, '$.orderId'));

CREATE INDEX IF NOT EXISTS idx_customer_signatures_order
  ON customerSignatures(json_extract(payload_json, '$.orderId'));

CREATE INDEX IF NOT EXISTS idx_customer_signatures_service_record
  ON customerSignatures(json_extract(payload_json, '$.serviceRecordId'));

CREATE INDEX IF NOT EXISTS idx_operation_logs_member_card_target
  ON operationLogs(targetType, targetId, action, storeId, createdAt DESC);

CREATE INDEX IF NOT EXISTS idx_customer_signatures_store_order
  ON customerSignatures(
    json_extract(payload_json, '$.storeId'),
    json_extract(payload_json, '$.orderId')
  );

CREATE INDEX IF NOT EXISTS idx_customer_signatures_token
  ON customerSignatures(json_extract(payload_json, '$.token'));

CREATE INDEX IF NOT EXISTS idx_customer_service_records_store_order
  ON customerServiceRecords(
    json_extract(payload_json, '$.storeId'),
    json_extract(payload_json, '$.orderId')
  );
