package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/db/dbtest"
	"github.com/arkive/arkive/internal/handlers"
	"github.com/arkive/arkive/internal/storage"
	"github.com/google/uuid"
)

type testEnv struct {
	t         *testing.T
	App       *app.App
	H         http.Handler
	Cookie    *http.Cookie
	UserID    uuid.UUID
	Email     string
	Password  string
	WS        uuid.UUID
	BackendID uuid.UUID
	NFSDir    string
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	dsn := dbtest.URL(t)
	ctx := context.Background()
	cfg := config.Load()
	cfg.DatabaseURL = dsn
	cfg.S3Endpoint = ""
	cfg.DataDir = t.TempDir()
	cfg.BootstrapAdminEmail = fmt.Sprintf("admin-%d@test.local", time.Now().UnixNano())
	cfg.MigrationsDir = filepath.Join("..", "..", "migrations")

	pool := dbtest.Open(t, cfg.DatabaseURL, cfg.MigrationsDir)

	application := &app.App{
		DB:     pool,
		Stores: app.NewStoreRegistry(),
		Cfg:    cfg,
	}
	if err := application.SeedDefaultBackend(ctx); err != nil {
		t.Fatal(err)
	}
	var hasDefault bool
	if err := application.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM storage_backends WHERE is_default = TRUE)`).Scan(&hasDefault); err != nil {
		t.Fatal(err)
	}

	dir := t.TempDir()
	raw, err := json.Marshal(map[string]string{"mount_path": dir})
	if err != nil {
		t.Fatal(err)
	}
	var backendID uuid.UUID
	err = application.DB.QueryRow(ctx, `
		INSERT INTO storage_backends (name, type, config, is_default)
		VALUES ($1, 'nfs', $2::jsonb, $3)
		RETURNING id
	`, "nfs-"+uuid.NewString()[:8], raw, !hasDefault).Scan(&backendID)
	if err != nil {
		t.Fatal(err)
	}

	h := handlers.NewRouter(application)
	env := &testEnv{
		t:         t,
		App:       application,
		H:         h,
		Email:     cfg.BootstrapAdminEmail,
		Password:  "password123",
		BackendID: backendID,
		NFSDir:    dir,
	}

	body, _ := json.Marshal(map[string]string{
		"email":        env.Email,
		"password":     env.Password,
		"display_name": "Test Admin",
	})
	rr := env.do(http.MethodPost, "/api/auth/register", bytes.NewReader(body), "application/json")
	if rr.Code != http.StatusCreated {
		t.Fatalf("bootstrap register status=%d body=%s", rr.Code, rr.Body.String())
	}
	env.Cookie = sessionCookie(rr)
	if env.Cookie == nil {
		t.Fatal("bootstrap register should set session cookie")
	}
	var user struct {
		ID uuid.UUID `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &user); err != nil {
		t.Fatal(err)
	}
	env.UserID = user.ID

	rr = env.do(http.MethodGet, "/api/workspaces", nil, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("workspaces status=%d body=%s", rr.Code, rr.Body.String())
	}
	var spaces []struct {
		ID   uuid.UUID `json:"id"`
		Type string    `json:"type"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &spaces); err != nil {
		t.Fatal(err)
	}
	for _, s := range spaces {
		if s.Type == "personal" {
			env.WS = s.ID
			break
		}
	}
	if env.WS == uuid.Nil {
		t.Fatal("no personal workspace")
	}
	if _, err := application.DB.Exec(ctx, `UPDATE workspaces SET storage_backend_id = $1 WHERE id = $2`, backendID, env.WS); err != nil {
		t.Fatal(err)
	}
	return env
}

func sessionCookie(rr *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range rr.Result().Cookies() {
		if c.Name == "arkive_session" {
			return c
		}
	}
	return nil
}

func (e *testEnv) do(method, path string, body io.Reader, contentType string) *httptest.ResponseRecorder {
	e.t.Helper()
	req := httptest.NewRequest(method, path, body)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if e.Cookie != nil {
		req.AddCookie(e.Cookie)
	}
	rr := httptest.NewRecorder()
	e.H.ServeHTTP(rr, req)
	return rr
}

func (e *testEnv) upload(name string, payload []byte) uuid.UUID {
	e.t.Helper()
	return e.uploadTo(e.WS, name, payload, true)
}

func (e *testEnv) uploadTo(ws uuid.UUID, name string, payload []byte, setLength bool) uuid.UUID {
	e.t.Helper()
	var body io.Reader = bytes.NewReader(payload)
	if !setLength {
		body = io.NopCloser(bytes.NewReader(payload))
	}
	req := httptest.NewRequest(http.MethodPut, "/api/workspaces/"+ws.String()+"/upload?name="+name, body)
	req.Header.Set("Content-Type", "text/plain")
	if e.Cookie != nil {
		req.AddCookie(e.Cookie)
	}
	if !setLength {
		req.ContentLength = -1
	}
	rr := httptest.NewRecorder()
	e.H.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
		e.t.Fatalf("upload %s status=%d body=%s", name, rr.Code, rr.Body.String())
	}
	var n struct {
		ID uuid.UUID `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &n); err != nil {
		e.t.Fatal(err)
	}
	return n.ID
}

func (e *testEnv) mkdir(name string) uuid.UUID {
	e.t.Helper()
	body, _ := json.Marshal(map[string]string{"name": name})
	rr := e.do(http.MethodPost, "/api/workspaces/"+e.WS.String()+"/folders", bytes.NewReader(body), "application/json")
	if rr.Code != http.StatusCreated {
		e.t.Fatalf("mkdir status=%d body=%s", rr.Code, rr.Body.String())
	}
	var n struct {
		ID uuid.UUID `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &n); err != nil {
		e.t.Fatal(err)
	}
	return n.ID
}

func (e *testEnv) registerPending(email, password, display string) uuid.UUID {
	e.t.Helper()
	body, _ := json.Marshal(map[string]string{
		"email":        email,
		"password":     password,
		"display_name": display,
	})
	saved := e.Cookie
	e.Cookie = nil
	rr := e.do(http.MethodPost, "/api/auth/register", bytes.NewReader(body), "application/json")
	e.Cookie = saved
	if rr.Code != http.StatusCreated {
		e.t.Fatalf("register pending status=%d body=%s", rr.Code, rr.Body.String())
	}
	var out struct {
		User struct {
			ID uuid.UUID `json:"id"`
		} `json:"user"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		e.t.Fatal(err)
	}
	if out.User.ID == uuid.Nil {
		e.t.Fatal("pending register missing user id")
	}
	return out.User.ID
}

func (e *testEnv) approve(userID uuid.UUID) {
	e.t.Helper()
	rr := e.do(http.MethodPost, "/api/admin/users/"+userID.String()+"/approve", nil, "")
	if rr.Code != http.StatusOK {
		e.t.Fatalf("approve status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func (e *testEnv) login(email, password string) *http.Cookie {
	e.t.Helper()
	body, _ := json.Marshal(map[string]string{"email": email, "password": password})
	saved := e.Cookie
	e.Cookie = nil
	rr := e.do(http.MethodPost, "/api/auth/login", bytes.NewReader(body), "application/json")
	e.Cookie = saved
	if rr.Code != http.StatusOK {
		e.t.Fatalf("login status=%d body=%s", rr.Code, rr.Body.String())
	}
	c := sessionCookie(rr)
	if c == nil {
		e.t.Fatal("login missing session cookie")
	}
	return c
}

func countRegularFiles(root string) int {
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
