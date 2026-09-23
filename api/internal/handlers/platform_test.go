package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/crypto"
	"github.com/arkive/arkive/internal/db"
	"github.com/arkive/arkive/internal/handlers"
	"github.com/jackc/pgx/v5"
)

// freshApp creates a brand-new, empty database on the test server (setup is
// only possible with zero users, so the shared test database is no use),
// migrates it with the embedded migrations and returns an App over it.
func freshApp(t *testing.T, mutate func(*config.Config)) *app.App {
	t.Helper()
	dsn := os.Getenv("ARKIVE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ARKIVE_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	name := fmt.Sprintf("arkive_setup_%d", time.Now().UnixNano())
	admin, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		admin.Close(ctx)
		t.Fatal(err)
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	freshDSN := u.String()

	cfg := config.Load()
	cfg.DatabaseURL = freshDSN
	cfg.S3Endpoint = ""
	cfg.DataDir = t.TempDir()
	cfg.BootstrapAdminEmail = ""
	cfg.MigrationsDir = "" // exercise the embedded migrations
	cfg.SetupToken = ""
	if mutate != nil {
		mutate(&cfg)
	}
	if err := db.Migrate(cfg.DatabaseURL, cfg.MigrationsDir); err != nil {
		t.Fatal(err)
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
		admin.Close(context.Background())
	})
	a := &app.App{DB: pool, Stores: app.NewStoreRegistry(), Cfg: cfg}
	if err := a.SeedDefaultBackend(ctx); err != nil {
		t.Fatal(err)
	}
	return a
}

func doJSON(h http.Handler, method, path string, body any, remote string) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if remote != "" {
		req.RemoteAddr = remote
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func setupBody(email, token string) map[string]string {
	return map[string]string{
		"email":        email,
		"password":     "password123",
		"display_name": "First Admin",
		"setup_token":  token,
	}
}

func TestSetupFirstUserOnly(t *testing.T) {
	a := freshApp(t, nil)
	h := handlers.NewRouter(a)

	rr := doJSON(h, http.MethodGet, "/api/setup", nil, "")
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"needed":true`) {
		t.Fatalf("GET setup: %d %s", rr.Code, rr.Body.String())
	}
	rr = doJSON(h, http.MethodGet, "/api/instance", nil, "")
	var inst map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &inst)
	if rr.Code != http.StatusOK || inst["setup_needed"] != true || inst["version"] == "" {
		t.Fatalf("instance: %d %s", rr.Code, rr.Body.String())
	}
	for _, k := range []string{"oidc", "registration_open", "google_drive_enabled"} {
		if _, ok := inst[k]; !ok {
			t.Fatalf("instance missing %q: %s", k, rr.Body.String())
		}
	}

	// Missing / wrong token.
	if rr := doJSON(h, http.MethodPost, "/api/setup", setupBody("root@example.com", ""), "192.0.2.1:1"); rr.Code != http.StatusForbidden {
		t.Fatalf("no token: %d %s", rr.Code, rr.Body.String())
	}
	if rr := doJSON(h, http.MethodPost, "/api/setup", setupBody("root@example.com", "nope"), "192.0.2.1:1"); rr.Code != http.StatusForbidden {
		t.Fatalf("wrong token: %d %s", rr.Code, rr.Body.String())
	}
	// Validation.
	bad := setupBody("root@example.com", a.SetupToken())
	bad["password"] = "short"
	if rr := doJSON(h, http.MethodPost, "/api/setup", bad, "192.0.2.1:1"); rr.Code != http.StatusBadRequest {
		t.Fatalf("short password: %d %s", rr.Code, rr.Body.String())
	}

	rr = doJSON(h, http.MethodPost, "/api/setup", setupBody("Root@Example.com", a.SetupToken()), "192.0.2.1:1")
	if rr.Code != http.StatusCreated {
		t.Fatalf("setup: %d %s", rr.Code, rr.Body.String())
	}
	var user struct {
		Email   string `json:"email"`
		IsAdmin bool   `json:"is_instance_admin"`
		Status  string `json:"status"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &user)
	if user.Email != "root@example.com" || !user.IsAdmin || user.Status != "active" {
		t.Fatalf("unexpected user %+v", user)
	}
	cookie := sessionCookie(rr)
	if cookie == nil {
		t.Fatal("setup must sign the admin in")
	}
	req := httptest.NewRequest(http.MethodGet, "/api/workspaces", nil)
	req.AddCookie(cookie)
	ws := httptest.NewRecorder()
	h.ServeHTTP(ws, req)
	if ws.Code != http.StatusOK || !strings.Contains(ws.Body.String(), `"personal"`) {
		t.Fatalf("admin workspaces: %d %s", ws.Code, ws.Body.String())
	}

	// Second attempt: conflict, even with the right token.
	if rr := doJSON(h, http.MethodPost, "/api/setup", setupBody("other@example.com", a.SetupToken()), "192.0.2.1:1"); rr.Code != http.StatusConflict {
		t.Fatalf("second setup: %d %s", rr.Code, rr.Body.String())
	}
	if rr := doJSON(h, http.MethodGet, "/api/setup", nil, ""); !strings.Contains(rr.Body.String(), `"needed":false`) {
		t.Fatalf("GET setup after: %s", rr.Body.String())
	}
}

func TestSetupConfiguredToken(t *testing.T) {
	a := freshApp(t, func(c *config.Config) { c.SetupToken = "operator-chosen-token" })
	if a.SetupToken() != "operator-chosen-token" {
		t.Fatal("configured token not used")
	}
	h := handlers.NewRouter(a)
	if rr := doJSON(h, http.MethodPost, "/api/setup", setupBody("a@example.com", "operator-chosen-token"), "192.0.2.2:1"); rr.Code != http.StatusCreated {
		t.Fatalf("setup: %d %s", rr.Code, rr.Body.String())
	}
}

func TestSetupRace(t *testing.T) {
	a := freshApp(t, nil)
	h := handlers.NewRouter(a)
	token := a.SetupToken()

	const n = 8
	var wg sync.WaitGroup
	codes := make([]int, n)
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			// Distinct IPs so the rate limiter is not what serializes them.
			rr := doJSON(h, http.MethodPost, "/api/setup", setupBody(fmt.Sprintf("racer%d@example.com", i), token), fmt.Sprintf("198.51.100.%d:1", i+1))
			codes[i] = rr.Code
		}(i)
	}
	close(start)
	wg.Wait()

	created := 0
	for _, c := range codes {
		switch c {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
		default:
			t.Fatalf("unexpected status %d in %v", c, codes)
		}
	}
	if created != 1 {
		t.Fatalf("expected exactly one admin, got %d (%v)", created, codes)
	}
	var users int
	if err := a.DB.QueryRow(context.Background(), `SELECT COUNT(*) FROM users`).Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 1 {
		t.Fatalf("users=%d", users)
	}
}

func TestMetricsEndpoint(t *testing.T) {
	// Disabled: 404.
	off := freshApp(t, nil)
	if rr := doJSON(handlers.NewRouter(off), http.MethodGet, "/metrics", nil, ""); rr.Code != http.StatusNotFound {
		t.Fatalf("disabled metrics: %d", rr.Code)
	}

	a := freshApp(t, func(c *config.Config) {
		c.MetricsEnabled = true
		c.MetricsToken = "scrape-secret"
	})
	h := handlers.NewRouter(a)
	// Generate some traffic, including a templated route.
	doJSON(h, http.MethodGet, "/api/health", nil, "")
	doJSON(h, http.MethodGet, "/api/nodes/00000000-0000-0000-0000-000000000000/download", nil, "")

	scrape := func(auth string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
		if auth != "" {
			req.Header.Set("Authorization", auth)
		}
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr
	}
	if rr := scrape(""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("no token: %d", rr.Code)
	}
	if rr := scrape("Bearer wrong"); rr.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token: %d", rr.Code)
	}
	rr := scrape("Bearer scrape-secret")
	if rr.Code != http.StatusOK {
		t.Fatalf("scrape: %d %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	for _, want := range []string{
		`arkive_http_requests_total{method="GET",route="/api/health",status="200"} 1`,
		`route="/api/nodes/{nodeID}/download"`,
		`arkive_http_request_duration_seconds_bucket`,
		`arkive_upload_bytes_total 0`,
		`arkive_active_sessions 0`,
		`arkive_storage_bytes_used 0`,
		`arkive_build_info{goversion=`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("metrics missing %q", want)
		}
	}
	if strings.Contains(body, "00000000-0000-0000-0000-000000000000") {
		t.Error("raw path leaked into labels")
	}
}

func TestMetricsWithoutToken(t *testing.T) {
	a := freshApp(t, func(c *config.Config) { c.MetricsEnabled = true })
	if rr := doJSON(handlers.NewRouter(a), http.MethodGet, "/metrics", nil, ""); rr.Code != http.StatusOK {
		t.Fatalf("open metrics: %d", rr.Code)
	}
}

func TestUploadBytesMetric(t *testing.T) {
	env := newTestEnv(t)
	env.App.Cfg.MetricsEnabled = true
	env.H = handlers.NewRouter(env.App)
	env.upload("metric.txt", []byte("0123456789"))
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rr := httptest.NewRecorder()
	env.H.ServeHTTP(rr, req)
	if !strings.Contains(rr.Body.String(), "arkive_upload_bytes_total 10") {
		t.Fatalf("upload bytes not counted:\n%s", grepLines(rr.Body.String(), "upload"))
	}
}

func TestDetectLegacySecretsKey(t *testing.T) {
	a := freshApp(t, nil)
	ctx := context.Background()
	if key, enc := app.DetectLegacySecretsKey(ctx, a.DB); key != "" || enc {
		t.Fatalf("empty db: key=%q enc=%v", key, enc)
	}
	ct, err := crypto.Encrypt(config.DefaultComposeSecret, "smtp-password")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.DB.Exec(ctx, `INSERT INTO instance_settings (key, value) VALUES ('legacy_test', $1)`, ct); err != nil {
		t.Fatal(err)
	}
	if key, enc := app.DetectLegacySecretsKey(ctx, a.DB); key != config.DefaultComposeSecret || !enc {
		t.Fatalf("placeholder not detected: key=%q enc=%v", key, enc)
	}
	ct, _ = crypto.Encrypt("some-real-key", "x")
	if _, err := a.DB.Exec(ctx, `UPDATE instance_settings SET value = $1 WHERE key = 'legacy_test'`, ct); err != nil {
		t.Fatal(err)
	}
	if key, enc := app.DetectLegacySecretsKey(ctx, a.DB); key != "" || !enc {
		t.Fatalf("unknown key: key=%q enc=%v", key, enc)
	}
}

func grepLines(s, sub string) string {
	var out []string
	for _, l := range strings.Split(s, "\n") {
		if strings.Contains(l, sub) {
			out = append(out, l)
		}
	}
	return strings.Join(out, "\n")
}

func TestSPAFallbackThroughRouter(t *testing.T) {
	a := &app.App{Cfg: config.Load()}
	h := handlers.NewRouter(a)
	for _, p := range []string{"/", "/login", "/s/sometoken", "/w/abc/f/def"} {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK || !strings.HasPrefix(rr.Header().Get("Content-Type"), "text/html") {
			t.Fatalf("%s: %d %q", p, rr.Code, rr.Header().Get("Content-Type"))
		}
		if rr.Header().Get("Content-Security-Policy") == "" || rr.Header().Get("X-Frame-Options") != "SAMEORIGIN" {
			t.Fatalf("%s: missing security headers", p)
		}
	}
	// Unknown API paths stay JSON 404s, never the SPA.
	req := httptest.NewRequest(http.MethodGet, "/api/does-not-exist", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound || strings.Contains(rr.Body.String(), "<html") {
		t.Fatalf("api 404: %d %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("API responses need nosniff")
	}
	// Metrics disabled → 404.
	req = httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("metrics disabled: %d", rr.Code)
	}
}
