ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS balance_microusd BIGINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
    ON users (lower(email))
    WHERE email IS NOT NULL;

ALTER TABLE users
    ADD CONSTRAINT users_balance_nonnegative CHECK (balance_microusd >= 0);

ALTER TABLE models
    ADD COLUMN IF NOT EXISTS input_price_microusd_per_million BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS output_price_microusd_per_million BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cache_read_price_microusd_per_million BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cache_creation_price_microusd_per_million BIGINT NOT NULL DEFAULT 0;

ALTER TABLE models
    ADD CONSTRAINT models_input_price_nonnegative CHECK (input_price_microusd_per_million >= 0),
    ADD CONSTRAINT models_output_price_nonnegative CHECK (output_price_microusd_per_million >= 0),
    ADD CONSTRAINT models_cache_read_price_nonnegative CHECK (cache_read_price_microusd_per_million >= 0),
    ADD CONSTRAINT models_cache_creation_price_nonnegative CHECK (cache_creation_price_microusd_per_million >= 0);

CREATE TABLE IF NOT EXISTS billing_reservations (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_id UUID REFERENCES models(id) ON DELETE SET NULL,
    request_id TEXT NOT NULL,
    estimated_cost_microusd BIGINT NOT NULL CHECK (estimated_cost_microusd >= 0),
    actual_cost_microusd BIGINT NOT NULL DEFAULT 0 CHECK (actual_cost_microusd >= 0),
    charged_microusd BIGINT NOT NULL DEFAULT 0 CHECK (charged_microusd >= 0),
    balance_after_microusd BIGINT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'settled', 'released')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at TIMESTAMPTZ,
    UNIQUE (user_id, request_id)
);

CREATE INDEX IF NOT EXISTS billing_reservations_active_user_idx
    ON billing_reservations (user_id, expires_at)
    WHERE status = 'active';

ALTER TABLE usage_logs
    ADD COLUMN IF NOT EXISTS billing_reservation_id UUID REFERENCES billing_reservations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS cost_microusd BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS charged_microusd BIGINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS usage_logs_billing_reservation_idx
    ON usage_logs (billing_reservation_id)
    WHERE billing_reservation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS balance_ledger (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    model_id UUID REFERENCES models(id) ON DELETE SET NULL,
    usage_log_id UUID REFERENCES usage_logs(id) ON DELETE SET NULL,
    request_id TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK (kind IN ('adjustment', 'usage_charge')),
    amount_microusd BIGINT NOT NULL CHECK (amount_microusd <> 0),
    balance_after_microusd BIGINT NOT NULL CHECK (balance_after_microusd >= 0),
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS balance_ledger_user_created_idx
    ON balance_ledger (user_id, created_at DESC, id DESC);
