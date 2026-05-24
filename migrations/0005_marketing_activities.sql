CREATE TABLE IF NOT EXISTS marketingActivities (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activityParticipants (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

ALTER TABLE orders ADD COLUMN activityId TEXT;
