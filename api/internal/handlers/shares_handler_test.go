package handlers_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestShareCreateAndList(t *testing.T) {
	env := newTestEnv(t)
	nodeID := env.upload("shared.txt", []byte("share me"))

	granteeEmail := fmt.Sprintf("grantee-%d@test.local", time.Now().UnixNano())
	granteeID := env.registerPending(granteeEmail, "password123", "Grantee")
	env.approve(granteeID)

	body, _ := json.Marshal(map[string]string{
		"grantee_email": granteeEmail,
		"permission":    "read",
	})
	rr := env.do(http.MethodPost, "/api/nodes/"+nodeID.String()+"/shares", bytes.NewReader(body), "application/json")
	if rr.Code != http.StatusCreated {
		t.Fatalf("create share status=%d body=%s", rr.Code, rr.Body.String())
	}
	var created struct {
		ID         uuid.UUID `json:"id"`
		Permission string    `json:"permission"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == uuid.Nil || created.Permission != "read" {
		t.Fatalf("share=%+v", created)
	}

	rr = env.do(http.MethodGet, "/api/nodes/"+nodeID.String()+"/shares", nil, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("list shares status=%d body=%s", rr.Code, rr.Body.String())
	}
	var listed []struct {
		ID uuid.UUID `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != created.ID {
		t.Fatalf("listed=%+v", listed)
	}

	// The grantee sees the node under Shared with me with the effective
	// permission (portable aggregate: this query once used Postgres bool_or).
	cookie := env.login(granteeEmail, "password123")
	req := httptest.NewRequest(http.MethodGet, "/api/shared", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
	env.H.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("shared with me status=%d body=%s", rec.Code, rec.Body.String())
	}
	var shared struct {
		Items []struct {
			ID         uuid.UUID `json:"id"`
			Permission string    `json:"permission"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &shared); err != nil {
		t.Fatal(err)
	}
	if len(shared.Items) != 1 || shared.Items[0].ID != nodeID || shared.Items[0].Permission != "read" {
		t.Fatalf("shared=%+v", shared.Items)
	}
}

func TestShareCreateRejectsForeignWorkspace(t *testing.T) {
	env := newTestEnv(t)
	nodeID := env.upload("team-share.txt", []byte("do not leak"))

	otherEmail := fmt.Sprintf("other-%d@test.local", time.Now().UnixNano())
	otherID := env.registerPending(otherEmail, "password123", "Other")
	env.approve(otherID)
	otherCookie := env.login(otherEmail, "password123")

	saved := env.Cookie
	env.Cookie = otherCookie
	rr := env.do(http.MethodGet, "/api/workspaces", nil, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("other workspaces status=%d body=%s", rr.Code, rr.Body.String())
	}
	var spaces []struct {
		ID   uuid.UUID `json:"id"`
		Type string    `json:"type"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &spaces); err != nil {
		t.Fatal(err)
	}
	var foreign uuid.UUID
	for _, s := range spaces {
		if s.Type == "personal" {
			foreign = s.ID
			break
		}
	}
	if foreign == uuid.Nil {
		t.Fatal("other user missing personal workspace")
	}
	env.Cookie = saved

	body, _ := json.Marshal(map[string]any{
		"grantee_workspace_id": foreign.String(),
		"permission":           "read",
	})
	rr = env.do(http.MethodPost, "/api/nodes/"+nodeID.String()+"/shares", bytes.NewReader(body), "application/json")
	if rr.Code != http.StatusForbidden {
		t.Fatalf("foreign workspace share status=%d body=%s", rr.Code, rr.Body.String())
	}

	body, _ = json.Marshal(map[string]string{"name": "Share Team"})
	rr = env.do(http.MethodPost, "/api/workspaces", bytes.NewReader(body), "application/json")
	if rr.Code != http.StatusCreated {
		t.Fatalf("create team status=%d body=%s", rr.Code, rr.Body.String())
	}
	var team struct {
		ID uuid.UUID `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &team); err != nil {
		t.Fatal(err)
	}
	body, _ = json.Marshal(map[string]any{
		"grantee_workspace_id": team.ID.String(),
		"permission":           "read",
	})
	rr = env.do(http.MethodPost, "/api/nodes/"+nodeID.String()+"/shares", bytes.NewReader(body), "application/json")
	if rr.Code != http.StatusCreated {
		t.Fatalf("own team share status=%d body=%s", rr.Code, rr.Body.String())
	}
}
