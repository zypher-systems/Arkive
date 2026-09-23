-- +goose Up
ALTER TABLE public_links
    ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'view';

ALTER TABLE public_links
    ADD CONSTRAINT public_links_mode_check CHECK (mode IN ('view', 'upload'));

-- +goose Down
ALTER TABLE public_links DROP CONSTRAINT IF EXISTS public_links_mode_check;
ALTER TABLE public_links DROP COLUMN IF EXISTS mode;
