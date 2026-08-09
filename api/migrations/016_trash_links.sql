-- +goose Up
ALTER TABLE public_links
    ADD COLUMN IF NOT EXISTS max_downloads INT,
    ADD COLUMN IF NOT EXISTS download_count INT NOT NULL DEFAULT 0;

ALTER TABLE public_links
    ADD CONSTRAINT public_links_max_downloads_check
    CHECK (max_downloads IS NULL OR max_downloads > 0);

INSERT INTO instance_settings (key, value, updated_at)
VALUES ('trash_retention_days', '30', now())
ON CONFLICT (key) DO NOTHING;

-- +goose Down
ALTER TABLE public_links DROP CONSTRAINT IF EXISTS public_links_max_downloads_check;
ALTER TABLE public_links DROP COLUMN IF EXISTS download_count;
ALTER TABLE public_links DROP COLUMN IF EXISTS max_downloads;
DELETE FROM instance_settings WHERE key = 'trash_retention_days';
