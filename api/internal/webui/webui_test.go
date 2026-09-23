package webui

import (
	"compress/gzip"
	"crypto/sha256"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

const themeScript = "\n      (function(){ document.documentElement.dataset.x = '1'; })();\n    "

func testFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":             {Data: []byte("<!doctype html><html><head><script>" + themeScript + "</script><script type=\"module\" src=\"/assets/index-abc123.js\"></script></head><body><div id=root></div></body></html>")},
		"assets/index-abc123.js": {Data: []byte("console.log('" + strings.Repeat("arkive ", 400) + "')")},
		"assets/app-def.css":     {Data: []byte("body{}")},
		"favicon.svg":            {Data: []byte("<svg xmlns='http://www.w3.org/2000/svg'></svg>")},
		".gitkeep":               {Data: nil},
	}
}

func get(h http.Handler, path string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	return rr
}

func checkSecurityHeaders(t *testing.T, rr *httptest.ResponseRecorder) {
	t.Helper()
	want := map[string]string{
		"X-Frame-Options":        "SAMEORIGIN",
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy":        "same-origin",
	}
	for k, v := range want {
		if got := rr.Header().Get(k); got != v {
			t.Errorf("%s=%q want %q", k, got, v)
		}
	}
	csp := rr.Header().Get("Content-Security-Policy")
	for _, part := range []string{"default-src 'self'", "script-src 'self'", "frame-ancestors 'self'", "base-uri 'self'", "form-action 'self'", "style-src 'self' 'unsafe-inline'"} {
		if !strings.Contains(csp, part) {
			t.Errorf("CSP missing %q: %s", part, csp)
		}
	}
}

func TestIndexFallbackForClientRoutes(t *testing.T) {
	h := NewFromFS(testFS())
	if !h.HasUI() {
		t.Fatal("expected UI")
	}
	for _, p := range []string{"/", "/login", "/s/abcDEF_123", "/w/1234/f/5678", "/admin", "/index.html"} {
		rr := get(h, p, nil)
		if rr.Code != http.StatusOK {
			t.Fatalf("%s status=%d", p, rr.Code)
		}
		if !strings.Contains(rr.Body.String(), `<div id=root>`) {
			t.Fatalf("%s did not serve index.html", p)
		}
		if cc := rr.Header().Get("Cache-Control"); cc != "no-cache" {
			t.Fatalf("%s index Cache-Control=%q", p, cc)
		}
		if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
			t.Fatalf("%s content-type=%q", p, ct)
		}
		checkSecurityHeaders(t, rr)
	}
}

func TestInlineScriptHashInCSP(t *testing.T) {
	h := NewFromFS(testFS())
	sum := sha256.Sum256([]byte(themeScript))
	want := "'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'"
	csp := get(h, "/", nil).Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "script-src 'self' "+want+";") {
		t.Fatalf("CSP lacks inline script hash %s: %s", want, csp)
	}
	if strings.Count(csp, "sha256-") != 1 {
		t.Fatalf("external module script must not be hashed: %s", csp)
	}
}

func TestHashedAssetsCachedForever(t *testing.T) {
	h := NewFromFS(testFS())
	rr := get(h, "/assets/app-def.css", nil)
	if rr.Code != http.StatusOK || rr.Body.String() != "body{}" {
		t.Fatalf("status=%d body=%q", rr.Code, rr.Body.String())
	}
	if cc := rr.Header().Get("Cache-Control"); cc != "public, max-age=31536000, immutable" {
		t.Fatalf("Cache-Control=%q", cc)
	}
	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/css") {
		t.Fatalf("Content-Type=%q", ct)
	}
	checkSecurityHeaders(t, rr)

	// Non-hashed static files revalidate.
	rr = get(h, "/favicon.svg", nil)
	if rr.Code != http.StatusOK || rr.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("favicon status=%d cc=%q", rr.Code, rr.Header().Get("Cache-Control"))
	}
}

func TestETagRevalidation(t *testing.T) {
	h := NewFromFS(testFS())
	rr := get(h, "/login", nil)
	etag := rr.Header().Get("ETag")
	if etag == "" {
		t.Fatal("missing ETag")
	}
	rr = get(h, "/login", map[string]string{"If-None-Match": etag})
	if rr.Code != http.StatusNotModified {
		t.Fatalf("status=%d want 304", rr.Code)
	}
}

func TestGzip(t *testing.T) {
	h := NewFromFS(testFS())
	rr := get(h, "/assets/index-abc123.js", map[string]string{"Accept-Encoding": "gzip, br"})
	if rr.Header().Get("Content-Encoding") != "gzip" {
		t.Fatal("expected gzip")
	}
	zr, err := gzip.NewReader(rr.Body)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(zr)
	if !strings.HasPrefix(string(body), "console.log") {
		t.Fatalf("bad body %q", body[:20])
	}
	rr = get(h, "/assets/index-abc123.js", nil)
	if rr.Header().Get("Content-Encoding") != "" || !strings.HasPrefix(rr.Body.String(), "console.log") {
		t.Fatal("identity response expected without Accept-Encoding")
	}
}

func TestMissingFilesAre404(t *testing.T) {
	h := NewFromFS(testFS())
	for _, p := range []string{"/assets/missing-123.js", "/robots.txt", "/.gitkeep"} {
		if rr := get(h, p, nil); rr.Code != http.StatusNotFound {
			t.Fatalf("%s status=%d want 404", p, rr.Code)
		}
	}
}

func TestReservedPrefixesNeverServeSPA(t *testing.T) {
	h := NewFromFS(testFS())
	for _, p := range []string{"/api", "/api/nope", "/dav/x", "/metrics", "/api/../api/x"} {
		rr := get(h, p, nil)
		if rr.Code != http.StatusNotFound || strings.Contains(rr.Body.String(), "root") {
			t.Fatalf("%s status=%d body=%q", p, rr.Code, rr.Body.String())
		}
	}
	rr := get(h, "/api/nope", nil)
	if !strings.HasPrefix(rr.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("api 404 should be JSON, got %q", rr.Header().Get("Content-Type"))
	}
}

func TestMethodNotAllowed(t *testing.T) {
	h := NewFromFS(testFS())
	req := httptest.NewRequest(http.MethodPost, "/login", nil)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status=%d", rr.Code)
	}
	req = httptest.NewRequest(http.MethodHead, "/login", nil)
	rr = httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK || rr.Body.Len() != 0 {
		t.Fatalf("HEAD status=%d len=%d", rr.Code, rr.Body.Len())
	}
}

func TestPlaceholderWithoutBuild(t *testing.T) {
	h := NewFromFS(fstest.MapFS{".gitkeep": {Data: nil}})
	if h.HasUI() {
		t.Fatal("expected placeholder")
	}
	rr := get(h, "/some/route", nil)
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), "npm run dev") {
		t.Fatalf("status=%d body=%q", rr.Code, rr.Body.String())
	}
	checkSecurityHeaders(t, rr)
}

func TestEmbeddedHandlerBuilds(t *testing.T) {
	// Whatever is in dist (a .gitkeep in a fresh checkout, a full build in
	// the Docker image), New must not panic and must answer "/".
	if rr := get(New(), "/", nil); rr.Code != http.StatusOK {
		t.Fatalf("status=%d", rr.Code)
	}
}
