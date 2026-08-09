package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/auth"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type appPasswordRow struct {
	ID         uuid.UUID  `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
}

type createAppPasswordRequest struct {
	Name string `json:"name"`
}

type createAppPasswordResponse struct {
	ID         uuid.UUID  `json:"id"`
	Name       string     `json:"name"`
	Prefix     string     `json:"prefix"`
	Secret     string     `json:"secret"`
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
}

func generateAppPasswordSecret() (prefix, secret string, err error) {
	pre := make([]byte, 4)
	body := make([]byte, 20)
	if _, err = rand.Read(pre); err != nil {
		return "", "", err
	}
	if _, err = rand.Read(body); err != nil {
		return "", "", err
	}
	prefix = hex.EncodeToString(pre)
	secret = "ark_" + prefix + "_" + hex.EncodeToString(body)
	return prefix, secret, nil
}

func parseAppPasswordPrefix(password string) (prefix string, ok bool) {
	if !strings.HasPrefix(password, "ark_") {
		return "", false
	}
	rest := strings.TrimPrefix(password, "ark_")
	pre, _, found := strings.Cut(rest, "_")
	if !found || len(pre) != 8 {
		return "", false
	}
	for _, c := range pre {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return "", false
		}
	}
	return pre, true
}

func (h *AuthHandler) ListAppPasswords(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	rows, err := h.App.DB.Query(r.Context(), `
		SELECT id, name, prefix, created_at, last_used_at
		FROM app_passwords
		WHERE user_id = $1 AND revoked_at IS NULL
		ORDER BY created_at DESC
	`, user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []appPasswordRow{}
	for rows.Next() {
		var row appPasswordRow
		if err := rows.Scan(&row.ID, &row.Name, &row.Prefix, &row.CreatedAt, &row.LastUsedAt); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		out = append(out, row)
	}
	httpjson.Write(w, http.StatusOK, out)
}

func (h *AuthHandler) CreateAppPassword(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var req createAppPasswordRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		name = "WebDAV"
	}
	if len(name) > 80 {
		httpjson.Error(w, http.StatusBadRequest, "name too long")
		return
	}
	prefix, secret, err := generateAppPasswordSecret()
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not generate secret")
		return
	}
	hash, err := auth.HashPassword(secret)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not hash secret")
		return
	}
	var row createAppPasswordResponse
	err = h.App.DB.QueryRow(r.Context(), `
		INSERT INTO app_passwords (user_id, name, prefix, secret_hash)
		VALUES ($1, $2, $3, $4)
		RETURNING id, name, prefix, created_at, last_used_at
	`, user.ID, name, prefix, hash).Scan(&row.ID, &row.Name, &row.Prefix, &row.CreatedAt, &row.LastUsedAt)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not create app password")
		return
	}
	row.Secret = secret
	httpjson.Write(w, http.StatusCreated, row)
}

func (h *AuthHandler) RevokeAppPassword(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid id")
		return
	}
	tag, err := h.App.DB.Exec(r.Context(), `
		UPDATE app_passwords
		SET revoked_at = now()
		WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
	`, id, user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not revoke")
		return
	}
	if tag.RowsAffected() == 0 {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}
