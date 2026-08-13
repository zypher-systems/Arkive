package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParsePage(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	limit, offset := parsePage(req)
	if limit != defaultPageLimit || offset != 0 {
		t.Fatalf("defaults limit=%d offset=%d", limit, offset)
	}

	req = httptest.NewRequest(http.MethodGet, "/x?limit=10&offset=20", nil)
	limit, offset = parsePage(req)
	if limit != 10 || offset != 20 {
		t.Fatalf("got limit=%d offset=%d", limit, offset)
	}

	req = httptest.NewRequest(http.MethodGet, "/x?limit=9999", nil)
	limit, _ = parsePage(req)
	if limit != maxPageLimit {
		t.Fatalf("cap=%d", limit)
	}
}
