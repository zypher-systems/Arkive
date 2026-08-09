-- +goose Up
ALTER TABLE users ADD COLUMN IF NOT EXISTS quota_bytes BIGINT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS quota_bytes BIGINT;

INSERT INTO instance_settings (key, value)
VALUES ('default_workspace_quota_bytes', '')
ON CONFLICT (key) DO NOTHING;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS quota_bytes;
ALTER TABLE workspaces DROP COLUMN IF EXISTS quota_bytes;
DELETE FROM instance_settings WHERE key = 'default_workspace_quota_bytes';
