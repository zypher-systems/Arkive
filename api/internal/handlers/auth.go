package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/auth"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/models"
	"github.com/google/uuid"
)

type AuthHandler struct {
	App *app.App
}

type authRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req authRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	display := strings.TrimSpace(req.DisplayName)
	if email == "" || len(req.Password) < 8 || display == "" {
		httpjson.Error(w, http.StatusBadRequest, "email, display_name, and password (min 8) required")
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not hash password")
		return
	}

	isAdmin := h.App.Cfg.BootstrapAdminEmail != "" && email == h.App.Cfg.BootstrapAdminEmail
	status := "pending"
	if isAdmin {
		status = "active"
	}
	backendID, err := h.App.DefaultBackendID(r.Context())
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "no storage backend configured")
		return
	}

	tx, err := h.App.DB.Begin(r.Context())
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(r.Context())

	var user models.User
	err = tx.QueryRow(r.Context(), `
		INSERT INTO users (email, password_hash, display_name, is_instance_admin, status)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, email, display_name, is_instance_admin, status, created_at
	`, email, hash, display, isAdmin, status).Scan(
		&user.ID, &user.Email, &user.DisplayName, &user.IsInstanceAdmin, &user.Status, &user.CreatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "unique") {
			httpjson.Error(w, http.StatusConflict, "email already registered")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "could not create user")
		return
	}

	wsID := uuid.New()
	_, err = tx.Exec(r.Context(), `
		INSERT INTO workspaces (id, type, name, storage_backend_id)
		VALUES ($1, 'personal', $2, $3)
	`, wsID, display+"'s Files", backendID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not create workspace")
		return
	}
	_, err = tx.Exec(r.Context(), `
		INSERT INTO workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, 'owner')
	`, wsID, user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not assign workspace")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not complete registration")
		return
	}

	if user.Status != "active" {
		httpjson.Write(w, http.StatusCreated, map[string]any{
			"status":  "pending",
			"message": "Account pending admin approval",
			"user":    user,
		})
		return
	}

	if err := h.createSession(w, r, user.ID); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not create session")
		return
	}
	httpjson.Write(w, http.StatusCreated, user)
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req authRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))

	var user models.User
	var hash *string
	err := h.App.DB.QueryRow(r.Context(), `
		SELECT id, email, display_name, is_instance_admin, status, created_at, password_hash
		FROM users WHERE email = $1
	`, email).Scan(
		&user.ID, &user.Email, &user.DisplayName, &user.IsInstanceAdmin, &user.Status, &user.CreatedAt, &hash,
	)
	if err != nil || hash == nil || !auth.CheckPassword(req.Password, *hash) {
		httpjson.Error(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	// Promote bootstrap admin if needed
	if h.App.Cfg.BootstrapAdminEmail != "" && email == h.App.Cfg.BootstrapAdminEmail {
		if !user.IsInstanceAdmin || user.Status != "active" {
			_, _ = h.App.DB.Exec(r.Context(), `
				UPDATE users SET is_instance_admin = TRUE, status = 'active' WHERE id = $1
			`, user.ID)
			user.IsInstanceAdmin = true
			user.Status = "active"
		}
	}

	if user.Status == "pending" {
		httpjson.Error(w, http.StatusForbidden, "pending approval")
		return
	}
	if user.Status != "active" {
		httpjson.Error(w, http.StatusForbidden, "account rejected")
		return
	}

	if err := h.createSession(w, r, user.ID); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not create session")
		return
	}
	httpjson.Write(w, http.StatusOK, user)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie("arkive_session"); err == nil && c.Value != "" {
		_, _ = h.App.DB.Exec(r.Context(), `DELETE FROM sessions WHERE token_hash = $1`, auth.HashToken(c.Value))
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "arkive_session",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   h.App.Cfg.CookieSecure,
	})
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	httpjson.Write(w, http.StatusOK, user)
}

type updateProfileRequest struct {
	DisplayName string `json:"display_name"`
	Password    string `json:"password"`
}

func (h *AuthHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var req updateProfileRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	display := strings.TrimSpace(req.DisplayName)
	if display == "" {
		httpjson.Error(w, http.StatusBadRequest, "display_name required")
		return
	}
	if req.Password != "" {
		if len(req.Password) < 8 {
			httpjson.Error(w, http.StatusBadRequest, "password must be at least 8 characters")
			return
		}
		hash, err := auth.HashPassword(req.Password)
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "could not hash password")
			return
		}
		_, err = h.App.DB.Exec(r.Context(), `
			UPDATE users SET display_name = $1, password_hash = $2 WHERE id = $3
		`, display, hash, user.ID)
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "update failed")
			return
		}
	} else {
		_, err := h.App.DB.Exec(r.Context(), `UPDATE users SET display_name = $1 WHERE id = $2`, display, user.ID)
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "update failed")
			return
		}
	}
	user.DisplayName = display
	httpjson.Write(w, http.StatusOK, user)
}

func (h *AuthHandler) SessionLookup() middleware.SessionLookup {
	return func(r *http.Request, token string) (*models.User, error) {
		var user models.User
		err := h.App.DB.QueryRow(r.Context(), `
			SELECT u.id, u.email, u.display_name, u.is_instance_admin, u.status, u.created_at
			FROM sessions s
			JOIN users u ON u.id = s.user_id
			WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'
		`, auth.HashToken(token)).Scan(
			&user.ID, &user.Email, &user.DisplayName, &user.IsInstanceAdmin, &user.Status, &user.CreatedAt,
		)
		if err != nil {
			return nil, err
		}
		return &user, nil
	}
}

func (h *AuthHandler) createSession(w http.ResponseWriter, r *http.Request, userID uuid.UUID) error {
	plain, hash, err := auth.NewSessionToken()
	if err != nil {
		return err
	}
	expires := time.Now().Add(30 * 24 * time.Hour)
	_, err = h.App.DB.Exec(r.Context(), `
		INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)
	`, userID, hash, expires)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "arkive_session",
		Value:    plain,
		Path:     "/",
		Expires:  expires,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   h.App.Cfg.CookieSecure,
	})
	return nil
}

func randomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
