// Package webui serves the built React SPA from inside the arkive binary.
//
// The Vite build output (web/dist) is copied into ./dist before `go build`
// (see docker/Dockerfile and the Makefile). A fresh checkout only has
// dist/.gitkeep, so dev builds and `go test ./...` still compile; in that case
// every SPA route answers with a placeholder page pointing at the Vite dev
// server.
package webui

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed all:dist
var distFS embed.FS

// Content-Security-Policy and friends, copied from the 1.0 docker/nginx.conf.
// script-src additionally allows the sha256 of any inline <script> found in
// index.html (the theme bootstrap), which nginx silently blocked.
const (
	cspBase = "default-src 'self'; script-src 'self'%s; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"

	cacheImmutable  = "public, max-age=31536000, immutable"
	cacheRevalidate = "no-cache"
)

var extraTypes = map[string]string{
	".woff2":       "font/woff2",
	".woff":        "font/woff",
	".ico":         "image/x-icon",
	".map":         "application/json",
	".webmanifest": "application/manifest+json",
	".txt":         "text/plain; charset=utf-8",
}

type asset struct {
	name  string
	data  []byte
	gz    []byte // precompressed body, nil when not worth it
	etag  string
	ctype string
	cache string
}

// Handler serves the SPA with index.html fallback for client-side routes.
type Handler struct {
	files       map[string]*asset
	index       *asset
	csp         string
	placeholder bool
}

var (
	embeddedOnce sync.Once
	embedded     *Handler
)

// New returns the (shared, lazily built) handler for the SPA embedded at
// build time.
func New() *Handler {
	embeddedOnce.Do(func() {
		sub, err := fs.Sub(distFS, "dist")
		if err != nil {
			panic(err)
		}
		embedded = NewFromFS(sub)
	})
	return embedded
}

// HasUI reports whether a real SPA build (index.html) was embedded.
func (h *Handler) HasUI() bool { return !h.placeholder }

// NewFromFS builds a handler over fsys (root = the Vite dist directory).
func NewFromFS(fsys fs.FS) *Handler {
	h := &Handler{files: map[string]*asset{}}
	_ = fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || strings.HasPrefix(path.Base(p), ".") {
			return nil
		}
		data, err := fs.ReadFile(fsys, p)
		if err != nil {
			return nil
		}
		h.files[p] = newAsset(p, data)
		return nil
	})
	if idx, ok := h.files["index.html"]; ok {
		h.index = idx
		h.csp = buildCSP(idx.data)
	} else {
		h.placeholder = true
		h.index = newAsset("index.html", []byte(placeholderHTML))
		h.csp = buildCSP(nil)
	}
	return h
}

func newAsset(name string, data []byte) *asset {
	sum := sha256.Sum256(data)
	ext := strings.ToLower(path.Ext(name))
	ctype := extraTypes[ext]
	if ctype == "" {
		ctype = mime.TypeByExtension(ext)
	}
	if ctype == "" {
		ctype = http.DetectContentType(data)
	}
	a := &asset{
		name:  name,
		data:  data,
		etag:  `"` + hex.EncodeToString(sum[:12]) + `"`,
		ctype: ctype,
		cache: cacheRevalidate,
	}
	// Vite emits content-hashed file names under assets/: safe to cache forever.
	if strings.HasPrefix(name, "assets/") {
		a.cache = cacheImmutable
	}
	if len(data) >= 1024 && compressible(ctype) {
		var buf bytes.Buffer
		zw, _ := gzip.NewWriterLevel(&buf, gzip.BestCompression)
		_, _ = zw.Write(data)
		_ = zw.Close()
		if buf.Len() < len(data)*9/10 {
			a.gz = buf.Bytes()
		}
	}
	return a
}

func compressible(ctype string) bool {
	for _, p := range []string{"text/", "application/javascript", "application/json", "image/svg+xml", "application/manifest+json", "application/wasm"} {
		if strings.HasPrefix(ctype, p) {
			return true
		}
	}
	return false
}

var (
	inlineScript = regexp.MustCompile(`(?is)<script\b([^>]*)>(.*?)</script>`)
	srcAttr      = regexp.MustCompile(`(?i)\bsrc\s*=`)
)

func buildCSP(indexHTML []byte) string {
	var hashes strings.Builder
	for _, m := range inlineScript.FindAllSubmatch(indexHTML, -1) {
		if srcAttr.Match(m[1]) || len(bytes.TrimSpace(m[2])) == 0 {
			continue
		}
		sum := sha256.Sum256(m[2])
		hashes.WriteString(" 'sha256-" + base64.StdEncoding.EncodeToString(sum[:]) + "'")
	}
	return strings.Replace(cspBase, "%s", hashes.String(), 1)
}

// SetSecurityHeaders adds the headers nginx used to add to every SPA response.
func (h *Handler) SetSecurityHeaders(w http.ResponseWriter) {
	hd := w.Header()
	hd.Set("Content-Security-Policy", h.csp)
	hd.Set("X-Frame-Options", "SAMEORIGIN")
	hd.Set("X-Content-Type-Options", "nosniff")
	hd.Set("Referrer-Policy", "same-origin")
}

// reserved reports prefixes owned by the API; they never fall back to the SPA.
func reserved(p string) bool {
	for _, pre := range []string{"/api", "/dav", "/metrics"} {
		if p == pre || strings.HasPrefix(p, pre+"/") {
			return true
		}
	}
	return false
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	clean := path.Clean("/" + r.URL.Path)
	if reserved(clean) {
		if strings.HasPrefix(clean, "/api") {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":"not found"}` + "\n"))
			return
		}
		http.NotFound(w, r)
		return
	}
	h.SetSecurityHeaders(w)

	name := strings.TrimPrefix(clean, "/")
	if a, ok := h.files[name]; ok && name != "index.html" {
		h.serveAsset(w, r, a)
		return
	}
	// Missing hashed assets or other files with an extension are real 404s —
	// answering index.html there would hand HTML to a <script> tag.
	if name != "" && name != "index.html" && (strings.HasPrefix(name, "assets/") || path.Ext(name) != "") {
		http.NotFound(w, r)
		return
	}
	h.serveAsset(w, r, h.index)
}

func (h *Handler) serveAsset(w http.ResponseWriter, r *http.Request, a *asset) {
	hd := w.Header()
	hd.Set("Content-Type", a.ctype)
	hd.Set("Cache-Control", a.cache)
	body := a.data
	etag := a.etag
	if a.gz != nil {
		hd.Add("Vary", "Accept-Encoding")
		if r.Header.Get("Range") == "" && acceptsGzip(r) {
			body = a.gz
			etag = strings.TrimSuffix(a.etag, `"`) + `-gz"`
			hd.Set("Content-Encoding", "gzip")
			// ServeContent omits Content-Length once Content-Encoding is set.
			hd.Set("Content-Length", strconv.Itoa(len(body)))
		}
	}
	hd.Set("ETag", etag)
	http.ServeContent(w, r, a.name, time.Time{}, bytes.NewReader(body))
}

func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		enc, q, _ := strings.Cut(strings.TrimSpace(part), ";")
		if strings.EqualFold(strings.TrimSpace(enc), "gzip") && strings.TrimSpace(q) != "q=0" {
			return true
		}
	}
	return false
}

const placeholderHTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Arkive (UI not built)</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5;color:#222}code{background:#eee;padding:.1em .3em;border-radius:3px}</style>
</head>
<body>
<h1>Arkive API is running</h1>
<p>This binary was built without the web UI embedded.</p>
<p>For development, run the Vite dev server (it proxies <code>/api</code> and <code>/dav</code> to this process on :8080):</p>
<pre><code>cd web &amp;&amp; npm install &amp;&amp; npm run dev</code></pre>
<p>and open <a href="http://localhost:5173">http://localhost:5173</a>.</p>
<p>To embed the UI, run <code>make build</code> (or copy <code>web/dist</code> into <code>api/internal/webui/dist</code> before <code>go build</code>).</p>
</body>
</html>
`
