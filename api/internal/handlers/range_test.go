package handlers

import "testing"

func TestParseBytesRange(t *testing.T) {
	cases := []struct {
		h          string
		size       int64
		wantStart  int64
		wantEnd    int64
		wantOK     bool
	}{
		{"bytes=0-479", 10000, 0, 479, true},
		{"bytes=0-", 1000, 0, 999, true},
		{"bytes=-100", 1000, 900, 999, true},
		{"bytes=500-499", 1000, 0, 0, false},
		{"bytes=1000-1001", 1000, 0, 0, false},
		{"bytes=0-9999", 1000, 0, 999, true},
		{"invalid", 1000, 0, 0, false},
		{"bytes=0-10,11-20", 1000, 0, 0, false},
	}
	for _, tc := range cases {
		start, end, ok := parseBytesRange(tc.h, tc.size)
		if ok != tc.wantOK {
			t.Fatalf("%q size=%d ok=%v want %v", tc.h, tc.size, ok, tc.wantOK)
		}
		if !ok {
			continue
		}
		if start != tc.wantStart || end != tc.wantEnd {
			t.Fatalf("%q got %d-%d want %d-%d", tc.h, start, end, tc.wantStart, tc.wantEnd)
		}
	}
}

func TestIsTextPreview(t *testing.T) {
	if !isTextPreview("text/plain", "a.bin") {
		t.Fatal("text/plain should preview")
	}
	if !isTextPreview("application/octet-stream", "notes.md") {
		t.Fatal(".md should preview")
	}
	if isTextPreview("application/pdf", "doc.pdf") {
		t.Fatal("pdf is not text preview")
	}
}

func TestDangerousInlineNotPreviewable(t *testing.T) {
	if isPreviewable("text/html", "x.html") {
		t.Fatal("html must not be previewable")
	}
	if isPreviewable("image/svg+xml", "icon.svg") {
		t.Fatal("svg must not be previewable")
	}
	if !isDangerousInline("text/html", "x.bin") {
		t.Fatal("text/html is dangerous")
	}
}

func TestLinkUnlockCookieName(t *testing.T) {
	name := linkUnlockCookieName("abc123")
	if name != "arkive_pl_abc123" {
		t.Fatalf("got %q", name)
	}
}

func TestParseAppPasswordPrefix(t *testing.T) {
	pre, ok := parseAppPasswordPrefix("ark_abcd1234_deadbeef")
	if !ok || pre != "abcd1234" {
		t.Fatalf("got %q ok=%v", pre, ok)
	}
	if _, ok := parseAppPasswordPrefix("password123"); ok {
		t.Fatal("account password should not parse as app password")
	}
	if _, ok := parseAppPasswordPrefix("ark_short_xx"); ok {
		t.Fatal("short prefix should fail")
	}
}

func TestTextEditGate(t *testing.T) {
	cases := []struct {
		ct, name string
		want     bool
	}{
		{"text/plain", "notes.txt", true},
		{"application/json", "data.json", true},
		{"application/octet-stream", "script.py", true},
		{"image/png", "pic.png", false},
		{"application/pdf", "doc.pdf", false},
		{"application/zip", "a.zip", false},
	}
	for _, tc := range cases {
		got := isTextPreview(tc.ct, tc.name)
		if got != tc.want {
			t.Fatalf("isTextPreview(%q, %q)=%v want %v", tc.ct, tc.name, got, tc.want)
		}
	}
}
