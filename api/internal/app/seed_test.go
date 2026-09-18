package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/db"
)

func TestSeedDefaultBackendLocal(t *testing.T) {
	dsn := os.Getenv("ARKIVE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ARKIVE_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	cfg := config.Load()
	cfg.DatabaseURL = dsn
	cfg.S3Endpoint = ""
	cfg.DataDir = t.TempDir()
	cfg.MigrationsDir = filepath.Join("..", "..", "migrations")
	if err := db.Migrate(cfg.DatabaseURL, cfg.MigrationsDir); err != nil {
		t.Fatal(err)
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	var defaults int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM storage_backends WHERE is_default = TRUE`).Scan(&defaults); err != nil {
		t.Fatal(err)
	}
	if defaults > 0 {
		t.Skip("database already has a default backend")
	}

	a := &App{DB: pool, Cfg: cfg}
	if err := a.SeedDefaultBackend(ctx); err != nil {
		t.Fatal(err)
	}
	var typ, name string
	if err := pool.QueryRow(ctx, `SELECT type, name FROM storage_backends WHERE is_default = TRUE`).Scan(&typ, &name); err != nil {
		t.Fatal(err)
	}
	if typ != "local" || name != "Default local" {
		t.Fatalf("got type=%s name=%s", typ, name)
	}
	if err := a.SeedDefaultBackend(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM storage_backends WHERE is_default = TRUE`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("expected one default, got %d", n)
	}
}

func TestSeedDefaultBackendS3WhenEndpointSet(t *testing.T) {
	dsn := os.Getenv("ARKIVE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ARKIVE_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	cfg := config.Load()
	cfg.DatabaseURL = dsn
	cfg.S3Endpoint = "s3.example.invalid:9000"
	cfg.S3AccessKey = "key"
	cfg.S3SecretKey = "secret"
	cfg.S3Bucket = "arkive"
	cfg.MigrationsDir = filepath.Join("..", "..", "migrations")
	if err := db.Migrate(cfg.DatabaseURL, cfg.MigrationsDir); err != nil {
		t.Fatal(err)
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	var defaults int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM storage_backends WHERE is_default = TRUE`).Scan(&defaults); err != nil {
		t.Fatal(err)
	}
	if defaults > 0 {
		t.Skip("database already has a default backend")
	}

	a := &App{DB: pool, Cfg: cfg}
	if err := a.SeedDefaultBackend(ctx); err != nil {
		t.Fatal(err)
	}
	var typ string
	if err := pool.QueryRow(ctx, `
		SELECT type FROM storage_backends WHERE is_default = TRUE ORDER BY created_at DESC LIMIT 1
	`).Scan(&typ); err != nil {
		t.Fatal(err)
	}
	if typ != "s3" {
		t.Fatalf("expected s3 default, got %s", typ)
	}
}
