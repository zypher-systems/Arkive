package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/db"
	"github.com/arkive/arkive/internal/handlers"
)

func TestSignupApprovalFlow(t *testing.T) {
	dsn := os.Getenv("ARKIVE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("ARKIVE_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	cfg := config.Load()
	cfg.DatabaseURL = dsn
	cfg.BootstrapAdminEmail = "bootstrap-admin@test.local"
	cfg.MigrationsDir = filepath.Join("..", "..", "migrations")

	if err := db.Migrate(cfg.DatabaseURL, cfg.MigrationsDir); err != nil {
		t.Fatal(err)
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	application := &app.App{
		DB:     pool,
		Stores: app.NewStoreRegistry(),
		Cfg:    cfg,
	}
	if err := application.SeedDefaultBackend(ctx); err != nil {
		t.Fatal(err)
	}

	h := handlers.NewRouter(application)

	email := "pending-" + time.Now().Format("150405.000") + "@test.local"
	body, _ := json.Marshal(map[string]string{
		"email":        email,
		"password":     "password123",
		"display_name": "Pending",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("register status=%d body=%s", rr.Code, rr.Body.String())
	}
	var reg struct {
		Status string `json:"status"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &reg)
	if reg.Status != "pending" {
		t.Fatalf("expected pending register response, got %#v", reg)
	}

	loginBody, _ := json.Marshal(map[string]string{
		"email":    email,
		"password": "password123",
	})
	req = httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(loginBody))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("pending login status=%d body=%s", rr.Code, rr.Body.String())
	}

	adminBody, _ := json.Marshal(map[string]string{
		"email":        cfg.BootstrapAdminEmail,
		"password":     "password123",
		"display_name": "Bootstrap",
	})
	req = httptest.NewRequest(http.MethodPost, "/api/auth/register", bytes.NewReader(adminBody))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code == http.StatusCreated {
		if len(rr.Result().Cookies()) == 0 {
			t.Fatal("bootstrap register should set session cookie")
		}
	} else if rr.Code == http.StatusConflict {
		req = httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(adminBody))
		req.Header.Set("Content-Type", "application/json")
		rr = httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("bootstrap login status=%d body=%s", rr.Code, rr.Body.String())
		}
	} else {
		t.Fatalf("bootstrap register status=%d body=%s", rr.Code, rr.Body.String())
	}
}
