package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestRegisterApproveUploadDownload(t *testing.T) {
	env := newTestEnv(t)
	email := fmt.Sprintf("member-%d@test.local", time.Now().UnixNano())
	uid := env.registerPending(email, "password123", "Member")
	env.approve(uid)
	env.Cookie = env.login(email, "password123")

	rr := env.do(http.MethodGet, "/api/workspaces", nil, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("workspaces status=%d body=%s", rr.Code, rr.Body.String())
	}
	var spaces []struct {
		ID   uuid.UUID `json:"id"`
		Type string    `json:"type"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &spaces); err != nil {
		t.Fatal(err)
	}
	var ws uuid.UUID
	for _, s := range spaces {
		if s.Type == "personal" {
			ws = s.ID
			break
		}
	}
	if ws == uuid.Nil {
		t.Fatal("no personal workspace")
	}
	if _, err := env.App.DB.Exec(context.Background(), `UPDATE workspaces SET storage_backend_id = $1 WHERE id = $2`, env.BackendID, ws); err != nil {
		t.Fatal(err)
	}

	id := env.uploadTo(ws, "hello.txt", []byte("hello arkive"), true)
	rr = env.do(http.MethodGet, "/api/nodes/"+id.String()+"/download", nil, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("download status=%d body=%s", rr.Code, rr.Body.String())
	}
	if got := rr.Body.String(); got != "hello arkive" {
		t.Fatalf("download body=%q", got)
	}
}

func TestUploadAndDownload(t *testing.T) {
	env := newTestEnv(t)
	id := env.upload("hello.txt", []byte("hello arkive"))
	rr := env.do(http.MethodGet, "/api/nodes/"+id.String()+"/download", nil, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("download status=%d body=%s", rr.Code, rr.Body.String())
	}
	if got := rr.Body.String(); got != "hello arkive" {
		t.Fatalf("download body=%q", got)
	}
}

func TestUploadQuotaKnownLength(t *testing.T) {
	env := newTestEnv(t)
	ctx := context.Background()
	if _, err := env.App.DB.Exec(ctx, `UPDATE workspaces SET quota_bytes = 10 WHERE id = $1`, env.WS); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPut, "/api/workspaces/"+env.WS.String()+"/upload?name=big.txt", bytes.NewReader(bytes.Repeat([]byte("x"), 64)))
	req.Header.Set("Content-Type", "text/plain")
	req.AddCookie(env.Cookie)
	rr := httptest.NewRecorder()
	env.H.ServeHTTP(rr, req)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestUploadQuotaUnknownLength(t *testing.T) {
	env := newTestEnv(t)
	ctx := context.Background()
	if _, err := env.App.DB.Exec(ctx, `UPDATE workspaces SET quota_bytes = 10 WHERE id = $1`, env.WS); err != nil {
		t.Fatal(err)
	}
	payload := bytes.Repeat([]byte("y"), 64)
	req := httptest.NewRequest(http.MethodPut, "/api/workspaces/"+env.WS.String()+"/upload?name=chunked.txt", io.NopCloser(bytes.NewReader(payload)))
	req.Header.Set("Content-Type", "text/plain")
	req.ContentLength = -1
	req.AddCookie(env.Cookie)
	rr := httptest.NewRecorder()
	env.H.ServeHTTP(rr, req)
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}
