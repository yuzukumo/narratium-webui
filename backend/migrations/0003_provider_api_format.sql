ALTER TABLE provider_configs
    ADD COLUMN api_format TEXT NOT NULL DEFAULT 'responses',
    ADD COLUMN prompt_cache_key_enabled BOOLEAN NOT NULL DEFAULT false;

UPDATE provider_configs
SET api_format = CASE provider
    WHEN 'openai' THEN 'responses'
    WHEN 'anthropic' THEN 'messages'
    WHEN 'gemini' THEN 'generate_content'
END,
prompt_cache_key_enabled = (provider = 'openai');

ALTER TABLE provider_configs
    ADD CONSTRAINT provider_configs_api_format_check CHECK (
        (provider = 'openai' AND api_format IN ('responses', 'chat_completions'))
        OR (provider = 'anthropic' AND api_format = 'messages')
        OR (provider = 'gemini' AND api_format = 'generate_content')
    ),
    ADD CONSTRAINT provider_configs_prompt_cache_key_check CHECK (
        provider = 'openai' OR NOT prompt_cache_key_enabled
    );
