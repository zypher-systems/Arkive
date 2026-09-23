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

// MigrationsFS returns the migration source: the directory when one is given
// (ARKIVE_MIGRATIONS_DIR), otherwise the migrations embedded in the binary.
func MigrationsFS(migrationsDir string) fs.FS {
	if strings.TrimSpace(migrationsDir) != "" {
		return os.DirFS(migrationsDir)
	}
	return migrations.FS
}

// Migrate applies all pending migrations. An empty migrationsDir uses the
// embedded set.
func Migrate(databaseURL, migrationsDir string) error {
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return fmt.Errorf("open db for migrate: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(`SELECT pg_advisory_lock($1)`, migrateLockKey); err != nil {
		return fmt.Errorf("migrate lock: %w", err)
	}
	defer func() { _, _ = db.Exec(`SELECT pg_advisory_unlock($1)`, migrateLockKey) }()

	// The Provider API avoids goose's package-level globals (SetBaseFS /
	// SetDialect), so concurrent callers in one process cannot clash.
	provider, err := goose.NewProvider(goose.DialectPostgres, db, MigrationsFS(migrationsDir))
	if err != nil {
		return fmt.Errorf("migrate setup: %w", err)
	}
	if _, err := provider.Up(context.Background()); err != nil {
		return fmt.Errorf("migrate up: %w", err)
	}
	return nil
}
