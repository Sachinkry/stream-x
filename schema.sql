CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'telegram',
  chat_id TEXT,
  telegram_update_id INTEGER UNIQUE,
  telegram_message_id INTEGER,
  body TEXT NOT NULL,
  created_at_iso TEXT NOT NULL,
  created_at_epoch_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS posts_created_at_idx
ON posts(created_at_epoch_ms DESC);
