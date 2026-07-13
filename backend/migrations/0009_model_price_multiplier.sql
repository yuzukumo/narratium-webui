ALTER TABLE models
    ADD COLUMN IF NOT EXISTS price_multiplier TEXT NOT NULL DEFAULT '1';

ALTER TABLE models
    ADD CONSTRAINT models_price_multiplier_valid
    CHECK (
        price_multiplier ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
        AND price_multiplier::numeric >= 0
        AND price_multiplier::numeric <= 1000000
    );

ALTER TABLE balance_ledger
    DROP CONSTRAINT IF EXISTS balance_ledger_kind_check;

ALTER TABLE balance_ledger
    ADD CONSTRAINT balance_ledger_kind_check
    CHECK (kind IN ('adjustment', 'quota_add', 'quota_subtract', 'quota_override', 'usage_charge'));
