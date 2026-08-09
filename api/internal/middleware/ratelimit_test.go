package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestIPRateLimiter(t *testing.T) {
	l := NewIPRateLimiter(2, time.Minute)
	if !l.Allow("1.2.3.4") || !l.Allow("1.2.3.4") {
		t.Fatal("first two should allow")
	}
	if l.Allow("1.2.3.4") {
		t.Fatal("third should deny")
	}
	if !l.Allow("9.9.9.9") {
		t.Fatal("other IP should allow")
	}
}

func TestRateLimitMiddleware(t *testing.T) {
	l := NewIPRateLimiter(1, time.Minute)
	h := RateLimit(l)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
	req.RemoteAddr = "10.0.0.1:1234"
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("first=%d", rr.Code)
	}
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("second=%d", rr.Code)
	}
}
