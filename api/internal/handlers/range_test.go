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
