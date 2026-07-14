CREATE INDEX IF NOT EXISTS chat_runs_pending_user_character_idx
    ON chat_runs (user_id, character_id, created_at ASC, id ASC)
    WHERE acknowledged_at IS NULL;
