package handlers_test

// Regressions found by running the web UI against the real API end to end
// (e2e/ suite). Each test pins one contract the UI relies on.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// grantee registers, approves and logs in a second user.
func (e *testEnv) grantee(prefix string) (uuid.UUID, string, *http.Cookie) {
	e.t.Helper()
	email := fmt.Sprintf("%s-%d@test.local", prefix, time.Now().UnixNano())
	id := e.registerPending(email, "password123", prefix)
	e.approve(id)
	return id, email, e.login(email, "password123")
}

func (e *testEnv) shareWith(nodeID uuid.UUID, email, perm string) {
	e.t.Helper()
	rr := e.do(http.MethodPost, "/api/nodes/"+nodeID.String()+"/shares",
		jsonBody(map[string]string{"grantee_email": email, "permission": perm}), "application/json")
	mustStatus(e.t, rr, http.StatusCreated, "share")
}

func (e *testEnv) mkdirIn(parent uuid.UUID, name string) uuid.UUID {
	e.t.Helper()
	rr := e.do(http.MethodPost, "/api/workspaces/"+e.WS.String()+"/folders",
		jsonBody(map[string]any{"name": name, "parent_id": parent}), "application/json")
	mustStatus(e.t, rr, http.StatusCreated, "mkdir "+name)
	return decodeID(e.t, rr)
}

func (e *testEnv) uploadIn(parent uuid.UUID, name, body, mime string) uuid.UUID {
	e.t.Helper()
	rr := e.do(http.MethodPut, "/api/workspaces/"+e.WS.String()+"/upload?name="+url.QueryEscape(name)+"&parent_id="+parent.String(),
		strings.NewReader(body), mime)
	mustStatus(e.t, rr, 0, "upload "+name)
	return decodeID(e.t, rr)
}

// A write share on a folder lets the grantee work inside it, but not move
// items out of it to the owner's workspace root (the Move dialog used to
// offer exactly that, and the API accepted it).
func TestSharedWriteGranteeStaysInsideShare(t *testing.T) {
	env := newTestEnv(t)
	shared := env.mkdir("Shared")
	sub := env.mkdirIn(shared, "Sub")
	file := env.uploadIn(shared, "doc.txt", "hello", "text/plain")
	_, email, cookie := env.grantee("writer")
	env.shareWith(shared, email, "write")

	rr := env.doAs(cookie, http.MethodPatch, "/api/nodes/"+file.String(), jsonBody(map[string]any{"parent_id": nil, "move": true}), "application/json")
	mustStatus(t, rr, http.StatusForbidden, "move to owner root")

	// Moving within the share still works.
	rr = env.doAs(cookie, http.MethodPatch, "/api/nodes/"+file.String(), jsonBody(map[string]any{"parent_id": sub, "move": true}), "application/json")
	mustStatus(t, rr, http.StatusOK, "move within share")

	// Paste (copy) into the shared folder, zip download, and undo of a delete.
	rr = env.doAs(cookie, http.MethodPost, "/api/nodes/copy",
		jsonBody(map[string]any{"node_ids": []uuid.UUID{file}, "target_workspace_id": env.WS, "target_parent_id": shared}), "application/json")
	mustStatus(t, rr, http.StatusCreated, "paste into shared folder")
	rr = env.doAs(cookie, http.MethodPost, "/api/workspaces/"+env.WS.String()+"/download-zip",
		jsonBody(map[string]any{"node_ids": []uuid.UUID{sub}}), "application/json")
	mustStatus(t, rr, http.StatusOK, "zip of shared subfolder")
	rr = env.doAs(cookie, http.MethodDelete, "/api/nodes/"+file.String(), nil, "")
	mustStatus(t, rr, 0, "grantee deletes")
	rr = env.doAs(cookie, http.MethodPost, "/api/nodes/"+file.String()+"/restore", nil, "")
	mustStatus(t, rr, http.StatusOK, "grantee undoes delete")

	// The grantee's listing starts at the shared folder, not the owner's tree.
	rr = env.doAs(cookie, http.MethodGet, "/api/workspaces/"+env.WS.String()+"/nodes?parent_id="+sub.String(), nil, "")
	mustStatus(t, rr, http.StatusOK, "list shared subfolder")
	var listing struct {
		Breadcrumbs []struct {
			ID uuid.UUID `json:"id"`
		} `json:"breadcrumbs"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &listing)
	if len(listing.Breadcrumbs) != 2 || listing.Breadcrumbs[0].ID != shared {
		t.Fatalf("breadcrumbs=%+v", listing.Breadcrumbs)
	}

	// Outsiders still get nothing.
	_, _, stranger := env.grantee("stranger")
	rr = env.doAs(stranger, http.MethodPost, "/api/workspaces/"+env.WS.String()+"/download-zip",
		jsonBody(map[string]any{"node_ids": []uuid.UUID{sub}}), "application/json")
	mustStatus(t, rr, http.StatusForbidden, "zip by stranger")
	rr = env.doAs(stranger, http.MethodPost, "/api/nodes/copy",
		jsonBody(map[string]any{"node_ids": []uuid.UUID{file}, "target_workspace_id": env.WS, "target_parent_id": shared}), "application/json")
	mustStatus(t, rr, http.StatusForbidden, "paste by stranger")
}

// A move without "name" keeps the name (it used to become "."), and "." is
// not a valid name for anything.
func TestMoveWithoutNameKeepsName(t *testing.T) {
	env := newTestEnv(t)
	dest := env.mkdir("Dest")
	file := env.upload("keep-me.txt", []byte("x"))
	rr := env.do(http.MethodPatch, "/api/nodes/"+file.String(), jsonBody(map[string]any{"parent_id": dest, "move": true}), "application/json")
	mustStatus(t, rr, http.StatusOK, "move")
	var n struct {
		Name string `json:"name"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &n)
	if n.Name != "keep-me.txt" {
		t.Fatalf("name after move = %q", n.Name)
	}
	for _, bad := range []string{".", "", "  "} {
		rr = env.do(http.MethodPost, "/api/workspaces/"+env.WS.String()+"/folders", jsonBody(map[string]string{"name": bad}), "application/json")
		mustStatus(t, rr, http.StatusBadRequest, fmt.Sprintf("mkdir %q", bad))
	}
}

func TestMoveOrCopyFolderIntoItselfRejected(t *testing.T) {
	env := newTestEnv(t)
	outer := env.mkdir("Outer")
	inner := env.mkdirIn(outer, "Inner")

	rr := env.do(http.MethodPatch, "/api/nodes/"+outer.String(), jsonBody(map[string]any{"parent_id": inner, "move": true}), "application/json")
	mustStatus(t, rr, http.StatusBadRequest, "move into descendant")

	for _, target := range []uuid.UUID{outer, inner} {
		rr = env.do(http.MethodPost, "/api/nodes/copy",
			jsonBody(map[string]any{"node_ids": []uuid.UUID{outer}, "target_workspace_id": env.WS, "target_parent_id": target}), "application/json")
		mustStatus(t, rr, http.StatusBadRequest, "copy into itself")
	}
}

// Ctrl+C / Ctrl+V in the same folder used to fail with a raw unique
// constraint error (500); copies get "name (1).ext" like file requests.
func TestCopyNextToOriginalGetsFreeName(t *testing.T) {
	env := newTestEnv(t)
	folder := env.mkdir("Docs")
	file := env.uploadIn(folder, "report.txt", "numbers", "text/plain")
	sub := env.mkdirIn(folder, "Photos")

	for i := 1; i <= 2; i++ {
		rr := env.do(http.MethodPost, "/api/nodes/copy",
			jsonBody(map[string]any{"node_ids": []uuid.UUID{file, sub}, "target_workspace_id": env.WS, "target_parent_id": folder}), "application/json")
		mustStatus(t, rr, http.StatusCreated, "copy next to original")
		var out struct {
			Nodes []struct {
				Name string `json:"name"`
			} `json:"nodes"`
		}
		_ = json.Unmarshal(rr.Body.Bytes(), &out)
		want := []string{fmt.Sprintf("report (%d).txt", i), fmt.Sprintf("Photos (%d)", i)}
		if len(out.Nodes) != 2 || out.Nodes[0].Name != want[0] || out.Nodes[1].Name != want[1] {
			t.Fatalf("copy %d names=%+v want %v", i, out.Nodes, want)
		}
	}
}

// Video/audio players need 206 answers from the preview endpoint.
func TestContentServesByteRangesForMedia(t *testing.T) {
	env := newTestEnv(t)
	payload := strings.Repeat("0123456789", 100)
	rr := env.do(http.MethodPut, "/api/workspaces/"+env.WS.String()+"/upload?name=clip.mp4", strings.NewReader(payload), "video/mp4")
	mustStatus(t, rr, 0, "upload video")
	id := decodeID(t, rr)

	req := httptest.NewRequest(http.MethodGet, "/api/nodes/"+id.String()+"/content", nil)
	req.Header.Set("Range", "bytes=100-109")
	req.AddCookie(env.Cookie)
	rec := httptest.NewRecorder()
	env.H.ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent {
		t.Fatalf("status=%d want 206", rec.Code)
	}
	if got := rec.Body.String(); got != payload[100:110] {
		t.Fatalf("body=%q", got)
	}
	if cr := rec.Header().Get("Content-Range"); cr != "bytes 100-109/1000" {
		t.Fatalf("Content-Range=%q", cr)
	}
}

// Header values are Latin-1: the UI percent-encodes link passwords, the meta
// response carries the size the share page shows.
func TestPublicLinkUnicodePasswordAndSize(t *testing.T) {
	env := newTestEnv(t)
	file := env.upload("photo.txt", []byte("0123456789"))
	pass := "pässwörd ✓ 100%"
	rr := env.do(http.MethodPost, "/api/nodes/"+file.String()+"/links", jsonBody(map[string]any{"password": pass}), "application/json")
	mustStatus(t, rr, http.StatusCreated, "link")
	var link struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &link)

	meta := func(header string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/api/public/"+link.Token, nil)
		if header != "" {
			req.Header.Set("X-Link-Password", header)
		}
		rec := httptest.NewRecorder()
		env.H.ServeHTTP(rec, req)
		return rec
	}
	mustStatus(t, meta(""), http.StatusUnauthorized, "no password")
	mustStatus(t, meta(url.PathEscape("wrong")), http.StatusUnauthorized, "wrong password")
	rec := meta(url.PathEscape(pass))
	mustStatus(t, rec, http.StatusOK, "encoded unicode password")
	var m struct {
		Size int64 `json:"size"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &m)
	if m.Size != 10 {
		t.Fatalf("meta size=%d body=%s", m.Size, rec.Body.String())
	}

	// Raw ASCII passwords (scripts, older clients) keep working.
	rr = env.do(http.MethodPost, "/api/nodes/"+file.String()+"/links", jsonBody(map[string]any{"password": "a%20b"}), "application/json")
	_ = json.Unmarshal(rr.Body.Bytes(), &link)
	mustStatus(t, meta("a%20b"), http.StatusOK, "raw password")
	mustStatus(t, meta(url.PathEscape("a%20b")), http.StatusOK, "encoded password with %")
}

func TestVersionDownloadKeepsExtension(t *testing.T) {
	env := newTestEnv(t)
	id := env.upload("report.md", []byte("v1"))
	rr := env.do(http.MethodPut, "/api/nodes/"+id.String()+"/content", strings.NewReader("v2"), "text/markdown")
	mustStatus(t, rr, 0, "save v2")
	rr = env.do(http.MethodGet, "/api/nodes/"+id.String()+"/versions/1/download", nil, "")
	mustStatus(t, rr, http.StatusOK, "version download")
	if cd := rr.Header().Get("Content-Disposition"); !strings.Contains(cd, `filename="report.v1.md"`) {
		t.Fatalf("Content-Disposition=%q", cd)
	}
}

// The activity panel lists removed shares and links (the UI has labels for
// them; they used to reach the audit log only).
func TestActivityRecordsShareAndLinkRemoval(t *testing.T) {
	env := newTestEnv(t)
	file := env.upload("a.txt", []byte("a"))
	_, email, _ := env.grantee("reader")
	rr := env.do(http.MethodPost, "/api/nodes/"+file.String()+"/shares", jsonBody(map[string]string{"grantee_email": email, "permission": "read"}), "application/json")
	shareID := decodeID(t, rr)
	rr = env.do(http.MethodPost, "/api/nodes/"+file.String()+"/links", jsonBody(map[string]any{}), "application/json")
	linkID := decodeID(t, rr)
	mustStatus(t, env.do(http.MethodDelete, "/api/shares/"+shareID.String(), nil, ""), 0, "unshare")
	mustStatus(t, env.do(http.MethodDelete, "/api/links/"+linkID.String(), nil, ""), 0, "delete link")

	rr = env.do(http.MethodGet, "/api/nodes/"+file.String()+"/activity", nil, "")
	mustStatus(t, rr, http.StatusOK, "activity")
	for _, action := range []string{"share.created", "share.deleted", "link.created", "link.deleted"} {
		if !strings.Contains(rr.Body.String(), `"`+action+`"`) {
			t.Errorf("activity lacks %s: %s", action, rr.Body.String())
		}
	}
}
