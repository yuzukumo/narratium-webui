ALTER TABLE usage_logs
    ADD COLUMN IF NOT EXISTS first_token_ms BIGINT;

UPDATE models AS m
SET capabilities = jsonb_build_object(
    'schema_version', 1,
    'context_window', COALESCE(
        NULLIF(m.capabilities->>'context_window', '')::integer,
        NULLIF(m.capabilities->>'input_token_limit', '')::integer,
        CASE p.provider
            WHEN 'anthropic' THEN 200000
            WHEN 'gemini' THEN 1048576
            ELSE 128000
        END
    ),
    'max_output_tokens', COALESCE(
        NULLIF(m.capabilities->>'max_output_tokens', '')::integer,
        NULLIF(m.capabilities->>'output_token_limit', '')::integer,
        CASE p.provider WHEN 'gemini' THEN 65536 ELSE 16384 END
    ),
    'reasoning', jsonb_build_object(
        'supported', COALESCE((m.capabilities->>'reasoning')::boolean, true),
        'efforts', CASE p.provider
            WHEN 'anthropic' THEN '["low","medium","high","xhigh","max"]'::jsonb
            WHEN 'gemini' THEN '["minimal","low","medium","high"]'::jsonb
            ELSE '["low","medium","high","xhigh"]'::jsonb
        END,
        'default_effort', CASE p.provider
            WHEN 'anthropic' THEN 'high'
            WHEN 'gemini' THEN 'high'
            ELSE 'medium'
        END
    )
)
FROM provider_configs AS p
WHERE p.id = m.provider_config_id
  AND COALESCE((m.capabilities->>'schema_version')::integer, 0) < 1;
