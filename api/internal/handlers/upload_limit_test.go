package handlers

import (
	"bytes"
	"io"
	"testing"

	"github.com/arkive/arkive/internal/app"
)

func TestStoredSizePrefersCountedBytes(t *testing.T) {
	c := &app.CountingReader{R: bytes.NewReader(nil), N: 42, Limit: -1}
	if got := storedSize(c, 10); got != 42 {
		t.Fatalf("got %d", got)
	}
	if got := storedSize(&app.CountingReader{}, 10); got != 10 {
		t.Fatalf("hint=%d", got)
	}
	if got := storedSize(nil, 0); got != 0 {
		t.Fatalf("zero=%d", got)
	}
}

func TestIsUploadTooLargeIncludesQuota(t *testing.T) {
	if !isUploadTooLarge(app.ErrQuotaExceeded) {
		t.Fatal("quota should map to too large")
	}
	if isUploadTooLarge(io.EOF) {
		t.Fatal("EOF is not too large")
	}
}
