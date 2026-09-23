-- SQLite baseline: the schema of PostgreSQL migrations 001-022 in one step.
--
-- Type mapping (see api/internal/db/README.md):
--   UUID         -> TEXT     canonical lowercase 8-4-4-4-12 form
--   TIMESTAMPTZ  -> TEXT     UTC 'YYYY-MM-DD HH:MM:SS.ffffff' (sortable)
--   JSONB        -> TEXT     JSON text
--   BOOLEAN      -> INTEGER  0 / 1
--   INT, BIGINT  -> INTEGER
--   tsvector     -> nodes_fts (FTS5) kept in sync by triggers
--
-- Defaults mirror PostgreSQL: gen_random_uuid() becomes a random v4 UUID
-- expression and now() the current UTC time in the format above.
--
-- Future schema changes: add NNN_name.sql here AND the matching PostgreSQL
-- migration in api/migrations/. TestSchemasMatch fails when they drift.

-- +goose Up
CREATE TABLE users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    display_name TEXT NOT NULL,
    is_instance_admin INTEGER NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now')),
    oidc_sub TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'rejected', 'disabled')),
    quota_bytes INTEGER,
    totp_secret TEXT,
    totp_pending_secret TEXT,
    totp_enabled_at TEXT,
    totp_last_step INTEGER
);
CREATE INDEX users_status_idx ON users(status);

CREATE TABLE storage_backends (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('s3', 'nfs', 'local', 'gdrive', 'webdav', 'internxt')),
    config TEXT NOT NULL DEFAULT '{}',
    is_default INTEGER NOT NULL DEFAULT FALSE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now')),
    owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX storage_backends_owner_user_id_idx ON storage_backends(owner_user_id)
    WHERE owner_user_id IS NOT NULL;

CREATE TABLE sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now'))
);
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE workspaces (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    type TEXT NOT NULL CHECK (type IN ('personal', 'team', 'mount')),
    name TEXT NOT NULL,
    storage_backend_id TEXT REFERENCES storage_backends(id),
    invite_token TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now')),
    quota_bytes INTEGER
);

CREATE TABLE workspace_members (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now')),
    PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_members_user_id_idx ON workspace_members(user_id);

CREATE TABLE nodes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('file', 'folder')),
    size INTEGER NOT NULL DEFAULT 0,
    mime TEXT,
    storage_key TEXT,
    checksum TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now')),
    deleted_at TEXT,
    content_text TEXT NOT NULL DEFAULT '',
    thumb_key TEXT
);
CREATE UNIQUE INDEX nodes_unique_name_root ON nodes(workspace_id, name)
    WHERE parent_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX nodes_unique_name_parent ON nodes(workspace_id, parent_id, name)
    WHERE parent_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX nodes_workspace_parent_idx ON nodes(workspace_id, parent_id);
CREATE INDEX nodes_parent_idx ON nodes(parent_id);
CREATE INDEX nodes_deleted_at_idx ON nodes(workspace_id, deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX nodes_storage_key_idx ON nodes(storage_key) WHERE storage_key IS NOT NULL;
CREATE INDEX nodes_thumb_key_idx ON nodes(thumb_key) WHERE thumb_key IS NOT NULL;

-- Full-text search (PostgreSQL: nodes.search_vector + GIN index).
-- nodes has no stable integer rowid (VACUUM may renumber implicit rowids), so
-- nodes_search maps each node to the FTS rowid. nodes_fts is contentless:
-- the text itself stays in nodes.
CREATE TABLE nodes_search (
    rid INTEGER PRIMARY KEY,
    node_id TEXT NOT NULL UNIQUE REFERENCES nodes(id) ON DELETE CASCADE
);
CREATE VIRTUAL TABLE nodes_fts USING fts5(
    name, content_text,
    content = '', contentless_delete = 1,
    tokenize = 'porter unicode61 remove_diacritics 2'
);

-- +goose StatementBegin
CREATE TRIGGER nodes_fts_insert AFTER INSERT ON nodes BEGIN
    INSERT INTO nodes_search (node_id) VALUES (new.id);
    INSERT INTO nodes_fts (rowid, name, content_text)
    VALUES ((SELECT rid FROM nodes_search WHERE node_id = new.id), new.name, new.content_text);
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER nodes_fts_update AFTER UPDATE OF name, content_text ON nodes BEGIN
    DELETE FROM nodes_fts WHERE rowid = (SELECT rid FROM nodes_search WHERE node_id = old.id);
    INSERT INTO nodes_fts (rowid, name, content_text)
    VALUES ((SELECT rid FROM nodes_search WHERE node_id = new.id), new.name, new.content_text);
END;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TRIGGER nodes_fts_delete BEFORE DELETE ON nodes BEGIN
    DELETE FROM nodes_fts WHERE rowid = (SELECT rid FROM nodes_search WHERE node_id = old.id);
END;
-- +goose StatementEnd

CREATE TABLE shares (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    grantee_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    grantee_workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now')),
    CHECK (
        (grantee_user_id IS NOT NULL AND grantee_workspace_id IS NULL)
        OR (grantee_user_id IS NULL AND grantee_workspace_id IS NOT NULL)
    )
);
CREATE INDEX shares_node_id_idx ON shares(node_id);
CREATE INDEX shares_grantee_user_id_idx ON shares(grantee_user_id);
CREATE INDEX shares_grantee_workspace_id_idx ON shares(grantee_workspace_id);

CREATE TABLE public_links (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    expires_at TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now')),
    max_downloads INTEGER CHECK (max_downloads IS NULL OR max_downloads > 0),
    download_count INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT 'view' CHECK (mode IN ('view', 'upload'))
);
CREATE INDEX public_links_node_id_idx ON public_links(node_id);

CREATE TABLE node_versions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    storage_key TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    mime TEXT,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now')),
    UNIQUE (node_id, version)
);
CREATE INDEX node_versions_node_id_idx ON node_versions(node_id, version DESC);
CREATE INDEX node_versions_storage_key_idx ON node_versions(storage_key);

CREATE TABLE activity_events (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    node_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now'))
);
CREATE INDEX activity_events_node_id_idx ON activity_events(node_id, created_at DESC);
CREATE INDEX activity_events_workspace_idx ON activity_events(workspace_id);

CREATE TABLE instance_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now'))
);
INSERT INTO instance_settings (key, value) VALUES ('default_workspace_quota_bytes', '');
INSERT INTO instance_settings (key, value) VALUES ('trash_retention_days', '30');

CREATE TABLE storage_migrations (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    from_backend_id TEXT REFERENCES storage_backends(id) ON DELETE SET NULL,
    to_backend_id TEXT NOT NULL REFERENCES storage_backends(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    copied INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now'))
);
CREATE INDEX storage_migrations_status_idx ON storage_migrations(status, created_at);
CREATE INDEX storage_migrations_workspace_idx ON storage_migrations(workspace_id, created_at DESC);

CREATE TABLE app_passwords (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    secret_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now')),
    last_used_at TEXT,
    revoked_at TEXT
);
CREATE UNIQUE INDEX app_passwords_user_prefix_active_idx ON app_passwords (user_id, prefix)
    WHERE revoked_at IS NULL;
CREATE INDEX app_passwords_user_id_idx ON app_passwords (user_id);

CREATE TABLE password_reset_tokens (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now'))
);
CREATE INDEX password_reset_tokens_user_id_idx ON password_reset_tokens (user_id);
CREATE INDEX password_reset_tokens_expires_idx ON password_reset_tokens (expires_at);

-- Resumable (tus 1.0.0) upload sessions. Partial data lives on local disk at
-- <ARKIVE_DATA_DIR>/.uploads/<id> until the upload completes.
CREATE TABLE uploads (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    length INTEGER NOT NULL CHECK (length >= 0),
    "offset" INTEGER NOT NULL DEFAULT 0 CHECK ("offset" >= 0 AND "offset" <= length),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now')),
    expires_at TEXT NOT NULL
);
CREATE INDEX uploads_user_idx ON uploads(user_id);
CREATE INDEX uploads_workspace_idx ON uploads(workspace_id);
CREATE INDEX uploads_expires_idx ON uploads(expires_at);

CREATE TABLE user_recovery_codes (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now'))
);
CREATE INDEX user_recovery_codes_user_idx ON user_recovery_codes (user_id);
CREATE UNIQUE INDEX user_recovery_codes_hash_idx ON user_recovery_codes (user_id, code_hash);

CREATE TABLE login_challenges (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now'))
);
CREATE INDEX login_challenges_expires_idx ON login_challenges (expires_at);

CREATE TABLE audit_log (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f000', 'now')),
    actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    -- Snapshot so entries stay readable after the actor is deleted.
    actor_email TEXT,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    meta TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC, id DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id, created_at DESC, id DESC);
CREATE INDEX audit_log_action_idx ON audit_log (action);

-- +goose Down
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS login_challenges;
DROP TABLE IF EXISTS user_recovery_codes;
DROP TABLE IF EXISTS uploads;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS app_passwords;
DROP TABLE IF EXISTS storage_migrations;
DROP TABLE IF EXISTS instance_settings;
DROP TABLE IF EXISTS activity_events;
DROP TABLE IF EXISTS node_versions;
DROP TABLE IF EXISTS public_links;
DROP TABLE IF EXISTS shares;
DROP TRIGGER IF EXISTS nodes_fts_delete;
DROP TRIGGER IF EXISTS nodes_fts_update;
DROP TRIGGER IF EXISTS nodes_fts_insert;
DROP TABLE IF EXISTS nodes_fts;
DROP TABLE IF EXISTS nodes_search;
DROP TABLE IF EXISTS nodes;
DROP TABLE IF EXISTS workspace_members;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS storage_backends;
DROP TABLE IF EXISTS users;
