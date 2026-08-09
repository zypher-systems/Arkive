package handlers

import (
	"net/http"
	"strings"

	"github.com/arkive/arkive/internal/crypto"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/google/uuid"
)

type connectWebDAVRequest struct {
	Type     string `json:"type"` // webdav | internxt
	Name     string `json:"name"`
	URL      string `json:"url"`
	Username string `json:"username"`
	Password string `json:"password"`
}

func (h *GDriveHandler) ConnectWebDAV(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var req connectWebDAVRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	typ := strings.TrimSpace(req.Type)
	if typ != "webdav" && typ != "internxt" {
		httpjson.Error(w, http.StatusBadRequest, "type must be webdav or internxt")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		if typ == "internxt" {
			name = "Internxt"
		} else {
			name = "Icedrive / WebDAV"
		}
	}
	if strings.TrimSpace(req.URL) == "" {
		httpjson.Error(w, http.StatusBadRequest, "url required")
		return
	}
	enc, err := crypto.EncryptWebDAVConfig(h.App.Cfg.SecretsKey, crypto.WebDAVConfig{
		URL: req.URL, Username: req.Username, Password: req.Password,
	})
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "encrypt failed")
		return
	}
	var backendID uuid.UUID
	err = h.App.DB.QueryRow(r.Context(), `
		SELECT id FROM storage_backends WHERE owner_user_id = $1 AND type = $2 LIMIT 1
	`, user.ID, typ).Scan(&backendID)
	if err == nil {
		_, err = h.App.DB.Exec(r.Context(), `
			UPDATE storage_backends SET name = $1, config = $2::jsonb WHERE id = $3
		`, name, enc, backendID)
		h.App.InvalidateStore(backendID)
	} else {
		err = h.App.DB.QueryRow(r.Context(), `
			INSERT INTO storage_backends (name, type, config, is_default, owner_user_id)
			VALUES ($1, $2, $3::jsonb, FALSE, $4)
			RETURNING id
		`, name, typ, enc, user.ID).Scan(&backendID)
	}
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "save failed")
		return
	}
	wsID, err := h.App.EnsureNamedMount(r.Context(), user.ID, backendID, name)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "mount failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"status": "ok", "connection_id": backendID, "workspace_id": wsID, "name": name, "type": typ,
	})
}
