package main

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/arkive/arkive/internal/db"
)

func TestDBCopyAndBackupSQLite(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	src := db.SQLiteURL(filepath.Join(dir, "src.db"))
	if err := db.Migrate(src, ""); err != nil {
		t.Fatal(err)
	}
	s, err := db.Open(ctx, src)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.Exec(ctx, `INSERT INTO users (email, password_hash, display_name, status) VALUES ('a@test.local', 'x', 'A', 'active')`); err != nil {
		t.Fatal(err)
	}

	if _, err := dbCopy(ctx, src, "sqlite://"+filepath.Join(dir, ".", "src.db"), "", nil); err == nil || !strings.Contains(err.Error(), "same database") {
		t.Fatalf("copy onto itself: %v", err)
	}
	if _, err := dbCopy(ctx, db.SQLiteURL(filepath.Join(dir, "missing.db")), db.SQLiteURL(filepath.Join(dir, "x.db")), "", nil); err == nil {
		t.Fatal("copy from a missing SQLite file should fail")
	}

	dst := db.SQLiteURL(filepath.Join(dir, "dst.db"))
	rep, err := dbCopy(ctx, src, dst, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Rows < 1 {
		t.Fatalf("copied %d rows", rep.Rows)
	}

	out := filepath.Join(dir, "backup.db")
	if err := db.Backup(ctx, s, out); err != nil {
		t.Fatal(err)
	}
	if err := db.Backup(ctx, s, out); err == nil {
		t.Fatal("backup over an existing file should fail")
	}
	b, err := db.OpenWith(ctx, db.SQLiteURL(out), db.Options{MustExist: true})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	var email string
	if err := b.QueryRow(ctx, `SELECT email FROM users`).Scan(&email); err != nil || email != "a@test.local" {
		t.Fatalf("backup content: %q %v", email, err)
	}
}
