package config

import (
	"os"
	"testing"
)

func TestMaxUploadBytesDefault(t *testing.T) {
	t.Setenv("ARKIVE_MAX_UPLOAD_BYTES", "")
	_ = os.Unsetenv("ARKIVE_MAX_UPLOAD_BYTES")
	cfg := Load()
	want := int64(10 * 1024 * 1024 * 1024)
	if cfg.MaxUploadBytes != want {
		t.Fatalf("MaxUploadBytes=%d want %d", cfg.MaxUploadBytes, want)
	}
}

func TestMaxUploadBytesOverride(t *testing.T) {
	t.Setenv("ARKIVE_MAX_UPLOAD_BYTES", "1048576")
	cfg := Load()
	if cfg.MaxUploadBytes != 1048576 {
		t.Fatalf("MaxUploadBytes=%d want 1048576", cfg.MaxUploadBytes)
	}
}
