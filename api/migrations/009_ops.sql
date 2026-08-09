-- +goose Up
CREATE TABLE storage_migrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    from_backend_id UUID REFERENCES storage_backends(id) ON DELETE SET NULL,
    to_backend_id UUID NOT NULL REFERENCES storage_backends(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    copied INT NOT NULL DEFAULT 0,
    total INT NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX storage_migrations_status_idx ON storage_migrations(status, created_at);
CREATE INDEX storage_migrations_workspace_idx ON storage_migrations(workspace_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS storage_migrations;
