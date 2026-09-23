package db

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"os"
	"strings"

	"github.com/arkive/arkive/migrations"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

// migrateLockKey serializes goose across API replicas and parallel test packages.
const migrateLockKey int64 = 872364011

// MigrationsFS returns the PostgreSQL migration source: the directory when one
// is given (ARKIVE_MIGRATIONS_DIR), otherwise the migrations embedded in the
// binary. The SQLite set lives in its "sqlite" subdirectory.
func MigrationsFS(migrationsDir string) fs.FS {
	if strings.TrimSpace(migrationsDir) != "" {
		return os.DirFS(migrationsDir)
	}
	return migrations.FS
}

// DialectMigrationsFS returns the migration set for dialect.
func DialectMigrationsFS(d Dialect, migrationsDir string) (fs.FS, error) {
	base := MigrationsFS(migrationsDir)
	if d == SQLite {
		return fs.Sub(base, "sqlite")
	}
	return base, nil
}

// Migrate applies all pending migrations for the database named by url. An
// empty migrationsDir uses the embedded set.
func Migrate(databaseURL, migrationsDir string) error {
	t, err := ParseURL(databaseURL)
	if err != nil {
		return err
	}
	fsys, err := DialectMigrationsFS(t.Dialect, migrationsDir)
	if err != nil {
		return fmt.Errorf("migrate setup: %w", err)
	}
	if t.Dialect == SQLite {
		sdb, err := openSQLiteSQL(t, Options{})
		if err != nil {
			return err
		}
		defer sdb.Close()
		// One connection: goose's version bookkeeping and the migration
		// statements then share a connection, and SQLite's file lock
		// serializes concurrent migrators.
		sdb.SetMaxOpenConns(1)
		return runGoose(goose.DialectSQLite3, sdb, fsys)
	}

	sdb, err := sql.Open("pgx", t.DSN)
	if err != nil {
		return fmt.Errorf("open db for migrate: %w", err)
	}
	defer sdb.Close()
	sdb.SetMaxOpenConns(1)

	if _, err := sdb.Exec(`SELECT pg_advisory_lock($1)`, migrateLockKey); err != nil {
		return fmt.Errorf("migrate lock: %w", err)
	}
	defer func() { _, _ = sdb.Exec(`SELECT pg_advisory_unlock($1)`, migrateLockKey) }()
	return runGoose(goose.DialectPostgres, sdb, fsys)
}

func runGoose(dialect goose.Dialect, sdb *sql.DB, fsys fs.FS) error {
	// The Provider API avoids goose's package-level globals (SetBaseFS /
	// SetDialect), so concurrent callers in one process cannot clash.
	provider, err := goose.NewProvider(dialect, sdb, fsys)
	if err != nil {
		return fmt.Errorf("migrate setup: %w", err)
	}
	if _, err := provider.Up(context.Background()); err != nil {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}
