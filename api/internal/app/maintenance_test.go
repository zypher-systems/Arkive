package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type maintFixture struct {
	app     *App
	ws      uuid.UUID
	user    uuid.UUID
	backend uuid.UUID
	dir     string
}

func newMaintFixture(t *testing.T) *maintFixture {
	t.Helper()
	dsn := os.Getenv("ARKIVE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ARKIVE_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	cfg := config.Load()
	cfg.DatabaseURL = dsn
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
	a := &App{DB: pool, Stores: NewStoreRegistry(), Cfg: cfg}
	dir := t.TempDir()
	backend := insertNFSBackend(t, a, dir)
	ws := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO workspaces (id, type, name, storage_backend_id) VALUES ($1, 'team', $2, $3)`,
		ws, "Team "+ws.String()[:8], backend); err != nil {
		t.Fatal(err)
	}
	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, email, password_hash, display_name, status) VALUES ($1, $2, 'x', 'T', 'active')`,
		user, user.String()+"@test.local"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, ws, user); err != nil {
		t.Fatal(err)
	}
	return &maintFixture{app: a, ws: ws, user: user, backend: backend, dir: dir}
}

// putBlob writes a blob directly and backdates it by age.
func (f *maintFixture) putBlob(t *testing.T, key, content string, age time.Duration) string {
	t.Helper()
	p := filepath.Join(f.dir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	ts := time.Now().Add(-age)
	if err := os.Chtimes(p, ts, ts); err != nil {
		t.Fatal(err)
	}
	return p
}

func (f *maintFixture) store(t *testing.T, parent *uuid.UUID, name, content string) StoreFileResult {
	t.Helper()
	res, err := f.app.StoreFile(context.Background(), StoreFileParams{
		WorkspaceID: f.ws, ParentID: parent, Name: name, ContentType: "text/plain",
		ActorID: f.user, Body: strings.NewReader(content), Size: int64(len(content)),
	})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func (f *maintFixture) mkdir(t *testing.T, parent *uuid.UUID, name string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := f.app.DB.QueryRow(context.Background(), `
		INSERT INTO nodes (workspace_id, parent_id, name, kind, created_by) VALUES ($1, $2, $3, 'folder', $4) RETURNING id
	`, f.ws, parent, name, f.user).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func exists(p string) bool {
	_, err := os.Lstat(p)
	return err == nil
}

func findBackend(rep GCReport, id uuid.UUID) *GCBackendReport {
	for i := range rep.Backends {
		if rep.Backends[i].BackendID == id {
			return &rep.Backends[i]
		}
	}
	return nil
}

func TestGarbageCollect(t *testing.T) {
	f := newMaintFixture(t)
	ctx := context.Background()
	hour2 := 2 * time.Hour

	// Referenced: a live node, a version row and a thumbnail, all old.
	nodeID := uuid.New()
	liveKey := StorageKey(f.ws, nodeID)
	live := f.putBlob(t, liveKey, "live", hour2)
	verKey := StorageKey(f.ws, uuid.New())
	ver := f.putBlob(t, verKey, "old version", hour2)
	thumbKey := ThumbKey(f.ws, nodeID)
	thumb := f.putBlob(t, thumbKey, "jpg", hour2)
	if _, err := f.app.DB.Exec(ctx, `
		INSERT INTO nodes (id, workspace_id, name, kind, size, storage_key, thumb_key) VALUES ($1, $2, 'a.txt', 'file', 4, $3, $4)
	`, nodeID, f.ws, liveKey, thumbKey); err != nil {
		t.Fatal(err)
	}
	if _, err := f.app.DB.Exec(ctx, `
		INSERT INTO node_versions (node_id, version, storage_key, size) VALUES ($1, 1, $2, 11)
	`, nodeID, verKey); err != nil {
		t.Fatal(err)
	}

	// Unreferenced.
	orphan := f.putBlob(t, StorageKey(f.ws, uuid.New()), "orphan!", hour2)
	orphanThumb := f.putBlob(t, ThumbKey(f.ws, uuid.New()), "t", hour2)
	fresh := f.putBlob(t, StorageKey(f.ws, uuid.New()), "in flight", 5*time.Minute) // newer than 1h: kept
	staleTmp := f.putBlob(t, StorageKey(f.ws, uuid.New())+".tmp", "partial", hour2)
	freshTmp := f.putBlob(t, StorageKey(f.ws, uuid.New())+".tmp", "partial", time.Minute)
	foreign := f.putBlob(t, "notes/readme.txt", "not ours", hour2)             // outside key layout
	dotted := f.putBlob(t, ".uploads/"+uuid.NewString(), "staging", hour2)     // dot dirs are never listed
	oddName := f.putBlob(t, "not-a-uuid/"+uuid.NewString(), "not ours", hour2) // outside key layout

	// Dry run: reports, deletes nothing.
	rep, err := f.app.GarbageCollect(ctx, true)
	if err != nil {
		t.Fatal(err)
	}
	b := findBackend(rep, f.backend)
	if b == nil {
		t.Fatal("backend missing from report")
	}
	if b.Skipped != "" || b.Orphans != 2 || b.StaleTmp != 1 || b.Deleted != 0 || b.KeptRecent != 2 || b.Ignored != 2 {
		t.Fatalf("dry-run report=%+v", *b)
	}
	if b.OrphanBytes != int64(len("orphan!")+len("t")) {
		t.Fatalf("orphan bytes=%d", b.OrphanBytes)
	}
	for _, p := range []string{live, ver, thumb, orphan, orphanThumb, fresh, staleTmp, freshTmp, foreign, dotted, oddName} {
		if !exists(p) {
			t.Fatalf("dry run deleted %s", p)
		}
	}

	// Real run.
	rep, err = f.app.GarbageCollect(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	b = findBackend(rep, f.backend)
	if b.Deleted != 3 || b.Orphans != 2 || len(b.Errors) != 0 {
		t.Fatalf("real report=%+v", *b)
	}
	for _, p := range []string{orphan, orphanThumb, staleTmp} {
		if exists(p) {
			t.Fatalf("GC kept orphan %s", p)
		}
	}
	for _, p := range []string{live, ver, thumb, fresh, freshTmp, foreign, dotted, oddName} {
		if !exists(p) {
			t.Fatalf("GC deleted %s", p)
		}
	}
}

func TestGarbageCollectSkipsBusyBackendAndDBFailure(t *testing.T) {
	f := newMaintFixture(t)
	ctx := context.Background()
	orphan := f.putBlob(t, StorageKey(f.ws, uuid.New()), "orphan", 2*time.Hour)

	// A running storage migration touching the backend: skipped.
	var jobID uuid.UUID
	if err := f.app.DB.QueryRow(ctx, `
		INSERT INTO storage_migrations (workspace_id, to_backend_id, status) VALUES ($1, $2, 'running') RETURNING id
	`, f.ws, f.backend).Scan(&jobID); err != nil {
		t.Fatal(err)
	}
	rep, err := f.app.GarbageCollect(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if b := findBackend(rep, f.backend); b == nil || b.Skipped == "" {
		t.Fatalf("busy backend not skipped: %+v", b)
	}
	if !exists(orphan) {
		t.Fatal("orphan deleted on busy backend")
	}
	if _, err := f.app.DB.Exec(ctx, `UPDATE storage_migrations SET status = 'completed' WHERE id = $1`, jobID); err != nil {
		t.Fatal(err)
	}

	// Database unavailable: error, nothing deleted.
	pool, err := pgxpool.New(ctx, f.app.Cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	pool.Close()
	broken := &App{DB: pool, Stores: f.app.Stores, Cfg: f.app.Cfg}
	if _, err := broken.GarbageCollect(ctx, false); err == nil {
		t.Fatal("expected error with closed DB")
	}
	if !exists(orphan) {
		t.Fatal("orphan deleted although DB failed")
	}
}

// versionSettingLockKey serializes tests (across packages sharing the test
// database) that change or depend on the global version-retention setting.
const versionSettingLockKey int64 = 872364019

func lockVersionSetting(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	conn, err := pool.Acquire(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(context.Background(), `SELECT pg_advisory_lock($1)`, versionSettingLockKey); err != nil {
		conn.Release()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, versionSettingLockKey)
		conn.Release()
	})
}

func TestVersionRetentionSetting(t *testing.T) {
	f := newMaintFixture(t)
	ctx := context.Background()
	lockVersionSetting(t, f.app.DB)
	t.Cleanup(func() { _ = f.app.deleteSetting(context.Background(), settingMaxVersions) })
	_ = f.app.deleteSetting(ctx, settingMaxVersions)
	if got := f.app.MaxVersionsPerFile(ctx); got != DefaultMaxVersionsPerFile {
		t.Fatalf("default=%d", got)
	}
	if err := f.app.SetMaxVersionsPerFile(ctx, 101); err == nil {
		t.Fatal("expected error for 101")
	}
	if err := f.app.SetMaxVersionsPerFile(ctx, -1); err == nil {
		t.Fatal("expected error for -1")
	}

	first := f.store(t, nil, "doc.txt", "v0")
	for i := 1; i <= 5; i++ {
		f.store(t, nil, "doc.txt", "v"+string(rune('0'+i)))
	}
	countVersions := func() int {
		var n int
		if err := f.app.DB.QueryRow(ctx, `SELECT COUNT(*) FROM node_versions WHERE node_id = $1`, first.Node.ID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := countVersions(); n != 5 {
		t.Fatalf("versions=%d want 5", n)
	}

	// Lowering the setting prunes lazily: nothing changes until the job runs.
	if err := f.app.SetMaxVersionsPerFile(ctx, 2); err != nil {
		t.Fatal(err)
	}
	if n := countVersions(); n != 5 {
		t.Fatalf("eager prune: %d", n)
	}
	if _, err := f.app.PruneAllVersions(ctx); err != nil {
		t.Fatal(err)
	}
	if n := countVersions(); n != 2 {
		t.Fatalf("after hourly prune=%d want 2", n)
	}
	// Kept versions still have their blobs; current content intact.
	rows, err := f.app.DB.Query(ctx, `SELECT storage_key FROM node_versions WHERE node_id = $1`, first.Node.ID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var k string
		_ = rows.Scan(&k)
		if !exists(filepath.Join(f.dir, k)) {
			t.Fatalf("kept version blob missing: %s", k)
		}
	}
	rows.Close()

	// Retention 0: next write keeps no history, and the node's blob survives.
	if err := f.app.SetMaxVersionsPerFile(ctx, 0); err != nil {
		t.Fatal(err)
	}
	res := f.store(t, nil, "doc.txt", "final")
	if n := countVersions(); n != 0 {
		t.Fatalf("retention 0 left %d versions", n)
	}
	var key string
	if err := f.app.DB.QueryRow(ctx, `SELECT storage_key FROM nodes WHERE id = $1`, res.Node.ID).Scan(&key); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(f.dir, key))
	if err != nil || string(b) != "final" {
		t.Fatalf("current blob=%q err=%v", b, err)
	}
}

func TestExport(t *testing.T) {
	f := newMaintFixture(t)
	ctx := context.Background()
	if _, err := f.app.DB.Exec(ctx, `UPDATE workspaces SET name = $1 WHERE id = $2`, "../Team/../../escape", f.ws); err != nil {
		t.Fatal(err)
	}
	docs := f.mkdir(t, nil, "Docs")
	sub := f.mkdir(t, &docs, "Sub")
	a := f.store(t, &docs, "a.txt", "alpha")
	f.store(t, &sub, "b.txt", "bravo")
	f.store(t, nil, "root.txt", "root")
	// Hostile / colliding names stored directly in the DB.
	evil := f.store(t, nil, "evil.txt", "evil")
	if _, err := f.app.DB.Exec(ctx, `UPDATE nodes SET name = '../../outside.txt' WHERE id = $1`, evil.Node.ID); err != nil {
		t.Fatal(err)
	}
	trashed := f.store(t, &docs, "gone.txt", "trash")
	if _, err := f.app.DB.Exec(ctx, `UPDATE nodes SET deleted_at = now() WHERE id = $1`, trashed.Node.ID); err != nil {
		t.Fatal(err)
	}
	// A trashed file with the same name as a live one.
	dup := f.store(t, &docs, "dup.txt", "old")
	if _, err := f.app.DB.Exec(ctx, `UPDATE nodes SET name = 'a.txt', deleted_at = now() WHERE id = $1`, dup.Node.ID); err != nil {
		t.Fatal(err)
	}
	mtime := time.Date(2020, 5, 17, 12, 0, 0, 0, time.UTC)
	if _, err := f.app.DB.Exec(ctx, `UPDATE nodes SET updated_at = $1 WHERE id = $2`, mtime, a.Node.ID); err != nil {
		t.Fatal(err)
	}
	// A missing blob is reported, not fatal.
	broken := f.store(t, &sub, "broken.bin", "xx")
	if _, err := f.app.DB.Exec(ctx, `UPDATE nodes SET storage_key = $1 WHERE id = $2`, StorageKey(f.ws, uuid.New()), broken.Node.ID); err != nil {
		t.Fatal(err)
	}

	parent := t.TempDir()
	out := filepath.Join(parent, "out")
	rep, err := f.app.Export(ctx, f.ws.String(), out)
	if err != nil {
		t.Fatal(err)
	}
	wsDir := filepath.Join(out, ".._Team_.._.._escape")
	if !exists(wsDir) {
		entries, _ := os.ReadDir(out)
		t.Fatalf("workspace dir missing; have %v", entries)
	}
	read := func(rel string) string {
		b, err := os.ReadFile(filepath.Join(wsDir, filepath.FromSlash(rel)))
		if err != nil {
			t.Fatalf("read %s: %v", rel, err)
		}
		return string(b)
	}
	if read("Docs/a.txt") != "alpha" || read("Docs/Sub/b.txt") != "bravo" || read("root.txt") != "root" || read(".._.._outside.txt") != "evil" {
		t.Fatal("content mismatch")
	}
	if exists(filepath.Join(wsDir, "Docs", "gone.txt")) || exists(filepath.Join(wsDir, "Docs", "a (2).txt")) {
		t.Fatal("trashed items exported without IncludeTrash")
	}
	st, err := os.Stat(filepath.Join(wsDir, "Docs", "a.txt"))
	if err != nil || !st.ModTime().Equal(mtime) {
		t.Fatalf("mtime=%v want %v", st.ModTime(), mtime)
	}
	if rep.Workspaces != 1 || rep.Files != 4 || rep.Folders != 2 || len(rep.Issues) != 1 || rep.Issues[0].NodeID != broken.Node.ID {
		t.Fatalf("report=%+v", rep)
	}
	// Nothing escaped outDir.
	entries, _ := os.ReadDir(parent)
	if len(entries) != 1 {
		t.Fatalf("export wrote outside outDir: %v", entries)
	}

	// Second export into the same dir, with trash: never overwrites, never
	// follows a planted symlink.
	target := filepath.Join(parent, "victim.txt")
	if err := os.WriteFile(target, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	rep2, err := f.app.Export(ctx, f.ws.String(), out, ExportOptions{IncludeTrash: true})
	if err != nil {
		t.Fatal(err)
	}
	ws2 := filepath.Join(out, ".._Team_.._.._escape (2)")
	if !exists(ws2) {
		t.Fatal("second export should use a de-duplicated workspace dir")
	}
	if b, _ := os.ReadFile(filepath.Join(ws2, "Docs", "a.txt")); string(b) != "alpha" {
		t.Fatalf("live file lost its name: %q", b)
	}
	if b, _ := os.ReadFile(filepath.Join(ws2, "Docs", "a (2).txt")); string(b) != "old" {
		t.Fatalf("trashed duplicate=%q", b)
	}
	if b, _ := os.ReadFile(filepath.Join(ws2, "Docs", "gone.txt")); string(b) != "trash" {
		t.Fatalf("trashed file=%q", b)
	}
	if rep2.Renamed < 1 || rep2.Files != 6 {
		t.Fatalf("report2=%+v", rep2)
	}
	if b, _ := os.ReadFile(filepath.Join(wsDir, "Docs", "a.txt")); string(b) != "alpha" {
		t.Fatal("first export modified")
	}

	// Planted symlink where a file would go is not followed.
	ws3 := filepath.Join(out, ".._Team_.._.._escape (3)")
	if err := os.Mkdir(ws3, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(out, ".._Team_.._.._escape (4)")
	if err := os.Symlink(parent, link); err != nil {
		t.Fatal(err)
	}
	if _, err := f.app.Export(ctx, f.ws.String(), out); err != nil {
		t.Fatal(err)
	}
	if !exists(filepath.Join(out, ".._Team_.._.._escape (5)", "root.txt")) {
		t.Fatal("expected export into (5) after skipping existing dir and symlink")
	}
	if b, _ := os.ReadFile(target); string(b) != "keep" {
		t.Fatal("file outside outDir modified")
	}
	if entries, _ := os.ReadDir(parent); len(entries) != 2 {
		t.Fatalf("export wrote outside outDir: %v", entries)
	}

	// Unknown workspace and bad id are errors.
	if _, err := f.app.Export(ctx, uuid.NewString(), out); err == nil {
		t.Fatal("expected error for unknown workspace")
	}
	if _, err := f.app.Export(ctx, "nope", out); err == nil {
		t.Fatal("expected error for invalid id")
	}
}

func TestExportNameHelpers(t *testing.T) {
	cases := map[string]string{
		"":             "_",
		"..":           "_",
		".":            "_",
		"a/b":          "a_b",
		`a\b`:          "a_b",
		"x\x00y":       "x_y",
		"  spaced  ":   "spaced",
		"normal.txt":   "normal.txt",
		"../../etc/pw": ".._.._etc_pw",
	}
	for in, want := range cases {
		if got := exportSafeName(in); got != want {
			t.Errorf("exportSafeName(%q)=%q want %q", in, got, want)
		}
	}
	long := strings.Repeat("é", 200) + ".txt"
	if got := exportSafeName(long); len(got) > maxExportNameBytes || !strings.HasSuffix(got, ".txt") {
		t.Errorf("long name not truncated safely: %d bytes", len(got))
	}
	if candidateName("a.tar.gz", 2, true) != "a.tar (2).gz" || candidateName(".bashrc", 3, true) != ".bashrc (3)" || candidateName("dir.v1", 2, false) != "dir.v1 (2)" {
		t.Error("candidateName")
	}
}
