-- +goose Up
CREATE TABLE IF NOT EXISTS app_passwords (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS app_passwords_user_prefix_active_idx
    ON app_passwords (user_id, prefix)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS app_passwords_user_id_idx ON app_passwords (user_id);

-- +goose Down
DROP TABLE IF EXISTS app_passwords;
