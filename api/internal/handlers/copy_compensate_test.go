package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/google/uuid"
)

func TestCopyNodesSuccess(t *testing.T) {
	env := newTestEnv(t)
	src := env.upload("src.txt", []byte("copy me"))
	dest := env.mkdir("copies")
	body, _ := json.Marshal(map[string]any{
		"node_ids":            []uuid.UUID{src},
		"target_workspace_id": env.WS,
		"target_parent_id":    dest,
	})
	rr := env.do(http.MethodPost, "/api/nodes/copy", bytes.NewReader(body), "application/json")
	if rr.Code != http.StatusCreated {
		t.Fatalf("copy status=%d body=%s", rr.Code, rr.Body.String())
	}
	if countRegularFiles(env.NFSDir) < 2 {
		t.Fatalf("expected source and dest blobs, got %d", countRegularFiles(env.NFSDir))
	}
}

func TestCopyNodesCompensatesPriorRootsOnFailure(t *testing.T) {
	env := newTestEnv(t)
	a := env.upload("a.txt", []byte("aaa"))
	b := env.upload("b.txt", []byte("bbb"))
	dest := env.mkdir("copies")
	before := countRegularFiles(env.NFSDir)

	inner, err := env.App.StoreForBackend(context.Background(), env.BackendID)
	if err != nil {
		t.Fatal(err)
	}
	fail := &failAfterStore{inner: inner, failAt: 2}
	if err := env.App.ReplaceCachedStore(context.Background(), env.BackendID, fail); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]any{
		"node_ids":            []uuid.UUID{a, b},
		"target_workspace_id": env.WS,
		"target_parent_id":    dest,
	})
	rr := env.do(http.MethodPost, "/api/nodes/copy", bytes.NewReader(body), "application/json")
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("copy status=%d body=%s", rr.Code, rr.Body.String())
	}
	after := countRegularFiles(env.NFSDir)
	if after != before {
		t.Fatalf("orphaned dest blobs: before=%d after=%d", before, after)
	}

	var copies int
	err = env.App.DB.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM nodes
		WHERE workspace_id = $1 AND name IN ('a.txt', 'b.txt') AND deleted_at IS NULL
	`, env.WS).Scan(&copies)
	if err != nil {
		t.Fatal(err)
	}
	if copies != 2 {
		t.Fatalf("expected only the two source files, got %d nodes named a/b.txt", copies)
	}
}

func TestCopyFolderCompensatesMidTreeFailure(t *testing.T) {
	env := newTestEnv(t)
	folder := env.mkdir("tree")
	uploadChild := func(name, body string) {
		t.Helper()
		reqPath := "/api/workspaces/" + env.WS.String() + "/upload?name=" + name + "&parent_id=" + folder.String()
		rr := env.do(http.MethodPut, reqPath, bytes.NewReader([]byte(body)), "text/plain")
		if rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
			t.Fatalf("child upload %s status=%d body=%s", name, rr.Code, rr.Body.String())
		}
	}
	uploadChild("one.txt", "one")
	uploadChild("two.txt", "two")
	dest := env.mkdir("copies")
	before := countRegularFiles(env.NFSDir)

	inner, err := env.App.StoreForBackend(context.Background(), env.BackendID)
	if err != nil {
		t.Fatal(err)
	}
	fail := &failAfterStore{inner: inner, failAt: 2}
	if err := env.App.ReplaceCachedStore(context.Background(), env.BackendID, fail); err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]any{
		"node_ids":            []uuid.UUID{folder},
		"target_workspace_id": env.WS,
		"target_parent_id":    dest,
	})
	rr := env.do(http.MethodPost, "/api/nodes/copy", bytes.NewReader(body), "application/json")
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("copy status=%d body=%s", rr.Code, rr.Body.String())
	}
	after := countRegularFiles(env.NFSDir)
	if after != before {
		t.Fatalf("orphaned dest blobs: before=%d after=%d", before, after)
	}

	var extra int
	err = env.App.DB.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM nodes
		WHERE workspace_id = $1 AND name = 'tree' AND deleted_at IS NULL
	`, env.WS).Scan(&extra)
	if err != nil {
		t.Fatal(err)
	}
	if extra != 1 {
		t.Fatalf("expected only source folder, got %d tree folders", extra)
	}
}
