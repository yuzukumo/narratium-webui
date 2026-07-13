CREATE TABLE IF NOT EXISTS chat_runs (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_id UUID REFERENCES models(id) ON DELETE SET NULL,
    character_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    parent_node_id TEXT NOT NULL,
    user_message TEXT NOT NULL,
    model_name TEXT NOT NULL,
    provider TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE,
    billing_reservation_id UUID REFERENCES billing_reservations(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
    response_text TEXT NOT NULL DEFAULT '',
    provider_response_id TEXT NOT NULL DEFAULT '',
    finish_reason TEXT NOT NULL DEFAULT '',
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    reasoning_tokens BIGINT NOT NULL DEFAULT 0,
    cache_read_input_tokens BIGINT NOT NULL DEFAULT 0,
    cache_creation_input_tokens BIGINT NOT NULL DEFAULT 0,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    first_token_ms BIGINT,
    cost_microusd BIGINT NOT NULL DEFAULT 0,
    charged_microusd BIGINT NOT NULL DEFAULT 0,
    balance_microusd BIGINT NOT NULL DEFAULT 0,
    reserved_microusd BIGINT NOT NULL DEFAULT 0,
    available_balance_microusd BIGINT NOT NULL DEFAULT 0,
    unbilled_microusd BIGINT NOT NULL DEFAULT 0,
    error_code TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    cancel_requested BOOLEAN NOT NULL DEFAULT false,
    acknowledged_at TIMESTAMPTZ,
    revision BIGINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, node_id)
);

CREATE INDEX IF NOT EXISTS chat_runs_user_character_updated_idx
    ON chat_runs (user_id, character_id, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS chat_runs_active_character_idx
    ON chat_runs (user_id, character_id)
    WHERE character_id <> '' AND status IN ('queued', 'running');
