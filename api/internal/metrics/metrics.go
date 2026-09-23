// Package metrics exposes Prometheus metrics at /metrics.
//
// It uses prometheus/client_golang rather than a hand-rolled exposition: the
// library is the reference implementation of the text format, gives correct
// histogram/label escaping for free, and adds the standard go_* / process_*
// collectors operators expect. It only pulls a handful of small modules.
package metrics

import (
	"context"
	"crypto/subtle"
	"io"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// Sources supplies instance-level gauges. Each func is called at most once
// per CacheTTL, so scrapes never hammer the database.
type Sources struct {
	ActiveSessions func(ctx context.Context) (int64, error)
	StorageBytes   func(ctx context.Context) (int64, error)
}

// CacheTTL bounds how often Sources are queried.
const CacheTTL = 60 * time.Second

// Metrics owns a private registry (no global state, so tests can build many).
type Metrics struct {
	reg         *prometheus.Registry
	requests    *prometheus.CounterVec
	duration    *prometheus.HistogramVec
	uploadBytes prometheus.Counter
}

// New registers all collectors.
func New(version string, src Sources) *Metrics {
	reg := prometheus.NewRegistry()
	m := &Metrics{
		reg: reg,
		requests: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "arkive_http_requests_total",
			Help: "HTTP requests by chi route pattern, method and status code.",
		}, []string{"route", "method", "status"}),
		duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "arkive_http_request_duration_seconds",
			Help:    "HTTP request latency by chi route pattern and method.",
			Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10, 30, 60, 300},
		}, []string{"route", "method"}),
		uploadBytes: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "arkive_upload_bytes_total",
			Help: "File bytes received in upload request bodies (PUT/PATCH, including WebDAV and tus).",
		}),
	}
	buildInfo := prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "arkive_build_info",
		Help: "Build information; value is always 1.",
	}, []string{"version", "goversion"})
	buildInfo.WithLabelValues(version, runtime.Version()).Set(1)

	reg.MustRegister(m.requests, m.duration, m.uploadBytes, buildInfo,
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)
	if src.ActiveSessions != nil {
		reg.MustRegister(prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "arkive_active_sessions",
			Help: "Unexpired login sessions (refreshed at most every 60s).",
		}, newCached(src.ActiveSessions).get))
	}
	if src.StorageBytes != nil {
		reg.MustRegister(prometheus.NewGaugeFunc(prometheus.GaugeOpts{
			Name: "arkive_storage_bytes_used",
			Help: "Bytes stored across all backends: current files plus old versions, trash included (refreshed at most every 60s).",
		}, newCached(src.StorageBytes).get))
	}
	return m
}

// Registry is exposed for tests.
func (m *Metrics) Registry() *prometheus.Registry { return m.reg }

type cached struct {
	mu   sync.Mutex
	fn   func(context.Context) (int64, error)
	at   time.Time
	val  float64
	have bool
}

func newCached(fn func(context.Context) (int64, error)) *cached { return &cached{fn: fn} }

func (c *cached) get() float64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.have && time.Since(c.at) < CacheTTL {
		return c.val
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	v, err := c.fn(ctx)
	c.at = time.Now() // back off on errors too
	if err == nil {
		c.val = float64(v)
		c.have = true
	}
	return c.val
}

// Handler serves the exposition. With a non-empty token it requires
// "Authorization: Bearer <token>".
func (m *Metrics) Handler(token string) http.Handler {
	inner := promhttp.HandlerFor(m.reg, promhttp.HandlerOpts{})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token != "" {
			got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if !ok || subtle.ConstantTimeCompare([]byte(strings.TrimSpace(got)), []byte(token)) != 1 {
				w.Header().Set("WWW-Authenticate", `Bearer realm="arkive-metrics"`)
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		}
		inner.ServeHTTP(w, r)
	})
}

type countingBody struct {
	io.ReadCloser
	n int64
}

func (c *countingBody) Read(p []byte) (int, error) {
	n, err := c.ReadCloser.Read(p)
	c.n += int64(n)
	return n, err
}

// normMethod bounds label cardinality: arbitrary verbs reach the WebDAV path.
func normMethod(m string) string {
	switch m {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch,
		http.MethodDelete, http.MethodOptions, "PROPFIND", "PROPPATCH", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK":
		return m
	}
	return "OTHER"
}

func isUploadBody(r *http.Request) bool {
	if r.Method != http.MethodPut && r.Method != http.MethodPatch {
		return false
	}
	ct := strings.ToLower(r.Header.Get("Content-Type"))
	return !strings.HasPrefix(ct, "application/json")
}

// Instrument wraps the whole router. It seeds a chi route context so the
// matched pattern ("/api/nodes/{nodeID}/download") is visible after chi
// routes the request — raw paths would explode label cardinality.
func (m *Metrics) Instrument(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rctx := chi.NewRouteContext()
		r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
		var body *countingBody
		if isUploadBody(r) && r.Body != nil && r.Body != http.NoBody {
			body = &countingBody{ReadCloser: r.Body}
			r.Body = body
		}
		ww := chimw.NewWrapResponseWriter(w, r.ProtoMajor)
		defer func() {
			route := rctx.RoutePattern()
			switch {
			case strings.HasPrefix(r.URL.Path, "/dav/"):
				route = "/dav/*"
			case route == "":
				route = "unmatched"
			}
			status := ww.Status()
			if status == 0 {
				status = http.StatusOK
			}
			method := normMethod(r.Method)
			m.requests.WithLabelValues(route, method, strconv.Itoa(status)).Inc()
			m.duration.WithLabelValues(route, method).Observe(time.Since(start).Seconds())
			if body != nil && body.n > 0 {
				m.uploadBytes.Add(float64(body.n))
			}
		}()
		next.ServeHTTP(ww, r)
	})
}
