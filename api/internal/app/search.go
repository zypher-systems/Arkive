package app

import (
	"context"
	"strings"
	"unicode"

	"github.com/arkive/arkive/internal/db"
	"github.com/arkive/arkive/internal/models"
)

// SearchScope limits a search: a condition on the nodes alias "n" using $1.
type SearchScope struct {
	Cond string
	Arg  any
}

// SearchNodes finds live nodes by name substring or full-text match on name
// and extracted content, best matches first (max 50).
//
// Full-text search is the one feature with an engine-specific
// implementation: PostgreSQL uses the nodes.search_vector tsvector (english
// configuration), SQLite the nodes_fts FTS5 table (porter stemmer). Both are
// maintained by triggers, so writers only ever touch nodes.name and
// nodes.content_text.
func (a *App) SearchNodes(ctx context.Context, scope SearchScope, q string) ([]models.Node, error) {
	pattern := "%" + EscapeLike(q) + "%"
	const cols = `n.id, n.workspace_id, n.parent_id, n.name, n.kind, n.size, n.mime, n.checksum, n.created_by, n.created_at, n.updated_at`
	var sql string
	args := []any{scope.Arg}
	switch a.DB.Dialect() {
	case db.SQLite:
		match := ftsMatchQuery(q)
		if match == "" {
			sql = `SELECT ` + cols + ` FROM nodes n
				WHERE ` + scope.Cond + ` AND n.deleted_at IS NULL AND n.name LIKE $2 ESCAPE '\'
				ORDER BY n.kind DESC, n.name ASC LIMIT 50`
			args = append(args, pattern)
			break
		}
		sql = `SELECT ` + cols + ` FROM nodes n
			LEFT JOIN (
			  SELECT s.node_id, bm25(nodes_fts, 4.0, 1.0) AS score
			  FROM nodes_fts JOIN nodes_search s ON s.rid = nodes_fts.rowid
			  WHERE nodes_fts MATCH $2
			) m ON m.node_id = n.id
			WHERE ` + scope.Cond + ` AND n.deleted_at IS NULL
			  AND (m.node_id IS NOT NULL OR n.name LIKE $3 ESCAPE '\')
			ORDER BY COALESCE(m.score, 0) ASC, n.kind DESC, n.name ASC
			LIMIT 50`
		args = append(args, match, pattern)
	default:
		sql = `SELECT ` + cols + ` FROM nodes n
			WHERE ` + scope.Cond + ` AND n.deleted_at IS NULL
			  AND (
			    n.search_vector @@ plainto_tsquery('english', $2)
			    OR n.name ILIKE $3 ESCAPE '\'
			  )
			ORDER BY
			  ts_rank(COALESCE(n.search_vector, ''::tsvector), plainto_tsquery('english', $2)) DESC,
			  n.kind DESC, n.name ASC
			LIMIT 50`
		args = append(args, q, pattern)
	}
	rows, err := a.DB.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.Node{}
	for rows.Next() {
		var n models.Node
		if err := rows.Scan(&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// ftsMatchQuery turns free text into an FTS5 query with plainto_tsquery
// semantics: every word must match (after stemming); operators and
// punctuation in the input are never interpreted.
func ftsMatchQuery(q string) string {
	words := strings.FieldsFunc(q, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
	for i, w := range words {
		words[i] = `"` + w + `"`
	}
	return strings.Join(words, " AND ")
}

// EscapeLike escapes %, _ and \ for a LIKE pattern. Always pair it with
// ESCAPE '\' in the SQL: PostgreSQL defaults to that escape character, SQLite
// has none.
func EscapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}
