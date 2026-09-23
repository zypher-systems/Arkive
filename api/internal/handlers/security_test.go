package handlers_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/arkive/arkive/internal/auth"
	"github.com/google/uuid"
)

var ipCounter atomic.Int64

type reqOpts struct {
	cookies []*http.Cookie
	headers map[string]string
	basic   [2]string
}

// req issues a request with a unique client IP so the per-IP auth limiter
// does not interfere with long flows.
func (e *testEnv) req(method, path string, body any, o reqOpts) *httptest.ResponseRecorder {
	e.t.Helper()
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case []byte:
		rd = bytes.NewReader(b)
	case string:
		rd = strings.NewReader(b)
	default:
		raw, _ := json.Marshal(b)
		rd = bytes.NewReader(raw)
	}
	r := httptest.NewRequest(method, path, rd)
	if _, ok := body.(map[string]any); ok {
		r.Header.Set("Content-Type", "application/json")
	}
	r.RemoteAddr = fmt.Sprintf("10.9.%d.%d:1234", ipCounter.Add(1)%250, ipCounter.Load()%250+1)
	for k, v := range o.headers {
		r.Header.Set(k, v)
	}
	for _, c := range o.cookies {
		r.AddCookie(c)
	}
	if o.basic[0] != "" {
		r.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(o.basic[0]+":"+o.basic[1])))
	}
	rr := httptest.NewRecorder()
	e.H.ServeHTTP(rr, r)
	return rr
}

func (e *testEnv) as(c *http.Cookie) reqOpts { return reqOpts{cookies: []*http.Cookie{c}} }

func decode[T any](t *testing.T, rr *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rr.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %T: %v body=%s", v, err, rr.Body.String())
	}
	return v
}

func expect(t *testing.T, rr *httptest.ResponseRecorder, code int, what string) {
	t.Helper()
	if rr.Code != code {
		t.Fatalf("%s: status=%d want %d body=%s", what, rr.Code, code, rr.Body.String())
	}
}

type secUser struct {
	ID       uuid.UUID
	Email    string
	Password string
	Cookie   *http.Cookie
}

func (e *testEnv) newUser(prefix string) secUser {
	e.t.Helper()
	email := fmt.Sprintf("%s-%d@test.local", prefix, time.Now().UnixNano())
	id := e.registerPending(email, "password123", prefix)
	e.approve(id)
	return secUser{ID: id, Email: email, Password: "password123", Cookie: e.login(email, "password123")}
}

func totpNow(t *testing.T, secret string, offset int64) string {
	t.Helper()
	c, err := auth.TOTPCode(secret, auth.TOTPStep(time.Now())+offset)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// resetReplay forgets the last accepted TOTP step so a test can reuse the
// current time window without sleeping 30s.
func (e *testEnv) resetReplay(userID uuid.UUID) {
	e.t.Helper()
	if _, err := e.App.DB.Exec(context.Background(), `UPDATE users SET totp_last_step = NULL WHERE id = $1`, userID); err != nil {
		e.t.Fatal(err)
	}
}

// enable2FA runs setup+enable and returns the secret and recovery codes.
func (e *testEnv) enable2FA(u secUser) (string, []string) {
	e.t.Helper()
	rr := e.req(http.MethodPost, "/api/me/2fa/setup", nil, e.as(u.Cookie))
	expect(e.t, rr, http.StatusOK, "2fa setup")
	setup := decode[struct {
		Secret     string `json:"secret"`
		OtpauthURL string `json:"otpauth_url"`
	}](e.t, rr)
	if setup.Secret == "" || !strings.HasPrefix(setup.OtpauthURL, "otpauth://totp/Arkive:") ||
		!strings.Contains(setup.OtpauthURL, "issuer=Arkive") || !strings.Contains(setup.OtpauthURL, "secret="+setup.Secret) {
		e.t.Fatalf("setup=%+v", setup)
	}
	// Secret must be encrypted at rest.
	var stored string
	if err := e.App.DB.QueryRow(context.Background(), `SELECT totp_pending_secret FROM users WHERE id = $1`, u.ID).Scan(&stored); err != nil {
		e.t.Fatal(err)
	}
	if !strings.HasPrefix(stored, "enc:v1:") || strings.Contains(stored, setup.Secret) {
		e.t.Fatalf("pending secret not encrypted: %q", stored)
	}
	rr = e.req(http.MethodPost, "/api/me/2fa/enable", map[string]any{"code": "000000"}, e.as(u.Cookie))
	if rr.Code != http.StatusBadRequest && totpNow(e.t, setup.Secret, 0) != "000000" {
		e.t.Fatalf("enable with bad code status=%d", rr.Code)
	}
	rr = e.req(http.MethodPost, "/api/me/2fa/enable", map[string]any{"code": totpNow(e.t, setup.Secret, -1)}, e.as(u.Cookie))
	expect(e.t, rr, http.StatusOK, "2fa enable")
	out := decode[struct {
		RecoveryCodes []string `json:"recovery_codes"`
	}](e.t, rr)
	if len(out.RecoveryCodes) != 10 {
		e.t.Fatalf("recovery codes=%v", out.RecoveryCodes)
	}
	return setup.Secret, out.RecoveryCodes
}

func (e *testEnv) passwordStep(u secUser) string {
	e.t.Helper()
	rr := e.req(http.MethodPost, "/api/auth/login", map[string]any{"email": u.Email, "password": u.Password}, reqOpts{})
	expect(e.t, rr, http.StatusOK, "password step")
	if sessionCookie(rr) != nil {
		e.t.Fatal("password step must not set a session cookie when 2FA is enabled")
	}
	out := decode[struct {
		Required  bool   `json:"two_factor_required"`
		Challenge string `json:"challenge"`
	}](e.t, rr)
	if !out.Required || out.Challenge == "" {
		e.t.Fatalf("challenge response=%s", rr.Body.String())
	}
	return out.Challenge
}

func (e *testEnv) secondStep(challenge, code string) *httptest.ResponseRecorder {
	e.t.Helper()
	return e.req(http.MethodPost, "/api/auth/login/2fa", map[string]any{"challenge": challenge, "code": code}, reqOpts{})
}

func errMsg(t *testing.T, rr *httptest.ResponseRecorder) string {
	t.Helper()
	return decode[struct {
		Error string `json:"error"`
	}](t, rr).Error
}

func (e *testEnv) auditActions(actor uuid.UUID) map[string]int {
	e.t.Helper()
	rows, err := e.App.DB.Query(context.Background(), `SELECT action FROM audit_log WHERE actor_user_id = $1`, actor)
	if err != nil {
		e.t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var a string
		if err := rows.Scan(&a); err != nil {
			e.t.Fatal(err)
		}
		out[a]++
	}
	return out
}

func TestTwoFactorLoginFlow(t *testing.T) {
	env := newTestEnv(t)
	u := env.newUser("tfa")
	other := env.login(u.Email, u.Password) // a second session that enabling 2FA must revoke

	rr := env.req(http.MethodGet, "/api/me/2fa", nil, env.as(u.Cookie))
	expect(t, rr, http.StatusOK, "2fa status")
	if s := decode[map[string]any](t, rr); s["enabled"] != false {
		t.Fatalf("status=%v", s)
	}

	secret, codes := env.enable2FA(u)

	rr = env.req(http.MethodGet, "/api/auth/me", nil, env.as(u.Cookie))
	expect(t, rr, http.StatusOK, "me after enable (current session kept)")
	if me := decode[map[string]any](t, rr); me["two_factor_enabled"] != true {
		t.Fatalf("me=%v", me)
	}
	rr = env.req(http.MethodGet, "/api/auth/me", nil, env.as(other))
	expect(t, rr, http.StatusUnauthorized, "other session revoked on enable")

	// Page through the list: a shared test database can hold many users.
	found := false
	for offset := 0; ; {
		rr = env.req(http.MethodGet, fmt.Sprintf("/api/admin/users?status=active&offset=%d", offset), nil, env.as(env.Cookie))
		expect(t, rr, http.StatusOK, "admin users")
		list := decode[struct {
			Items []struct {
				ID               uuid.UUID `json:"id"`
				TwoFactorEnabled bool      `json:"two_factor_enabled"`
			} `json:"items"`
			HasMore    bool `json:"has_more"`
			NextOffset int  `json:"next_offset"`
		}](t, rr)
		for _, it := range list.Items {
			if it.ID == u.ID {
				found = it.TwoFactorEnabled
			}
		}
		if found || !list.HasMore {
			break
		}
		offset = list.NextOffset
	}
	if !found {
		t.Fatal("admin user list should report two_factor_enabled")
	}

	// Bad password still fails before any challenge.
	rr = env.req(http.MethodPost, "/api/auth/login", map[string]any{"email": u.Email, "password": "nope-nope"}, reqOpts{})
	expect(t, rr, http.StatusUnauthorized, "bad password")

	// The exact code accepted by enable cannot be replayed.
	var usedStep int64
	if err := env.App.DB.QueryRow(context.Background(), `SELECT totp_last_step FROM users WHERE id = $1`, u.ID).Scan(&usedStep); err != nil {
		t.Fatal(err)
	}
	usedCode, _ := auth.TOTPCode(secret, usedStep)
	ch := env.passwordStep(u)
	rr = env.secondStep(ch, usedCode)
	expect(t, rr, http.StatusUnauthorized, "replayed code")
	if m := errMsg(t, rr); m != "invalid code" {
		t.Fatalf("msg=%q", m)
	}
	rr = env.secondStep(ch, totpNow(t, secret, 0))
	expect(t, rr, http.StatusOK, "totp login")
	if sessionCookie(rr) == nil {
		t.Fatal("2fa step should set session cookie")
	}
	if me := decode[map[string]any](t, rr); me["email"] != u.Email || me["two_factor_enabled"] != true {
		t.Fatalf("user=%v", me)
	}
	// Challenge is single-use.
	env.resetReplay(u.ID)
	rr = env.secondStep(ch, totpNow(t, secret, 0))
	expect(t, rr, http.StatusUnauthorized, "challenge reuse")
	if m := errMsg(t, rr); m != "invalid or expired challenge" {
		t.Fatalf("msg=%q", m)
	}
	// Garbage challenge.
	rr = env.secondStep("not-a-challenge", totpNow(t, secret, 0))
	expect(t, rr, http.StatusUnauthorized, "garbage challenge")

	// Recovery code works once (case/format-insensitive).
	ch = env.passwordStep(u)
	rr = env.secondStep(ch, strings.ToUpper(codes[0]))
	expect(t, rr, http.StatusOK, "recovery login")
	ch = env.passwordStep(u)
	rr = env.secondStep(ch, codes[0])
	expect(t, rr, http.StatusUnauthorized, "recovery reuse")
	rr = env.secondStep(ch, strings.ReplaceAll(codes[1], "-", ""))
	expect(t, rr, http.StatusOK, "second recovery code on same challenge after one failure")
	rr = env.req(http.MethodGet, "/api/me/2fa", nil, env.as(u.Cookie))
	if s := decode[map[string]any](t, rr); s["enabled"] != true || s["recovery_codes_remaining"] != float64(8) {
		t.Fatalf("status=%v", s)
	}

	// Lockout after 5 bad codes, even for a correct code afterwards.
	env.resetReplay(u.ID)
	ch = env.passwordStep(u)
	for i := 1; i <= 5; i++ {
		rr = env.secondStep(ch, "abcd-efgh")
		expect(t, rr, http.StatusUnauthorized, fmt.Sprintf("bad code %d", i))
		want := "invalid code"
		if i == 5 {
			want = "invalid or expired challenge"
		}
		if m := errMsg(t, rr); m != want {
			t.Fatalf("attempt %d msg=%q want %q", i, m, want)
		}
	}
	rr = env.secondStep(ch, totpNow(t, secret, 0))
	expect(t, rr, http.StatusUnauthorized, "locked challenge")
	if m := errMsg(t, rr); m != "invalid or expired challenge" {
		t.Fatalf("msg=%q", m)
	}

	// Expired challenge.
	ch = env.passwordStep(u)
	if _, err := env.App.DB.Exec(context.Background(), `
		UPDATE login_challenges SET expires_at = $2 WHERE token_hash = $1
	`, auth.HashToken(ch), time.Now().Add(-time.Second)); err != nil {
		t.Fatal(err)
	}
	rr = env.secondStep(ch, totpNow(t, secret, 0))
	expect(t, rr, http.StatusUnauthorized, "expired challenge")

	// Regenerate recovery codes (TOTP required; old codes die).
	rr = env.req(http.MethodPost, "/api/me/2fa/recovery-codes", map[string]any{"code": "123"}, env.as(u.Cookie))
	expect(t, rr, http.StatusForbidden, "regenerate bad code")
	env.resetReplay(u.ID)
	rr = env.req(http.MethodPost, "/api/me/2fa/recovery-codes", map[string]any{"code": totpNow(t, secret, 0)}, env.as(u.Cookie))
	expect(t, rr, http.StatusOK, "regenerate")
	fresh := decode[struct {
		RecoveryCodes []string `json:"recovery_codes"`
	}](t, rr).RecoveryCodes
	if len(fresh) != 10 {
		t.Fatalf("fresh=%v", fresh)
	}
	ch = env.passwordStep(u)
	rr = env.secondStep(ch, codes[2])
	expect(t, rr, http.StatusUnauthorized, "old recovery code after regenerate")

	// Disable: needs password AND code.
	other = env.login2FA(u, fresh[0])
	rr = env.req(http.MethodPost, "/api/me/2fa/disable", map[string]any{"password": "wrong-pass", "code": fresh[1]}, env.as(u.Cookie))
	expect(t, rr, http.StatusForbidden, "disable wrong password")
	rr = env.req(http.MethodPost, "/api/me/2fa/disable", map[string]any{"password": u.Password, "code": "000000x"}, env.as(u.Cookie))
	expect(t, rr, http.StatusForbidden, "disable wrong code")
	rr = env.req(http.MethodPost, "/api/me/2fa/disable", map[string]any{"password": u.Password, "code": fresh[1]}, env.as(u.Cookie))
	expect(t, rr, http.StatusOK, "disable")
	if s := decode[map[string]any](t, rr); s["enabled"] != false {
		t.Fatalf("disable=%v", s)
	}
	rr = env.req(http.MethodGet, "/api/auth/me", nil, env.as(other))
	expect(t, rr, http.StatusUnauthorized, "other session revoked on disable")
	rr = env.req(http.MethodGet, "/api/auth/me", nil, env.as(u.Cookie))
	expect(t, rr, http.StatusOK, "current session kept on disable")
	c := env.login(u.Email, u.Password) // plain login again
	if c == nil {
		t.Fatal("expected session")
	}

	acts := env.auditActions(u.ID)
	for _, a := range []string{"auth.2fa_enabled", "auth.2fa_disabled", "auth.login", "auth.login_failed"} {
		if acts[a] == 0 {
			t.Errorf("missing audit %s (have %v)", a, acts)
		}
	}
	var withSecondStep int
	_ = env.App.DB.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM audit_log WHERE actor_user_id = $1 AND action = 'auth.login' AND meta->>'second_step' = 'recovery'
	`, u.ID).Scan(&withSecondStep)
	if withSecondStep == 0 {
		t.Error("auth.login audit should record the second step method")
	}
}

func (e *testEnv) login2FA(u secUser, code string) *http.Cookie {
	e.t.Helper()
	ch := e.passwordStep(u)
	rr := e.secondStep(ch, code)
	expect(e.t, rr, http.StatusOK, "login2FA")
	return sessionCookie(rr)
}

func TestAdminResetTwoFactor(t *testing.T) {
	env := newTestEnv(t)
	u := env.newUser("tfareset")
	env.enable2FA(u)

	rr := env.req(http.MethodPost, "/api/admin/users/"+u.ID.String()+"/2fa/reset", nil, env.as(u.Cookie))
	expect(t, rr, http.StatusForbidden, "non-admin reset")
	rr = env.req(http.MethodPost, "/api/admin/users/"+uuid.NewString()+"/2fa/reset", nil, env.as(env.Cookie))
	expect(t, rr, http.StatusNotFound, "reset unknown user")
	rr = env.req(http.MethodPost, "/api/admin/users/"+u.ID.String()+"/2fa/reset", nil, env.as(env.Cookie))
	expect(t, rr, http.StatusOK, "admin reset")
	if s := decode[map[string]string](t, rr); s["status"] != "ok" {
		t.Fatalf("reset=%v", s)
	}
	env.login(u.Email, u.Password) // no challenge anymore
	var n int
	_ = env.App.DB.QueryRow(context.Background(), `SELECT COUNT(*) FROM user_recovery_codes WHERE user_id = $1`, u.ID).Scan(&n)
	if n != 0 {
		t.Fatalf("recovery codes left: %d", n)
	}
	if env.auditActions(env.UserID)["user.2fa_reset"] == 0 {
		t.Fatal("missing user.2fa_reset audit")
	}
}

func TestWebDAVBasicAuthWithTwoFactor(t *testing.T) {
	env := newTestEnv(t)
	u := env.newUser("tfadav")

	rr := env.req(http.MethodGet, "/api/workspaces", nil, env.as(u.Cookie))
	expect(t, rr, http.StatusOK, "workspaces")
	var ws uuid.UUID
	for _, s := range decode[[]struct {
		ID   uuid.UUID `json:"id"`
		Type string    `json:"type"`
	}](t, rr) {
		if s.Type == "personal" {
			ws = s.ID
		}
	}
	rr = env.req(http.MethodPost, "/api/me/app-passwords", map[string]any{"name": "sync"}, env.as(u.Cookie))
	expect(t, rr, http.StatusCreated, "app password")
	appPass := decode[struct {
		Secret string `json:"secret"`
	}](t, rr).Secret

	propfind := func(pass string) int {
		return env.req("PROPFIND", "/dav/"+ws.String()+"/", nil, reqOpts{
			basic:   [2]string{u.Email, pass},
			headers: map[string]string{"Depth": "0"},
		}).Code
	}
	if c := propfind(u.Password); c != http.StatusMultiStatus {
		t.Fatalf("password before 2FA: %d", c)
	}
	env.enable2FA(u)
	if c := propfind(u.Password); c != http.StatusUnauthorized {
		t.Fatalf("password with 2FA must be rejected, got %d", c)
	}
	if c := propfind(appPass); c != http.StatusMultiStatus {
		t.Fatalf("app password with 2FA: %d", c)
	}
}

// ---- upload-only links ----

func (e *testEnv) createLink(nodeID uuid.UUID, body map[string]any) (string, uuid.UUID, *httptest.ResponseRecorder) {
	e.t.Helper()
	rr := e.req(http.MethodPost, "/api/nodes/"+nodeID.String()+"/links", body, e.as(e.Cookie))
	if rr.Code != http.StatusCreated {
		return "", uuid.Nil, rr
	}
	l := decode[struct {
		ID    uuid.UUID `json:"id"`
		Token string    `json:"token"`
		Mode  string    `json:"mode"`
	}](e.t, rr)
	return l.Token, l.ID, rr
}

func (e *testEnv) publicUpload(token, name string, payload []byte, o reqOpts) *httptest.ResponseRecorder {
	e.t.Helper()
	return e.req(http.MethodPut, "/api/public/"+token+"/upload?name="+name, payload, o)
}

func TestUploadLink(t *testing.T) {
	env := newTestEnv(t)
	folder := env.mkdir("inbox")
	file := env.upload("plain.txt", []byte("x"))

	_, _, rr := env.createLink(file, map[string]any{"mode": "upload"})
	expect(t, rr, http.StatusBadRequest, "upload link on a file")
	_, _, rr = env.createLink(folder, map[string]any{"mode": "bogus"})
	expect(t, rr, http.StatusBadRequest, "bad mode")

	token, linkID, rr := env.createLink(folder, map[string]any{"mode": "upload"})
	if token == "" {
		t.Fatalf("create upload link status=%d body=%s", rr.Code, rr.Body.String())
	}
	if m := decode[map[string]any](t, rr)["mode"]; m != "upload" {
		t.Fatalf("mode=%v", m)
	}
	rr = env.req(http.MethodGet, "/api/nodes/"+folder.String()+"/links", nil, env.as(env.Cookie))
	if !strings.Contains(rr.Body.String(), `"mode":"upload"`) {
		t.Fatalf("list links=%s", rr.Body.String())
	}

	rr = env.req(http.MethodGet, "/api/public/"+token, nil, reqOpts{})
	expect(t, rr, http.StatusOK, "meta")
	if m := decode[map[string]any](t, rr); m["mode"] != "upload" || m["kind"] != "folder" {
		t.Fatalf("meta=%v", m)
	}
	expect(t, env.req(http.MethodGet, "/api/public/"+token+"/nodes", nil, reqOpts{}), http.StatusForbidden, "list on upload link")
	expect(t, env.req(http.MethodGet, "/api/public/"+token+"/download?node_id="+file.String(), nil, reqOpts{}), http.StatusForbidden, "download on upload link")
	expect(t, env.req(http.MethodPost, "/api/public/"+token+"/download-zip", nil, reqOpts{}), http.StatusForbidden, "zip on upload link")

	for i, want := range []string{"report.pdf", "report (1).pdf", "report (2).pdf"} {
		rr = env.publicUpload(token, "report.pdf", []byte(fmt.Sprintf("v%d", i)), reqOpts{headers: map[string]string{"Content-Type": "text/html"}})
		expect(t, rr, http.StatusCreated, "public upload "+want)
		out := decode[struct {
			Name string `json:"name"`
			Size int64  `json:"size"`
		}](t, rr)
		if out.Name != want || out.Size != 2 {
			t.Fatalf("upload %d => %+v want %s", i, out, want)
		}
	}
	rr = env.publicUpload(token, ".env", []byte("a"), reqOpts{})
	expect(t, rr, http.StatusCreated, "dotfile")
	rr = env.publicUpload(token, ".env", []byte("b"), reqOpts{})
	if n := decode[map[string]any](t, rr)["name"]; n != ".env (1)" {
		t.Fatalf("dotfile collision name=%v", n)
	}
	expect(t, env.publicUpload(token, "", []byte("a"), reqOpts{}), http.StatusBadRequest, "empty name")
	// Path tricks land in the folder under a sanitized name.
	rr = env.publicUpload(token, "..%2F..%2Fescape.txt", []byte("a"), reqOpts{})
	expect(t, rr, http.StatusCreated, "path traversal name")
	if n := decode[map[string]any](t, rr)["name"]; n != "escape.txt" {
		t.Fatalf("sanitized name=%v", n)
	}

	// Owner sees the files; originals untouched; anonymous attribution; mime not client-controlled.
	rows, err := env.App.DB.Query(context.Background(), `
		SELECT name, created_by IS NULL, COALESCE(mime, '') FROM nodes WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY name
	`, folder)
	if err != nil {
		t.Fatal(err)
	}
	names := []string{}
	for rows.Next() {
		var n, mime string
		var anon bool
		if err := rows.Scan(&n, &anon, &mime); err != nil {
			t.Fatal(err)
		}
		if !anon {
			t.Errorf("%s should have created_by NULL", n)
		}
		if strings.HasPrefix(n, "report") && mime != "application/pdf" {
			t.Errorf("%s mime=%q", n, mime)
		}
		names = append(names, n)
	}
	rows.Close()
	if strings.Join(names, ",") != ".env,.env (1),escape.txt,report (1).pdf,report (2).pdf,report.pdf" {
		t.Fatalf("names=%v", names)
	}

	var auditN, actN int
	_ = env.App.DB.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM audit_log WHERE action = 'link.upload' AND actor_user_id IS NULL AND meta->>'link_id' = $1
	`, linkID.String()).Scan(&auditN)
	_ = env.App.DB.QueryRow(context.Background(), `
		SELECT COUNT(*) FROM activity_events WHERE action = 'link.uploaded' AND detail->>'link_id' = $1
	`, linkID.String()).Scan(&actN)
	if auditN != 6 || actN != 6 {
		t.Fatalf("audit=%d activity=%d want 6", auditN, actN)
	}

	// Size limit.
	env.App.Cfg.MaxUploadBytes = 4
	expect(t, env.publicUpload(token, "big.bin", []byte("12345"), reqOpts{}), http.StatusRequestEntityTooLarge, "max upload bytes")
	env.App.Cfg.MaxUploadBytes = 0

	// Quota of the owning workspace.
	if _, err := env.App.DB.Exec(context.Background(), `UPDATE workspaces SET quota_bytes = 20 WHERE id = $1`, env.WS); err != nil {
		t.Fatal(err)
	}
	expect(t, env.publicUpload(token, "q.bin", bytes.Repeat([]byte("q"), 50), reqOpts{}), http.StatusRequestEntityTooLarge, "quota")
	if _, err := env.App.DB.Exec(context.Background(), `UPDATE workspaces SET quota_bytes = NULL WHERE id = $1`, env.WS); err != nil {
		t.Fatal(err)
	}

	// Expiry.
	if _, err := env.App.DB.Exec(context.Background(), `UPDATE public_links SET expires_at = $2 WHERE id = $1`, linkID, time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	expect(t, env.publicUpload(token, "late.txt", []byte("x"), reqOpts{}), http.StatusGone, "expired upload link")

	// A view link does not accept uploads and keeps working as before.
	viewToken, _, rr := env.createLink(folder, map[string]any{})
	if viewToken == "" {
		t.Fatalf("create view link: %d %s", rr.Code, rr.Body.String())
	}
	if m := decode[map[string]any](t, rr)["mode"]; m != "view" {
		t.Fatalf("default mode=%v", m)
	}
	expect(t, env.publicUpload(viewToken, "x.txt", []byte("x"), reqOpts{}), http.StatusForbidden, "upload to view link")
	rr = env.req(http.MethodGet, "/api/public/"+viewToken+"/nodes", nil, reqOpts{})
	expect(t, rr, http.StatusOK, "view link listing")
	if !strings.Contains(rr.Body.String(), "report (2).pdf") {
		t.Fatalf("listing=%s", rr.Body.String())
	}
	rr = env.req(http.MethodGet, "/api/public/"+viewToken, nil, reqOpts{})
	if m := decode[map[string]any](t, rr)["mode"]; m != "view" {
		t.Fatalf("view meta mode=%v", m)
	}
}

func TestUploadLinkPassword(t *testing.T) {
	env := newTestEnv(t)
	folder := env.mkdir("drop")
	token, _, rr := env.createLink(folder, map[string]any{"mode": "upload", "password": "s3cret-pass"})
	if token == "" {
		t.Fatalf("create: %d %s", rr.Code, rr.Body.String())
	}
	rr = env.publicUpload(token, "a.txt", []byte("a"), reqOpts{})
	expect(t, rr, http.StatusUnauthorized, "no password")
	if decode[map[string]any](t, rr)["needs_password"] != true {
		t.Fatal("needs_password expected")
	}
	expect(t, env.publicUpload(token, "a.txt", []byte("a"), reqOpts{headers: map[string]string{"X-Link-Password": "wrong"}}), http.StatusUnauthorized, "wrong password")

	// Unlock via meta (same as view links), then upload with the cookie.
	rr = env.req(http.MethodGet, "/api/public/"+token, nil, reqOpts{headers: map[string]string{"X-Link-Password": "s3cret-pass"}})
	expect(t, rr, http.StatusOK, "unlock")
	var unlock *http.Cookie
	for _, c := range rr.Result().Cookies() {
		if c.Name == "arkive_pl_"+token {
			unlock = c
		}
	}
	if unlock == nil {
		t.Fatal("unlock cookie missing")
	}
	expect(t, env.publicUpload(token, "a.txt", []byte("a"), reqOpts{cookies: []*http.Cookie{unlock}}), http.StatusCreated, "upload with cookie")
	expect(t, env.publicUpload(token, "b.txt", []byte("b"), reqOpts{headers: map[string]string{"X-Link-Password": "s3cret-pass"}}), http.StatusCreated, "upload with header")
}

// ---- audit log ----

func TestAuditLogEndpoint(t *testing.T) {
	env := newTestEnv(t)
	u := env.newUser("auditee")

	// Non-admins cannot read the log.
	expect(t, env.req(http.MethodGet, "/api/admin/audit", nil, env.as(u.Cookie)), http.StatusForbidden, "non-admin audit")

	// Instrumented handler actions by the admin.
	nodeID := env.upload("audited.txt", []byte("x"))
	rr := env.req(http.MethodPost, "/api/nodes/"+nodeID.String()+"/shares", map[string]any{"grantee_email": u.Email, "permission": "read"}, env.as(env.Cookie))
	expect(t, rr, http.StatusCreated, "share")
	shareID := decode[struct {
		ID uuid.UUID `json:"id"`
	}](t, rr).ID
	expect(t, env.req(http.MethodDelete, "/api/shares/"+shareID.String(), nil, env.as(env.Cookie)), http.StatusOK, "unshare")
	_, linkID, _ := env.createLink(nodeID, map[string]any{})
	expect(t, env.req(http.MethodDelete, "/api/links/"+linkID.String(), nil, env.as(env.Cookie)), http.StatusOK, "unlink")
	expect(t, env.req(http.MethodPut, "/api/admin/settings/registration", map[string]any{"registration_open": true}, env.as(env.Cookie)), http.StatusOK, "settings")
	expect(t, env.req(http.MethodPatch, "/api/admin/users/"+u.ID.String()+"/admin", map[string]any{"is_instance_admin": false}, env.as(env.Cookie)), http.StatusOK, "admin change")
	expect(t, env.req(http.MethodPost, "/api/admin/users/"+u.ID.String()+"/disable", nil, env.as(env.Cookie)), http.StatusOK, "disable")
	expect(t, env.req(http.MethodPost, "/api/admin/users/"+u.ID.String()+"/approve", nil, env.as(env.Cookie)), http.StatusOK, "approve")

	acts := env.auditActions(env.UserID)
	for _, a := range []string{"share.created", "share.deleted", "link.created", "link.deleted", "settings.updated",
		"user.admin_changed", "user.disabled", "user.approved"} {
		if acts[a] == 0 {
			t.Errorf("missing audit %s (have %v)", a, acts)
		}
	}
	var ip, email string
	_ = env.App.DB.QueryRow(context.Background(), `
		SELECT ip, actor_email FROM audit_log WHERE actor_user_id = $1 AND action = 'share.created'
	`, env.UserID).Scan(&ip, &email)
	if !strings.HasPrefix(ip, "10.9.") || email != env.Email {
		t.Fatalf("ip=%q email=%q", ip, email)
	}

	// Pagination: 7 entries via the helper plus 3 sharing one timestamp.
	ctx := context.Background()
	for i := 0; i < 7; i++ {
		env.App.Audit(ctx, nil, u.ID.String(), "test.page", "thing", fmt.Sprint(i), map[string]any{"i": i})
	}
	tie := time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 3; i++ {
		if _, err := env.App.DB.Exec(ctx, `
			INSERT INTO audit_log (created_at, actor_user_id, action, meta) VALUES ($1, $2, 'test.tie', '{}')
		`, tie, u.ID); err != nil {
			t.Fatal(err)
		}
	}
	type page struct {
		Items []struct {
			ID          uuid.UUID      `json:"id"`
			CreatedAt   time.Time      `json:"created_at"`
			ActorUserID *uuid.UUID     `json:"actor_user_id"`
			ActorEmail  *string        `json:"actor_email"`
			Action      string         `json:"action"`
			TargetType  string         `json:"target_type"`
			TargetID    string         `json:"target_id"`
			IP          string         `json:"ip"`
			Meta        map[string]any `json:"meta"`
		} `json:"items"`
		NextCursor *string `json:"next_cursor"`
	}
	seen := map[uuid.UUID]bool{}
	var prev time.Time
	cursor := ""
	pages := 0
	var actionsInOrder []string
	for {
		path := "/api/admin/audit?limit=3&actor=" + u.ID.String() + "&action=test."
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		rr = env.req(http.MethodGet, path, nil, env.as(env.Cookie))
		expect(t, rr, http.StatusOK, "audit page")
		p := decode[page](t, rr)
		pages++
		for _, it := range p.Items {
			if seen[it.ID] {
				t.Fatalf("duplicate %s", it.ID)
			}
			seen[it.ID] = true
			if !prev.IsZero() && it.CreatedAt.After(prev) {
				t.Fatal("not newest-first")
			}
			prev = it.CreatedAt
			if it.ActorUserID == nil || *it.ActorUserID != u.ID || it.Meta == nil {
				t.Fatalf("item=%+v", it)
			}
			actionsInOrder = append(actionsInOrder, it.Action)
		}
		if p.NextCursor == nil {
			break
		}
		cursor = *p.NextCursor
		if pages > 10 {
			t.Fatal("pagination does not terminate")
		}
	}
	if len(seen) != 10 || pages != 4 {
		t.Fatalf("seen=%d pages=%d", len(seen), pages)
	}
	if actionsInOrder[0] != "test.page" || actionsInOrder[9] != "test.tie" {
		t.Fatalf("order=%v", actionsInOrder)
	}
	// Prefix filter narrows.
	rr = env.req(http.MethodGet, "/api/admin/audit?limit=50&actor="+u.ID.String()+"&action=test.tie", nil, env.as(env.Cookie))
	if n := len(decode[page](t, rr).Items); n != 3 {
		t.Fatalf("tie filter n=%d", n)
	}
	expect(t, env.req(http.MethodGet, "/api/admin/audit?cursor=bm90LWEtY3Vyc29y", nil, env.as(env.Cookie)), http.StatusBadRequest, "bad cursor")
	expect(t, env.req(http.MethodGet, "/api/admin/audit?actor=nope", nil, env.as(env.Cookie)), http.StatusBadRequest, "bad actor")

	// Retention purge.
	n, err := env.App.PurgeOldAudit(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n < 3 {
		t.Fatalf("purged=%d want >=3 (2020 rows)", n)
	}
	var left int
	_ = env.App.DB.QueryRow(ctx, `SELECT COUNT(*) FROM audit_log WHERE actor_user_id = $1 AND action LIKE 'test.%'`, u.ID).Scan(&left)
	if left != 7 {
		t.Fatalf("left=%d", left)
	}

	// Actor deletion keeps the email snapshot.
	expect(t, env.req(http.MethodDelete, "/api/admin/users/"+u.ID.String(), nil, env.as(env.Cookie)), http.StatusOK, "delete user")
	var orphanEmail *string
	_ = env.App.DB.QueryRow(ctx, `
		SELECT actor_email FROM audit_log WHERE actor_user_id IS NULL AND action = 'test.page' AND actor_email = $1 LIMIT 1
	`, u.Email).Scan(&orphanEmail)
	if orphanEmail == nil {
		t.Fatal("actor_email snapshot lost after user deletion")
	}
	if env.auditActions(env.UserID)["user.deleted"] == 0 {
		t.Fatal("missing user.deleted")
	}
}

func TestAuditNeverFailsCaller(t *testing.T) {
	env := newTestEnv(t)
	// Invalid actor id and unmarshalable meta must not panic or error.
	env.App.Audit(context.Background(), nil, "not-a-uuid", "test.robust", "", "", map[string]any{"bad": make(chan int)})
	var n int
	_ = env.App.DB.QueryRow(context.Background(), `SELECT COUNT(*) FROM audit_log WHERE action = 'test.robust' AND actor_user_id IS NULL`).Scan(&n)
	if n < 1 {
		t.Fatal("robust audit entry not written")
	}
}
