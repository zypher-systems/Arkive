// Package db is Arkive's database layer. It hides the difference between the
// two supported engines behind one small interface:
//
//   - PostgreSQL through pgx/pgxpool (larger installs, multiple replicas);
//   - SQLite through modernc.org/sqlite (pure Go, the single-container default).
//
// Application code writes PostgreSQL-flavoured SQL and runs it through DB /
// Tx. The SQLite implementation rewrites the few PostgreSQL-only spellings it
// can translate mechanically (see rewrite.go) and converts values at the
// boundary (UUIDs as TEXT, timestamps as fixed-width UTC TEXT). Anything that
// cannot be translated mechanically is an explicit `switch q.Dialect()` in the
// caller. The rules for portable SQL are in README.md next to this file.
package db

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"
)

// Dialect names the SQL engine behind a DB.
type Dialect string

const (
	Postgres Dialect = "postgres"
	SQLite   Dialect = "sqlite"
)

// ErrNoRows is returned by Row.Scan when the query matched nothing, for both
// engines. Compare with errors.Is.
var ErrNoRows = errors.New("no rows in result set")

// Row is the result of QueryRow.
type Row interface {
	Scan(dest ...any) error
}

// Rows is a result set from Query. Always Close it (defer rows.Close()) and
// check Err after the Next loop.
type Rows interface {
	Next() bool
	Scan(dest ...any) error
	Close()
	Err() error
}

// CommandTag reports the outcome of Exec.
type CommandTag struct{ rows int64 }

// RowsAffected is the number of rows inserted, updated or deleted.
func (c CommandTag) RowsAffected() int64 { return c.rows }

// Querier runs statements. DB and Tx both implement it, so helpers that may
// run inside or outside a transaction take a Querier.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) Row
	// Dialect lets callers branch where the engines truly differ.
	Dialect() Dialect
}

// Tx is a database transaction. Rollback after Commit is a harmless no-op, so
// `defer tx.Rollback(ctx)` is the normal pattern.
//
// On SQLite every transaction is BEGIN IMMEDIATE: it takes the single write
// lock up front, so transactions are serialized and never fail half-way with
// SQLITE_BUSY. Keep transactions short and never do network or blob I/O
// inside one.
type Tx interface {
	Querier
	Commit(ctx context.Context) error
	Rollback(ctx context.Context) error
}

// DB is a connection pool.
type DB interface {
	Querier
	Begin(ctx context.Context) (Tx, error)
	Ping(ctx context.Context) error
	Close()
}

// BeginFunc runs fn in a transaction: committed when fn returns nil, rolled
// back otherwise.
func BeginFunc(ctx context.Context, d DB, fn func(Tx) error) error {
	tx, err := d.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// IsUniqueViolation reports a unique / primary key constraint failure.
func IsUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	var sqErr *sqlite.Error
	if errors.As(err, &sqErr) {
		switch sqErr.Code() {
		case sqlite3.SQLITE_CONSTRAINT_UNIQUE, sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY:
			return true
		}
	}
	return false
}

// IsNoRows reports ErrNoRows (also accepts the drivers' own sentinels).
func IsNoRows(err error) bool {
	return errors.Is(err, ErrNoRows) || errors.Is(err, pgx.ErrNoRows)
}

// Target is a parsed ARKIVE_DATABASE_URL.
type Target struct {
	Dialect Dialect
	// DSN is the PostgreSQL connection string, or for SQLite the database
	// file path.
	DSN string
	// Params are extra query parameters given on a sqlite URL.
	Params url.Values
}

// ParseURL decides the engine from the URL scheme:
//
//	postgres://… / postgresql://…      PostgreSQL
//	sqlite:///abs/path.db              SQLite (three slashes: absolute path)
//	sqlite://relative/path.db          SQLite, path relative to the cwd
//	file:/abs/path.db, file:path.db    SQLite
//
// Anything else is handed to pgx unchanged (keyword/value DSNs keep working).
func ParseURL(raw string) (Target, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return Target{}, errors.New("database URL is empty")
	}
	lower := strings.ToLower(s)
	var rest string
	switch {
	case strings.HasPrefix(lower, "sqlite://"):
		rest = s[len("sqlite://"):]
	case strings.HasPrefix(lower, "sqlite:"):
		rest = s[len("sqlite:"):]
	case strings.HasPrefix(lower, "file://"):
		rest = s[len("file://"):]
	case strings.HasPrefix(lower, "file:"):
		rest = s[len("file:"):]
	default:
		return Target{Dialect: Postgres, DSN: s}, nil
	}
	path, query, _ := strings.Cut(rest, "?")
	params, err := url.ParseQuery(query)
	if err != nil {
		return Target{}, fmt.Errorf("parse sqlite url parameters: %w", err)
	}
	if unescaped, err := url.PathUnescape(path); err == nil {
		path = unescaped
	}
	if path == "" || path == ":memory:" {
		return Target{}, fmt.Errorf("sqlite url %q has no database file path", raw)
	}
	return Target{Dialect: SQLite, DSN: filepath.Clean(path), Params: params}, nil
}

// SQLiteURL is the canonical URL for a SQLite file.
func SQLiteURL(path string) string {
	if abs, err := filepath.Abs(path); err == nil {
		path = abs
	}
	return "sqlite://" + filepath.ToSlash(path)
}

// Redact hides a password in a database URL for logs.
func Redact(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.User == nil {
		return raw
	}
	if _, ok := u.User.Password(); ok {
		u.User = url.UserPassword(u.User.Username(), "xxxxx")
	}
	return u.String()
}

// Options tune Open.
type Options struct {
	// MustExist refuses to create a missing SQLite file (admin commands
	// should not silently create an empty database).
	MustExist bool
}

// Open connects to the database named by url and pings it.
func Open(ctx context.Context, rawURL string) (DB, error) {
	return OpenWith(ctx, rawURL, Options{})
}

// OpenWith is Open with options.
func OpenWith(ctx context.Context, rawURL string, opts Options) (DB, error) {
	t, err := ParseURL(rawURL)
	if err != nil {
		return nil, err
	}
	switch t.Dialect {
	case SQLite:
		return openSQLite(ctx, t, opts)
	default:
		return openPostgres(ctx, t.DSN)
	}
}
