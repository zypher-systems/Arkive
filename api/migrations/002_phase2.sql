-- +goose Up
ALTER TABLE nodes ADD COLUMN deleted_at TIMESTAMPTZ;

DROP INDEX IF EXISTS nodes_unique_name_root;
DROP INDEX IF EXISTS nodes_unique_name_parent;

CREATE UNIQUE INDEX nodes_unique_name_root
    ON nodes(workspace_id, name)
    WHERE parent_id IS NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX nodes_unique_name_parent
    ON nodes(workspace_id, parent_id, name)
    WHERE parent_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX nodes_deleted_at_idx ON nodes(workspace_id, deleted_at)
    WHERE deleted_at IS NOT NULL;

CREATE TABLE public_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    expires_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX public_links_node_id_idx ON public_links(node_id);

-- +goose Down
DROP TABLE IF EXISTS public_links;
DROP INDEX IF EXISTS nodes_deleted_at_idx;
DROP INDEX IF EXISTS nodes_unique_name_parent;
DROP INDEX IF EXISTS nodes_unique_name_root;
ALTER TABLE nodes DROP COLUMN IF EXISTS deleted_at;
CREATE UNIQUE INDEX nodes_unique_name_root ON nodes(workspace_id, name) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX nodes_unique_name_parent ON nodes(workspace_id, parent_id, name) WHERE parent_id IS NOT NULL;
