-- +goose Up
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS content_text TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS nodes_search_vector_idx ON nodes USING GIN (search_vector);

UPDATE nodes SET search_vector =
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content_text, '')), 'B')
WHERE search_vector IS NULL;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION nodes_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.content_text, '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

DROP TRIGGER IF EXISTS nodes_search_vector_trigger ON nodes;

-- +goose StatementBegin
CREATE TRIGGER nodes_search_vector_trigger
BEFORE INSERT OR UPDATE OF name, content_text ON nodes
FOR EACH ROW EXECUTE PROCEDURE nodes_search_vector_update();
-- +goose StatementEnd

-- +goose Down
DROP TRIGGER IF EXISTS nodes_search_vector_trigger ON nodes;
DROP FUNCTION IF EXISTS nodes_search_vector_update();
DROP INDEX IF EXISTS nodes_search_vector_idx;
ALTER TABLE nodes DROP COLUMN IF EXISTS search_vector;
ALTER TABLE nodes DROP COLUMN IF EXISTS content_text;
