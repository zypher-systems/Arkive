package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite" // registers the "sqlite" database/sql driver
)

// SQLiteTimeFormat is how timestamps are stored in SQLite: UTC, fixed width,
// microsecond precision, so TEXT comparison and ORDER BY are chronological.
// Schema defaults produce the same shape:
//
//	strftime('%Y-%m-%d %H:%M:%f000', 'now')   -- milliseconds, padded
const SQLiteTimeFormat = "2006-01-02 15:04:05.000000"

// sqliteMaxOpenConns bounds concurrent SQLite connections. WAL lets readers
// run in parallel with the single writer; writers queue on the write lock
// (BEGIN IMMEDIATE + busy_timeout) instead of failing with SQLITE_BUSY.
const sqliteMaxOpenConns = 8

// sqliteBusyTimeout is how long a writer waits for the write lock.
const sqliteBusyTimeout = 10 * time.Second

type sqliteDB struct {
	db   *sql.DB
	path string
}

// sqliteDSN builds the modernc DSN with Arkive's connection pragmas. Every
// pooled connection runs them when it is opened.
func sqliteDSN(t Target) string {
	q := url.Values{}
	for k, v := range t.Params {
		q[k] = append([]string(nil), v...)
	}
	q.Add("_pragma", fmt.Sprintf("busy_timeout(%d)", sqliteBusyTimeout.Milliseconds()))
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "synchronous(NORMAL)")
	q.Add("_pragma", "foreign_keys(ON)")
	if q.Get("_txlock") == "" {
		q.Set("_txlock", "immediate")
	}
	return t.DSN + "?" + q.Encode()
}

func openSQLiteSQL(t Target, opts Options) (*sql.DB, error) {
	if _, err := os.Stat(t.DSN); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("sqlite database %s: %w", t.DSN, err)
		}
		if opts.MustExist {
			return nil, fmt.Errorf("sqlite database %s does not exist (start the server or run `arkive migrate` once to create it)", t.DSN)
		}
		if dir := filepath.Dir(t.DSN); dir != "" {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, fmt.Errorf("create sqlite directory: %w", err)
			}
		}
	}
	sdb, err := sql.Open("sqlite", sqliteDSN(t))
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	sdb.SetMaxOpenConns(sqliteMaxOpenConns)
	sdb.SetMaxIdleConns(sqliteMaxOpenConns)
	sdb.SetConnMaxIdleTime(10 * time.Minute)
	return sdb, nil
}

func openSQLite(ctx context.Context, t Target, opts Options) (DB, error) {
	sdb, err := openSQLiteSQL(t, opts)
	if err != nil {
		return nil, err
	}
	if err := sdb.PingContext(ctx); err != nil {
		sdb.Close()
		return nil, fmt.Errorf("open sqlite %s: %w", t.DSN, err)
	}
	return &sqliteDB{db: sdb, path: t.DSN}, nil
}

// SQLitePath returns the database file of a SQLite DB ("" for PostgreSQL).
func SQLitePath(d DB) string {
	if s, ok := d.(*sqliteDB); ok {
		return s.path
	}
	return ""
}

func (s *sqliteDB) Dialect() Dialect               { return SQLite }
func (s *sqliteDB) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }
func (s *sqliteDB) Close()                         { _ = s.db.Close() }

func (s *sqliteDB) Exec(ctx context.Context, q string, args ...any) (CommandTag, error) {
	return sqliteExec(ctx, s.db, nowUTC(), q, args)
}

func (s *sqliteDB) Query(ctx context.Context, q string, args ...any) (Rows, error) {
	return sqliteQuery(ctx, s.db, nowUTC(), q, args)
}

func (s *sqliteDB) QueryRow(ctx context.Context, q string, args ...any) Row {
	return sqliteQueryRow(ctx, s.db, nowUTC(), q, args)
}

func (s *sqliteDB) Begin(ctx context.Context) (Tx, error) {
	// Like pgx, the transaction is not bound to ctx: only the statements
	// are. database/sql would otherwise roll back when a request ends.
	tx, err := s.db.BeginTx(context.WithoutCancel(ctx), nil)
	if err != nil {
		return nil, err
	}
	// now() is the transaction start time, as in PostgreSQL.
	return &sqliteTx{tx: tx, now: nowUTC()}, nil
}

type sqliteTx struct {
	tx  *sql.Tx
	now time.Time
}

func (t *sqliteTx) Dialect() Dialect { return SQLite }

func (t *sqliteTx) Exec(ctx context.Context, q string, args ...any) (CommandTag, error) {
	return sqliteExec(ctx, t.tx, t.now, q, args)
}

func (t *sqliteTx) Query(ctx context.Context, q string, args ...any) (Rows, error) {
	return sqliteQuery(ctx, t.tx, t.now, q, args)
}

func (t *sqliteTx) QueryRow(ctx context.Context, q string, args ...any) Row {
	return sqliteQueryRow(ctx, t.tx, t.now, q, args)
}

func (t *sqliteTx) Commit(context.Context) error { return t.tx.Commit() }

func (t *sqliteTx) Rollback(context.Context) error {
	err := t.tx.Rollback()
	if errors.Is(err, sql.ErrTxDone) {
		return nil
	}
	return err
}

type sqlRunner interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func prepare(now time.Time, q string, args []any) (string, []any) {
	r := rewriteForSQLite(q)
	n := len(args)
	if r.nowParam > n {
		n = r.nowParam
	}
	out := make([]any, n)
	for i, a := range args {
		out[i] = sqliteArg(a)
	}
	if r.nowParam > 0 {
		for i := len(args); i < r.nowParam-1; i++ {
			out[i] = nil
		}
		out[r.nowParam-1] = now.Format(SQLiteTimeFormat)
	}
	return r.sql, out
}

func sqliteExec(ctx context.Context, r sqlRunner, now time.Time, q string, args []any) (CommandTag, error) {
	q, a := prepare(now, q, args)
	res, err := r.ExecContext(ctx, q, a...)
	if err != nil {
		return CommandTag{}, err
	}
	n, _ := res.RowsAffected()
	return CommandTag{rows: n}, nil
}

func sqliteQuery(ctx context.Context, r sqlRunner, now time.Time, q string, args []any) (Rows, error) {
	q, a := prepare(now, q, args)
	rows, err := r.QueryContext(ctx, q, a...)
	if err != nil {
		return nil, err
	}
	return &sqliteRows{rows: rows}, nil
}

func sqliteQueryRow(ctx context.Context, r sqlRunner, now time.Time, q string, args []any) Row {
	q, a := prepare(now, q, args)
	return sqliteRow{row: r.QueryRowContext(ctx, q, a...)}
}

type sqliteRow struct{ row *sql.Row }

func (r sqliteRow) Scan(dest ...any) error {
	err := r.row.Scan(wrapDests(dest)...)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNoRows
	}
	return err
}

type sqliteRows struct{ rows *sql.Rows }

func (r *sqliteRows) Next() bool             { return r.rows.Next() }
func (r *sqliteRows) Scan(dest ...any) error { return r.rows.Scan(wrapDests(dest)...) }
func (r *sqliteRows) Close()                 { _ = r.rows.Close() }
func (r *sqliteRows) Err() error             { return r.rows.Err() }

var (
	clockMu   sync.Mutex
	lastClock time.Time
)

// nowUTC is a strictly increasing microsecond clock, so rows written in quick
// succession still sort in write order.
func nowUTC() time.Time {
	clockMu.Lock()
	defer clockMu.Unlock()
	t := time.Now().UTC().Truncate(time.Microsecond)
	if !t.After(lastClock) {
		t = lastClock.Add(time.Microsecond)
	}
	lastClock = t
	return t
}
