// Package dbtest gives tests a database with zero setup.
//
// By default every call returns a brand-new SQLite file in the test's temp
// directory. With ARKIVE_TEST_DATABASE_URL set (a PostgreSQL URL), tests run
// against that shared PostgreSQL database instead; FreshURL then creates (and
// drops) a separate empty database on the same server.
package dbtest

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/arkive/arkive/internal/db"
	"github.com/jackc/pgx/v5"
)

// EnvURL is the environment variable selecting PostgreSQL for tests.
const EnvURL = "ARKIVE_TEST_DATABASE_URL"

// Postgres reports whether tests run against PostgreSQL.
func Postgres() bool { return strings.TrimSpace(os.Getenv(EnvURL)) != "" }

// Dialect is the engine tests run against.
func Dialect() db.Dialect {
	if Postgres() {
		return db.Postgres
	}
	return db.SQLite
}

// URL returns a database URL for one test: the shared PostgreSQL database, or
// a fresh SQLite file. Callers must not assume the database is empty.
func URL(t testing.TB) string {
	t.Helper()
	if Postgres() {
		return strings.TrimSpace(os.Getenv(EnvURL))
	}
	return db.SQLiteURL(filepath.Join(t.TempDir(), "arkive.db"))
}

var freshSeq atomic.Int64

// FreshURL returns an empty, unmigrated database that is removed when the
// test ends.
func FreshURL(t testing.TB) string {
	t.Helper()
	if !Postgres() {
		return URL(t)
	}
	dsn := strings.TrimSpace(os.Getenv(EnvURL))
	ctx := context.Background()
	name := fmt.Sprintf("arkive_t_%d_%d", time.Now().UnixNano(), freshSeq.Add(1))
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		admin.Close(ctx)
		t.Fatal(err)
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	t.Cleanup(func() {
		_, _ = admin.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
		admin.Close(context.Background())
	})
	return u.String()
}

// Open migrates the database at url (migrationsDir "" = embedded) and opens
// it, closing it when the test ends.
func Open(t testing.TB, rawURL, migrationsDir string) db.DB {
	t.Helper()
	if err := db.Migrate(rawURL, migrationsDir); err != nil {
		t.Fatal(err)
	}
	d, err := db.Open(context.Background(), rawURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(d.Close)
	return d
}

// LockShared serializes tests that change global state (instance settings)
// in the shared PostgreSQL database, across packages, until the test ends.
// SQLite tests each have their own database, so it is a no-op there.
func LockShared(t testing.TB, key int64) {
	t.Helper()
	if !Postgres() {
		return
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, strings.TrimSpace(os.Getenv(EnvURL)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, key); err != nil {
		conn.Close(ctx)
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, key)
		conn.Close(context.Background())
	})
}
