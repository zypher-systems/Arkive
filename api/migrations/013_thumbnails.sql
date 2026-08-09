-- +goose Up
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS thumb_key TEXT;

-- +goose Down
ALTER TABLE nodes DROP COLUMN IF EXISTS thumb_key;
