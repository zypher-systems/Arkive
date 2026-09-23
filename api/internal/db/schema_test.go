package db_test

import (
	"context"
	"io/fs"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/arkive/arkive/internal/db"
	"github.com/arkive/arkive/internal/db/dbtest"
	"github.com/arkive/arkive/migrations"
)

// Engine-specific parts of the schema, allowed to differ.
var (
	postgresOnlyColumns = map[string]bool{"nodes.search_vector": true} // tsvector
	sqliteOnlyTables    = map[string]bool{"nodes_search": true, "nodes_fts": true}
)

// TestSchemasMatch keeps the PostgreSQL and SQLite migration sets in step:
// after all migrations both must have the same tables with the same columns.
// If this fails you added a migration to one set only — add the equivalent
// NNN_*.sql to the other (api/migrations/ and api/migrations/sqlite/).
//
// The PostgreSQL side is derived by replaying the DDL of the migration files
// (no server needed); with ARKIVE_TEST_DATABASE_URL set it is also checked
// against a live, freshly migrated PostgreSQL database.
func TestSchemasMatch(t *testing.T) {
	pgSchema := parsePostgresMigrations(t)
	sqliteSchema := liveSchema(t, dbtest.Open(t, db.SQLiteURL(filepath.Join(t.TempDir(), "s.db")), ""))
	compareSchemas(t, "postgres migrations", pgSchema, "sqlite", sqliteSchema)

	if dbtest.Postgres() {
		pg := liveSchema(t, dbtest.Open(t, dbtest.FreshURL(t), ""))
		compareSchemas(t, "postgres migrations", pgSchema, "live postgres", pg)
	}
}

type schema map[string]map[string]bool // table -> columns

func compareSchemas(t *testing.T, aName string, a schema, bName string, b schema) {
	t.Helper()
	norm := func(s schema) schema {
		out := schema{}
		for tbl, cols := range s {
			if sqliteOnlyTables[tbl] || tbl == "goose_db_version" {
				continue
			}
			out[tbl] = map[string]bool{}
			for c := range cols {
				if !postgresOnlyColumns[tbl+"."+c] {
					out[tbl][c] = true
				}
			}
		}
		return out
	}
	a, b = norm(a), norm(b)
	for _, tbl := range sortedKeys(a) {
		if _, ok := b[tbl]; !ok {
			t.Errorf("table %s exists in %s but not in %s", tbl, aName, bName)
			continue
		}
		for _, c := range sortedKeys(a[tbl]) {
			if !b[tbl][c] {
				t.Errorf("column %s.%s exists in %s but not in %s", tbl, c, aName, bName)
			}
		}
		for _, c := range sortedKeys(b[tbl]) {
			if !a[tbl][c] {
				t.Errorf("column %s.%s exists in %s but not in %s", tbl, c, bName, aName)
			}
		}
	}
	for _, tbl := range sortedKeys(b) {
		if _, ok := a[tbl]; !ok {
			t.Errorf("table %s exists in %s but not in %s", tbl, bName, aName)
		}
	}
	if len(a) < 10 {
		t.Fatalf("suspiciously small schema from %s: %v", aName, sortedKeys(a))
	}
}

func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func liveSchema(t *testing.T, d db.DB) schema {
	t.Helper()
	ctx := context.Background()
	out := schema{}
	add := func(tbl, col string) {
		if out[tbl] == nil {
			out[tbl] = map[string]bool{}
		}
		out[tbl][col] = true
	}
	switch d.Dialect() {
	case db.SQLite:
		rows, err := d.Query(ctx, `
			SELECT m.name, p.name FROM sqlite_master m, pragma_table_info(m.name) p
			WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\_%' ESCAPE '\'
			  AND m.name NOT LIKE 'nodes\_fts\_%' ESCAPE '\'`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		for rows.Next() {
			var tbl, col string
			if err := rows.Scan(&tbl, &col); err != nil {
				t.Fatal(err)
			}
			add(tbl, col)
		}
	default:
		rows, err := d.Query(ctx, `
			SELECT table_name, column_name FROM information_schema.columns
			WHERE table_schema = current_schema()`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		for rows.Next() {
			var tbl, col string
			if err := rows.Scan(&tbl, &col); err != nil {
				t.Fatal(err)
			}
			add(tbl, col)
		}
	}
	return out
}

var (
	reCreateTable = regexp.MustCompile(`(?is)^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s*\((.*)\)$`)
	reAlterTable  = regexp.MustCompile(`(?is)^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?"?(\w+)"?\s+(.*)$`)
	reDropTable   = regexp.MustCompile(`(?is)^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(.*)$`)
	reRenameTable = regexp.MustCompile(`(?is)^RENAME\s+TO\s+"?(\w+)"?$`)
	reAddColumn   = regexp.MustCompile(`(?is)^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?`)
	reDropColumn  = regexp.MustCompile(`(?is)^DROP\s+(?:COLUMN\s+)?(?:IF\s+EXISTS\s+)?"?(\w+)"?`)
	reRenameCol   = regexp.MustCompile(`(?is)^RENAME\s+(?:COLUMN\s+)?"?(\w+)"?\s+TO\s+"?(\w+)"?$`)
	reLineComment = regexp.MustCompile(`--[^\n]*`)
)

// parsePostgresMigrations replays the table/column DDL of the embedded
// PostgreSQL migrations (Up sections, in order).
func parsePostgresMigrations(t *testing.T) schema {
	t.Helper()
	names, err := fs.Glob(migrations.FS, "*.sql")
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(names)
	s := schema{}
	for _, name := range names {
		raw, err := fs.ReadFile(migrations.FS, name)
		if err != nil {
			t.Fatal(err)
		}
		up := string(raw)
		if i := strings.Index(up, "-- +goose Up"); i >= 0 {
			up = up[i:]
		}
		if i := strings.Index(up, "-- +goose Down"); i >= 0 {
			up = up[:i]
		}
		// Function bodies ($$ … $$) contain semicolons and no table DDL.
		for strings.Contains(up, "$$") {
			a := strings.Index(up, "$$")
			b := strings.Index(up[a+2:], "$$")
			if b < 0 {
				break
			}
			up = up[:a] + "''" + up[a+2+b+2:]
		}
		up = reLineComment.ReplaceAllString(up, "")
		for _, stmt := range strings.Split(up, ";") {
			stmt = strings.TrimSpace(stmt)
			if stmt == "" {
				continue
			}
			applyDDL(t, s, name, stmt)
		}
	}
	return s
}

func applyDDL(t *testing.T, s schema, file, stmt string) {
	if m := reCreateTable.FindStringSubmatch(stmt); m != nil {
		tbl := strings.ToLower(m[1])
		if s[tbl] == nil {
			s[tbl] = map[string]bool{}
		}
		for _, part := range splitTopLevel(m[2]) {
			f := strings.Fields(part)
			if len(f) == 0 {
				continue
			}
			switch strings.ToUpper(f[0]) {
			case "PRIMARY", "UNIQUE", "CHECK", "CONSTRAINT", "FOREIGN", "EXCLUDE":
				continue
			}
			s[tbl][strings.ToLower(strings.Trim(f[0], `"`))] = true
		}
		return
	}
	if m := reDropTable.FindStringSubmatch(stmt); m != nil {
		for _, n := range strings.Split(m[1], ",") {
			n = strings.ToLower(strings.Trim(strings.Fields(n)[0], `"`))
			delete(s, n)
		}
		return
	}
	if m := reAlterTable.FindStringSubmatch(stmt); m != nil {
		tbl := strings.ToLower(m[1])
		for _, action := range splitTopLevel(m[2]) {
			action = strings.TrimSpace(action)
			up := strings.ToUpper(action)
			switch {
			case strings.HasPrefix(up, "ADD CONSTRAINT"), strings.HasPrefix(up, "DROP CONSTRAINT"),
				strings.HasPrefix(up, "ALTER "), strings.HasPrefix(up, "ADD PRIMARY"),
				strings.HasPrefix(up, "ADD UNIQUE"), strings.HasPrefix(up, "ADD CHECK"),
				strings.HasPrefix(up, "ADD FOREIGN"):
			case reRenameTable.MatchString(action):
				n := strings.ToLower(reRenameTable.FindStringSubmatch(action)[1])
				s[n] = s[tbl]
				delete(s, tbl)
			case reRenameCol.MatchString(action):
				mm := reRenameCol.FindStringSubmatch(action)
				delete(s[tbl], strings.ToLower(mm[1]))
				s[tbl][strings.ToLower(mm[2])] = true
			case strings.HasPrefix(up, "ADD"):
				if s[tbl] == nil {
					t.Fatalf("%s: ALTER TABLE on unknown table %s", file, tbl)
				}
				s[tbl][strings.ToLower(reAddColumn.FindStringSubmatch(action)[1])] = true
			case strings.HasPrefix(up, "DROP"):
				delete(s[tbl], strings.ToLower(reDropColumn.FindStringSubmatch(action)[1]))
			default:
				t.Fatalf("%s: unsupported ALTER TABLE action %q: teach schema_test.go about it", file, action)
			}
		}
	}
	// Other statements (indexes, triggers, data) do not change columns.
}

// splitTopLevel splits on commas outside parentheses and quotes.
func splitTopLevel(s string) []string {
	var out []string
	depth, start := 0, 0
	inQuote := false
	for i, r := range s {
		switch {
		case r == '\'':
			inQuote = !inQuote
		case inQuote:
		case r == '(':
			depth++
		case r == ')':
			depth--
		case r == ',' && depth == 0:
			out = append(out, s[start:i])
			start = i + 1
		}
	}
	return append(out, s[start:])
}
