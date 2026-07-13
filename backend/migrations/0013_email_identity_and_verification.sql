-- Authentication identity is the email address. Display names are not unique.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'users' AND column_name = 'username'
    ) THEN
        ALTER TABLE users RENAME COLUMN username TO name;
    END IF;
END $$;

ALTER TABLE users
    ALTER COLUMN email SET NOT NULL;

DROP INDEX IF EXISTS users_username_lower_idx;
CREATE INDEX IF NOT EXISTS users_name_lower_idx ON users (lower(name));
DROP INDEX IF EXISTS users_email_lower_idx;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

INSERT INTO settings (key, value)
VALUES ('email_verification_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS email_verification_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
