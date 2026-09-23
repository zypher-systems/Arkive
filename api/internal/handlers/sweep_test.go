package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/arkive/arkive/internal/auth"
	"github.com/arkive/arkive/internal/handlers"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// sweepSeed is a small but realistic instance: two users, a team, folders,
// files with versions, shares, public links, trash, audit rows and an
// unfinished tus upload. The route sweep substitutes these ids into every
// registered path.
type sweepSeed struct {
	env        *testEnv
	userCookie *http.Cookie
	userID     uuid.UUID
	userEmail  string
	team       uuid.UUID
	folder     uuid.UUID
	file       uuid.UUID
	image      uuid.UUID
	trashed    uuid.UUID
	userShare  uuid.UUID
	teamShare  uuid.UUID
	viewLink   uuid.UUID
	viewToken  string
	uploadLink uuid.UUID
	upToken    string
	uploadID   string
	appPwID    uuid.UUID
}

// doAs runs a request with a specific cookie (nil = anonymous).
func (e *testEnv) doAs(c *http.Cookie, method, path string, body io.Reader, contentType string) *httptest.ResponseRecorder {
	e.t.Helper()
	saved := e.Cookie
	e.Cookie = c
	defer func() { e.Cookie = saved }()
	return e.do(method, path, body, contentType)
}

func jsonBody(v any) io.Reader {
	b, _ := json.Marshal(v)
	return bytes.NewReader(b)
}

// mustStatus checks a status; want 0 accepts any 2xx.
func mustStatus(t *testing.T, rr *httptest.ResponseRecorder, want int, what string) {
	t.Helper()
	if !statusOK(rr.Code, want) {
		t.Fatalf("%s: status=%d want %d body=%s", what, rr.Code, want, rr.Body.String())
	}
}

func statusOK(got, want int) bool {
	if want == 0 {
		return got >= 200 && got < 300
	}
	return got == want
}

func decodeID(t *testing.T, rr *httptest.ResponseRecorder) uuid.UUID {
	t.Helper()
	var v struct {
		ID uuid.UUID `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &v); err != nil || v.ID == uuid.Nil {
		t.Fatalf("decode id: %v body=%s", err, rr.Body.String())
	}
	return v.ID
}

// tinyPNG is a valid 1x1 PNG so thumbnails have something real to decode.
var tinyPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
	0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
	0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
}

func seedSweep(t *testing.T) *sweepSeed {
	env := newTestEnv(t)
	s := &sweepSeed{env: env}

	// Second user, approved, logged in.
	s.userEmail = fmt.Sprintf("user-%d@test.local", time.Now().UnixNano())
	s.userID = env.registerPending(s.userEmail, "password123", "Second User")
	env.approve(s.userID)
	s.userCookie = env.login(s.userEmail, "password123")

	// Team workspace, the second user joins with the invite token.
	rr := env.do(http.MethodPost, "/api/workspaces", jsonBody(map[string]string{"name": "Team Sweep"}), "application/json")
	mustStatus(t, rr, http.StatusCreated, "create team")
	var team struct {
		ID          uuid.UUID `json:"id"`
		InviteToken string    `json:"invite_token"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &team); err != nil {
		t.Fatal(err)
	}
	s.team = team.ID
	// On a shared PostgreSQL test database the instance default backend may
	// belong to another test's (removed) temp dir: pin the team to ours.
	if _, err := env.App.DB.Exec(context.Background(), `UPDATE workspaces SET storage_backend_id = $1 WHERE id = $2`, env.BackendID, s.team); err != nil {
		t.Fatal(err)
	}
	rr = env.doAs(s.userCookie, http.MethodPost, "/api/workspaces/join", jsonBody(map[string]string{"token": team.InviteToken}), "application/json")
	mustStatus(t, rr, http.StatusOK, "join team")
	env.uploadTo(s.team, "team-notes.txt", []byte("team notes"), true)

	// Folders and files, one with a few versions.
	s.folder = env.mkdir("Projects")
	rr = env.do(http.MethodPost, "/api/workspaces/"+env.WS.String()+"/folders",
		jsonBody(map[string]any{"name": "Nested", "parent_id": s.folder}), "application/json")
	mustStatus(t, rr, http.StatusCreated, "mkdir nested")
	rr = env.do(http.MethodPut, "/api/workspaces/"+env.WS.String()+"/upload?name=readme.md&parent_id="+s.folder.String(),
		strings.NewReader("# Readme\nhello sweep"), "text/markdown")
	if rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
		t.Fatalf("upload into folder status=%d body=%s", rr.Code, rr.Body.String())
	}
	s.file = decodeID(t, rr)
	for i := 2; i <= 3; i++ {
		rr = env.do(http.MethodPut, "/api/nodes/"+s.file.String()+"/content",
			strings.NewReader(fmt.Sprintf("# Readme\nversion %d", i)), "text/markdown")
		if rr.Code >= 300 {
			t.Fatalf("put content v%d status=%d body=%s", i, rr.Code, rr.Body.String())
		}
	}
	s.image = env.uploadTo(env.WS, "pixel.png", tinyPNG, true)
	env.upload(url.QueryEscape("notes with spaces & ünïcode.txt"), []byte("searchable needle text"))

	// Trash.
	s.trashed = env.upload("old.txt", []byte("bye"))
	mustStatus(t, env.do(http.MethodDelete, "/api/nodes/"+s.trashed.String(), nil, ""), 0, "trash")

	// Shares: to the second user and to the team.
	rr = env.do(http.MethodPost, "/api/nodes/"+s.folder.String()+"/shares",
		jsonBody(map[string]string{"grantee_email": s.userEmail, "permission": "read"}), "application/json")
	mustStatus(t, rr, http.StatusCreated, "share to user")
	s.userShare = decodeID(t, rr)
	rr = env.do(http.MethodPost, "/api/nodes/"+s.image.String()+"/shares",
		jsonBody(map[string]any{"grantee_workspace_id": s.team, "permission": "write"}), "application/json")
	mustStatus(t, rr, http.StatusCreated, "share to team")
	s.teamShare = decodeID(t, rr)

	// Public links: a password-protected view link and an upload-only link.
	exp := time.Now().Add(24 * time.Hour).UTC()
	rr = env.do(http.MethodPost, "/api/nodes/"+s.folder.String()+"/links",
		jsonBody(map[string]any{"password": "linkpass", "expires_at": exp}), "application/json")
	mustStatus(t, rr, http.StatusCreated, "view link")
	var link struct {
		ID    uuid.UUID `json:"id"`
		Token string    `json:"token"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &link)
	s.viewLink, s.viewToken = link.ID, link.Token
	rr = env.do(http.MethodPost, "/api/nodes/"+s.folder.String()+"/links",
		jsonBody(map[string]any{"mode": "upload"}), "application/json")
	mustStatus(t, rr, http.StatusCreated, "upload link")
	_ = json.Unmarshal(rr.Body.Bytes(), &link)
	s.uploadLink, s.upToken = link.ID, link.Token
	if s.viewToken == "" || s.upToken == "" {
		t.Fatal("link tokens missing")
	}

	// Unfinished tus upload.
	s.uploadID = strings.TrimPrefix(env.tusCreate("big.bin", 1024, nil), "/api/uploads/")

	// App password and a pending 2FA setup; admin settings change (audit).
	rr = env.do(http.MethodPost, "/api/me/app-passwords", jsonBody(map[string]string{"name": "sweep"}), "application/json")
	mustStatus(t, rr, http.StatusCreated, "app password")
	s.appPwID = decodeID(t, rr)
	rr = env.do(http.MethodPut, "/api/admin/settings/versions", jsonBody(map[string]int{"max_versions": 5}), "application/json")
	mustStatus(t, rr, http.StatusOK, "version retention")
	return s
}

// sweepPath fills a chi route pattern with seeded ids.
func (s *sweepSeed) sweepPath(pattern string) string {
	repl := map[string]string{
		"{workspaceID}":  s.env.WS.String(),
		"{nodeID}":       s.file.String(),
		"{shareID}":      s.userShare.String(),
		"{linkID}":       s.viewLink.String(),
		"{version}":      "1",
		"{userID}":       s.userID.String(),
		"{backendID}":    s.env.BackendID.String(),
		"{jobID}":        uuid.NewString(),
		"{connectionID}": uuid.NewString(),
		"{uploadID}":     s.uploadID,
		"{token}":        s.viewToken,
		"{id}":           s.appPwID.String(),
	}
	p := pattern
	for k, v := range repl {
		p = strings.ReplaceAll(p, k, v)
	}
	p = strings.ReplaceAll(p, "/*", "/")
	return p
}

// sweepQueries adds the query strings some GET handlers need to do real work.
var sweepQueries = map[string]string{
	"/api/workspaces/{workspaceID}/search": "q=needle",
	"/api/search":                          "q=readme",
	"/api/admin/audit":                     "limit=2",
}

// TestSweepEveryGETRoute seeds a realistic instance and calls every GET/HEAD
// route registered in the router as admin, as a second user and anonymously.
// No route may answer 5xx: each one used to be tested alone, but together
// (and on SQLite as well as PostgreSQL) several were not.
func TestSweepEveryGETRoute(t *testing.T) {
	s := seedSweep(t)
	env := s.env
	router := handlers.ChiRoutes(env.App)
	var routes []string
	err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if method == http.MethodGet || method == http.MethodHead {
			routes = append(routes, method+" "+route)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(routes) < 50 {
		t.Fatalf("walked only %d GET routes", len(routes))
	}
	callers := []struct {
		name   string
		cookie *http.Cookie
	}{{"admin", env.Cookie}, {"user", s.userCookie}, {"anon", nil}}
	variants := func(route string) []string {
		p := s.sweepPath(route)
		out := []string{p}
		if strings.Contains(route, "{nodeID}") {
			// Folder and image variants exercise different branches.
			out = append(out,
				strings.ReplaceAll(p, s.file.String(), s.folder.String()),
				strings.ReplaceAll(p, s.file.String(), s.image.String()))
		}
		if strings.Contains(route, "{workspaceID}") {
			out = append(out, strings.ReplaceAll(p, env.WS.String(), s.team.String()))
		}
		if q, ok := sweepQueries[route]; ok {
			for i := range out {
				out[i] += "?" + q
			}
		}
		return out
	}
	for _, r := range routes {
		method, route, _ := strings.Cut(r, " ")
		for _, p := range variants(route) {
			for _, c := range callers {
				rr := env.doAs(c.cookie, method, p, nil, "")
				if method == http.MethodHead && strings.HasPrefix(p, "/api/uploads/") {
					// tus HEAD without Tus-Resumable is a 412; with it, 200.
					req := httptest.NewRequest(method, p, nil)
					req.Header.Set("Tus-Resumable", "1.0.0")
					if c.cookie != nil {
						req.AddCookie(c.cookie)
					}
					rr = httptest.NewRecorder()
					env.H.ServeHTTP(rr, req)
				}
				if rr.Code == http.StatusServiceUnavailable && route == "/api/ready" {
					// Readiness answers 503 by contract; on the shared
					// PostgreSQL test database the default backend may be
					// another test's removed temp dir.
					continue
				}
				if rr.Code >= 500 {
					t.Errorf("%s %s as %s: %d %s", method, p, c.name, rr.Code, rr.Body.String())
				}
			}
		}
	}
	t.Logf("swept %d GET/HEAD routes", len(routes))

	// Public link: unlock the view link, then use it as a browser would.
	pub := "/api/public/" + s.viewToken
	rr := env.doAs(nil, http.MethodGet, pub, nil, "")
	mustStatus(t, rr, http.StatusUnauthorized, "locked link meta")
	req := httptest.NewRequest(http.MethodGet, pub, nil)
	req.Header.Set("X-Link-Password", "linkpass")
	rec := httptest.NewRecorder()
	env.H.ServeHTTP(rec, req)
	if rec.Code >= 500 {
		t.Errorf("unlock: %d %s", rec.Code, rec.Body.String())
	}

	// Audit cursor pagination.
	rr = env.do(http.MethodGet, "/api/admin/audit?limit=1", nil, "")
	mustStatus(t, rr, http.StatusOK, "audit page 1")
	var page struct {
		Items      []json.RawMessage `json:"items"`
		NextCursor *string           `json:"next_cursor"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &page)
	if page.NextCursor == nil {
		t.Fatalf("audit: expected a next cursor, body=%s", rr.Body.String())
	}
	rr = env.do(http.MethodGet, "/api/admin/audit?limit=1&cursor="+url.QueryEscape(*page.NextCursor), nil, "")
	mustStatus(t, rr, http.StatusOK, "audit page 2")
	var page2 struct {
		Items []json.RawMessage `json:"items"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &page2)
	if len(page2.Items) != 1 || string(page2.Items[0]) == string(page.Items[0]) {
		t.Fatalf("audit page 2 = %s", rr.Body.String())
	}
	rr = env.do(http.MethodGet, "/api/admin/audit?action=settings.", nil, "")
	mustStatus(t, rr, http.StatusOK, "audit filter")
	if !strings.Contains(rr.Body.String(), "settings.updated") {
		t.Fatalf("audit filter missing settings.updated: %s", rr.Body.String())
	}
}

// TestSweepMutatingRoutes drives the main write paths end to end on one
// seeded instance and checks status codes (and that nothing 5xx's).
func TestSweepMutatingRoutes(t *testing.T) {
	s := seedSweep(t)
	env := s.env
	ws := env.WS.String()
	type step struct {
		name   string
		cookie *http.Cookie
		method string
		path   string
		body   any
		want   int
	}
	admin, user := env.Cookie, s.userCookie
	copyTarget := env.mkdir("Copies")
	steps := []step{
		{"rename", admin, http.MethodPatch, "/api/nodes/" + s.file.String(), map[string]any{"name": "README.md"}, 0},
		{"move", admin, http.MethodPatch, "/api/nodes/" + s.image.String(), map[string]any{"parent_id": s.folder, "move": true}, 0},
		{"copy", admin, http.MethodPost, "/api/nodes/copy", map[string]any{"node_ids": []uuid.UUID{s.folder}, "target_workspace_id": env.WS, "target_parent_id": copyTarget}, 0},
		{"copy to team", admin, http.MethodPost, "/api/nodes/copy", map[string]any{"node_ids": []uuid.UUID{s.file}, "target_workspace_id": s.team}, 0},
		{"zip", admin, http.MethodPost, "/api/workspaces/" + ws + "/download-zip", map[string]any{"node_ids": []uuid.UUID{s.folder}}, 0},
		{"restore version", admin, http.MethodPost, "/api/nodes/" + s.file.String() + "/versions/1/restore", nil, 0},
		{"restore trash", admin, http.MethodPost, "/api/nodes/" + s.trashed.String() + "/restore", nil, 0},
		{"trash again", admin, http.MethodDelete, "/api/nodes/" + s.trashed.String(), nil, 0},
		{"purge", admin, http.MethodDelete, "/api/nodes/" + s.trashed.String() + "/purge", nil, 0},
		{"empty trash", admin, http.MethodDelete, "/api/workspaces/" + ws + "/trash", nil, 0},
		{"user cannot write read share", user, http.MethodPut, "/api/nodes/" + s.file.String() + "/content", "nope", http.StatusForbidden},
		{"user writes team share", user, http.MethodPut, "/api/nodes/" + s.image.String() + "/content", "not a png any more", 0},
		{"public upload", nil, http.MethodPut, "/api/public/" + s.upToken + "/upload?name=drop.txt", "dropped", 0},
		{"public upload collision", nil, http.MethodPut, "/api/public/" + s.upToken + "/upload?name=drop.txt", "dropped again", 0},
		{"upload link cannot list", nil, http.MethodGet, "/api/public/" + s.upToken + "/nodes", nil, http.StatusForbidden},
		{"upload link cannot download", nil, http.MethodGet, "/api/public/" + s.upToken + "/download", nil, http.StatusForbidden},
		{"member role", admin, http.MethodPatch, "/api/workspaces/" + s.team.String() + "/members/" + s.userID.String(), map[string]string{"role": "admin"}, 0},
		{"rotate invite", admin, http.MethodPost, "/api/workspaces/" + s.team.String() + "/invite", nil, 0},
		{"user quota", admin, http.MethodPatch, "/api/admin/users/" + s.userID.String() + "/quota", map[string]any{"quota_bytes": 1 << 30}, 0},
		{"workspace quota", admin, http.MethodPatch, "/api/admin/workspaces/" + s.team.String() + "/quota", map[string]any{"quota_bytes": 1 << 30}, 0},
		{"trash retention", admin, http.MethodPut, "/api/admin/settings/trash", map[string]any{"trash_retention_days": 14}, 0},
		{"registration", admin, http.MethodPut, "/api/admin/settings/registration", map[string]any{"registration_open": true}, 0},
		{"quota defaults", admin, http.MethodPut, "/api/admin/settings/quota", map[string]any{"default_workspace_quota_bytes": nil}, 0},
		{"smtp", admin, http.MethodPut, "/api/admin/settings/smtp", map[string]any{"host": "smtp.example.com", "port": "587", "from": "a@example.com"}, 0},
		{"reindex", admin, http.MethodPost, "/api/admin/search/reindex", nil, 0},
		{"backend test", admin, http.MethodPost, "/api/admin/backends/" + env.BackendID.String() + "/test", nil, 0},
		{"profile", user, http.MethodPatch, "/api/auth/me", map[string]string{"display_name": "Renamed User"}, 0},
		{"delete user share", admin, http.MethodDelete, "/api/shares/" + s.userShare.String(), nil, 0},
		{"delete link", admin, http.MethodDelete, "/api/links/" + s.viewLink.String(), nil, 0},
		{"revoke app pw", admin, http.MethodDelete, "/api/me/app-passwords/" + s.appPwID.String(), nil, 0},
		{"tus delete", admin, http.MethodDelete, "/api/uploads/" + s.uploadID, nil, 0},
		{"disable user", admin, http.MethodPost, "/api/admin/users/" + s.userID.String() + "/disable", nil, 0},
	}
	for _, st := range steps {
		var body io.Reader
		ct := ""
		switch b := st.body.(type) {
		case nil:
		case string:
			body, ct = strings.NewReader(b), "text/plain"
		default:
			body, ct = jsonBody(b), "application/json"
		}
		req := httptest.NewRequest(st.method, st.path, body)
		if ct != "" {
			req.Header.Set("Content-Type", ct)
		}
		if strings.HasPrefix(st.path, "/api/uploads/") {
			req.Header.Set("Tus-Resumable", "1.0.0")
		}
		if st.cookie != nil {
			req.AddCookie(st.cookie)
		}
		rr := httptest.NewRecorder()
		env.H.ServeHTTP(rr, req)
		if !statusOK(rr.Code, st.want) {
			t.Errorf("%s: %s %s = %d want %d: %s", st.name, st.method, st.path, rr.Code, st.want, rr.Body.String())
		}
	}

	// The upload-only drop landed twice with a renamed collision.
	rr := env.do(http.MethodGet, "/api/workspaces/"+ws+"/nodes?parent_id="+s.folder.String(), nil, "")
	mustStatus(t, rr, http.StatusOK, "list folder")
	var listing struct {
		Nodes []struct {
			Name string `json:"name"`
		} `json:"nodes"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &listing)
	drops := 0
	for _, n := range listing.Nodes {
		if strings.HasPrefix(n.Name, "drop") {
			drops++
		}
	}
	if drops != 2 {
		t.Errorf("expected 2 dropped files, got %+v", listing.Nodes)
	}

	// 2FA: setup, enable with a real TOTP code, reset by the admin.
	rr = env.do(http.MethodPost, "/api/me/2fa/setup", nil, "")
	mustStatus(t, rr, http.StatusOK, "2fa setup")
	var setup struct {
		Secret string `json:"secret"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &setup)
	code, err := auth.TOTPCode(setup.Secret, auth.TOTPStep(time.Now()))
	if err != nil {
		t.Fatal(err)
	}
	rr = env.do(http.MethodPost, "/api/me/2fa/enable", jsonBody(map[string]string{"code": code}), "application/json")
	mustStatus(t, rr, http.StatusOK, "2fa enable")
	rr = env.do(http.MethodGet, "/api/me/2fa", nil, "")
	mustStatus(t, rr, http.StatusOK, "2fa status")
	rr = env.do(http.MethodPost, "/api/admin/users/"+env.UserID.String()+"/2fa/reset", nil, "")
	if rr.Code >= 500 {
		t.Errorf("2fa reset: %d %s", rr.Code, rr.Body.String())
	}
}
