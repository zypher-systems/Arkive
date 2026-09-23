package storage

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestNFSListSkipsDotEntries(t *testing.T) {
	dir := t.TempDir()
	s, err := NewNFSStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for _, k := range []string{"ws/a", "ws/b", "thumbs/ws/a.jpg"} {
		if err := s.Put(ctx, k, bytes.NewReader([]byte("x")), 1, ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(dir, ".uploads"), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dir, ".uploads", "partial"), []byte("p"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, ".arkive-secrets"), []byte("s"), 0o600)
	_ = os.WriteFile(filepath.Join(dir, "ws", "c.tmp"), []byte("t"), 0o644)
	_ = os.Symlink(filepath.Join(dir, "ws", "a"), filepath.Join(dir, "ws", "link"))

	var got []string
	if err := s.List(ctx, "", func(o ObjectInfo) error {
		got = append(got, o.Key)
		if o.ModTime.IsZero() {
			t.Errorf("zero modtime for %s", o.Key)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	sort.Strings(got)
	want := "thumbs/ws/a.jpg,ws/a,ws/b,ws/c.tmp"
	if strings.Join(got, ",") != want {
		t.Fatalf("got %v want %s", got, want)
	}

	got = nil
	_ = s.List(ctx, "thumbs/", func(o ObjectInfo) error { got = append(got, o.Key); return nil })
	if len(got) != 1 || got[0] != "thumbs/ws/a.jpg" {
		t.Fatalf("prefix list got %v", got)
	}
}

func TestWebDAVList(t *testing.T) {
	tree := map[string][]string{ // dir -> children (dirs end with /)
		"/dav/root/":            {"ws1/", "thumbs/"},
		"/dav/root/ws1/":        {"f%201", "f2"},
		"/dav/root/thumbs/":     {"ws1/"},
		"/dav/root/thumbs/ws1/": {"f2.jpg"},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PROPFIND" || r.Header.Get("Depth") != "1" {
			http.Error(w, "bad", http.StatusBadRequest)
			return
		}
		kids, ok := tree[r.URL.EscapedPath()]
		if !ok {
			http.NotFound(w, r)
			return
		}
		var b strings.Builder
		b.WriteString(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">`)
		b.WriteString(`<d:response><d:href>` + r.URL.EscapedPath() + `</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`)
		for _, k := range kids {
			href := r.URL.EscapedPath() + k
			if strings.HasSuffix(k, "/") {
				b.WriteString(`<d:response><d:href>` + href + `</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`)
			} else {
				fmt.Fprintf(&b, `<d:response><d:href>%s</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>7</d:getcontentlength><d:getlastmodified>Mon, 02 Jan 2006 15:04:05 GMT</d:getlastmodified></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`, href)
			}
		}
		b.WriteString(`</d:multistatus>`)
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusMultiStatus)
		_, _ = w.Write([]byte(b.String()))
	}))
	defer srv.Close()

	s := &WebDAVStore{base: srv.URL + "/dav/root", client: srv.Client()}
	var got []string
	if err := s.List(context.Background(), "", func(o ObjectInfo) error {
		if o.Size != 7 || o.ModTime.IsZero() {
			t.Errorf("bad info %+v", o)
		}
		got = append(got, o.Key)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	sort.Strings(got)
	if strings.Join(got, ",") != "thumbs/ws1/f2.jpg,ws1/f 1,ws1/f2" {
		t.Fatalf("got %v", got)
	}
}
