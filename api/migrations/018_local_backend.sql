-- +goose Up
ALTER TABLE storage_backends DROP CONSTRAINT IF EXISTS storage_backends_type_check;
ALTER TABLE storage_backends ADD CONSTRAINT storage_backends_type_check
    CHECK (type IN ('s3', 'nfs', 'local', 'gdrive', 'webdav', 'internxt'));

-- +goose Down
ALTER TABLE storage_backends DROP CONSTRAINT IF EXISTS storage_backends_type_check;
ALTER TABLE storage_backends ADD CONSTRAINT storage_backends_type_check
    CHECK (type IN ('s3', 'nfs', 'gdrive', 'webdav', 'internxt'));
