package handlers_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestAdminVersionRetentionEndpoints(t *testing.T) {
	env := newTestEnv(t)
	lockVersionSetting(t, env)
	t.Cleanup(func() {
		_, _ = env.App.DB.Exec(context.Background(), `DELETE FROM instance_settings WHERE key = 'max_versions_per_file'`)
	})
	_, _ = env.App.DB.Exec(context.Background(), `DELETE FROM instance_settings WHERE key = 'max_versions_per_file'`)

	get := func() int {
		rr := env.do(http.MethodGet, "/api/admin/settings/versions", nil, "")
		if rr.Code != http.StatusOK {
			t.Fatalf("get status=%d", rr.Code)
		}
		var out struct {
			MaxVersions int `json:"max_versions"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out.MaxVersions
	}
	if got := get(); got != 10 {
		t.Fatalf("default=%d", got)
	}
	for _, bad := range []string{`{"max_versions": 101}`, `{"max_versions": -1}`, `{}`, `nope`} {
		if rr := env.do(http.MethodPut, "/api/admin/settings/versions", strings.NewReader(bad), "application/json"); rr.Code != http.StatusBadRequest {
			t.Fatalf("PUT %s status=%d", bad, rr.Code)
		}
	}
	rr := env.do(http.MethodPut, "/api/admin/settings/versions", strings.NewReader(`{"max_versions": 0}`), "application/json")
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), `"max_versions":0`) {
		t.Fatalf("PUT 0 status=%d body=%s", rr.Code, rr.Body.String())
	}
	if got := get(); got != 0 {
		t.Fatalf("after put=%d", got)
	}

	// Non-admins are forbidden.
	email := fmt.Sprintf("plain-%d@test.local", time.Now().UnixNano())
	uid := env.registerPending(email, "password123", "Plain")
	env.approve(uid)
	env.Cookie = env.login(email, "password123")
	if rr := env.do(http.MethodGet, "/api/admin/settings/versions", nil, ""); rr.Code != http.StatusForbidden {
		t.Fatalf("non-admin get status=%d", rr.Code)
	}
}
