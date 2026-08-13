package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/config"
)

func TestHealth(t *testing.T) {
	a := &app.App{Cfg: config.Load()}
	h := NewRouter(a)
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestReadyWithoutDB(t *testing.T) {
	a := &app.App{Cfg: config.Load()}
	h := NewRouter(a)
	req := httptest.NewRequest(http.MethodGet, "/api/ready", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}
