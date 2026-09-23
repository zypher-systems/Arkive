package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/db/dbtest"
	"github.com/arkive/arkive/internal/storage"
	"github.com/google/uuid"
)

type migrateFixture struct {
	app    *App
	ws     uuid.UUID
	oldID  uuid.UUID
	newID  uuid.UUID
	oldDir string
	newDir string
	keys   []string
}

func setupMigrateFixture(t *testing.T, files int) *migrateFixture {
	t.Helper()
	dsn := dbtest.URL(t)
	ctx := context.Background()
	cfg := config.Load()
	cfg.DatabaseURL = dsn
	cfg.MigrationsDir = filepath.Join("..", "..", "migrations")
	pool := dbtest.Open(t, cfg.DatabaseURL, cfg.MigrationsDir)

	a := &App{DB: pool, Stores: NewStoreRegistry(), Cfg: cfg}
	oldDir := t.TempDir()
	newDir := t.TempDir()
	oldID := insertNFSBackend(t, a, oldDir)
	newID := insertNFSBackend(t, a, newDir)
	ws := uuid.New()
	if _, err := a.DB.Exec(ctx, `
		INSERT INTO workspaces (id, type, name, storage_backend_id)
		VALUES ($1, 'personal', $2, $3)
	`, ws, "migrate-"+ws.String()[:8], oldID); err != nil {
		t.Fatal(err)
	}

	oldStore, err := a.StoreForBackend(ctx, oldID)
	if err != nil {
		t.Fatal(err)
	}
	var keys []string
	for i := 0; i < files; i++ {
		nodeID := uuid.New()
		key := StorageKey(ws, nodeID)
		payload := []byte(fmt.Sprintf("blob-%d", i))
		if err := oldStore.Put(ctx, key, bytes.NewReader(payload), int64(len(payload)), "text/plain"); err != nil {
			t.Fatal(err)
		}
		if _, err := a.DB.Exec(ctx, `
			INSERT INTO nodes (id, workspace_id, name, kind, size, storage_key)
			VALUES ($1, $2, $3, 'file', $4, $5)
		`, nodeID, ws, fmt.Sprintf("f%d.txt", i), int64(len(payload)), key); err != nil {
			t.Fatal(err)
		}
		keys = append(keys, key)
	}
	return &migrateFixture{app: a, ws: ws, oldID: oldID, newID: newID, oldDir: oldDir, newDir: newDir, keys: keys}
}

func insertNFSBackend(t *testing.T, a *App, dir string) uuid.UUID {
	t.Helper()
	raw, err := json.Marshal(map[string]string{"mount_path": dir})
	if err != nil {
		t.Fatal(err)
	}
	var id uuid.UUID
	err = a.DB.QueryRow(context.Background(), `
		INSERT INTO storage_backends (name, type, config, is_default)
		VALUES ($1, 'nfs', $2::jsonb, FALSE)
		RETURNING id
	`, "nfs-"+uuid.NewString()[:8], raw).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func nfsFileCount(root string) int {
	n := 0
	_ = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if strings.HasSuffix(info.Name(), ".tmp") {
			return nil
		}
		n++
		return nil
	})
	return n
}

func currentBackend(t *testing.T, a *App, ws uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := a.DB.QueryRow(context.Background(), `SELECT storage_backend_id FROM workspaces WHERE id = $1`, ws).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

type failAfterStore struct {
	inner  storage.BlobStore
	failAt int
	n      int
}

func (s *failAfterStore) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	s.n++
	if s.failAt > 0 && s.n >= s.failAt {
		return fmt.Errorf("injected put failure")
	}
	return s.inner.Put(ctx, key, r, size, contentType)
}

func (s *failAfterStore) Get(ctx context.Context, key string) (io.ReadCloser, *storage.ObjectMeta, error) {
	return s.inner.Get(ctx, key)
}

func (s *failAfterStore) Delete(ctx context.Context, key string) error {
	return s.inner.Delete(ctx, key)
}

func (s *failAfterStore) List(ctx context.Context, prefix string, fn func(storage.ObjectInfo) error) error {
	return s.inner.List(ctx, prefix, fn)
}

func TestMigrateCopyFailureCleansDest(t *testing.T) {
	fx := setupMigrateFixture(t, 2)
	ctx := context.Background()
	inner, err := fx.app.StoreForBackend(ctx, fx.newID)
	if err != nil {
		t.Fatal(err)
	}
	if err := fx.app.ReplaceCachedStore(ctx, fx.newID, &failAfterStore{inner: inner, failAt: 2}); err != nil {
		t.Fatal(err)
	}

	_, err = fx.app.MigrateWorkspaceStorage(ctx, fx.ws, fx.newID)
	if err == nil {
		t.Fatal("expected migrate error")
	}
	if currentBackend(t, fx.app, fx.ws) != fx.oldID {
		t.Fatal("workspace pointer should stay on source backend")
	}
	if nfsFileCount(fx.newDir) != 0 {
		t.Fatalf("dest should be clean after copy failure, got %d files", nfsFileCount(fx.newDir))
	}
	if nfsFileCount(fx.oldDir) != 2 {
		t.Fatalf("source blobs should remain, got %d", nfsFileCount(fx.oldDir))
	}
}

func TestMigratePointerFlipFailureDeletesDest(t *testing.T) {
	fx := setupMigrateFixture(t, 2)
	ctx := context.Background()
	bad := uuid.New()
	migrateFlipOverride = &bad
	t.Cleanup(func() { migrateFlipOverride = nil })

	_, err := fx.app.MigrateWorkspaceStorage(ctx, fx.ws, fx.newID)
	if err == nil {
		t.Fatal("expected pointer flip error")
	}
	if currentBackend(t, fx.app, fx.ws) != fx.oldID {
		t.Fatal("workspace pointer should stay on source backend")
	}
	if nfsFileCount(fx.newDir) != 0 {
		t.Fatalf("dest keys should be deleted after failed flip, got %d files", nfsFileCount(fx.newDir))
	}
	if nfsFileCount(fx.oldDir) != 2 {
		t.Fatalf("source blobs should remain, got %d", nfsFileCount(fx.oldDir))
	}
}

func TestMigrateSuccessFlipsPointer(t *testing.T) {
	fx := setupMigrateFixture(t, 2)
	ctx := context.Background()
	res, err := fx.app.MigrateWorkspaceStorage(ctx, fx.ws, fx.newID)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Migrated || res.Copied != 2 {
		t.Fatalf("result=%+v", res)
	}
	if currentBackend(t, fx.app, fx.ws) != fx.newID {
		t.Fatal("workspace pointer should move to dest backend")
	}
	if nfsFileCount(fx.newDir) != 2 {
		t.Fatalf("dest should have copies, got %d", nfsFileCount(fx.newDir))
	}
	if nfsFileCount(fx.oldDir) != 2 {
		t.Fatalf("source should be left in place, got %d", nfsFileCount(fx.oldDir))
	}
}
