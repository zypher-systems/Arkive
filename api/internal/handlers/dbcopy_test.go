package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/db"
	"github.com/arkive/arkive/internal/db/dbtest"
	"github.com/arkive/arkive/internal/handlers"
	"github.com/google/uuid"
)

// TestDBCopyRoundTrip fills a database through the API, copies it to SQLite
// and from there into a second new database (PostgreSQL when
// ARKIVE_TEST_DATABASE_URL is set, otherwise SQLite), then serves the copy:
// same ids and timestamps, logins, downloads and search keep working.
func TestDBCopyRoundTrip(t *testing.T) {
	ctx := context.Background()
	env := newTestEnvOn(t, dbtest.FreshURL(t))

	folder := env.mkdir("Reports")
	fileID := env.upload("budget.txt", []byte("v2 quarterly budget"))
	if _, err := env.App.DB.Exec(ctx, `
		INSERT INTO node_versions (node_id, version, storage_key, size) VALUES ($1, 1, $2, 2)
	`, fileID, app.StorageKey(env.WS, uuid.New())); err != nil {
		t.Fatal(err)
	}
	if rr := env.do(http.MethodPatch, "/api/nodes/"+fileID.String(), strings.NewReader(`{"parent_id":"`+folder.String()+`"}`), "application/json"); rr.Code != http.StatusOK {
		t.Fatalf("move status=%d body=%s", rr.Code, rr.Body.String())
	}
	// Content indexing runs in the background.
	deadline := time.Now().Add(10 * time.Second)
	for {
		var text string
		if err := env.App.DB.QueryRow(ctx, `SELECT content_text FROM nodes WHERE id = $1`, fileID).Scan(&text); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(text, "quarterly") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("content was not indexed")
		}
		time.Sleep(20 * time.Millisecond)
	}
	rr := env.do(http.MethodPost, "/api/nodes/"+fileID.String()+"/links", bytes.NewReader([]byte(`{}`)), "application/json")
	if rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
		t.Fatalf("link status=%d body=%s", rr.Code, rr.Body.String())
	}

	mid := db.SQLiteURL(filepath.Join(t.TempDir(), "copy.db"))
	copyDB(t, env.App.DB, mid)
	midDB := openCopy(t, mid)
	assertSameData(t, env.App.DB, midDB)

	// Copying into a database that is no longer empty is refused.
	if _, err := db.Copy(ctx, env.App.DB, midDB, nil); err == nil || !strings.Contains(err.Error(), "not empty") {
		t.Fatalf("copy into non-empty target: %v", err)
	}

	final := dbtest.FreshURL(t)
	copyDB(t, midDB, final)
	finalDB := openCopy(t, final)
	assertSameData(t, env.App.DB, finalDB)

	// Serve the final copy with the same blobs and secrets.
	a := &app.App{DB: finalDB, Stores: app.NewStoreRegistry(), Cfg: env.App.Cfg}
	h := handlers.NewRouter(a)
	body, _ := json.Marshal(map[string]string{"email": env.Email, "password": env.Password})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("login on copy status=%d body=%s", rec.Code, rec.Body.String())
	}
	cookie := sessionCookie(rec)
	get := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec
	}
	if rec := get("/api/nodes/" + fileID.String() + "/download"); rec.Code != http.StatusOK || rec.Body.String() != "v2 quarterly budget" {
		t.Fatalf("download on copy status=%d body=%q", rec.Code, rec.Body.String())
	}
	rec = get("/api/workspaces/" + env.WS.String() + "/search?q=quarterly")
	var hits []struct {
		ID uuid.UUID `json:"id"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &hits); err != nil || len(hits) != 1 || hits[0].ID != fileID {
		t.Fatalf("full-text search on copy: status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func copyDB(t *testing.T, src db.DB, to string) {
	t.Helper()
	if err := db.Migrate(to, filepath.Join("..", "..", "migrations")); err != nil {
		t.Fatal(err)
	}
	dst, err := db.Open(context.Background(), to)
	if err != nil {
		t.Fatal(err)
	}
	defer dst.Close()
	rep, err := db.Copy(context.Background(), src, dst, nil)
	if err != nil {
		t.Fatalf("copy %s -> %s: %v", src.Dialect(), dst.Dialect(), err)
	}
	if rep.Rows == 0 {
		t.Fatal("copy wrote no rows")
	}
}

func openCopy(t *testing.T, url string) db.DB {
	t.Helper()
	d, err := db.Open(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(d.Close)
	return d
}

func assertSameData(t *testing.T, a, b db.DB) {
	t.Helper()
	ctx := context.Background()
	for _, tbl := range db.CopyTables {
		var na, nb int64
		if err := a.QueryRow(ctx, `SELECT COUNT(*) FROM `+tbl).Scan(&na); err != nil {
			t.Fatal(err)
		}
		if err := b.QueryRow(ctx, `SELECT COUNT(*) FROM `+tbl).Scan(&nb); err != nil {
			t.Fatal(err)
		}
		if na != nb {
			t.Errorf("%s: %d rows vs %d", tbl, na, nb)
		}
	}
	type nodeRow struct {
		ID        uuid.UUID
		Parent    *uuid.UUID
		Name      string
		Key       *string
		Created   time.Time
		Updated   time.Time
		Deleted   *time.Time
		Content   string
		Workspace uuid.UUID
	}
	load := func(d db.DB) map[uuid.UUID]nodeRow {
		rows, err := d.Query(ctx, `SELECT id, parent_id, name, storage_key, created_at, updated_at, deleted_at, content_text, workspace_id FROM nodes`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		out := map[uuid.UUID]nodeRow{}
		for rows.Next() {
			var n nodeRow
			if err := rows.Scan(&n.ID, &n.Parent, &n.Name, &n.Key, &n.Created, &n.Updated, &n.Deleted, &n.Content, &n.Workspace); err != nil {
				t.Fatal(err)
			}
			out[n.ID] = n
		}
		return out
	}
	na, nb := load(a), load(b)
	for id, x := range na {
		y, ok := nb[id]
		if !ok {
			t.Errorf("node %s missing from copy", id)
			continue
		}
		if !x.Created.Equal(y.Created) || !x.Updated.Equal(y.Updated) || x.Name != y.Name ||
			x.Content != y.Content || x.Workspace != y.Workspace ||
			(x.Parent == nil) != (y.Parent == nil) || (x.Parent != nil && *x.Parent != *y.Parent) {
			t.Errorf("node %s differs:\n%+v\n%+v", id, x, y)
		}
	}
	var cfgA, cfgB map[string]any
	var backend uuid.UUID
	if err := a.QueryRow(ctx, `SELECT id, config FROM storage_backends ORDER BY created_at LIMIT 1`).Scan(&backend, &cfgA); err != nil {
		t.Fatal(err)
	}
	if err := b.QueryRow(ctx, `SELECT config FROM storage_backends WHERE id = $1`, backend).Scan(&cfgB); err != nil {
		t.Fatal(err)
	}
	if cfgA["mount_path"] != cfgB["mount_path"] || cfgA["mount_path"] == nil && cfgA["endpoint"] != cfgB["endpoint"] {
		t.Errorf("backend config differs: %v vs %v", cfgA, cfgB)
	}
}
