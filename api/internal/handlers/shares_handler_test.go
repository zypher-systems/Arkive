package handlers_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
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
}
