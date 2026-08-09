-- +goose Up
ALTER TABLE users
    ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'rejected'));

UPDATE users SET status = 'active';

CREATE INDEX users_status_idx ON users(status);

-- +goose Down
DROP INDEX IF EXISTS users_status_idx;
ALTER TABLE users DROP COLUMN IF EXISTS status;
