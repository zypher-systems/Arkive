package app

import (
	"strings"
	"testing"
)

func TestMigrateErrorFormat(t *testing.T) {
	e := &MigrateError{Message: "failed to write destination object", Copied: 2, Total: 5, FailedKey: "abc"}
	s := e.Error()
	if !strings.Contains(s, "copied 2/5") || !strings.Contains(s, "failed_key=abc") {
		t.Fatalf("error=%q", s)
	}
}
