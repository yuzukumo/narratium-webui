WITH existing AS (
    SELECT
        m.id,
        p.provider,
        COALESCE(NULLIF(m.capabilities->>'context_window', '')::integer, 128000) AS context_window,
        COALESCE(NULLIF(m.capabilities->>'max_output_tokens', '')::integer, 16384) AS max_output_tokens,
        COALESCE(
            NULLIF(m.capabilities->'reasoning'->>'enabled', '')::boolean,
            NULLIF(m.capabilities->'reasoning'->>'supported', '')::boolean,
            true
        ) AS reasoning_enabled,
        NULLIF(m.capabilities->>'compaction_threshold', '')::integer AS configured_threshold,
        COALESCE(
            NULLIF(m.capabilities->'reasoning'->>'effort', ''),
            NULLIF(m.capabilities->'reasoning'->>'default_effort', ''),
            CASE p.provider
                WHEN 'anthropic' THEN 'high'
                WHEN 'gemini' THEN 'high'
                ELSE 'medium'
            END
        ) AS reasoning_effort
    FROM models AS m
    JOIN provider_configs AS p ON p.id = m.provider_config_id
    WHERE COALESCE((m.capabilities->>'schema_version')::integer, 0) < 2
), normalized AS (
    SELECT
        *,
        GREATEST(
            1,
            LEAST(
                context_window - 1,
                COALESCE(configured_threshold, floor(context_window * 0.95)::integer)
            )
        ) AS compaction_threshold
    FROM existing
)
UPDATE models AS m
SET capabilities = jsonb_build_object(
    'schema_version', 2,
    'context_window', normalized.context_window,
    'compaction_threshold', normalized.compaction_threshold,
    'max_output_tokens', normalized.max_output_tokens,
    'reasoning', jsonb_build_object(
        'enabled', normalized.reasoning_enabled,
        'effort', CASE WHEN normalized.reasoning_enabled THEN normalized.reasoning_effort ELSE '' END
    )
)
FROM normalized
WHERE normalized.id = m.id;
