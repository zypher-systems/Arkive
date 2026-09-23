package handlers_test

import (
	"context"
	"encoding/xml"
	"fmt"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// ---- helpers ---------------------------------------------------------------

type davHdr map[string]string

// davURL builds a request target with every segment percent-encoded.
func (e *testEnv) davURL(rel string) string {
	p := "/dav/" + e.WS.String() + "/"
	if rel == "" {
		return p
	}
	segs := strings.Split(rel, "/")
	for i, s := range segs {
		segs[i] = url.PathEscape(s)
	}
	return p + strings.Join(segs, "/")
}

func (e *testEnv) dav(method, rel, body string, hdr davHdr) *httptest.ResponseRecorder {
	e.t.Helper()
	req := httptest.NewRequest(method, e.davURL(rel), strings.NewReader(body))
	// The /dav rate limiter is per IP; spread test traffic across addresses.
	req.RemoteAddr = fmt.Sprintf("10.%d.%d.%d:1234", rand.IntN(250), rand.IntN(250), rand.IntN(250)+1)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	req.AddCookie(e.Cookie)
	rr := httptest.NewRecorder()
	e.H.ServeHTTP(rr, req)
	return rr
}

func (e *testEnv) davExpect(want int, method, rel, body string, hdr davHdr) *httptest.ResponseRecorder {
	e.t.Helper()
	rr := e.dav(method, rel, body, hdr)
	if rr.Code != want {
		e.t.Fatalf("%s %s: status=%d want %d body=%s", method, rel, rr.Code, want, rr.Body.String())
	}
	return rr
}

func (e *testEnv) davPut(rel, content string) string {
	e.t.Helper()
	rr := e.dav(http.MethodPut, rel, content, davHdr{"Content-Type": "text/plain"})
	if rr.Code != http.StatusCreated && rr.Code != http.StatusNoContent {
		e.t.Fatalf("PUT %s status=%d body=%s", rel, rr.Code, rr.Body.String())
	}
	return rr.Header().Get("ETag")
}

func (e *testEnv) davGet(rel string) string {
	e.t.Helper()
	return e.davExpect(http.StatusOK, http.MethodGet, rel, "", nil).Body.String()
}

func (e *testEnv) destHdr(rel string, extra davHdr) davHdr {
	h := davHdr{"Destination": "http://example.com" + e.davURL(rel)}
	for k, v := range extra {
		h[k] = v
	}
	return h
}

type msProp struct {
	XMLName xml.Name
	Inner   string `xml:",innerxml"`
}

type msPropstat struct {
	Status string `xml:"status"`
	Prop   struct {
		Items []msProp `xml:",any"`
	} `xml:"prop"`
}

type msResponse struct {
	Href      string       `xml:"href"`
	Propstats []msPropstat `xml:"propstat"`
}

type multistatus struct {
	XMLName   xml.Name     `xml:"DAV: multistatus"`
	Responses []msResponse `xml:"response"`
}

func parseMS(t *testing.T, rr *httptest.ResponseRecorder) multistatus {
	t.Helper()
	if rr.Code != http.StatusMultiStatus {
		t.Fatalf("status=%d want 207 body=%s", rr.Code, rr.Body.String())
	}
	var ms multistatus
	if err := xml.Unmarshal(rr.Body.Bytes(), &ms); err != nil {
		t.Fatalf("invalid multistatus XML: %v\n%s", err, rr.Body.String())
	}
	return ms
}

func (ms multistatus) find(t *testing.T, href string) msResponse {
	t.Helper()
	for _, r := range ms.Responses {
		if r.Href == href {
			return r
		}
	}
	var got []string
	for _, r := range ms.Responses {
		got = append(got, r.Href)
	}
	t.Fatalf("href %q not in multistatus; have %v", href, got)
	return msResponse{}
}

// prop returns the inner XML of a property and the status code it was reported with.
func (r msResponse) prop(space, local string) (string, int) {
	for _, ps := range r.Propstats {
		code := 0
		if f := strings.Fields(ps.Status); len(f) >= 2 {
			fmt.Sscanf(f[1], "%d", &code)
		}
		for _, p := range ps.Prop.Items {
			if p.XMLName.Space == space && p.XMLName.Local == local {
				return p.Inner, code
			}
		}
	}
	return "", 0
}

func (e *testEnv) nodeIDByName(name string) (uuid.UUID, bool) {
	var id uuid.UUID
	err := e.App.DB.QueryRow(context.Background(),
		`SELECT id FROM nodes WHERE workspace_id = $1 AND name = $2 AND deleted_at IS NULL`, e.WS, name).Scan(&id)
	return id, err == nil
}

const lockBody = `<?xml version="1.0" encoding="utf-8"?>
<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner><D:href>tester</D:href></D:owner></D:lockinfo>`

// ---- tests -----------------------------------------------------------------

func TestWebDAVOptionsAdvertisesClass2(t *testing.T) {
	env := newTestEnv(t)
	rr := env.davExpect(http.StatusOK, http.MethodOptions, "", "", nil)
	if dav := rr.Header().Get("DAV"); !strings.Contains(dav, "2") {
		t.Fatalf("DAV header=%q", dav)
	}
	for _, m := range []string{"LOCK", "UNLOCK", "PROPPATCH", "MOVE"} {
		if !strings.Contains(rr.Header().Get("Allow"), m) {
			t.Fatalf("Allow missing %s: %q", m, rr.Header().Get("Allow"))
		}
	}
}

func TestWebDAVMoveOverwrite(t *testing.T) {
	env := newTestEnv(t)
	env.davPut("doc.txt", "original")
	origID, _ := env.nodeIDByName("doc.txt")
	env.davPut("doc.txt~tmp", "edited")

	// Overwrite: F refuses an existing destination.
	env.davExpect(http.StatusPreconditionFailed, "MOVE", "doc.txt~tmp", "", env.destHdr("doc.txt", davHdr{"Overwrite": "F"}))
	if env.davGet("doc.txt") != "original" {
		t.Fatal("Overwrite: F must not modify the destination")
	}

	// Default (T): temp-file-then-rename replaces the destination -> 204.
	env.davExpect(http.StatusNoContent, "MOVE", "doc.txt~tmp", "", env.destHdr("doc.txt", nil))
	if got := env.davGet("doc.txt"); got != "edited" {
		t.Fatalf("content after overwrite=%q", got)
	}
	env.davExpect(http.StatusNotFound, http.MethodGet, "doc.txt~tmp", "", nil)
	newID, _ := env.nodeIDByName("doc.txt")
	if newID != origID {
		t.Fatal("file-over-file MOVE should keep the destination node (id, shares, history)")
	}
	var versions int
	if err := env.App.DB.QueryRow(context.Background(), `SELECT COUNT(*) FROM node_versions WHERE node_id = $1`, origID).Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if versions != 1 {
		t.Fatalf("old content should be kept as a version, versions=%d", versions)
	}

	// Explicit T to a new name -> 201.
	env.davExpect(http.StatusCreated, "MOVE", "doc.txt", "", env.destHdr("renamed.txt", davHdr{"Overwrite": "T"}))
	env.davGet("renamed.txt")

	// Collection over collection: old destination goes to the trash.
	env.davExpect(http.StatusCreated, "MKCOL", "d1", "", nil)
	env.davPut("d1/x.txt", "x")
	env.davExpect(http.StatusCreated, "MKCOL", "d2", "", nil)
	env.davPut("d2/y.txt", "y")
	env.davExpect(http.StatusPreconditionFailed, "MOVE", "d1", "", env.destHdr("d2", davHdr{"Overwrite": "F"}))
	env.davExpect(http.StatusNoContent, "MOVE", "d1", "", env.destHdr("d2", nil))
	if env.davGet("d2/x.txt") != "x" {
		t.Fatal("moved collection content missing")
	}
	env.davExpect(http.StatusNotFound, http.MethodGet, "d2/y.txt", "", nil)
	var trashed int
	if err := env.App.DB.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM nodes WHERE workspace_id = $1 AND name IN ('d2','y.txt') AND deleted_at IS NOT NULL`, env.WS).Scan(&trashed); err != nil {
		t.Fatal(err)
	}
	if trashed != 2 {
		t.Fatalf("replaced collection should be in trash, trashed=%d", trashed)
	}

	// File over collection also trashes the collection.
	env.davExpect(http.StatusNoContent, "MOVE", "renamed.txt", "", env.destHdr("d2", nil))
	if env.davGet("d2") != "edited" {
		t.Fatal("file should now live at d2")
	}

	// Invalid moves.
	env.davExpect(http.StatusCreated, "MKCOL", "p", "", nil)
	env.davExpect(http.StatusCreated, "MKCOL", "p/c", "", nil)
	env.davExpect(http.StatusConflict, "MOVE", "p", "", env.destHdr("p/c/p", nil))
	env.davExpect(http.StatusConflict, "MOVE", "p/c", "", env.destHdr("p", nil))
	env.davExpect(http.StatusForbidden, "MOVE", "p", "", env.destHdr("p", nil))
	env.davExpect(http.StatusConflict, "MOVE", "p", "", env.destHdr("missing/p", nil))
	env.davExpect(http.StatusBadRequest, "MOVE", "p", "", env.destHdr("q", davHdr{"Overwrite": "maybe"}))
	env.davExpect(http.StatusBadGateway, "MOVE", "p", "", davHdr{"Destination": "/dav/" + uuid.NewString() + "/p"})
}

func TestWebDAVCopyOverwrite(t *testing.T) {
	env := newTestEnv(t)
	env.davPut("a.txt", "AAA")
	env.davPut("b.txt", "BBB")
	env.davExpect(http.StatusPreconditionFailed, "COPY", "a.txt", "", env.destHdr("b.txt", davHdr{"Overwrite": "F"}))
	env.davExpect(http.StatusNoContent, "COPY", "a.txt", "", env.destHdr("b.txt", nil))
	if env.davGet("b.txt") != "AAA" || env.davGet("a.txt") != "AAA" {
		t.Fatal("COPY overwrite content wrong")
	}
	bID, _ := env.nodeIDByName("b.txt")
	var versions int
	_ = env.App.DB.QueryRow(context.Background(), `SELECT COUNT(*) FROM node_versions WHERE node_id = $1`, bID).Scan(&versions)
	if versions != 1 {
		t.Fatalf("overwritten content should be a version, got %d", versions)
	}
	env.davExpect(http.StatusCreated, "COPY", "a.txt", "", env.destHdr("c.txt", nil))

	// Collection copy, deep and shallow.
	env.davExpect(http.StatusCreated, "MKCOL", "src", "", nil)
	env.davPut("src/f.txt", "F")
	env.davExpect(http.StatusCreated, "COPY", "src", "", env.destHdr("deep", nil))
	if env.davGet("deep/f.txt") != "F" {
		t.Fatal("deep copy missing child")
	}
	env.davExpect(http.StatusCreated, "COPY", "src", "", env.destHdr("shallow", davHdr{"Depth": "0"}))
	env.davExpect(http.StatusNotFound, http.MethodGet, "shallow/f.txt", "", nil)
	env.davExpect(http.StatusConflict, "COPY", "src", "", env.destHdr("src/inner", nil))
}

func TestWebDAVETagsAndConditionals(t *testing.T) {
	env := newTestEnv(t)
	etag := env.davPut("e.txt", "v1")
	if etag == "" || !strings.HasPrefix(etag, `"`) {
		t.Fatalf("PUT ETag=%q", etag)
	}
	get := env.davExpect(http.StatusOK, http.MethodGet, "e.txt", "", nil)
	if get.Header().Get("ETag") != etag {
		t.Fatalf("GET ETag=%q want %q", get.Header().Get("ETag"), etag)
	}
	if get.Header().Get("Last-Modified") == "" {
		t.Fatal("GET missing Last-Modified")
	}
	head := env.davExpect(http.StatusOK, http.MethodHead, "e.txt", "", nil)
	if head.Header().Get("ETag") != etag || head.Header().Get("Content-Length") != "2" || head.Body.Len() != 0 {
		t.Fatalf("HEAD etag=%q len=%q body=%d", head.Header().Get("ETag"), head.Header().Get("Content-Length"), head.Body.Len())
	}
	ms := parseMS(t, env.dav("PROPFIND", "e.txt", "", davHdr{"Depth": "0"}))
	if v, code := ms.find(t, env.davURL("e.txt")).prop("DAV:", "getetag"); code != 200 || v != etag {
		t.Fatalf("PROPFIND getetag=%q (%d) want %q", v, code, etag)
	}

	// GET conditionals.
	env.davExpect(http.StatusNotModified, http.MethodGet, "e.txt", "", davHdr{"If-None-Match": etag})
	env.davExpect(http.StatusPreconditionFailed, http.MethodGet, "e.txt", "", davHdr{"If-Match": `"nope"`})
	env.davExpect(http.StatusOK, http.MethodGet, "e.txt", "", davHdr{"If-Match": etag})

	// PUT conditionals.
	env.davExpect(http.StatusPreconditionFailed, http.MethodPut, "e.txt", "v2", davHdr{"If-Match": `"nope"`})
	env.davExpect(http.StatusPreconditionFailed, http.MethodPut, "e.txt", "v2", davHdr{"If-None-Match": "*"})
	env.davExpect(http.StatusCreated, http.MethodPut, "fresh.txt", "new", davHdr{"If-None-Match": "*"})
	env.davExpect(http.StatusPreconditionFailed, http.MethodPut, "absent.txt", "x", davHdr{"If-Match": "*"})
	put := env.davExpect(http.StatusNoContent, http.MethodPut, "e.txt", "v2", davHdr{"If-Match": etag})
	etag2 := put.Header().Get("ETag")
	if etag2 == "" || etag2 == etag {
		t.Fatalf("ETag must change with content: %q -> %q", etag, etag2)
	}

	// Rename keeps the content ETag; MOVE honours If-Match on the source.
	env.davExpect(http.StatusPreconditionFailed, "MOVE", "e.txt", "", env.destHdr("moved.txt", davHdr{"If-Match": etag}))
	env.davExpect(http.StatusCreated, "MOVE", "e.txt", "", env.destHdr("moved.txt", davHdr{"If-Match": etag2}))
	if got := env.davExpect(http.StatusOK, http.MethodHead, "moved.txt", "", nil).Header().Get("ETag"); got != etag2 {
		t.Fatalf("ETag after rename=%q want %q", got, etag2)
	}

	// DELETE conditionals.
	env.davExpect(http.StatusPreconditionFailed, http.MethodDelete, "moved.txt", "", davHdr{"If-Match": etag})
	env.davExpect(http.StatusNoContent, http.MethodDelete, "moved.txt", "", davHdr{"If-Match": etag2})

	// Range requests.
	env.davPut("r.txt", "0123456789")
	rr := env.davExpect(http.StatusPartialContent, http.MethodGet, "r.txt", "", davHdr{"Range": "bytes=2-4"})
	if rr.Body.String() != "234" || rr.Header().Get("Content-Range") != "bytes 2-4/10" {
		t.Fatalf("range body=%q cr=%q", rr.Body.String(), rr.Header().Get("Content-Range"))
	}
	env.davExpect(http.StatusRequestedRangeNotSatisfiable, http.MethodGet, "r.txt", "", davHdr{"Range": "bytes=50-60"})
	env.davExpect(http.StatusOK, http.MethodGet, "r.txt", "", davHdr{"Range": "bytes=2-4", "If-Range": `"stale"`})
}

func TestWebDAVLocking(t *testing.T) {
	env := newTestEnv(t)
	env.davPut("locked.txt", "v1")
	env.davPut("other.txt", "o")

	rr := env.davExpect(http.StatusOK, "LOCK", "locked.txt", lockBody, davHdr{"Timeout": "Second-600"})
	token := strings.Trim(rr.Header().Get("Lock-Token"), "<>")
	if !strings.HasPrefix(token, "opaquelocktoken:") {
		t.Fatalf("Lock-Token=%q", rr.Header().Get("Lock-Token"))
	}
	if !strings.Contains(rr.Body.String(), token) || !strings.Contains(rr.Body.String(), "Second-") {
		t.Fatalf("LOCK body missing activelock: %s", rr.Body.String())
	}
	ifHdr := davHdr{"If": "(<" + token + ">)"}

	// lockdiscovery / supportedlock in PROPFIND.
	ms := parseMS(t, env.dav("PROPFIND", "locked.txt", "", davHdr{"Depth": "0"}))
	resp := ms.find(t, env.davURL("locked.txt"))
	if v, _ := resp.prop("DAV:", "lockdiscovery"); !strings.Contains(v, token) {
		t.Fatalf("lockdiscovery=%q", v)
	}
	if v, _ := resp.prop("DAV:", "supportedlock"); !strings.Contains(v, "exclusive") {
		t.Fatalf("supportedlock=%q", v)
	}

	// Writes without the token are refused with 423.
	env.davExpect(http.StatusLocked, http.MethodPut, "locked.txt", "v2", nil)
	env.davExpect(http.StatusLocked, http.MethodDelete, "locked.txt", "", nil)
	env.davExpect(http.StatusLocked, "PROPPATCH", "locked.txt", `<D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><D:getlastmodified>Wed, 20 Sep 2023 10:00:00 GMT</D:getlastmodified></D:prop></D:set></D:propertyupdate>`, nil)
	env.davExpect(http.StatusLocked, "MOVE", "other.txt", "", env.destHdr("locked.txt", nil))
	env.davExpect(http.StatusLocked, "MOVE", "locked.txt", "", env.destHdr("elsewhere.txt", nil))
	env.davExpect(http.StatusLocked, "LOCK", "locked.txt", lockBody, nil)
	// Reads still work.
	if env.davGet("locked.txt") != "v1" {
		t.Fatal("GET of a locked file must work")
	}
	// A bogus token fails the If header precondition.
	env.davExpect(http.StatusPreconditionFailed, http.MethodPut, "locked.txt", "v2", davHdr{"If": "(<opaquelocktoken:bogus>)"})

	// With the token, writes succeed.
	env.davExpect(http.StatusNoContent, http.MethodPut, "locked.txt", "v2", ifHdr)
	env.davExpect(http.StatusNoContent, "MOVE", "other.txt", "", env.destHdr("locked.txt", davHdr{"If": "<http://example.com" + env.davURL("locked.txt") + "> (<" + token + ">)"}))
	if env.davGet("locked.txt") != "o" {
		t.Fatal("MOVE onto locked file with token failed")
	}

	// Refresh.
	rr = env.davExpect(http.StatusOK, "LOCK", "locked.txt", "", davHdr{"If": "(<" + token + ">)", "Timeout": "Second-120"})
	if !strings.Contains(rr.Body.String(), token) {
		t.Fatalf("refresh body=%s", rr.Body.String())
	}
	env.davExpect(http.StatusPreconditionFailed, "LOCK", "locked.txt", "", davHdr{"If": "(<opaquelocktoken:nope>)"})

	// UNLOCK.
	env.davExpect(http.StatusConflict, "UNLOCK", "locked.txt", "", davHdr{"Lock-Token": "<opaquelocktoken:nope>"})
	env.davExpect(http.StatusBadRequest, "UNLOCK", "locked.txt", "", nil)
	env.davExpect(http.StatusNoContent, "UNLOCK", "locked.txt", "", davHdr{"Lock-Token": "<" + token + ">"})
	env.davExpect(http.StatusNoContent, http.MethodPut, "locked.txt", "v3", nil)

	// Locking an unmapped URL creates an empty file (Finder/Office do this).
	rr = env.davExpect(http.StatusCreated, "LOCK", "new.docx", lockBody, davHdr{"Depth": "0"})
	newTok := strings.Trim(rr.Header().Get("Lock-Token"), "<>")
	if got := env.davExpect(http.StatusOK, http.MethodHead, "new.docx", "", nil).Header().Get("Content-Length"); got != "0" {
		t.Fatalf("lock-created file length=%q", got)
	}
	env.davExpect(http.StatusLocked, http.MethodPut, "new.docx", "data", nil)
	env.davExpect(http.StatusNoContent, http.MethodPut, "new.docx", "data", davHdr{"If": "(<" + newTok + ">)"})

	// Depth-infinity collection lock covers new members.
	env.davExpect(http.StatusCreated, "MKCOL", "dir", "", nil)
	rr = env.davExpect(http.StatusOK, "LOCK", "dir", lockBody, nil)
	dirTok := strings.Trim(rr.Header().Get("Lock-Token"), "<>")
	env.davExpect(http.StatusLocked, http.MethodPut, "dir/child.txt", "c", nil)
	env.davExpect(http.StatusLocked, "MKCOL", "dir/sub", "", nil)
	env.davExpect(http.StatusLocked, http.MethodDelete, "dir", "", nil)
	env.davExpect(http.StatusCreated, http.MethodPut, "dir/child.txt", "c", davHdr{"If": "(<" + dirTok + ">)"})
	ms = parseMS(t, env.dav("PROPFIND", "dir/child.txt", "", davHdr{"Depth": "0"}))
	if v, _ := ms.find(t, env.davURL("dir/child.txt")).prop("DAV:", "lockdiscovery"); !strings.Contains(v, dirTok) {
		t.Fatalf("inherited lockdiscovery=%q", v)
	}
	env.davExpect(http.StatusNoContent, http.MethodDelete, "dir", "", davHdr{"If": "(<" + dirTok + ">)"})
	// Deleting the collection released its lock.
	env.davExpect(http.StatusCreated, "MKCOL", "dir", "", nil)
}

func TestWebDAVProppatch(t *testing.T) {
	env := newTestEnv(t)
	env.davPut("m.txt", "m")

	body := `<?xml version="1.0"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:">
 <D:set><D:prop>
  <Z:Win32CreationTime>Tue, 19 Sep 2023 08:00:00 GMT</Z:Win32CreationTime>
  <Z:Win32LastModifiedTime>Wed, 20 Sep 2023 10:00:00 GMT</Z:Win32LastModifiedTime>
  <Z:Win32FileAttributes>00000020</Z:Win32FileAttributes>
 </D:prop></D:set>
</D:propertyupdate>`
	ms := parseMS(t, env.dav("PROPPATCH", "m.txt", body, nil))
	resp := ms.find(t, env.davURL("m.txt"))
	for _, p := range []string{"Win32CreationTime", "Win32LastModifiedTime", "Win32FileAttributes"} {
		if _, code := resp.prop("urn:schemas-microsoft-com:", p); code != 200 {
			t.Fatalf("%s status=%d", p, code)
		}
	}
	ms = parseMS(t, env.dav("PROPFIND", "m.txt", "", davHdr{"Depth": "0"}))
	if v, _ := ms.find(t, env.davURL("m.txt")).prop("DAV:", "getlastmodified"); v != "Wed, 20 Sep 2023 10:00:00 GMT" {
		t.Fatalf("mtime after Win32 PROPPATCH=%q", v)
	}

	// rclone (vendor=owncloud) style: <lastmodified xmlns="DAV:">unix</lastmodified>
	rclone := `<?xml version="1.0" encoding="utf-8" ?><D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><lastmodified xmlns="DAV:">1600000000</lastmodified></D:prop></D:set></D:propertyupdate>`
	ms = parseMS(t, env.dav("PROPPATCH", "m.txt", rclone, nil))
	if _, code := ms.find(t, env.davURL("m.txt")).prop("DAV:", "lastmodified"); code != 200 {
		t.Fatalf("lastmodified status=%d", code)
	}
	ms = parseMS(t, env.dav("PROPFIND", "m.txt", "", davHdr{"Depth": "0"}))
	if v, _ := ms.find(t, env.davURL("m.txt")).prop("DAV:", "getlastmodified"); v != time.Unix(1600000000, 0).UTC().Format(http.TimeFormat) {
		t.Fatalf("mtime after rclone PROPPATCH=%q", v)
	}

	// Protected property fails the whole request atomically (403 + 424).
	bad := `<D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><D:getlastmodified>Thu, 01 Jan 2015 00:00:00 GMT</D:getlastmodified><D:resourcetype/></D:prop></D:set></D:propertyupdate>`
	resp = parseMS(t, env.dav("PROPPATCH", "m.txt", bad, nil)).find(t, env.davURL("m.txt"))
	if _, code := resp.prop("DAV:", "resourcetype"); code != 403 {
		t.Fatalf("resourcetype status=%d", code)
	}
	if _, code := resp.prop("DAV:", "getlastmodified"); code != 424 {
		t.Fatalf("getlastmodified status=%d want 424", code)
	}
	ms = parseMS(t, env.dav("PROPFIND", "m.txt", "", davHdr{"Depth": "0"}))
	if v, _ := ms.find(t, env.davURL("m.txt")).prop("DAV:", "getlastmodified"); strings.Contains(v, "2015") {
		t.Fatal("failed PROPPATCH must not apply")
	}
	env.davExpect(http.StatusBadRequest, "PROPPATCH", "m.txt", "<junk", nil)
	env.davExpect(http.StatusNotFound, "PROPPATCH", "missing.txt", bad, nil)

	// X-OC-Mtime on PUT.
	rr := env.davExpect(http.StatusCreated, http.MethodPut, "oc.txt", "x", davHdr{"X-OC-Mtime": "1500000000"})
	if rr.Header().Get("X-OC-Mtime") != "accepted" {
		t.Fatalf("X-OC-Mtime response=%q", rr.Header().Get("X-OC-Mtime"))
	}
	ms = parseMS(t, env.dav("PROPFIND", "oc.txt", "", davHdr{"Depth": "0"}))
	if v, _ := ms.find(t, env.davURL("oc.txt")).prop("DAV:", "getlastmodified"); v != time.Unix(1500000000, 0).UTC().Format(http.TimeFormat) {
		t.Fatalf("mtime after X-OC-Mtime PUT=%q", v)
	}
	// A MOVE keeps the modification time (rename semantics).
	env.davExpect(http.StatusCreated, "MOVE", "oc.txt", "", env.destHdr("oc2.txt", nil))
	ms = parseMS(t, env.dav("PROPFIND", "oc2.txt", "", davHdr{"Depth": "0"}))
	if v, _ := ms.find(t, env.davURL("oc2.txt")).prop("DAV:", "getlastmodified"); v != time.Unix(1500000000, 0).UTC().Format(http.TimeFormat) {
		t.Fatalf("mtime after MOVE=%q", v)
	}
}

func TestWebDAVQuotaProps(t *testing.T) {
	env := newTestEnv(t)
	env.davPut("q.txt", strings.Repeat("a", 100))
	env.davExpect(http.StatusCreated, "MKCOL", "sub", "", nil)
	propReq := `<?xml version="1.0"?><D:propfind xmlns:D="DAV:"><D:prop><D:quota-available-bytes/><D:quota-used-bytes/></D:prop></D:propfind>`

	// Unlimited: used is reported, available is 404.
	resp := parseMS(t, env.dav("PROPFIND", "", propReq, davHdr{"Depth": "0"})).find(t, env.davURL(""))
	if v, code := resp.prop("DAV:", "quota-used-bytes"); code != 200 || v != "100" {
		t.Fatalf("used=%q (%d)", v, code)
	}
	if _, code := resp.prop("DAV:", "quota-available-bytes"); code != 404 {
		t.Fatalf("available status=%d want 404 when unlimited", code)
	}

	if _, err := env.App.DB.Exec(context.Background(), `UPDATE workspaces SET quota_bytes = 1000 WHERE id = $1`, env.WS); err != nil {
		t.Fatal(err)
	}
	ms := parseMS(t, env.dav("PROPFIND", "", propReq, davHdr{"Depth": "1"}))
	for _, href := range []string{env.davURL(""), env.davURL("sub") + "/"} {
		r := ms.find(t, href)
		if v, code := r.prop("DAV:", "quota-available-bytes"); code != 200 || v != "900" {
			t.Fatalf("%s available=%q (%d)", href, v, code)
		}
		if v, _ := r.prop("DAV:", "quota-used-bytes"); v != "100" {
			t.Fatalf("%s used=%q", href, v)
		}
	}
	// Files do not carry quota props.
	if _, code := ms.find(t, env.davURL("q.txt")).prop("DAV:", "quota-available-bytes"); code != 404 {
		t.Fatalf("file quota status=%d", code)
	}
	// Allprop on a collection includes both.
	resp = parseMS(t, env.dav("PROPFIND", "sub", "", davHdr{"Depth": "0"})).find(t, env.davURL("sub")+"/")
	if v, _ := resp.prop("DAV:", "quota-available-bytes"); v != "900" {
		t.Fatalf("allprop available=%q", v)
	}
	// Exceeding the quota answers 507 Insufficient Storage.
	env.davExpect(http.StatusInsufficientStorage, http.MethodPut, "big.txt", strings.Repeat("b", 2000), nil)
	if _, err := env.App.DB.Exec(context.Background(), `UPDATE workspaces SET quota_bytes = 150 WHERE id = $1`, env.WS); err != nil {
		t.Fatal(err)
	}
	env.davExpect(http.StatusInsufficientStorage, "COPY", "q.txt", "", env.destHdr("q2.txt", nil))
}

func TestWebDAVPropfindDepthAndProps(t *testing.T) {
	env := newTestEnv(t)
	env.davExpect(http.StatusCreated, "MKCOL", "folder", "", nil)
	env.davPut("folder/inner.txt", "inner")
	env.davExpect(http.StatusCreated, http.MethodPut, "top.json", `{"a":1}`, nil) // type guessed from extension

	davError := env.davExpect(http.StatusForbidden, "PROPFIND", "", "", davHdr{"Depth": "infinity"})
	if !strings.Contains(davError.Body.String(), "propfind-finite-depth") {
		t.Fatalf("infinity body=%s", davError.Body.String())
	}
	env.davExpect(http.StatusBadRequest, "PROPFIND", "", "", davHdr{"Depth": "2"})

	if n := len(parseMS(t, env.dav("PROPFIND", "", "", davHdr{"Depth": "0"})).Responses); n != 1 {
		t.Fatalf("Depth 0 responses=%d", n)
	}
	// Missing Depth is treated as 1.
	ms := parseMS(t, env.dav("PROPFIND", "", "", nil))
	if len(ms.Responses) != 3 {
		t.Fatalf("Depth 1 responses=%d", len(ms.Responses))
	}
	root := ms.find(t, env.davURL(""))
	if v, _ := root.prop("DAV:", "resourcetype"); !strings.Contains(v, "collection") {
		t.Fatalf("root resourcetype=%q", v)
	}
	folder := ms.find(t, env.davURL("folder")+"/")
	if v, _ := folder.prop("DAV:", "resourcetype"); !strings.Contains(v, "collection") {
		t.Fatal("folder resourcetype")
	}
	if v, _ := folder.prop("DAV:", "displayname"); v != "folder" {
		t.Fatalf("displayname=%q", v)
	}
	file := ms.find(t, env.davURL("top.json"))
	if v, _ := file.prop("DAV:", "getcontentlength"); v != "7" {
		t.Fatalf("getcontentlength=%q", v)
	}
	if v, _ := file.prop("DAV:", "getcontenttype"); !strings.Contains(v, "json") {
		t.Fatalf("getcontenttype=%q", v)
	}
	if v, _ := file.prop("DAV:", "creationdate"); v == "" {
		t.Fatal("missing creationdate")
	} else if _, err := time.Parse(time.RFC3339, v); err != nil {
		t.Fatalf("creationdate not RFC3339: %q", v)
	}
	if v, code := file.prop("DAV:", "resourcetype"); code != 200 || v != "" {
		t.Fatalf("file resourcetype=%q (%d)", v, code)
	}

	// Named props: unknown ones come back 404.
	named := `<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:Z="urn:x"><D:prop><D:getcontentlength/><Z:custom/></D:prop></D:propfind>`
	resp := parseMS(t, env.dav("PROPFIND", "top.json", named, davHdr{"Depth": "0"})).find(t, env.davURL("top.json"))
	if _, code := resp.prop("DAV:", "getcontentlength"); code != 200 {
		t.Fatal("getcontentlength should be 200")
	}
	if _, code := resp.prop("urn:x", "custom"); code != 404 {
		t.Fatalf("unknown prop status=%d", code)
	}
	// propname.
	resp = parseMS(t, env.dav("PROPFIND", "top.json", `<D:propfind xmlns:D="DAV:"><D:propname/></D:propfind>`, davHdr{"Depth": "0"})).find(t, env.davURL("top.json"))
	if _, code := resp.prop("DAV:", "getetag"); code != 200 {
		t.Fatal("propname should list getetag")
	}
	env.davExpect(http.StatusNotFound, "PROPFIND", "nope", "", nil)
	env.davExpect(http.StatusBadRequest, "PROPFIND", "", "<not-xml", nil)

	// MKCOL edge cases.
	env.davExpect(http.StatusMethodNotAllowed, "MKCOL", "folder", "", nil)
	env.davExpect(http.StatusConflict, "MKCOL", "a/b/c", "", nil)
	env.davExpect(http.StatusUnsupportedMediaType, "MKCOL", "withbody", "<x/>", nil)
	env.davExpect(http.StatusConflict, http.MethodPut, "missing/f.txt", "x", nil)
	env.davExpect(http.StatusMethodNotAllowed, http.MethodPut, "folder", "x", nil)
	env.davExpect(http.StatusBadRequest, http.MethodGet, "a/../b", "", nil)

	// /dav/ lists workspaces.
	req := httptest.NewRequest("PROPFIND", "/dav/", nil)
	req.Header.Set("Depth", "1")
	req.AddCookie(env.Cookie)
	rr := httptest.NewRecorder()
	env.H.ServeHTTP(rr, req)
	parseMS(t, rr).find(t, "/dav/"+env.WS.String()+"/")
}

func TestWebDAVHrefEncoding(t *testing.T) {
	env := newTestEnv(t)
	names := []string{"sp ace #?ü", "a b#c?.txt", "100%.txt", "日本語.md", "semi;colon&amp.txt", "dots..in..name.txt"}
	env.davExpect(http.StatusCreated, "MKCOL", names[0], "", nil)
	for _, n := range names[1:] {
		env.davPut(names[0]+"/"+n, n)
	}
	ms := parseMS(t, env.dav("PROPFIND", "", "", davHdr{"Depth": "1"}))
	dir := ms.find(t, "/dav/"+env.WS.String()+"/sp%20ace%20%23%3F%C3%BC/")
	if v, _ := dir.prop("DAV:", "displayname"); v != names[0] {
		t.Fatalf("displayname=%q", v)
	}
	ms = parseMS(t, env.dav("PROPFIND", names[0], "", davHdr{"Depth": "1"}))
	if len(ms.Responses) != len(names) {
		t.Fatalf("responses=%d", len(ms.Responses))
	}
	for _, n := range names[1:] {
		href := env.davURL(names[0] + "/" + n)
		resp := ms.find(t, href)
		// hrefs must round-trip to the exact name.
		u, err := url.Parse(resp.Href)
		if err != nil || !strings.HasSuffix(u.Path, "/"+n) {
			t.Fatalf("href %q does not decode to %q", resp.Href, n)
		}
		if strings.ContainsAny(strings.TrimPrefix(resp.Href, "/dav/"), " #?") {
			t.Fatalf("href not escaped: %q", resp.Href)
		}
		if got := env.davGet(names[0] + "/" + n); got != n {
			t.Fatalf("GET %q=%q", n, got)
		}
	}
	ms.find(t, "/dav/"+env.WS.String()+"/sp%20ace%20%23%3F%C3%BC/100%25.txt")
}
