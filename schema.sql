CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT,
  telegram_update_id INTEGER UNIQUE,
  telegram_message_id INTEGER,
  body TEXT NOT NULL,
  created_at_iso TEXT NOT NULL,
  created_at_epoch_ms INTEGER NOT NULL,
  is_stream INTEGER NOT NULL DEFAULT 1,
  is_tweet INTEGER NOT NULL DEFAULT 0,
  x_tweet_id TEXT
);

CREATE INDEX IF NOT EXISTS posts_created_at_idx
ON posts(created_at_epoch_ms DESC);

-- Migration for databases that pre-date is_stream/is_tweet/x_tweet_id.
-- Run these once if you already have a posts table:
--   ALTER TABLE posts ADD COLUMN is_stream INTEGER NOT NULL DEFAULT 1;
--   ALTER TABLE posts ADD COLUMN is_tweet INTEGER NOT NULL DEFAULT 0;
--   ALTER TABLE posts ADD COLUMN x_tweet_id TEXT;
