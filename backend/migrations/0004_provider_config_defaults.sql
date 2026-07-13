ALTER TABLE provider_configs
    ALTER COLUMN api_format DROP DEFAULT,
    ALTER COLUMN prompt_cache_key_enabled DROP DEFAULT;

CREATE OR REPLACE FUNCTION narratium_provider_config_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    api_format_inherited BOOLEAN := false;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.provider IS DISTINCT FROM OLD.provider THEN
        api_format_inherited := NEW.api_format IS NOT DISTINCT FROM OLD.api_format;
    END IF;

    IF NEW.api_format IS NULL OR api_format_inherited THEN
        NEW.api_format := CASE NEW.provider
            WHEN 'openai' THEN 'responses'
            WHEN 'anthropic' THEN 'messages'
            WHEN 'gemini' THEN 'generate_content'
        END;
    END IF;

    IF NEW.prompt_cache_key_enabled IS NULL THEN
        NEW.prompt_cache_key_enabled := (
            NEW.provider = 'openai' AND NEW.api_format = 'responses'
        );
    ELSIF TG_OP = 'UPDATE' THEN
        IF api_format_inherited
            AND NEW.prompt_cache_key_enabled IS NOT DISTINCT FROM OLD.prompt_cache_key_enabled
        THEN
            NEW.prompt_cache_key_enabled := (
                NEW.provider = 'openai' AND NEW.api_format = 'responses'
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provider_configs_defaults_trigger ON provider_configs;

CREATE TRIGGER provider_configs_defaults_trigger
BEFORE INSERT OR UPDATE ON provider_configs
FOR EACH ROW
EXECUTE FUNCTION narratium_provider_config_defaults();
