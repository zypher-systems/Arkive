package handlers

import (
	"testing"

	"github.com/google/uuid"
)

func TestParseDAVPath(t *testing.T) {
	id := uuid.MustParse("9a0b867b-7b7a-43f2-b71e-46e4a12a8076")
	ws, rel, err := parseDAVPath("/dav/" + id.String() + "/folder/file.txt")
	if err != nil {
		t.Fatal(err)
	}
	if ws != id {
		t.Fatalf("workspace=%s", ws)
	}
	if rel != "folder/file.txt" {
		t.Fatalf("rel=%q", rel)
	}

	ws, rel, err = parseDAVPath("/dav/" + id.String() + "/")
	if err != nil {
		t.Fatal(err)
	}
	if rel != "" {
		t.Fatalf("root rel=%q", rel)
	}

	_, _, err = parseDAVPath("/dav/not-a-uuid/x")
	if err == nil {
		t.Fatal("expected error for bad workspace id")
	}
}
