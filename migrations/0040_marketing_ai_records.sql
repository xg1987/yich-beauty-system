CREATE TABLE IF NOT EXISTS marketingAiRecords (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_marketing_ai_records_store_json ON marketingAiRecords(json_extract(payload_json, '$.storeId'));
CREATE INDEX IF NOT EXISTS idx_marketing_ai_records_created_json ON marketingAiRecords(json_extract(payload_json, '$.createdAt'));
