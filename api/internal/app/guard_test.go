package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/db/dbtest"
	"github.com/google/uuid"
)

func TestCheckDataDirRefusesEmptyDatabaseOverExistingBlobs(t *testing.T) {
	ctx := context.Background()
	pool := dbtest.Open(t, dbtest.FreshURL(t), filepath.Join("..", "..", "migrations"))
	dataDir := t.TempDir()
	cfg := config.Config{DataDir: dataDir, DatabaseURL: "sqlite://" + filepath.Join(dataDir, "arkive.db"), DatabaseURLDefaulted: true}

	// Arkive's own bookkeeping files are not blobs.
	for _, d := range []string{".uploads", "not-a-uuid"} {
		if err := os.MkdirAll(filepath.Join(dataDir, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(dataDir, "arkive.db"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := CheckDataDir(ctx, pool, cfg); err != nil {
		t.Fatalf("clean data dir refused: %v", err)
	}

	// A 1.0 blob folder: <workspace uuid>/<blob uuid>.
	ws := uuid.NewString()
	if err := os.MkdirAll(filepath.Join(dataDir, ws), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, ws, uuid.NewString()), []byte("precious"), 0o644); err != nil {
		t.Fatal(err)
	}
	err := CheckDataDir(ctx, pool, cfg)
	if !errors.Is(err, ErrDataDirHasBlobs) {
		t.Fatalf("want ErrDataDirHasBlobs, got %v", err)
	}
	for _, hint := range []string{"docker-compose.postgres.yml", "ARKIVE_DATABASE_URL", "arkive db copy", "ARKIVE_ALLOW_NONEMPTY_DATA_DIR"} {
		if !strings.Contains(err.Error(), hint) {
			t.Errorf("message lacks %q:\n%v", hint, err)
		}
	}

	// Explicit override.
	allowed := cfg
	allowed.AllowNonEmptyDataDir = true
	if err := CheckDataDir(ctx, pool, allowed); err != nil {
		t.Fatalf("override ignored: %v", err)
	}

	// Once the database is in use, blobs are expected.
	if _, err := pool.Exec(ctx, `INSERT INTO users (email, password_hash, display_name, status) VALUES ('x@test.local', 'x', 'X', 'active')`); err != nil {
		t.Fatal(err)
	}
	if err := CheckDataDir(ctx, pool, cfg); err != nil {
		t.Fatalf("non-empty database refused: %v", err)
	}
}

func TestCountBlobDirsCountsThumbs(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "thumbs", uuid.NewString()), 0o755); err != nil {
		t.Fatal(err)
	}
	if n := CountBlobDirs(dir); n != 1 {
		t.Fatalf("CountBlobDirs=%d want 1", n)
	}
}

func TestGarbageCollectRefusesWhenDatabaseHasNoFiles(t *testing.T) {
	f := newMaintFixtureOn(t, dbtest.FreshURL(t))
	ctx := context.Background()
	var blobs []string
	for i := 0; i < 3; i++ {
		blobs = append(blobs, f.putBlob(t, StorageKey(f.ws, uuid.New()), "user data", 48*time.Hour))
	}

	rep, err := f.app.GarbageCollect(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Refused == "" || rep.Deleted != 0 {
		t.Fatalf("GC on an empty database must refuse: %+v", rep)
	}
	if b := findBackend(rep, f.backend); b == nil || !strings.HasPrefix(b.Skipped, "refused") {
		t.Fatalf("backend not marked refused: %+v", b)
	}
	for _, p := range blobs {
		if !exists(p) {
			t.Fatalf("GC deleted %s from an empty database", p)
		}
	}

	rep, err = f.app.GarbageCollectWith(ctx, GCOptions{Force: true})
	if err != nil {
		t.Fatal(err)
	}
	if rep.Refused != "" || rep.Deleted != len(blobs) {
		t.Fatalf("forced GC: %+v", rep)
	}
}

func TestGarbageCollectCapsOrphansPerRun(t *testing.T) {
	f := newMaintFixtureOn(t, dbtest.FreshURL(t))
	ctx := context.Background()
	f.store(t, nil, "real.txt", "keep me")

	n := GCMinOrphanCap + 5
	var blobs []string
	for i := 0; i < n; i++ {
		blobs = append(blobs, f.putBlob(t, StorageKey(f.ws, uuid.New()), "x", 48*time.Hour))
	}
	rep, err := f.app.GarbageCollect(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	b := findBackend(rep, f.backend)
	if b == nil || !strings.HasPrefix(b.Skipped, "refused") || b.Deleted != 0 || b.Orphans != n {
		t.Fatalf("mass deletion not refused: %+v", b)
	}
	for _, p := range blobs {
		if !exists(p) {
			t.Fatalf("capped GC deleted %s", p)
		}
	}

	rep, err = f.app.GarbageCollectWith(ctx, GCOptions{Force: true})
	if err != nil {
		t.Fatal(err)
	}
	if b := findBackend(rep, f.backend); b == nil || b.Deleted != n {
		t.Fatalf("forced GC: %+v", b)
	}
	var live int
	if err := f.app.DB.QueryRow(ctx, `SELECT COUNT(*) FROM nodes WHERE workspace_id = $1`, f.ws).Scan(&live); err != nil || live != 1 {
		t.Fatalf("live file count=%d err=%v", live, err)
	}
}
