DROP INDEX IF EXISTS models_enabled_idx;

ALTER TABLE models
    DROP COLUMN IF EXISTS display_name;

CREATE INDEX IF NOT EXISTS models_external_id_idx
    ON models (external_id);
