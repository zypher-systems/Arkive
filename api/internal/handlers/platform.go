package handlers

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/auth"
	"github.com/arkive/arkive/internal/buildinfo"
	"github.com/arkive/arkive/internal/httpjson"
)

// PlatformHandler serves first-run setup and the /api/instance aggregate.
type PlatformHandler struct {
	App  *app.App
	Auth *AuthHandler
}

type setupRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
	SetupToken  string `json:"setup_token"`
}

// GetSetup → { "needed": bool, "token_required": true }.
func (h *PlatformHandler) GetSetup(w http.ResponseWriter, r *http.Request) {
	needed, err := h.App.SetupNeeded(r.Context())
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "database error")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"needed": needed,
		// Always true: without ARKIVE_SETUP_TOKEN a one-time token is printed
		// to the server log, so a stranger cannot claim a fresh instance.
		"token_required": true,
	})
}

// PostSetup creates the first (admin) account and signs it in.
func (h *PlatformHandler) PostSetup(w http.ResponseWriter, r *http.Request) {
	var req setupRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	needed, err := h.App.SetupNeeded(r.Context())
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "database error")
		return
	}
	if !needed {
		httpjson.Error(w, http.StatusConflict, "setup already completed")
		return
	}
	want := h.App.SetupToken()
	got := strings.TrimSpace(req.SetupToken)
	if want == "" || subtle.ConstantTimeCompare([]byte(got), []byte(want)) != 1 {
		httpjson.Error(w, http.StatusForbidden, "invalid setup token")
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	display := strings.TrimSpace(req.DisplayName)
	if email == "" || !strings.Contains(email, "@") || len(req.Password) < 8 || display == "" {
		httpjson.Error(w, http.StatusBadRequest, "email, display_name, and password (min 8) required")
		return
	}
	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not hash password")
		return
	}
	user, err := h.App.CreateSetupAdmin(r.Context(), email, hash, display)
	if errors.Is(err, app.ErrSetupDone) {
		httpjson.Error(w, http.StatusConflict, "setup already completed")
		return
	}
	if err != nil {
		if h.App.Logger != nil {
			h.App.Logger.Error("setup failed", "err", err)
		}
		httpjson.Error(w, http.StatusInternalServerError, "could not create admin")
		return
	}
	if h.App.Logger != nil {
		h.App.Logger.Info("first-run setup completed", "admin", user.Email)
	}
	if err := h.Auth.createSession(w, r, user.ID); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not create session")
		return
	}
	httpjson.Write(w, http.StatusCreated, user)
}

// Instance is a public aggregate of what the login page needs in one call.
func (h *PlatformHandler) Instance(w http.ResponseWriter, r *http.Request) {
	cfg := h.App.Cfg
	needed, err := h.App.SetupNeeded(r.Context())
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "database error")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"version": buildinfo.Version,
		"oidc": map[string]any{
			"enabled":       cfg.OIDCEnabled(),
			"provider_name": cfg.OIDCProviderName,
		},
		"registration_open":    h.App.RegistrationOpen(r.Context()),
		"google_drive_enabled": h.App.ResolveGoogleOAuth(r.Context()).Enabled,
		"setup_needed":         needed,
	})
}
