package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/db"
)

// ErrDataDirHasBlobs is returned by CheckDataDir; the error text explains
// what to do.
var ErrDataDirHasBlobs = errors.New("data directory already holds Arkive files but the database is empty")

// DatabaseIsEmpty reports a database that was never set up: no accounts and
// no files.
func DatabaseIsEmpty(ctx context.Context, q db.Querier) (bool, error) {
	var used bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users) OR EXISTS (SELECT 1 FROM nodes)`).Scan(&used)
	return !used, err
}

// CountBlobDirs counts Arkive blob folders directly in dir: workspace folders
// named by UUID, and the UUID folders under thumbs/.
func CountBlobDirs(dir string) int {
	n := 0
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		switch {
		case isUUID(e.Name()):
			n++
		case e.Name() == "thumbs":
			sub, _ := os.ReadDir(filepath.Join(dir, "thumbs"))
			for _, s := range sub {
				if s.IsDir() && isUUID(s.Name()) {
					n++
				}
			}
		}
	}
	return n
}

// CheckDataDir refuses to run on an empty database while the local data
// directory already contains blobs from an existing installation.
//
// This protects 1.0 installs upgraded with the new single-container compose
// file: ARKIVE_DATABASE_URL then defaults to a new SQLite database, the old
// PostgreSQL data is not visible, and the orphan GC would eventually delete
// every file. ARKIVE_ALLOW_NONEMPTY_DATA_DIR=true skips the check.
func CheckDataDir(ctx context.Context, q db.Querier, cfg config.Config) error {
	if cfg.AllowNonEmptyDataDir || strings.TrimSpace(cfg.DataDir) == "" {
		return nil
	}
	empty, err := DatabaseIsEmpty(ctx, q)
	if err != nil {
		return fmt.Errorf("inspect database: %w", err)
	}
	if !empty {
		return nil
	}
	blobs := CountBlobDirs(cfg.DataDir)
	if blobs == 0 {
		return nil
	}
	target := cfg.DatabaseURL
	if cfg.DatabaseURLDefaulted {
		target = config.DefaultSQLiteURL(cfg.DataDir)
	}
	return fmt.Errorf(`%w.

  The database (%s) has no accounts and no files, but %s
  already contains %d Arkive blob folder(s) from an existing installation.
  Starting would treat those files as orphans, and the cleanup job would
  eventually delete them. Arkive refuses to start.

  - Upgrading from Arkive 1.0 with PostgreSQL? Keep using that database:
    start with docker-compose.postgres.yml, or set
      ARKIVE_DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/arkive?sslmode=disable
  - Want to move to SQLite instead? Copy the PostgreSQL data first:
      arkive db copy --from postgres://USER:PASSWORD@HOST:5432/arkive --to %s
  - The files are not from this Arkive (or you know what you are doing)?
    Set ARKIVE_ALLOW_NONEMPTY_DATA_DIR=true.`,
		ErrDataDirHasBlobs, db.Redact(cfg.DatabaseURL), cfg.DataDir, blobs, target)
}
