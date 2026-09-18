package app

import (
	"errors"
	"testing"
)

func TestWriteHTTPErrorWorkspaceMismatch(t *testing.T) {
	status, msg := WriteHTTPError(ErrWorkspaceMismatch)
	if status != 400 || msg != "parent not in workspace" {
		t.Fatalf("got %d %q", status, msg)
	}
	status, msg = WriteHTTPError(errors.New("wrap: " + ErrWorkspaceMismatch.Error()))
	// non-Is wrap without %w
	if status != 500 {
		t.Fatalf("unwrapped mismatch should be 500, got %d", status)
	}
	if msg != "internal error" {
		t.Fatalf("default message must not leak internals, got %q", msg)
	}
}
