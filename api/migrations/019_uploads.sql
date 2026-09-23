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

-- +goose Down
DROP TABLE IF EXISTS uploads;
