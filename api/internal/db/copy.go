package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// CopyTables lists every application table in foreign-key order (parents
// first). A new table must be added here; Copy refuses databases with tables
// it does not know, so a forgotten table fails loudly instead of being lost.
var CopyTables = []string{
	"users",
	"storage_backends",
	"workspaces",
	"workspace_members",
	"sessions",
	"nodes",
	"shares",
	"public_links",
	"node_versions",
	"activity_events",
	"instance_settings",
	"storage_migrations",
	"app_passwords",
	"password_reset_tokens",
	"uploads",
	"user_recovery_codes",
	"login_challenges",
	"audit_log",
}

// engineTables are bookkeeping or engine-specific tables that are not copied
// (the search index is rebuilt on the target instead).
func engineTable(name string) bool {
	return name == "goose_db_version" || name == "nodes_search" ||
		strings.HasPrefix(name, "nodes_fts") || strings.HasPrefix(name, "sqlite_")
}

// engineColumns are engine-specific columns that are not copied.
var engineColumns = map[string]bool{"nodes.search_vector": true}

// CopyTableReport is the per-table outcome of Copy.
type CopyTableReport struct {
	Table string `json:"table"`
	Rows  int64  `json:"rows"`
}

// CopyReport summarizes Copy.
type CopyReport struct {
	From     Dialect           `json:"from"`
	To       Dialect           `json:"to"`
	Tables   []CopyTableReport `json:"tables"`
	Rows     int64             `json:"rows"`
	Duration time.Duration     `json:"duration"`
}

// Copy copies every row of the Arkive tables from src into dst, which must be
// migrated to the same schema and empty (apart from the default settings the
// migrations insert). It preserves ids and timestamps, runs in one
// transaction on each side (the source is read from a consistent snapshot;
// the target is all-or-nothing) and rebuilds the full-text index on the
// target. progress, if non-nil, is called after each table.
func Copy(ctx context.Context, src, dst DB, progress func(CopyTableReport)) (CopyReport, error) {
	start := time.Now()
	rep := CopyReport{From: src.Dialect(), To: dst.Dialect()}

	srcCols, err := tableColumns(ctx, src)
	if err != nil {
		return rep, fmt.Errorf("inspect source: %w", err)
	}
	dstCols, err := tableColumns(ctx, dst)
	if err != nil {
		return rep, fmt.Errorf("inspect target: %w", err)
	}
	for _, side := range []struct {
		name string
		cols map[string][]column
	}{{"source", srcCols}, {"target", dstCols}} {
		if err := checkKnownTables(side.cols); err != nil {
			return rep, fmt.Errorf("%s: %w", side.name, err)
		}
	}
	for _, t := range CopyTables {
		if _, ok := srcCols[t]; !ok {
			return rep, fmt.Errorf("source has no table %q: run `arkive migrate` against it first", t)
		}
		if _, ok := dstCols[t]; !ok {
			return rep, fmt.Errorf("target has no table %q: is it migrated?", t)
		}
		dstHas := map[string]bool{}
		for _, c := range dstCols[t] {
			dstHas[c.name] = true
		}
		for _, c := range srcCols[t] {
			if !dstHas[c.name] && !engineColumns[t+"."+c.name] {
				return rep, fmt.Errorf("target table %s has no column %q: migrate the target to the same Arkive version as the source", t, c.name)
			}
		}
	}
	if err := checkTargetEmpty(ctx, dst); err != nil {
		return rep, err
	}

	stx, err := src.Begin(ctx)
	if err != nil {
		return rep, fmt.Errorf("source transaction: %w", err)
	}
	defer func() { _ = stx.Rollback(ctx) }()
	if src.Dialect() == Postgres {
		if _, err := stx.Exec(ctx, `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`); err != nil {
			return rep, err
		}
	}
	dtx, err := dst.Begin(ctx)
	if err != nil {
		return rep, fmt.Errorf("target transaction: %w", err)
	}
	defer func() { _ = dtx.Rollback(ctx) }()

	// Migrations seed default settings; the source's settings replace them.
	if _, err := dtx.Exec(ctx, `DELETE FROM instance_settings`); err != nil {
		return rep, err
	}
	for _, t := range CopyTables {
		srcHas := map[string]bool{}
		for _, c := range srcCols[t] {
			srcHas[c.name] = true
		}
		var cols []column
		for _, c := range dstCols[t] {
			if srcHas[c.name] {
				cols = append(cols, c)
			}
		}
		n, err := copyTable(ctx, stx, dtx, t, cols)
		if err != nil {
			return rep, fmt.Errorf("copy %s: %w", t, err)
		}
		var got int64
		if err := dtx.QueryRow(ctx, `SELECT COUNT(*) FROM `+quoteIdent(t)).Scan(&got); err != nil {
			return rep, err
		}
		if got != n {
			return rep, fmt.Errorf("copy %s: wrote %d rows but target has %d", t, n, got)
		}
		tr := CopyTableReport{Table: t, Rows: n}
		rep.Tables = append(rep.Tables, tr)
		rep.Rows += n
		if progress != nil {
			progress(tr)
		}
	}
	if err := RebuildSearchIndex(ctx, dtx); err != nil {
		return rep, fmt.Errorf("rebuild search index: %w", err)
	}
	if err := dtx.Commit(ctx); err != nil {
		return rep, fmt.Errorf("commit target: %w", err)
	}
	rep.Duration = time.Since(start)
	return rep, nil
}

// RebuildSearchIndex recomputes the full-text index for every node.
func RebuildSearchIndex(ctx context.Context, q Querier) error {
	var stmts []string
	switch q.Dialect() {
	case SQLite:
		stmts = []string{
			`INSERT INTO nodes_fts (nodes_fts) VALUES ('delete-all')`,
			`DELETE FROM nodes_search`,
			`INSERT INTO nodes_search (node_id) SELECT id FROM nodes`,
			`INSERT INTO nodes_fts (rowid, name, content_text)
			 SELECT s.rid, n.name, n.content_text FROM nodes n JOIN nodes_search s ON s.node_id = n.id`,
		}
	default:
		stmts = []string{`
			UPDATE nodes SET search_vector =
			    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
			    setweight(to_tsvector('english', coalesce(content_text, '')), 'B')`}
	}
	for _, s := range stmts {
		if _, err := q.Exec(ctx, s); err != nil {
			return err
		}
	}
	return nil
}

type column struct {
	name string
	kind string // uuid, time, json, bool, int, text
}

func tableColumns(ctx context.Context, q Querier) (map[string][]column, error) {
	out := map[string][]column{}
	var rows Rows
	var err error
	if q.Dialect() == SQLite {
		rows, err = q.Query(ctx, `
			SELECT m.name, p.name, p.type FROM sqlite_master m, pragma_table_info(m.name) p
			WHERE m.type = 'table' ORDER BY m.name, p.cid`)
	} else {
		rows, err = q.Query(ctx, `
			SELECT table_name, column_name, data_type FROM information_schema.columns
			WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var t, c, typ string
		if err := rows.Scan(&t, &c, &typ); err != nil {
			return nil, err
		}
		if engineTable(t) || engineColumns[t+"."+c] {
			continue
		}
		out[t] = append(out[t], column{name: c, kind: columnKind(typ)})
	}
	return out, rows.Err()
}

func columnKind(typ string) string {
	switch strings.ToLower(typ) {
	case "uuid":
		return "uuid"
	case "timestamp with time zone", "timestamp without time zone", "timestamptz", "timestamp":
		return "time"
	case "jsonb", "json":
		return "json"
	case "boolean":
		return "bool"
	case "bigint", "integer", "smallint":
		return "int"
	}
	// SQLite columns are TEXT / INTEGER: values are converted by Go type.
	return "any"
}

func checkKnownTables(cols map[string][]column) error {
	known := map[string]bool{}
	for _, t := range CopyTables {
		known[t] = true
	}
	var unknown []string
	for t := range cols {
		if !known[t] {
			unknown = append(unknown, t)
		}
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		return fmt.Errorf("unknown table(s) %s: add them to db.CopyTables", strings.Join(unknown, ", "))
	}
	return nil
}

func checkTargetEmpty(ctx context.Context, q Querier) error {
	for _, t := range CopyTables {
		if t == "instance_settings" {
			continue
		}
		var n int64
		if err := q.QueryRow(ctx, `SELECT COUNT(*) FROM `+quoteIdent(t)).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			return fmt.Errorf("target database is not empty (%s has %d rows): copy only into a new database", t, n)
		}
	}
	return nil
}

// copyBatchParams bounds the placeholders per INSERT (SQLite allows 32766,
// PostgreSQL 65535).
const copyBatchParams = 2000

func copyTable(ctx context.Context, src, dst Querier, table string, cols []column) (int64, error) {
	names := make([]string, len(cols))
	for i, c := range cols {
		names[i] = quoteIdent(c.name)
	}
	list := strings.Join(names, ", ")
	var query string
	if table == "nodes" {
		// Parents before children (nodes.parent_id references nodes.id).
		query = `WITH RECURSIVE tree (id, depth) AS (
			SELECT id, 0 FROM nodes WHERE parent_id IS NULL
			UNION ALL
			SELECT c.id, tree.depth + 1 FROM nodes c JOIN tree ON c.parent_id = tree.id
		)
		SELECT ` + prefixCols("nodes", names) + ` FROM nodes JOIN tree ON tree.id = nodes.id ORDER BY tree.depth`
	} else {
		query = `SELECT ` + list + ` FROM ` + quoteIdent(table)
	}
	rows, err := src.Query(ctx, query)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	perBatch := max(1, copyBatchParams/len(cols))
	batch := make([]any, 0, perBatch*len(cols))
	var total int64
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		n := len(batch) / len(cols)
		var b strings.Builder
		b.WriteString("INSERT INTO " + quoteIdent(table) + " (" + list + ") VALUES ")
		p := 1
		for r := 0; r < n; r++ {
			if r > 0 {
				b.WriteString(", ")
			}
			b.WriteByte('(')
			for c := range cols {
				if c > 0 {
					b.WriteString(", ")
				}
				b.WriteString("$" + strconv.Itoa(p))
				p++
			}
			b.WriteByte(')')
		}
		if _, err := dst.Exec(ctx, b.String(), batch...); err != nil {
			return err
		}
		total += int64(n)
		batch = batch[:0]
		return nil
	}
	for rows.Next() {
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return total, err
		}
		for i, c := range cols {
			v, err := normalizeValue(vals[i], c.kind, dst.Dialect())
			if err != nil {
				return total, fmt.Errorf("column %s: %w", c.name, err)
			}
			batch = append(batch, v)
		}
		if len(batch) >= perBatch*len(cols) {
			if err := flush(); err != nil {
				return total, err
			}
		}
	}
	if err := rows.Err(); err != nil {
		return total, err
	}
	return total, flush()
}

func prefixCols(table string, names []string) string {
	out := make([]string, len(names))
	for i, n := range names {
		out[i] = quoteIdent(table) + "." + n
	}
	return strings.Join(out, ", ")
}

func quoteIdent(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }

// normalizeValue converts a value read from either engine into what the
// target expects. kind comes from the target column type (PostgreSQL) or is
// "any" (SQLite, where the Go type decides).
func normalizeValue(v any, kind string, target Dialect) (any, error) {
	if v == nil {
		return nil, nil
	}
	// pgx returns uuid columns as [16]byte and jsonb decoded.
	switch x := v.(type) {
	case [16]byte:
		v = uuid.UUID(x)
	case uuid.UUID, time.Time, bool, int64, int32, int16, float64, string, []byte, json.RawMessage:
	default:
		rv := reflect.ValueOf(v)
		switch rv.Kind() {
		case reflect.Map, reflect.Slice, reflect.Array:
			b, err := json.Marshal(v)
			if err != nil {
				return nil, err
			}
			v = json.RawMessage(b)
		}
	}
	if target == SQLite {
		if b, ok := v.([]byte); ok {
			return string(b), nil
		}
		return v, nil
	}
	switch kind {
	case "uuid":
		switch x := v.(type) {
		case string:
			return uuid.Parse(x)
		case []byte:
			return uuid.ParseBytes(x)
		}
	case "time":
		switch x := v.(type) {
		case string:
			return ParseSQLiteTime(x)
		case []byte:
			return ParseSQLiteTime(string(x))
		}
	case "json":
		switch x := v.(type) {
		case string:
			return json.RawMessage(x), nil
		case []byte:
			return json.RawMessage(x), nil
		}
	case "bool":
		switch x := v.(type) {
		case int64:
			return x != 0, nil
		case string:
			return strconv.ParseBool(x)
		}
	case "int":
		if s, ok := v.(string); ok {
			return strconv.ParseInt(s, 10, 64)
		}
	case "any":
		if b, ok := v.([]byte); ok {
			return string(b), nil
		}
	}
	return v, nil
}

// Backup writes a consistent copy of a SQLite database to out using VACUUM
// INTO (safe while Arkive is running). PostgreSQL databases are backed up
// with pg_dump instead.
func Backup(ctx context.Context, d DB, out string) error {
	if d.Dialect() != SQLite {
		return errors.New("arkive db backup supports SQLite only; back up PostgreSQL with pg_dump (see docs/backup.md)")
	}
	if _, err := os.Stat(out); err == nil {
		return fmt.Errorf("%s already exists; choose a new file", out)
	}
	if _, err := d.Exec(ctx, `VACUUM INTO $1`, out); err != nil {
		return fmt.Errorf("vacuum into %s: %w", out, err)
	}
	return nil
}
