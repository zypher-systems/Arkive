-- +goose Up
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Snapshot so entries stay readable after the actor is deleted.
    actor_email TEXT,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    meta JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action text_pattern_ops);

-- +goose Down
DROP TABLE IF EXISTS audit_log;
