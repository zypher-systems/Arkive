package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/crypto"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/netutil"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type BackendHandler struct {
	App *app.App
}

type backendDTO struct {
	ID        uuid.UUID      `json:"id"`
	Name      string         `json:"name"`
	Type      string         `json:"type"`
	Config    map[string]any `json:"config"`
	IsDefault bool           `json:"is_default"`
	CreatedAt string         `json:"created_at"`
}

type backendRequest struct {
	Name      string          `json:"name"`
	Type      string          `json:"type"`
	Config    json.RawMessage `json:"config"`
	IsDefault bool            `json:"is_default"`
}

func (h *BackendHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.App.DB.Query(r.Context(), `
		SELECT id, name, type, config, is_default, created_at
		FROM storage_backends
		WHERE owner_user_id IS NULL
		ORDER BY is_default DESC, name ASC
	`)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []backendDTO{}
	for rows.Next() {
		var id uuid.UUID
		var name, typ string
		var raw []byte
		var isDefault bool
		var created time.Time
		if err := rows.Scan(&id, &name, &typ, &raw, &isDefault, &created); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		cfg, err := h.App.BackendPublicConfig(typ, raw)
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "config decode failed")
			return
		}
		out = append(out, backendDTO{
			ID: id, Name: name, Type: typ, Config: cfg, IsDefault: isDefault, CreatedAt: created.Format(time.RFC3339),
		})
	}
	httpjson.Write(w, http.StatusOK, out)
}

func (h *BackendHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req backendRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || (req.Type != "s3" && req.Type != "nfs" && req.Type != "webdav" && req.Type != "internxt") {
		httpjson.Error(w, http.StatusBadRequest, "name and type (s3|nfs|webdav|internxt) required")
		return
	}
	raw, err := h.normalizeConfig(req.Type, req.Config, nil)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := h.App.TestBackendConfig(r.Context(), req.Type, raw); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "connection test failed: "+err.Error())
		return
	}

	tx, err := h.App.DB.Begin(r.Context())
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(r.Context())

	if req.IsDefault {
		_, _ = tx.Exec(r.Context(), `UPDATE storage_backends SET is_default = FALSE`)
	}
	var id uuid.UUID
	var isDefault bool
	var created time.Time
	err = tx.QueryRow(r.Context(), `
		INSERT INTO storage_backends (name, type, config, is_default)
		VALUES ($1, $2, $3::jsonb, $4)
		RETURNING id, is_default, created_at
	`, name, req.Type, raw, req.IsDefault).Scan(&id, &isDefault, &created)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "create failed")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "commit failed")
		return
	}
	cfg, _ := h.App.BackendPublicConfig(req.Type, raw)
	httpjson.Write(w, http.StatusCreated, backendDTO{
		ID: id, Name: name, Type: req.Type, Config: cfg, IsDefault: isDefault, CreatedAt: created.Format(time.RFC3339),
	})
}

func (h *BackendHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "backendID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req backendRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	var typ string
	var existing []byte
	err = h.App.DB.QueryRow(r.Context(), `SELECT type, config FROM storage_backends WHERE id = $1`, id).Scan(&typ, &existing)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	if req.Type != "" && req.Type != typ {
		httpjson.Error(w, http.StatusBadRequest, "type cannot be changed")
		return
	}
	name := strings.TrimSpace(req.Name)
	raw := existing
	if len(req.Config) > 0 && string(req.Config) != "null" {
		raw, err = h.normalizeConfig(typ, req.Config, existing)
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := h.App.TestBackendConfig(r.Context(), typ, raw); err != nil {
			httpjson.Error(w, http.StatusBadRequest, "connection test failed: "+err.Error())
			return
		}
	}
	if name == "" {
		_ = h.App.DB.QueryRow(r.Context(), `SELECT name FROM storage_backends WHERE id = $1`, id).Scan(&name)
	}
	_, err = h.App.DB.Exec(r.Context(), `
		UPDATE storage_backends SET name = $1, config = $2::jsonb WHERE id = $3
	`, name, raw, id)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "update failed")
		return
	}
	h.App.InvalidateStore(id)
	cfg, _ := h.App.BackendPublicConfig(typ, raw)
	httpjson.Write(w, http.StatusOK, backendDTO{ID: id, Name: name, Type: typ, Config: cfg})
}

func (h *BackendHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "backendID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid id")
		return
	}
	var isDefault bool
	err = h.App.DB.QueryRow(r.Context(), `SELECT is_default FROM storage_backends WHERE id = $1`, id).Scan(&isDefault)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	if isDefault {
		httpjson.Error(w, http.StatusBadRequest, "cannot delete default backend")
		return
	}
	var inUse int
	_ = h.App.DB.QueryRow(r.Context(), `SELECT COUNT(*) FROM workspaces WHERE storage_backend_id = $1`, id).Scan(&inUse)
	if inUse > 0 {
		httpjson.Error(w, http.StatusBadRequest, "backend is assigned to workspaces")
		return
	}
	_, err = h.App.DB.Exec(r.Context(), `DELETE FROM storage_backends WHERE id = $1`, id)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "delete failed")
		return
	}
	h.App.InvalidateStore(id)
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *BackendHandler) SetDefault(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "backendID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid id")
		return
	}
	tx, err := h.App.DB.Begin(r.Context())
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), `UPDATE storage_backends SET is_default = FALSE`)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "update failed")
		return
	}
	tag, err := tx.Exec(r.Context(), `UPDATE storage_backends SET is_default = TRUE WHERE id = $1`, id)
	if err != nil || tag.RowsAffected() == 0 {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "commit failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *BackendHandler) Test(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "backendID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid id")
		return
	}
	typ, raw, err := h.App.LoadBackendRow(r.Context(), id)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	if err := h.App.TestBackendConfig(r.Context(), typ, raw); err != nil {
		httpjson.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}

type assignBackendRequest struct {
	StorageBackendID uuid.UUID `json:"storage_backend_id"`
	Migrate          *bool     `json:"migrate"`
}

func (h *BackendHandler) AssignWorkspace(w http.ResponseWriter, r *http.Request) {
	wsID, err := uuid.Parse(chi.URLParam(r, "workspaceID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid workspace id")
		return
	}
	var req assignBackendRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	var exists bool
	err = h.App.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM storage_backends WHERE id = $1)`, req.StorageBackendID).Scan(&exists)
	if err != nil || !exists {
		httpjson.Error(w, http.StatusBadRequest, "backend not found")
		return
	}
	var wsExists bool
	_ = h.App.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = $1)`, wsID).Scan(&wsExists)
	if !wsExists {
		httpjson.Error(w, http.StatusNotFound, "workspace not found")
		return
	}
	migrate := false
	if req.Migrate != nil {
		migrate = *req.Migrate
	}
	writeAssignResult(w, r, h.App, wsID, req.StorageBackendID, migrate)
}

func (h *BackendHandler) normalizeConfig(typ string, incoming json.RawMessage, existing []byte) ([]byte, error) {
	switch typ {
	case "s3":
		var cfg crypto.S3Config
		if err := json.Unmarshal(incoming, &cfg); err != nil {
			return nil, err
		}
		if existing != nil {
			old, err := crypto.DecryptS3Config(h.App.Cfg.SecretsKey, existing)
			if err == nil {
				if cfg.AccessKey == "" || strings.HasPrefix(cfg.AccessKey, "••") {
					cfg.AccessKey = old.AccessKey
				}
				if cfg.SecretKey == "" || strings.HasPrefix(cfg.SecretKey, "••") {
					cfg.SecretKey = old.SecretKey
				}
				if cfg.Endpoint == "" {
					cfg.Endpoint = old.Endpoint
				}
				if cfg.Bucket == "" {
					cfg.Bucket = old.Bucket
				}
				if cfg.Region == "" {
					cfg.Region = old.Region
				}
			}
		}
		if cfg.Endpoint == "" || cfg.AccessKey == "" || cfg.SecretKey == "" || cfg.Bucket == "" {
			return nil, errString("s3 endpoint, access_key, secret_key, and bucket required")
		}
		if cfg.Region == "" {
			cfg.Region = "us-east-1"
		}
		return h.App.EncryptAndMarshalS3(cfg)
	case "nfs":
		var cfg crypto.NFSConfig
		if err := json.Unmarshal(incoming, &cfg); err != nil {
			return nil, err
		}
		if strings.TrimSpace(cfg.MountPath) == "" {
			return nil, errString("mount_path required")
		}
		return json.Marshal(cfg)
	case "webdav", "internxt":
		var cfg crypto.WebDAVConfig
		if err := json.Unmarshal(incoming, &cfg); err != nil {
			return nil, err
		}
		if existing != nil {
			if old, err := crypto.DecryptWebDAVConfig(h.App.Cfg.SecretsKey, existing); err == nil {
				if cfg.Password == "" || strings.HasPrefix(cfg.Password, "••") {
					cfg.Password = old.Password
				}
				if cfg.URL == "" {
					cfg.URL = old.URL
				}
				if cfg.Username == "" {
					cfg.Username = old.Username
				}
			}
		}
		if strings.TrimSpace(cfg.URL) == "" {
			return nil, errString("webdav url required")
		}
		if err := netutil.ValidateOutboundHTTPSURL(cfg.URL); err != nil {
			return nil, errString(err.Error())
		}
		return crypto.EncryptWebDAVConfig(h.App.Cfg.SecretsKey, cfg)
	default:
		return nil, errString("unsupported type")
	}
}

type errString string

func (e errString) Error() string { return string(e) }
