package handlers_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func tusMeta(kv map[string]string) string {
	var parts []string
	for k, v := range kv {
		parts = append(parts, k+" "+base64.StdEncoding.EncodeToString([]byte(v)))
	}
	return strings.Join(parts, ",")
}

func (e *testEnv) tus(method, path string, headers map[string]string, body []byte, cookie *http.Cookie) *httptest.ResponseRecorder {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req := httptest.NewRequest(method, path, rd)
	req.Header.Set("Tus-Resumable", "1.0.0")
	for k, v := range headers {
		if v == "" {
			req.Header.Del(k)
			continue
		}
		req.Header.Set(k, v)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	rr := httptest.NewRecorder()
	e.H.ServeHTTP(rr, req)
	if method != http.MethodOptions && rr.Header().Get("Tus-Resumable") != "1.0.0" {
		e.t.Errorf("%s %s: missing Tus-Resumable on response (status %d)", method, path, rr.Code)
	}
	return rr
}

func (e *testEnv) tusCreate(name string, length int, parent *uuid.UUID) string {
	e.t.Helper()
	meta := map[string]string{"workspace_id": e.WS.String(), "filename": name, "content_type": "text/plain"}
	if parent != nil {
		meta["parent_id"] = parent.String()
	}
	rr := e.tus(http.MethodPost, "/api/uploads", map[string]string{
		"Upload-Length":   strconv.Itoa(length),
		"Upload-Metadata": tusMeta(meta),
	}, nil, e.Cookie)
	if rr.Code != http.StatusCreated {
		e.t.Fatalf("create status=%d body=%s", rr.Code, rr.Body.String())
	}
	loc := rr.Header().Get("Location")
	if !strings.HasPrefix(loc, "/api/uploads/") {
		e.t.Fatalf("bad Location %q", loc)
	}
	if _, err := http.ParseTime(rr.Header().Get("Upload-Expires")); err != nil {
		e.t.Fatalf("bad Upload-Expires %q", rr.Header().Get("Upload-Expires"))
	}
	return loc
}

func (e *testEnv) tusPatch(loc string, offset int, chunk []byte, cookie *http.Cookie) *httptest.ResponseRecorder {
	e.t.Helper()
	return e.tus(http.MethodPatch, loc, map[string]string{
		"Content-Type":  "application/offset+octet-stream",
		"Upload-Offset": strconv.Itoa(offset),
	}, chunk, cookie)
}

func (e *testEnv) tusHeadOffset(loc string) int {
	e.t.Helper()
	rr := e.tus(http.MethodHead, loc, nil, nil, e.Cookie)
	if rr.Code != http.StatusOK {
		e.t.Fatalf("head status=%d", rr.Code)
	}
	if rr.Header().Get("Cache-Control") != "no-store" {
		e.t.Fatalf("HEAD missing Cache-Control: no-store")
	}
	n, err := strconv.Atoi(rr.Header().Get("Upload-Offset"))
	if err != nil {
		e.t.Fatalf("bad Upload-Offset %q", rr.Header().Get("Upload-Offset"))
	}
	return n
}

func TestTusOptions(t *testing.T) {
	env := newTestEnv(t)
	rr := env.tus(http.MethodOptions, "/api/uploads", map[string]string{"Tus-Resumable": ""}, nil, env.Cookie)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("status=%d", rr.Code)
	}
	if rr.Header().Get("Tus-Version") != "1.0.0" || rr.Header().Get("Tus-Extension") != "creation,termination,expiration" {
		t.Fatalf("headers=%v", rr.Header())
	}
	if rr.Header().Get("Tus-Max-Size") != strconv.FormatInt(env.App.Cfg.MaxUploadBytes, 10) {
		t.Fatalf("Tus-Max-Size=%q", rr.Header().Get("Tus-Max-Size"))
	}
	// Non-OPTIONS requests without Tus-Resumable are rejected.
	rr = env.tus(http.MethodPost, "/api/uploads", map[string]string{"Tus-Resumable": "", "Upload-Length": "1"}, nil, env.Cookie)
	if rr.Code != http.StatusPreconditionFailed {
		t.Fatalf("missing Tus-Resumable status=%d", rr.Code)
	}
	// Unauthenticated.
	rr = env.tus(http.MethodPost, "/api/uploads", map[string]string{"Upload-Length": "1"}, nil, nil)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status=%d", rr.Code)
	}
}

func TestTusResumableUploadFlow(t *testing.T) {
	env := newTestEnv(t)
	ctx := context.Background()
	folder := env.mkdir("docs")
	payload := bytes.Repeat([]byte("0123456789"), 100) // 1000 bytes
	loc := env.tusCreate("big.txt", len(payload), &folder)
	uploadID := strings.TrimPrefix(loc, "/api/uploads/")
	partPath := filepath.Join(env.App.UploadsDir(), uploadID)
	if _, err := os.Stat(partPath); err != nil {
		t.Fatalf("partial file not created: %v", err)
	}

	if got := env.tusHeadOffset(loc); got != 0 {
		t.Fatalf("initial offset=%d", got)
	}
	rr := env.tusPatch(loc, 0, payload[:300], env.Cookie)
	if rr.Code != http.StatusNoContent || rr.Header().Get("Upload-Offset") != "300" {
		t.Fatalf("patch1 status=%d offset=%s body=%s", rr.Code, rr.Header().Get("Upload-Offset"), rr.Body.String())
	}
	if rr.Header().Get("Arkive-Node-Id") != "" {
		t.Fatal("node id before completion")
	}
	// Resume: client asks where to continue.
	if got := env.tusHeadOffset(loc); got != 300 {
		t.Fatalf("resume offset=%d", got)
	}
	// Wrong offset → 409.
	rr = env.tusPatch(loc, 100, payload[100:200], env.Cookie)
	if rr.Code != http.StatusConflict {
		t.Fatalf("wrong offset status=%d", rr.Code)
	}
	// Wrong content type → 415.
	rr = env.tus(http.MethodPatch, loc, map[string]string{"Content-Type": "text/plain", "Upload-Offset": "300"}, payload[300:], env.Cookie)
	if rr.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("bad content-type status=%d", rr.Code)
	}
	// A concurrent PATCH holding the lock → 423.
	unlock, ok := env.App.LockUpload(uuid.MustParse(uploadID))
	if !ok {
		t.Fatal("could not take lock")
	}
	rr = env.tusPatch(loc, 300, payload[300:], env.Cookie)
	unlock()
	if rr.Code != http.StatusLocked {
		t.Fatalf("locked patch status=%d", rr.Code)
	}

	rr = env.tusPatch(loc, 300, payload[300:], env.Cookie)
	if rr.Code != http.StatusNoContent || rr.Header().Get("Upload-Offset") != "1000" {
		t.Fatalf("final patch status=%d offset=%s body=%s", rr.Code, rr.Header().Get("Upload-Offset"), rr.Body.String())
	}
	nodeID, err := uuid.Parse(rr.Header().Get("Arkive-Node-Id"))
	if err != nil {
		t.Fatalf("Arkive-Node-Id=%q", rr.Header().Get("Arkive-Node-Id"))
	}

	// Node exists in the right folder with content + checksum.
	var name string
	var parent *uuid.UUID
	var size int64
	var checksum *string
	if err := env.App.DB.QueryRow(ctx, `SELECT name, parent_id, size, checksum FROM nodes WHERE id = $1`, nodeID).Scan(&name, &parent, &size, &checksum); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(payload)
	if name != "big.txt" || parent == nil || *parent != folder || size != 1000 || checksum == nil || *checksum != hex.EncodeToString(sum[:]) {
		t.Fatalf("node name=%s parent=%v size=%d checksum=%v", name, parent, size, checksum)
	}
	dl := env.do(http.MethodGet, "/api/nodes/"+nodeID.String()+"/download", nil, "")
	if dl.Code != http.StatusOK || !bytes.Equal(dl.Body.Bytes(), payload) {
		t.Fatalf("download status=%d len=%d", dl.Code, dl.Body.Len())
	}
	// Session and partial data are gone.
	if _, err := os.Stat(partPath); !os.IsNotExist(err) {
		t.Fatalf("partial file still present: %v", err)
	}
	if rr := env.tus(http.MethodHead, loc, nil, nil, env.Cookie); rr.Code != http.StatusNotFound {
		t.Fatalf("head after completion status=%d", rr.Code)
	}

	// Same name again via tus → new version of the same node.
	payload2 := []byte("second version")
	loc2 := env.tusCreate("big.txt", len(payload2), &folder)
	rr = env.tusPatch(loc2, 0, payload2, env.Cookie)
	if rr.Code != http.StatusNoContent {
		t.Fatalf("v2 status=%d body=%s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("Arkive-Node-Id") != nodeID.String() {
		t.Fatalf("same-name upload made a new node %s (want %s)", rr.Header().Get("Arkive-Node-Id"), nodeID)
	}
	var versions int
	if err := env.App.DB.QueryRow(ctx, `SELECT COUNT(*) FROM node_versions WHERE node_id = $1`, nodeID).Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if versions != 1 {
		t.Fatalf("versions=%d want 1", versions)
	}
	dl = env.do(http.MethodGet, "/api/nodes/"+nodeID.String()+"/download", nil, "")
	if dl.Body.String() != string(payload2) {
		t.Fatalf("download after v2=%q", dl.Body.String())
	}
}

func TestTusZeroLengthAndOverflow(t *testing.T) {
	env := newTestEnv(t)
	rr := env.tus(http.MethodPost, "/api/uploads", map[string]string{
		"Upload-Length":   "0",
		"Upload-Metadata": tusMeta(map[string]string{"workspace_id": env.WS.String(), "filename": "empty.txt"}),
	}, nil, env.Cookie)
	if rr.Code != http.StatusCreated || rr.Header().Get("Arkive-Node-Id") == "" {
		t.Fatalf("zero-length status=%d node=%q body=%s", rr.Code, rr.Header().Get("Arkive-Node-Id"), rr.Body.String())
	}

	loc := env.tusCreate("small.txt", 4, nil)
	rr = env.tusPatch(loc, 0, []byte("toolong"), env.Cookie)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("overflow status=%d", rr.Code)
	}
}

func TestTusOtherUserAndDelete(t *testing.T) {
	env := newTestEnv(t)
	loc := env.tusCreate("mine.bin", 10, nil)
	if rr := env.tusPatch(loc, 0, []byte("abc"), env.Cookie); rr.Code != http.StatusNoContent {
		t.Fatalf("patch status=%d", rr.Code)
	}

	email := fmt.Sprintf("other-%d@test.local", time.Now().UnixNano())
	uid := env.registerPending(email, "password123", "Other")
	env.approve(uid)
	other := env.login(email, "password123")

	if rr := env.tus(http.MethodHead, loc, nil, nil, other); rr.Code != http.StatusNotFound {
		t.Fatalf("other HEAD status=%d", rr.Code)
	}
	if rr := env.tusPatch(loc, 3, []byte("def"), other); rr.Code != http.StatusNotFound {
		t.Fatalf("other PATCH status=%d", rr.Code)
	}
	if rr := env.tus(http.MethodDelete, loc, nil, nil, other); rr.Code != http.StatusNotFound {
		t.Fatalf("other DELETE status=%d", rr.Code)
	}
	// Other user cannot start an upload into this workspace either.
	rr := env.tus(http.MethodPost, "/api/uploads", map[string]string{
		"Upload-Length":   "5",
		"Upload-Metadata": tusMeta(map[string]string{"workspace_id": env.WS.String(), "filename": "x.txt"}),
	}, nil, other)
	if rr.Code != http.StatusForbidden && rr.Code != http.StatusNotFound {
		t.Fatalf("other create status=%d", rr.Code)
	}
	if got := env.tusHeadOffset(loc); got != 3 {
		t.Fatalf("offset after foreign attempts=%d", got)
	}

	partPath := filepath.Join(env.App.UploadsDir(), strings.TrimPrefix(loc, "/api/uploads/"))
	if rr := env.tus(http.MethodDelete, loc, nil, nil, env.Cookie); rr.Code != http.StatusNoContent {
		t.Fatalf("delete status=%d", rr.Code)
	}
	if rr := env.tus(http.MethodHead, loc, nil, nil, env.Cookie); rr.Code != http.StatusNotFound {
		t.Fatalf("head after delete status=%d", rr.Code)
	}
	if _, err := os.Stat(partPath); !os.IsNotExist(err) {
		t.Fatalf("partial file not removed: %v", err)
	}
}

func TestTusQuotaAndSizeLimits(t *testing.T) {
	env := newTestEnv(t)
	ctx := context.Background()
	if _, err := env.App.DB.Exec(ctx, `UPDATE workspaces SET quota_bytes = 100 WHERE id = $1`, env.WS); err != nil {
		t.Fatal(err)
	}
	meta := tusMeta(map[string]string{"workspace_id": env.WS.String(), "filename": "q.bin"})
	rr := env.tus(http.MethodPost, "/api/uploads", map[string]string{"Upload-Length": "101", "Upload-Metadata": meta}, nil, env.Cookie)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("over-quota create status=%d body=%s", rr.Code, rr.Body.String())
	}
	// Pending sessions count against quota too.
	env.tusCreate("a.bin", 60, nil)
	rr = env.tus(http.MethodPost, "/api/uploads", map[string]string{"Upload-Length": "60", "Upload-Metadata": meta}, nil, env.Cookie)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("pending-quota create status=%d", rr.Code)
	}

	// Quota is enforced again at completion.
	if _, err := env.App.DB.Exec(ctx, `DELETE FROM uploads WHERE workspace_id = $1`, env.WS); err != nil {
		t.Fatal(err)
	}
	loc := env.tusCreate("late.bin", 50, nil)
	if _, err := env.App.DB.Exec(ctx, `UPDATE workspaces SET quota_bytes = 10 WHERE id = $1`, env.WS); err != nil {
		t.Fatal(err)
	}
	rr = env.tusPatch(loc, 0, bytes.Repeat([]byte("z"), 50), env.Cookie)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("finalize over quota status=%d body=%s", rr.Code, rr.Body.String())
	}
	var n int
	if err := env.App.DB.QueryRow(ctx, `SELECT COUNT(*) FROM nodes WHERE workspace_id = $1 AND name = 'late.bin'`, env.WS).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatal("node created despite quota")
	}

	// ARKIVE_MAX_UPLOAD_BYTES.
	env.App.Cfg.MaxUploadBytes = 20
	rr = env.tus(http.MethodPost, "/api/uploads", map[string]string{"Upload-Length": "21", "Upload-Metadata": meta}, nil, env.Cookie)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("max size create status=%d", rr.Code)
	}
}

func TestTusPurgeExpired(t *testing.T) {
	env := newTestEnv(t)
	ctx := context.Background()
	loc := env.tusCreate("stale.bin", 10, nil)
	id := strings.TrimPrefix(loc, "/api/uploads/")
	if _, err := env.App.DB.Exec(ctx, `UPDATE uploads SET expires_at = now() - interval '1 minute' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if rr := env.tus(http.MethodHead, loc, nil, nil, env.Cookie); rr.Code != http.StatusNotFound {
		t.Fatalf("expired HEAD status=%d", rr.Code)
	}
	// Orphan partial file (no row), old enough to be purged.
	orphan := filepath.Join(env.App.UploadsDir(), uuid.NewString())
	if err := os.WriteFile(orphan, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-2 * time.Hour)
	_ = os.Chtimes(orphan, old, old)

	rep, err := env.App.PurgeExpiredUploads(ctx, false)
	if err != nil {
		t.Fatal(err)
	}
	if rep.ExpiredSessions < 1 || rep.OrphanFiles < 1 {
		t.Fatalf("report=%+v", rep)
	}
	if _, err := os.Stat(filepath.Join(env.App.UploadsDir(), id)); !os.IsNotExist(err) {
		t.Fatal("expired partial file kept")
	}
	if _, err := os.Stat(orphan); !os.IsNotExist(err) {
		t.Fatal("orphan partial file kept")
	}
}
