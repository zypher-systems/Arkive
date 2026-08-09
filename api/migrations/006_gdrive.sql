-- +goose Up
ALTER TABLE storage_backends DROP CONSTRAINT IF EXISTS storage_backends_type_check;
ALTER TABLE storage_backends
    ADD CONSTRAINT storage_backends_type_check
    CHECK (type IN ('s3', 'nfs', 'gdrive'));

ALTER TABLE storage_backends
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS storage_backends_owner_user_id_idx
    ON storage_backends(owner_user_id)
    WHERE owner_user_id IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS storage_backends_owner_user_id_idx;
ALTER TABLE storage_backends DROP COLUMN IF EXISTS owner_user_id;
ALTER TABLE storage_backends DROP CONSTRAINT IF EXISTS storage_backends_type_check;
ALTER TABLE storage_backends
    ADD CONSTRAINT storage_backends_type_check
    CHECK (type IN ('s3', 'nfs'));
