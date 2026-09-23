-- +goose Up
-- TOTP secrets are encrypted at rest (enc:v1: AES-GCM keyed by ARKIVE_SECRETS_KEY).
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS totp_secret TEXT,
    ADD COLUMN IF NOT EXISTS totp_pending_secret TEXT,
    ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS totp_last_step BIGINT;

CREATE TABLE IF NOT EXISTS user_recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_recovery_codes_user_idx ON user_recovery_codes (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_recovery_codes_hash_idx ON user_recovery_codes (user_id, code_hash);

-- Short-lived, single-use login challenges issued after a correct password
-- when the account has 2FA enabled.
CREATE TABLE IF NOT EXISTS login_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    failed_attempts INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_challenges_expires_idx ON login_challenges (expires_at);

-- +goose Down
DROP TABLE IF EXISTS login_challenges;
DROP TABLE IF EXISTS user_recovery_codes;
ALTER TABLE users
    DROP COLUMN IF EXISTS totp_last_step,
    DROP COLUMN IF EXISTS totp_enabled_at,
    DROP COLUMN IF EXISTS totp_pending_secret,
    DROP COLUMN IF EXISTS totp_secret;
