package handlers

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/crypto"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/storage"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"golang.org/x/oauth2"
)

type GDriveHandler struct {
	App *app.App
}

func (h *GDriveHandler) Enabled(w http.ResponseWriter, r *http.Request) {
	oauth := h.App.ResolveGoogleOAuth(r.Context())
	httpjson.Write(w, http.StatusOK, map[string]any{
		"enabled": oauth.Enabled,
	})
}

func (h *GDriveHandler) oauthConfig(r *http.Request) (*oauth2.Config, app.GoogleOAuth, bool) {
	oauth := h.App.ResolveGoogleOAuth(r.Context())
	if !oauth.Enabled {
		return nil, oauth, false
	}
	return storage.GoogleOAuthConfig(oauth.ClientID, oauth.ClientSecret, oauth.RedirectURL), oauth, true
}

func (h *GDriveHandler) Start(w http.ResponseWriter, r *http.Request) {
	cfg, _, ok := h.oauthConfig(r)
	if !ok {
		httpjson.Error(w, http.StatusBadRequest, "google drive not configured")
		return
	}
	user := middleware.UserFromContext(r.Context())
	state := randomOIDCState()
	payload, _ := json.Marshal(map[string]string{
		"state": state,
		"uid":   user.ID.String(),
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "arkive_gdrive_oauth",
		Value:    base64.RawURLEncoding.EncodeToString(payload),
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   h.App.Cfg.CookieSecure,
	})
	url := cfg.AuthCodeURL(state, oauth2.AccessTypeOffline, oauth2.ApprovalForce)
	http.Redirect(w, r, url, http.StatusFound)
}

func (h *GDriveHandler) Callback(w http.ResponseWriter, r *http.Request) {
	oauthCfg, googleOAuth, ok := h.oauthConfig(r)
	if !ok {
		http.Redirect(w, r, "/account?error=gdrive_config", http.StatusFound)
		return
	}
	c, err := r.Cookie("arkive_gdrive_oauth")
	if err != nil || c.Value == "" {
		http.Redirect(w, r, "/account?error=gdrive_state", http.StatusFound)
		return
	}
	raw, err := base64.RawURLEncoding.DecodeString(c.Value)
	if err != nil {
		http.Redirect(w, r, "/account?error=gdrive_state", http.StatusFound)
		return
	}
	var payload struct {
		State string `json:"state"`
		UID   string `json:"uid"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil || payload.State == "" || payload.State != r.URL.Query().Get("state") {
		http.Redirect(w, r, "/account?error=gdrive_state", http.StatusFound)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "arkive_gdrive_oauth",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   h.App.Cfg.CookieSecure,
	})

	userID, err := uuid.Parse(payload.UID)
	if err != nil {
		http.Redirect(w, r, "/account?error=gdrive_user", http.StatusFound)
		return
	}

	tok, err := oauthCfg.Exchange(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		http.Redirect(w, r, "/account?error=gdrive_exchange", http.StatusFound)
		return
	}
	client := oauthCfg.Client(r.Context(), tok)
	email, err := storage.FetchGoogleEmail(r.Context(), client)
	if err != nil || email == "" {
		http.Redirect(w, r, "/account?error=gdrive_email", http.StatusFound)
		return
	}

	store, err := storage.NewGDriveStore(r.Context(), storage.GDriveOptions{
		ClientID:     googleOAuth.ClientID,
		ClientSecret: googleOAuth.ClientSecret,
		Config: storage.GDriveConfig{
			RefreshToken: tok.RefreshToken,
			AccessToken:  tok.AccessToken,
			TokenExpiry:  tok.Expiry,
			AccountEmail: email,
		},
	})
	if err != nil {
		http.Redirect(w, r, "/account?error=gdrive_store", http.StatusFound)
		return
	}

	cfg := crypto.GDriveConfig{
		RefreshToken: tok.RefreshToken,
		AccessToken:  tok.AccessToken,
		TokenExpiry:  tok.Expiry.UTC().Format(time.RFC3339),
		RootFolderID: store.RootFolderID(),
		AccountEmail: email,
	}
	// Preserve refresh token if Google omits it on re-consent.
	if cfg.RefreshToken == "" {
		var existing []byte
		_ = h.App.DB.QueryRow(r.Context(), `
			SELECT config FROM storage_backends
			WHERE owner_user_id = $1 AND type = 'gdrive' LIMIT 1
		`, userID).Scan(&existing)
		if len(existing) > 0 {
			if old, err := crypto.DecryptGDriveConfig(h.App.Cfg.SecretsKey, existing); err == nil {
				cfg.RefreshToken = old.RefreshToken
			}
		}
	}
	if cfg.RefreshToken == "" {
		http.Redirect(w, r, "/account?error=gdrive_refresh", http.StatusFound)
		return
	}

	enc, err := crypto.EncryptGDriveConfig(h.App.Cfg.SecretsKey, cfg)
	if err != nil {
		http.Redirect(w, r, "/account?error=gdrive_save", http.StatusFound)
		return
	}

	var backendID uuid.UUID
	err = h.App.DB.QueryRow(r.Context(), `
		SELECT id FROM storage_backends WHERE owner_user_id = $1 AND type = 'gdrive' LIMIT 1
	`, userID).Scan(&backendID)
	if err == nil {
		_, err = h.App.DB.Exec(r.Context(), `
			UPDATE storage_backends SET name = $1, config = $2::jsonb, is_default = FALSE WHERE id = $3
		`, "Google Drive ("+email+")", enc, backendID)
		h.App.InvalidateStore(backendID)
	} else {
		err = h.App.DB.QueryRow(r.Context(), `
			INSERT INTO storage_backends (name, type, config, is_default, owner_user_id)
			VALUES ($1, 'gdrive', $2::jsonb, FALSE, $3)
			RETURNING id
		`, "Google Drive ("+email+")", enc, userID).Scan(&backendID)
	}
	if err != nil {
		http.Redirect(w, r, "/account?error=gdrive_save", http.StatusFound)
		return
	}
	if _, err := h.App.EnsureDriveMount(r.Context(), userID, backendID); err != nil {
		http.Redirect(w, r, "/account?error=gdrive_mount", http.StatusFound)
		return
	}
	http.Redirect(w, r, "/account?gdrive=connected", http.StatusFound)
}

type connectionDTO struct {
	ID           uuid.UUID  `json:"id"`
	Type         string     `json:"type"`
	Name         string     `json:"name"`
	AccountEmail string     `json:"account_email"`
	WorkspaceID  *uuid.UUID `json:"workspace_id,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

func (h *GDriveHandler) ListConnections(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if err := h.App.EnsureDriveMountsForUser(r.Context(), user.ID); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not ensure drive mounts")
		return
	}
	rows, err := h.App.DB.Query(r.Context(), `
		SELECT id, type, name, config, created_at
		FROM storage_backends
		WHERE owner_user_id = $1
		ORDER BY created_at ASC
	`, user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []connectionDTO{}
	for rows.Next() {
		var id uuid.UUID
		var typ, name string
		var raw []byte
		var created time.Time
		if err := rows.Scan(&id, &typ, &name, &raw, &created); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		email := ""
		var mountID *uuid.UUID
		if typ == "gdrive" {
			if cfg, err := crypto.DecryptGDriveConfig(h.App.Cfg.SecretsKey, raw); err == nil {
				email = cfg.AccountEmail
			}
			if mid, err := h.App.EnsureDriveMount(r.Context(), user.ID, id); err == nil {
				mountID = &mid
			}
		}
		out = append(out, connectionDTO{
			ID: id, Type: typ, Name: name, AccountEmail: email, WorkspaceID: mountID, CreatedAt: created,
		})
	}
	httpjson.Write(w, http.StatusOK, out)
}

func (h *GDriveHandler) DeleteConnection(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "connectionID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid id")
		return
	}
	var owner *uuid.UUID
	err = h.App.DB.QueryRow(r.Context(), `
		SELECT owner_user_id FROM storage_backends WHERE id = $1
	`, id).Scan(&owner)
	if err != nil || owner == nil || *owner != user.ID {
		httpjson.Error(w, http.StatusNotFound, "connection not found")
		return
	}
	var inUse int
	_ = h.App.DB.QueryRow(r.Context(), `SELECT COUNT(*) FROM workspaces WHERE storage_backend_id = $1`, id).Scan(&inUse)
	if inUse > 0 {
		def, err := h.App.DefaultBackendID(r.Context())
		if err != nil {
			httpjson.Error(w, http.StatusConflict, "connection in use; set workspaces to default storage first")
			return
		}
		_, _ = h.App.DB.Exec(r.Context(), `
			UPDATE workspaces SET storage_backend_id = $1 WHERE storage_backend_id = $2
		`, def, id)
	}
	_, err = h.App.DB.Exec(r.Context(), `DELETE FROM storage_backends WHERE id = $1`, id)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "delete failed")
		return
	}
	h.App.InvalidateStore(id)
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}

type assignStorageRequest struct {
	StorageBackendID *uuid.UUID `json:"storage_backend_id"`
	UseDefault       bool       `json:"use_default"`
	Migrate          *bool      `json:"migrate"`
}

func (h *GDriveHandler) AssignWorkspaceStorage(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	wsID, err := uuid.Parse(chi.URLParam(r, "workspaceID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid workspace id")
		return
	}
	var role string
	err = h.App.DB.QueryRow(r.Context(), `
		SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2
	`, wsID, user.ID).Scan(&role)
	if err != nil || role != "owner" {
		httpjson.Error(w, http.StatusForbidden, "owner required")
		return
	}

	var req assignStorageRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	migrate := false
	if req.Migrate != nil {
		migrate = *req.Migrate
	}

	var backendID uuid.UUID
	if req.UseDefault || req.StorageBackendID == nil {
		backendID, err = h.App.DefaultBackendID(r.Context())
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "no default backend")
			return
		}
	} else {
		backendID = *req.StorageBackendID
		var owner *uuid.UUID
		var typ string
		err = h.App.DB.QueryRow(r.Context(), `
			SELECT owner_user_id, type FROM storage_backends WHERE id = $1
		`, backendID).Scan(&owner, &typ)
		if err != nil {
			httpjson.Error(w, http.StatusNotFound, "backend not found")
			return
		}
		if typ == "gdrive" {
			if owner == nil || *owner != user.ID {
				httpjson.Error(w, http.StatusForbidden, "not your connection")
				return
			}
		} else if owner != nil {
			httpjson.Error(w, http.StatusForbidden, "not allowed")
			return
		}
	}

	writeAssignResult(w, r, h.App, wsID, backendID, migrate)
}
