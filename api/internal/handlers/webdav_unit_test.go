package handlers

import (
	"encoding/xml"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestDAVHrefEncoding(t *testing.T) {
	ws := uuid.MustParse("9a0b867b-7b7a-43f2-b71e-46e4a12a8076")
	base := "/dav/" + ws.String() + "/"
	cases := []struct {
		rel  string
		dir  bool
		want string
	}{
		{"", true, base},
		{"docs", true, base + "docs/"},
		{"my file.txt", false, base + "my%20file.txt"},
		{"a#b?c.txt", false, base + "a%23b%3Fc.txt"},
		{"100%.txt", false, base + "100%25.txt"},
		{"Grüße/ünï.txt", false, base + "Gr%C3%BC%C3%9Fe/%C3%BCn%C3%AF.txt"},
		{"semi;colon", true, base + "semi%3Bcolon/"},
	}
	for _, c := range cases {
		if got := davHref(ws, c.rel, c.dir); got != c.want {
			t.Errorf("davHref(%q,%v)=%q want %q", c.rel, c.dir, got, c.want)
		}
	}
}

func TestCleanDAVRel(t *testing.T) {
	good := map[string]string{"": "", "/": "", "a//b/": "a/b", "a..b/c": "a..b/c", " x ": " x "}
	for in, want := range good {
		got, err := cleanDAVRel(in)
		if err != nil || got != want {
			t.Errorf("cleanDAVRel(%q)=%q,%v want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"..", "a/../b", "./a", "a\x00b"} {
		if _, err := cleanDAVRel(bad); err == nil {
			t.Errorf("cleanDAVRel(%q) should fail", bad)
		}
	}
}

func TestDAVRelFromURL(t *testing.T) {
	ws := uuid.MustParse("9a0b867b-7b7a-43f2-b71e-46e4a12a8076")
	other := uuid.MustParse("11111111-7b7a-43f2-b71e-46e4a12a8076")
	cases := []struct {
		in     string
		rel    string
		status int
	}{
		{"http://host/dav/" + ws.String() + "/a%20b/c.txt", "a b/c.txt", 0},
		{"/dav/" + ws.String() + "/x", "x", 0},
		{"https://h/prefix/dav/" + ws.String() + "/x/", "x", 0},
		{"/dav/" + other.String() + "/x", "", 502},
		{"/elsewhere/x", "", 400},
		{"/dav/" + ws.String() + "/../x", "", 400},
	}
	for _, c := range cases {
		rel, st := davRelFromURL(c.in, ws)
		if rel != c.rel || st != c.status {
			t.Errorf("davRelFromURL(%q)=%q,%d want %q,%d", c.in, rel, st, c.rel, c.status)
		}
	}
}

func TestDAVLockManager(t *testing.T) {
	ws := uuid.New()
	u1, u2 := uuid.New(), uuid.New()
	now := time.Now()
	m := newDAVLockManager()
	m.now = func() time.Time { return now }

	dir, err := m.create(davLock{Workspace: ws, Path: "dir", Infinite: true, UserID: u1, Timeout: 10 * time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(dir.Token, davLockTokenPrefix) {
		t.Fatalf("token %q", dir.Token)
	}
	// Conflicts: same path, descendant of infinite lock, ancestor infinite over it.
	for _, l := range []davLock{
		{Workspace: ws, Path: "dir", UserID: u2},
		{Workspace: ws, Path: "dir/f.txt", UserID: u1},
		{Workspace: ws, Path: "", Infinite: true, UserID: u2},
	} {
		if _, err := m.create(l); err != errDAVLocked {
			t.Fatalf("create %+v err=%v want locked", l, err)
		}
	}
	// Sibling and depth-0 parent lock do not conflict.
	if _, err := m.create(davLock{Workspace: ws, Path: "other.txt", UserID: u2}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.create(davLock{Workspace: uuid.New(), Path: "dir", UserID: u2}); err != nil {
		t.Fatal("other workspace must not conflict")
	}
	if got := m.covering(ws, "dir/sub/x"); len(got) != 1 || got[0].Token != dir.Token {
		t.Fatalf("covering=%v", got)
	}
	if !m.valid(ws, "dir/sub/x", dir.Token, u1) || m.valid(ws, "dir/sub/x", dir.Token, u2) || m.valid(ws, "elsewhere", dir.Token, u1) {
		t.Fatal("valid() wrong")
	}
	// recursive: deleting the root collection must see the lock below it.
	if got := m.affecting(ws, "", true, false); len(got) != 2 {
		t.Fatalf("recursive affecting=%d want 2", len(got))
	}
	// membership: a depth-0 lock on a collection guards its members.
	col, err := m.create(davLock{Workspace: ws, Path: "col", UserID: u1})
	if err != nil {
		t.Fatal(err)
	}
	if got := m.affecting(ws, "col/new.txt", false, true); len(got) != 1 || got[0].Token != col.Token {
		t.Fatalf("membership affecting=%v", got)
	}
	if got := m.affecting(ws, "col/new.txt", false, false); len(got) != 0 {
		t.Fatalf("depth-0 lock must not cover member content: %v", got)
	}

	// Refresh and unlock rules.
	if _, err := m.refresh(ws, "dir", dir.Token, u2, time.Minute); err == nil {
		t.Fatal("refresh by other user must fail")
	}
	if err := m.unlock(ws, "dir", dir.Token, u2); err != errDAVLocked {
		t.Fatalf("unlock by other user err=%v", err)
	}
	if err := m.unlock(ws, "nope", dir.Token, u1); err != errDAVLockNotFound {
		t.Fatalf("unlock wrong path err=%v", err)
	}

	// Expiry.
	now = now.Add(11 * time.Minute)
	if len(m.covering(ws, "dir")) != 0 {
		t.Fatal("lock should have expired")
	}
	if _, err := m.create(davLock{Workspace: ws, Path: "dir", UserID: u2, Timeout: 2 * time.Hour}); err != nil {
		t.Fatal(err)
	}
	if got := m.covering(ws, "dir"); len(got) != 1 || got[0].Timeout != davLockMaxTimeout {
		t.Fatalf("timeout not clamped: %+v", got)
	}
	m.removeTree(ws, "")
	if len(m.covering(ws, "dir")) != 0 || len(m.covering(ws, "col")) != 0 {
		t.Fatal("removeTree should drop all locks in the workspace")
	}
}

func TestParseDAVTimeout(t *testing.T) {
	cases := map[string]time.Duration{
		"":                            davLockDefaultTimeout,
		"Second-600":                  10 * time.Minute,
		"Infinite, Second-4100000000": davLockMaxTimeout,
		"Second-99999999":             davLockMaxTimeout,
		"bogus, Second-30":            30 * time.Second,
	}
	for in, want := range cases {
		if got := parseDAVTimeout(in); got != want {
			t.Errorf("parseDAVTimeout(%q)=%v want %v", in, got, want)
		}
	}
}

func TestParseDAVIf(t *testing.T) {
	lists, err := parseDAVIf(`(<opaquelocktoken:a> ["etag1"]) (Not <DAV:no-lock> ["etag2"])`)
	if err != nil {
		t.Fatal(err)
	}
	if len(lists) != 2 || lists[0].Conds[0].Token != "opaquelocktoken:a" || lists[0].Conds[1].ETag != `"etag1"` || !lists[1].Conds[0].Not {
		t.Fatalf("parsed %+v", lists)
	}
	if toks := davSubmittedTokens(lists); len(toks) != 1 || toks[0] != "opaquelocktoken:a" {
		t.Fatalf("tokens %v", toks)
	}
	tagged, err := parseDAVIf(`<http://h/dav/x/a.txt> (<opaquelocktoken:b>) <http://h/dav/x/b> (["e"])`)
	if err != nil || len(tagged) != 2 || tagged[0].Tag != "http://h/dav/x/a.txt" || tagged[1].Tag != "http://h/dav/x/b" {
		t.Fatalf("tagged %+v err=%v", tagged, err)
	}
	for _, bad := range []string{`(`, `<x>`, `(<a>) <http://x> (<b>)`, `()`, `(foo)`} {
		if _, err := parseDAVIf(bad); err == nil {
			t.Errorf("parseDAVIf(%q) should fail", bad)
		}
	}

	res := davIfResource{Path: "a.txt", Exists: true, ETag: `"etag2"`}
	resolve := func(string) (davIfResource, bool) { return res, true }
	valid := func(p, tok string) bool { return tok == "opaquelocktoken:a" }
	if !evalDAVIf(lists, resolve, valid) {
		t.Fatal(`second list (Not <DAV:no-lock> ["etag2"]) should be true`)
	}
	res.ETag = `"zzz"`
	if evalDAVIf(lists, resolve, valid) {
		t.Fatal("no list should match")
	}
	res.ETag = `"etag1"`
	if !evalDAVIf(lists, resolve, valid) {
		t.Fatal("first list should match")
	}
}

func TestDAVCheckConditional(t *testing.T) {
	mod := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	etag := `"abc"`
	req := func(method string, hdr ...string) int {
		r := httptest.NewRequest(method, "/", nil)
		for i := 0; i+1 < len(hdr); i += 2 {
			r.Header.Set(hdr[i], hdr[i+1])
		}
		return davCheckConditional(r, true, etag, mod)
	}
	if got := req("GET", "If-None-Match", `"abc"`); got != 304 {
		t.Fatalf("INM match GET=%d", got)
	}
	if got := req("PUT", "If-None-Match", `*`); got != 412 {
		t.Fatalf("INM * PUT=%d", got)
	}
	if got := req("PUT", "If-Match", `"nope"`); got != 412 {
		t.Fatalf("IM mismatch=%d", got)
	}
	if got := req("PUT", "If-Match", `W/"abc"`); got != 412 {
		t.Fatalf("weak tag must fail strong If-Match: %d", got)
	}
	if got := req("DELETE", "If-Match", `"x", "abc"`); got != 0 {
		t.Fatalf("IM list=%d", got)
	}
	if got := req("GET", "If-Modified-Since", mod.Format("Mon, 02 Jan 2006 15:04:05 GMT")); got != 304 {
		t.Fatalf("IMS=%d", got)
	}
	if got := req("PUT", "If-Unmodified-Since", mod.Add(-time.Hour).Format("Mon, 02 Jan 2006 15:04:05 GMT")); got != 412 {
		t.Fatalf("IUS=%d", got)
	}
	r := httptest.NewRequest("PUT", "/", nil)
	r.Header.Set("If-None-Match", "*")
	if got := davCheckConditional(r, false, "", time.Time{}); got != 0 {
		t.Fatalf("INM * on new resource=%d", got)
	}
	r.Header.Del("If-None-Match")
	r.Header.Set("If-Match", "*")
	if got := davCheckConditional(r, false, "", time.Time{}); got != 412 {
		t.Fatalf("IM * on missing=%d", got)
	}
}

func TestDAVETags(t *testing.T) {
	a := davFileETag("k1", 10)
	if a != davFileETag("k1", 10) || a == davFileETag("k2", 10) || a == davFileETag("k1", 11) {
		t.Fatal("file etag must be stable and content-sensitive")
	}
	if !strings.HasPrefix(a, `"`) || !strings.HasSuffix(a, `"`) {
		t.Fatalf("etag must be quoted: %s", a)
	}
}

func TestParseDAVTime(t *testing.T) {
	want := time.Date(2023, 9, 20, 10, 0, 0, 0, time.UTC)
	for _, in := range []string{"1695204000", "Wed, 20 Sep 2023 10:00:00 GMT", "2023-09-20T10:00:00Z"} {
		got, ok := parseDAVTime(in)
		if !ok || !got.Equal(want) {
			t.Errorf("parseDAVTime(%q)=%v,%v", in, got, ok)
		}
	}
	if _, ok := parseDAVTime("yesterday"); ok {
		t.Error("garbage must not parse")
	}
	if tm, ok := parseOCMtime("1695204000.5"); !ok || tm.UnixMilli() != want.UnixMilli()+500 {
		t.Errorf("parseOCMtime=%v,%v", tm, ok)
	}
}

func TestDAVBodies(t *testing.T) {
	spec, err := parsePropfind([]byte(`<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:Z="urn:x"><D:prop><D:getetag/><Z:foo/></D:prop></D:propfind>`))
	if err != nil || spec.Mode != davNamedProps || len(spec.Names) != 2 || spec.Names[1] != (xml.Name{Space: "urn:x", Local: "foo"}) {
		t.Fatalf("propfind spec=%+v err=%v", spec, err)
	}
	if spec, _ := parsePropfind(nil); spec.Mode != davAllProp {
		t.Fatal("empty body = allprop")
	}
	if _, err := parsePropfind([]byte("<nope")); err == nil {
		t.Fatal("bad xml must fail")
	}
	ops, err := parseProppatch([]byte(`<D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:schemas-microsoft-com:"><D:set><D:prop><Z:Win32LastModifiedTime>Wed, 20 Sep 2023 10:00:00 GMT</Z:Win32LastModifiedTime></D:prop></D:set><D:remove><D:prop><Z:x/></D:prop></D:remove></D:propertyupdate>`))
	if err != nil || len(ops) != 2 || ops[0].Value != "Wed, 20 Sep 2023 10:00:00 GMT" || !ops[1].Remove {
		t.Fatalf("proppatch ops=%+v err=%v", ops, err)
	}
	owner, err := parseLockInfo([]byte(`<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner><D:href>mailto:a&amp;b</D:href></D:owner></D:lockinfo>`))
	if err != nil || owner != "<d:href>mailto:a&amp;b</d:href>" {
		t.Fatalf("owner=%q err=%v", owner, err)
	}
	if _, err := parseLockInfo([]byte(`<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope></D:lockinfo>`)); err == nil {
		t.Fatal("lockinfo without locktype must fail")
	}
}

func TestDAVPropElemNamespaces(t *testing.T) {
	if got := davPropElem(xml.Name{Space: "DAV:", Local: "getetag"}, `"x"`); got != `<d:getetag>"x"</d:getetag>` {
		t.Fatal(got)
	}
	if got := davPropElem(xml.Name{Space: "urn:a\"b", Local: "foo"}, ""); got != `<x:foo xmlns:x="urn:a&#34;b"/>` {
		t.Fatal(got)
	}
	if got := davPropElem(xml.Name{Local: "bare"}, ""); got != `<bare xmlns=""/>` {
		t.Fatal(got)
	}
}
