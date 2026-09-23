package db

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"regexp"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRewriteForSQLite(t *testing.T) {
	cases := []struct{ in, want string }{
		{`SELECT id::text FROM t WHERE id = $1::uuid`, `SELECT id FROM t WHERE id = $1`},
		{`INSERT INTO t (c) VALUES ($1::jsonb)`, `INSERT INTO t (c) VALUES ($1)`},
		{`UPDATE t SET a = now() WHERE b < now() AND c = $2 AND d = $1`, `UPDATE t SET a = $3 WHERE b < $3 AND c = $2 AND d = $1`},
		{`SELECT 1 WHERE name ILIKE $1 ESCAPE '\'`, `SELECT 1 WHERE name LIKE $1 ESCAPE '\'`},
		{`SELECT a FROM t WHERE id = $1 FOR UPDATE`, `SELECT a FROM t WHERE id = $1  `},
		{"SELECT a FROM t c WHERE x FOR UPDATE OF c\n", "SELECT a FROM t c WHERE x  \n"},
		{`SELECT a FROM t ORDER BY b FOR UPDATE SKIP LOCKED LIMIT 1`, `SELECT a FROM t ORDER BY b   LIMIT 1`},
		{`SELECT 'now()', '::text', "for" FROM t -- now()`, `SELECT 'now()', '::text', "for" FROM t -- now()`},
		{`SELECT 'it''s ::x'`, `SELECT 'it''s ::x'`},
		{`SELECT NOW ( )`, `SELECT $1`},
		{`SELECT a FROM t ORDER BY a OFFSET $1`, `SELECT a FROM t ORDER BY a LIMIT -1 OFFSET $1`},
		{`SELECT a FROM t LIMIT $1 OFFSET $2`, `SELECT a FROM t LIMIT $1 OFFSET $2`},
		{`SELECT (SELECT 1 LIMIT 1) OFFSET 2`, `SELECT (SELECT 1 LIMIT 1) LIMIT -1 OFFSET 2`},
	}
	for _, c := range cases {
		if got := doRewrite(c.in).sql; got != c.want {
			t.Errorf("rewrite(%q)\n got %q\nwant %q", c.in, got, c.want)
		}
	}
}

func TestParseURL(t *testing.T) {
	cases := []struct {
		in      string
		dialect Dialect
		dsn     string
	}{
		{"postgres://u:p@h/db?sslmode=disable", Postgres, "postgres://u:p@h/db?sslmode=disable"},
		{"postgresql://h/db", Postgres, "postgresql://h/db"},
		{"host=localhost dbname=x", Postgres, "host=localhost dbname=x"},
		{"sqlite:///data/arkive/arkive.db", SQLite, "/data/arkive/arkive.db"},
		{"sqlite://rel/a.db", SQLite, "rel/a.db"},
		{"file:/tmp/a.db", SQLite, "/tmp/a.db"},
		{"file:///tmp/a.db?_foo=1", SQLite, "/tmp/a.db"},
	}
	for _, c := range cases {
		got, err := ParseURL(c.in)
		if err != nil {
			t.Fatalf("%s: %v", c.in, err)
		}
		if got.Dialect != c.dialect || got.DSN != c.dsn {
			t.Errorf("%s: got %s %q", c.in, got.Dialect, got.DSN)
		}
	}
	if _, err := ParseURL(""); err == nil {
		t.Error("empty url accepted")
	}
	if _, err := ParseURL("sqlite://"); err == nil {
		t.Error("sqlite url without path accepted")
	}
}

func openTestSQLite(t *testing.T) DB {
	t.Helper()
	url := SQLiteURL(filepath.Join(t.TempDir(), "arkive.db"))
	if err := Migrate(url, ""); err != nil {
		t.Fatal(err)
	}
	d, err := Open(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(d.Close)
	return d
}

var uuidRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestSQLiteValueRoundTrip(t *testing.T) {
	d := openTestSQLite(t)
	ctx := context.Background()

	var id uuid.UUID
	var created time.Time
	var admin bool
	if err := d.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name) VALUES ($1, NULL, $2)
		RETURNING id, created_at, is_instance_admin
	`, "a@b.c", "A").Scan(&id, &created, &admin); err != nil {
		t.Fatal(err)
	}
	if !uuidRe.MatchString(id.String()) {
		t.Fatalf("default id not a v4 uuid: %s", id)
	}
	if time.Since(created) > time.Minute || time.Since(created) < -time.Minute {
		t.Fatalf("default created_at off: %v", created)
	}
	var raw string
	if err := d.QueryRow(ctx, `SELECT created_at FROM users WHERE id = $1`, id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if len(raw) != len(SQLiteTimeFormat) {
		t.Fatalf("stored timestamp %q not in fixed-width format", raw)
	}

	// Go-supplied timestamps, nullable pointers and now().
	when := time.Date(2030, 1, 2, 3, 4, 5, 123456789, time.FixedZone("x", 3600))
	if _, err := d.Exec(ctx, `UPDATE users SET totp_enabled_at = $1, quota_bytes = $2 WHERE id = $3`, when, int64(42), id); err != nil {
		t.Fatal(err)
	}
	var enabled *time.Time
	var quota *int64
	var hash *string
	if err := d.QueryRow(ctx, `SELECT totp_enabled_at, quota_bytes, password_hash FROM users WHERE id = $1`, id).Scan(&enabled, &quota, &hash); err != nil {
		t.Fatal(err)
	}
	if enabled == nil || !enabled.Equal(when.Truncate(time.Microsecond)) {
		t.Fatalf("timestamp round trip: got %v want %v", enabled, when)
	}
	if quota == nil || *quota != 42 || hash != nil {
		t.Fatalf("nullable scan: quota=%v hash=%v", quota, hash)
	}
	var future bool
	if err := d.QueryRow(ctx, `SELECT totp_enabled_at > now() FROM users WHERE id = $1`, id).Scan(&future); err != nil {
		t.Fatal(err)
	}
	if !future {
		t.Fatal("2030 should compare after now()")
	}

	// JSON in and out.
	cfg, _ := json.Marshal(map[string]string{"mount_path": "/x"})
	var bid uuid.UUID
	if err := d.QueryRow(ctx, `INSERT INTO storage_backends (name, type, config) VALUES ('b', 'local', $1::jsonb) RETURNING id`, cfg).Scan(&bid); err != nil {
		t.Fatal(err)
	}
	var m map[string]string
	var rawCfg []byte
	var rm json.RawMessage
	if err := d.QueryRow(ctx, `SELECT config, config, config FROM storage_backends WHERE id = $1 AND config->>'mount_path' = '/x'`, bid).Scan(&m, &rawCfg, &rm); err != nil {
		t.Fatal(err)
	}
	if m["mount_path"] != "/x" || string(rawCfg) != string(cfg) || string(rm) != string(cfg) {
		t.Fatalf("json scan: %v %s %s", m, rawCfg, rm)
	}

	// ErrNoRows and unique violations.
	err := d.QueryRow(ctx, `SELECT id FROM users WHERE email = 'none'`).Scan(&id)
	if !errors.Is(err, ErrNoRows) {
		t.Fatalf("want ErrNoRows, got %v", err)
	}
	_, err = d.Exec(ctx, `INSERT INTO users (email, display_name) VALUES ('a@b.c', 'dup')`)
	if !IsUniqueViolation(err) {
		t.Fatalf("want unique violation, got %v", err)
	}
}

func TestSQLiteSearchIndexFollowsNodes(t *testing.T) {
	d := openTestSQLite(t)
	ctx := context.Background()
	var ws, parent, child uuid.UUID
	if err := d.QueryRow(ctx, `INSERT INTO workspaces (type, name) VALUES ('team', 't') RETURNING id`).Scan(&ws); err != nil {
		t.Fatal(err)
	}
	if err := d.QueryRow(ctx, `INSERT INTO nodes (workspace_id, name, kind) VALUES ($1, 'Holiday Photos', 'folder') RETURNING id`, ws).Scan(&parent); err != nil {
		t.Fatal(err)
	}
	if err := d.QueryRow(ctx, `INSERT INTO nodes (workspace_id, parent_id, name, kind) VALUES ($1, $2, 'notes.txt', 'file') RETURNING id`, ws, parent).Scan(&child); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(ctx, `UPDATE nodes SET content_text = 'the quarterly budgets are attached' WHERE id = $1`, child); err != nil {
		t.Fatal(err)
	}
	match := func(q string) []uuid.UUID {
		t.Helper()
		rows, err := d.Query(ctx, `
			SELECT s.node_id FROM nodes_fts f JOIN nodes_search s ON s.rid = f.rowid
			WHERE nodes_fts MATCH $1 ORDER BY s.node_id`, q)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []uuid.UUID
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				t.Fatal(err)
			}
			out = append(out, id)
		}
		return out
	}
	if got := match(`"budget"`); len(got) != 1 || got[0] != child {
		t.Fatalf("stemmed content match: %v", got)
	}
	if got := match(`"photo"`); len(got) != 1 || got[0] != parent {
		t.Fatalf("name match: %v", got)
	}
	if _, err := d.Exec(ctx, `UPDATE nodes SET name = 'Trips' WHERE id = $1`, parent); err != nil {
		t.Fatal(err)
	}
	if got := match(`"photo"`); len(got) != 0 {
		t.Fatalf("rename not reindexed: %v", got)
	}
	// Cascading deletes (workspace -> nodes -> children) clean the index.
	if _, err := d.Exec(ctx, `DELETE FROM workspaces WHERE id = $1`, ws); err != nil {
		t.Fatal(err)
	}
	if got := match(`"budget"`); len(got) != 0 {
		t.Fatalf("cascade delete left index rows: %v", got)
	}
	var n int
	if err := d.QueryRow(ctx, `SELECT COUNT(*) FROM nodes_search`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("nodes_search rows left: %d", n)
	}
}

func TestSQLiteTxNowIsStable(t *testing.T) {
	d := openTestSQLite(t)
	ctx := context.Background()
	err := BeginFunc(ctx, d, func(tx Tx) error {
		var a, b time.Time
		if err := tx.QueryRow(ctx, `SELECT now()`).Scan(&a); err != nil {
			return err
		}
		time.Sleep(2 * time.Millisecond)
		if err := tx.QueryRow(ctx, `SELECT now()`).Scan(&b); err != nil {
			return err
		}
		if !a.Equal(b) {
			t.Errorf("now() changed inside a transaction: %v vs %v", a, b)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
