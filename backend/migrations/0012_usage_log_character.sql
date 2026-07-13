ALTER TABLE chat_runs
    ADD COLUMN IF NOT EXISTS character_name TEXT NOT NULL DEFAULT '';

ALTER TABLE usage_logs
    ADD COLUMN IF NOT EXISTS character_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS character_name TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS usage_logs_user_created_id_idx
    ON usage_logs (user_id, created_at DESC, id DESC);
