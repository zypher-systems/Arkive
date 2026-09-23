-- +goose Up
-- Resumable (tus 1.0.0) upload sessions. Partial data lives on local disk at
-- <ARKIVE_DATA_DIR>/.uploads/<id> until the upload completes.
CREATE TABLE uploads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    length BIGINT NOT NULL CHECK (length >= 0),
    "offset" BIGINT NOT NULL DEFAULT 0 CHECK ("offset" >= 0 AND "offset" <= length),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX uploads_user_idx ON uploads(user_id);
CREATE INDEX uploads_workspace_idx ON uploads(workspace_id);
CREATE INDEX uploads_expires_idx ON uploads(expires_at);

-- Version pruning and orphan GC look blobs up by key before deleting them.
-- (The version-retention setting itself lives in instance_settings.)
CREATE INDEX IF NOT EXISTS nodes_storage_key_idx ON nodes(storage_key) WHERE storage_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS nodes_thumb_key_idx ON nodes(thumb_key) WHERE thumb_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS node_versions_storage_key_idx ON node_versions(storage_key);

-- +goose Down
DROP INDEX IF EXISTS node_versions_storage_key_idx;
DROP INDEX IF EXISTS nodes_thumb_key_idx;
DROP INDEX IF EXISTS nodes_storage_key_idx;
DROP TABLE IF EXISTS uploads;
