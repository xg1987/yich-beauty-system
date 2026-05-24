CREATE TABLE IF NOT EXISTS onlineStorefronts (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS onlineBookingRequests (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL
);
