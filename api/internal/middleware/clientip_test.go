package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func mustProxies(t *testing.T, raw string) {
	t.Helper()
	p, err := ParseTrustedProxies(raw)
	if err != nil {
		t.Fatal(err)
	}
	SetTrustedProxies(p)
	t.Cleanup(func() { SetTrustedProxies(nil) })
}

func TestParseTrustedProxies(t *testing.T) {
	p, err := ParseTrustedProxies("10.0.0.0/8, 192.168.1.5 ,fd00::/8")
	if err != nil {
		t.Fatal(err)
	}
	if len(p) != 3 {
		t.Fatalf("got %v", p)
	}
	if _, err := ParseTrustedProxies("10.0.0.0/33"); err == nil {
		t.Fatal("expected error for bad CIDR")
	}
	if _, err := ParseTrustedProxies("not-an-ip"); err == nil {
		t.Fatal("expected error for bad IP")
	}
	if p, err := ParseTrustedProxies(""); err != nil || len(p) != 0 {
		t.Fatalf("empty list: %v %v", p, err)
	}
}

func TestClientIP(t *testing.T) {
	cases := []struct {
		name    string
		trusted string
		remote  string
		xff     []string
		xrealip string
		want    string
	}{
		{name: "no proxies ignores XFF", remote: "203.0.113.9:5555", xff: []string{"1.1.1.1"}, want: "203.0.113.9"},
		{name: "no proxies ignores X-Real-IP", remote: "203.0.113.9:5555", xrealip: "1.1.1.1", want: "203.0.113.9"},
		{name: "untrusted peer ignores XFF", trusted: "10.0.0.0/8", remote: "203.0.113.9:1", xff: []string{"1.1.1.1"}, want: "203.0.113.9"},
		{name: "trusted peer single hop", trusted: "10.0.0.0/8", remote: "10.0.0.2:1", xff: []string{"198.51.100.7"}, want: "198.51.100.7"},
		{name: "spoofed left-most entry ignored", trusted: "10.0.0.0/8", remote: "10.0.0.2:1", xff: []string{"6.6.6.6, 198.51.100.7"}, want: "198.51.100.7"},
		{name: "multiple trusted hops", trusted: "10.0.0.0/8,172.16.0.0/12", remote: "10.0.0.2:1", xff: []string{"6.6.6.6, 198.51.100.7, 172.18.0.3"}, want: "198.51.100.7"},
		{name: "multiple XFF headers", trusted: "10.0.0.0/8", remote: "10.0.0.2:1", xff: []string{"6.6.6.6", "198.51.100.7, 10.1.1.1"}, want: "198.51.100.7"},
		{name: "all hops trusted", trusted: "10.0.0.0/8", remote: "10.0.0.2:1", xff: []string{"10.9.9.9, 10.1.1.1"}, want: "10.9.9.9"},
		{name: "garbage hop stops walk", trusted: "10.0.0.0/8", remote: "10.0.0.2:1", xff: []string{"1.2.3.4, bogus, 10.1.1.1"}, want: "10.1.1.1"},
		{name: "X-Real-IP from trusted peer", trusted: "10.0.0.0/8", remote: "10.0.0.2:1", xrealip: "198.51.100.8", want: "198.51.100.8"},
		{name: "trusted peer no headers", trusted: "10.0.0.0/8", remote: "10.0.0.2:1", want: "10.0.0.2"},
		{name: "single trusted IP", trusted: "10.0.0.2", remote: "10.0.0.2:1", xff: []string{"198.51.100.7"}, want: "198.51.100.7"},
		{name: "ipv6 peer", trusted: "fd00::/8", remote: "[fd00::1]:443", xff: []string{"2001:db8::5"}, want: "2001:db8::5"},
		{name: "hop with port", trusted: "10.0.0.0/8", remote: "10.0.0.2:1", xff: []string{"198.51.100.7:4444"}, want: "198.51.100.7"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mustProxies(t, tc.trusted)
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			req.RemoteAddr = tc.remote
			for _, v := range tc.xff {
				req.Header.Add("X-Forwarded-For", v)
			}
			if tc.xrealip != "" {
				req.Header.Set("X-Real-IP", tc.xrealip)
			}
			if got := ClientIP(req); got != tc.want {
				t.Fatalf("ClientIP=%q want %q", got, tc.want)
			}
		})
	}
}

func TestRealIPMiddlewareStoresResolvedIP(t *testing.T) {
	mustProxies(t, "10.0.0.0/8")
	var seen, remote string
	h := RealIP(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = ClientIP(r)
		remote = r.RemoteAddr
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.2:1"
	// Client IP itself lies in a trusted range; resolution must not re-walk.
	req.Header.Set("X-Forwarded-For", "10.5.5.5")
	h.ServeHTTP(httptest.NewRecorder(), req)
	if seen != "10.5.5.5" || remote != "10.5.5.5:0" {
		t.Fatalf("seen=%q remote=%q", seen, remote)
	}
}

func TestRateLimitIgnoresSpoofedXFF(t *testing.T) {
	SetTrustedProxies(nil)
	l := NewIPRateLimiter(1, time.Minute)
	h := RateLimit(l)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	for i, xff := range []string{"1.1.1.1", "2.2.2.2"} {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", nil)
		req.RemoteAddr = "203.0.113.1:999"
		req.Header.Set("X-Forwarded-For", xff)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		want := http.StatusOK
		if i == 1 {
			want = http.StatusTooManyRequests
		}
		if rr.Code != want {
			t.Fatalf("request %d: status=%d want %d", i, rr.Code, want)
		}
	}
}
