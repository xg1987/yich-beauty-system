-- v0.1.336 issued eight-hour sessions. Extend only sessions that are still
-- active at migration time, so signed-in users keep working after the fix
-- without reviving tokens that have already expired.
UPDATE sessions
SET expiresAt = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days')
WHERE expiresAt IS NOT NULL
  AND datetime(expiresAt) > datetime('now')
  AND datetime(expiresAt) >= datetime(createdAt, '+7 hours')
  AND datetime(expiresAt) <= datetime(createdAt, '+9 hours');
