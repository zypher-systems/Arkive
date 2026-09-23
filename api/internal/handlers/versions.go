package handlers

import (
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type VersionsHandler struct {
	App *app.App
}

type versionDTO struct {
	Version   int     `json:"version"`
	Size      int64   `json:"size"`
	Mime      *string `json:"mime,omitempty"`
	CreatedAt string  `json:"created_at"`
	CreatedBy *string `json:"created_by,omitempty"`
}

func (h *VersionsHandler) List(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	nodeID, err := uuid.Parse(chi.URLParam(r, "nodeID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid node id")
		return
	}
	if _, err := h.App.RequireNodeAccess(r.Context(), nodeID, user.ID, false); err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	rows, err := h.App.DB.Query(r.Context(), `
		SELECT v.version, v.size, v.mime, v.created_at, u.display_name
		FROM node_versions v
		LEFT JOIN users u ON u.id = v.created_by
		WHERE v.node_id = $1
		ORDER BY v.version DESC
	`, nodeID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []versionDTO{}
	for rows.Next() {
		var v versionDTO
		var created time.Time
		var name *string
		if err := rows.Scan(&v.Version, &v.Size, &v.Mime, &created, &name); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		v.CreatedAt = created.Format(time.RFC3339)
		v.CreatedBy = name
		out = append(out, v)
	}
	httpjson.Write(w, http.StatusOK, out)
}

func (h *VersionsHandler) Restore(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	nodeID, err := uuid.Parse(chi.URLParam(r, "nodeID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid node id")
		return
	}
	ver, err := strconv.Atoi(chi.URLParam(r, "version"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid version")
		return
	}
	wsID, err := h.App.RequireNodeAccess(r.Context(), nodeID, user.ID, true)
	if err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	store, err := h.App.StoreForWorkspace(r.Context(), wsID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "storage unavailable")
		return
	}
	if err := h.App.RestoreVersion(r.Context(), nodeID, ver, user.ID, store); err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *VersionsHandler) Download(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	nodeID, err := uuid.Parse(chi.URLParam(r, "nodeID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid node id")
		return
	}
	ver, err := strconv.Atoi(chi.URLParam(r, "version"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid version")
		return
	}
	wsID, err := h.App.RequireNodeAccess(r.Context(), nodeID, user.ID, false)
	if err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	var key, name string
	var mime *string
	err = h.App.DB.QueryRow(r.Context(), `
		SELECT v.storage_key, n.name, v.mime
		FROM node_versions v
		JOIN nodes n ON n.id = v.node_id
		WHERE v.node_id = $1 AND v.version = $2
	`, nodeID, ver).Scan(&key, &name, &mime)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	store, err := h.App.StoreForWorkspace(r.Context(), wsID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "storage unavailable")
		return
	}
	rc, meta, err := store.Get(r.Context(), key)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "storage error")
		return
	}
	defer rc.Close()
	ct := "application/octet-stream"
	if mime != nil && *mime != "" {
		ct = *mime
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(versionFileName(name, ver), `"`, ``)+`"`)
	if meta.Size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(meta.Size, 10))
	}
	_, _ = io.Copy(w, rc)
}

// versionFileName names a downloaded old version "report.v3.pdf": the
// version goes before the extension so the file still opens by type.
func versionFileName(name string, ver int) string {
	ext := path.Ext(name)
	base := strings.TrimSuffix(name, ext)
	if base == "" {
		base, ext = name, ""
	}
	return base + ".v" + strconv.Itoa(ver) + ext
}
