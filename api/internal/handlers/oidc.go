package handlers

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"strings"
	"sync"

	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/models"
	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"golang.org/x/oauth2"
)

type AuthOIDC struct {
	Auth *AuthHandler

	mu       sync.Mutex
	provider *oidc.Provider
	verifier *oidc.IDTokenVerifier
	oauth    *oauth2.Config
}

func NewAuthOIDC(auth *AuthHandler) *AuthOIDC {
	return &AuthOIDC{Auth: auth}
}

func (h *AuthOIDC) Enabled(w http.ResponseWriter, r *http.Request) {
	cfg := h.Auth.App.Cfg
	httpjson.Write(w, http.StatusOK, map[string]any{
		"enabled":       cfg.OIDCEnabled(),
		"provider_name": cfg.OIDCProviderName,
	})
}

func (h *AuthOIDC) ensure(ctx context.Context) error {
	cfg := h.Auth.App.Cfg
	if !cfg.OIDCEnabled() {
		return errString("oidc not configured")
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.provider != nil {
		return nil
	}
	provider, err := oidc.NewProvider(ctx, cfg.OIDCIssuer)
	if err != nil {
		return err
	}
	h.provider = provider
	h.verifier = provider.Verifier(&oidc.Config{ClientID: cfg.OIDCClientID})
	h.oauth = &oauth2.Config{
		ClientID:     cfg.OIDCClientID,
		ClientSecret: cfg.OIDCClientSecret,
		Endpoint:     provider.Endpoint(),
		RedirectURL:  cfg.OIDCRedirectURL,
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}
	return nil
}

func (h *AuthOIDC) Start(w http.ResponseWriter, r *http.Request) {
	if err := h.ensure(r.Context()); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "oidc not configured")
		return
	}
	state := randomOIDCState()
	http.SetCookie(w, &http.Cookie{
		Name:     "arkive_oidc_state",
		Value:    state,
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   h.Auth.App.Cfg.CookieSecure,
	})
	h.mu.Lock()
	url := h.oauth.AuthCodeURL(state)
	h.mu.Unlock()
	http.Redirect(w, r, url, http.StatusFound)
}

func (h *AuthOIDC) Callback(w http.ResponseWriter, r *http.Request) {
	if err := h.ensure(r.Context()); err != nil {
		http.Redirect(w, r, "/login?error=oidc", http.StatusFound)
		return
	}
	stateCookie, err := r.Cookie("arkive_oidc_state")
	if err != nil || stateCookie.Value == "" || stateCookie.Value != r.URL.Query().Get("state") {
		http.Redirect(w, r, "/login?error=oidc_state", http.StatusFound)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "arkive_oidc_state",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.Auth.App.Cfg.CookieSecure,
	})

	h.mu.Lock()
	oauthCfg := *h.oauth
	verifier := h.verifier
	h.mu.Unlock()

	token, err := oauthCfg.Exchange(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		http.Redirect(w, r, "/login?error=oidc_exchange", http.StatusFound)
		return
	}
	rawID, ok := token.Extra("id_token").(string)
	if !ok || rawID == "" {
		http.Redirect(w, r, "/login?error=oidc_id_token", http.StatusFound)
		return
	}
	idToken, err := verifier.Verify(r.Context(), rawID)
	if err != nil {
		http.Redirect(w, r, "/login?error=oidc_verify", http.StatusFound)
		return
	}
	var claims struct {
		Subject string `json:"sub"`
		Email   string `json:"email"`
		Name    string `json:"name"`
	}
	if err := idToken.Claims(&claims); err != nil || claims.Email == "" {
		http.Redirect(w, r, "/login?error=oidc_claims", http.StatusFound)
		return
	}
	email := strings.ToLower(strings.TrimSpace(claims.Email))
	display := strings.TrimSpace(claims.Name)
	if display == "" {
		display = strings.Split(email, "@")[0]
	}

	user, err := h.upsertOIDCUser(r.Context(), claims.Subject, email, display)
	if err != nil {
		http.Redirect(w, r, "/login?error=oidc_user", http.StatusFound)
		return
	}
	if user.Status == "pending" {
		http.Redirect(w, r, "/login?error=pending", http.StatusFound)
		return
	}
	if user.Status != "active" {
		http.Redirect(w, r, "/login?error=rejected", http.StatusFound)
		return
	}
	if err := h.Auth.createSession(w, r, user.ID); err != nil {
		http.Redirect(w, r, "/login?error=oidc_session", http.StatusFound)
		return
	}
	http.Redirect(w, r, "/", http.StatusFound)
}

func (h *AuthOIDC) upsertOIDCUser(ctx context.Context, sub, email, display string) (*models.User, error) {
	var user models.User
	err := h.Auth.App.DB.QueryRow(ctx, `
		SELECT id, email, display_name, is_instance_admin, status, created_at
		FROM users WHERE oidc_sub = $1 OR email = $2
		ORDER BY CASE WHEN oidc_sub = $1 THEN 0 ELSE 1 END
		LIMIT 1
	`, sub, email).Scan(&user.ID, &user.Email, &user.DisplayName, &user.IsInstanceAdmin, &user.Status, &user.CreatedAt)
	if err == nil {
		_, _ = h.Auth.App.DB.Exec(ctx, `
			UPDATE users SET oidc_sub = $1, display_name = COALESCE(NULLIF($2, ''), display_name)
			WHERE id = $3
		`, sub, display, user.ID)
		if h.Auth.App.Cfg.BootstrapAdminEmail != "" && email == h.Auth.App.Cfg.BootstrapAdminEmail {
			_, _ = h.Auth.App.DB.Exec(ctx, `
				UPDATE users SET is_instance_admin = TRUE, status = 'active' WHERE id = $1
			`, user.ID)
			user.IsInstanceAdmin = true
			user.Status = "active"
		}
		return &user, nil
	}

	isAdmin := h.Auth.App.Cfg.BootstrapAdminEmail != "" && email == h.Auth.App.Cfg.BootstrapAdminEmail
	status := "pending"
	if isAdmin {
		status = "active"
	}
	backendID, err := h.Auth.App.DefaultBackendID(ctx)
	if err != nil {
		return nil, err
	}
	tx, err := h.Auth.App.DB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	err = tx.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, is_instance_admin, status, oidc_sub)
		VALUES ($1, NULL, $2, $3, $4, $5)
		RETURNING id, email, display_name, is_instance_admin, status, created_at
	`, email, display, isAdmin, status, sub).Scan(
		&user.ID, &user.Email, &user.DisplayName, &user.IsInstanceAdmin, &user.Status, &user.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	wsID := uuid.New()
	_, err = tx.Exec(ctx, `
		INSERT INTO workspaces (id, type, name, storage_backend_id)
		VALUES ($1, 'personal', $2, $3)
	`, wsID, display+"'s Files", backendID)
	if err != nil {
		return nil, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
	`, wsID, user.ID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &user, nil
}

func randomOIDCState() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
