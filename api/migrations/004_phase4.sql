-- +goose Up
CREATE TABLE node_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    version INT NOT NULL,
    storage_key TEXT NOT NULL,
    size BIGINT NOT NULL DEFAULT 0,
    mime TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (node_id, version)
);

CREATE INDEX node_versions_node_id_idx ON node_versions(node_id, version DESC);

CREATE TABLE activity_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX activity_events_node_id_idx ON activity_events(node_id, created_at DESC);

-- +goose Down
DROP TABLE IF EXISTS activity_events;
DROP TABLE IF EXISTS node_versions;
