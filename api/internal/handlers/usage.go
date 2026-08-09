package handlers

import (
	"net/http"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func (h *WorkspaceHandler) Usage(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	wsID, err := uuid.Parse(chi.URLParam(r, "workspaceID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid workspace id")
		return
	}
	if err := h.App.RequireWorkspaceAccess(r.Context(), wsID, user.ID, false); err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	info, err := h.App.WorkspaceQuotaInfo(r.Context(), wsID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"bytes":       info.UsedBytes,
		"files":       info.Files,
		"quota_bytes": info.QuotaBytes,
	})
}

type usageByWorkspace struct {
	ID         uuid.UUID `json:"id"`
	Name       string    `json:"name"`
	Type       string    `json:"type"`
	Bytes      int64     `json:"bytes"`
	Files      int64     `json:"files"`
	QuotaBytes *int64    `json:"quota_bytes,omitempty"`
}

func (h *WorkspaceHandler) StorageUsage(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	rows, err := h.App.DB.Query(r.Context(), `
		SELECT w.id, w.name, w.type,
		       COALESCE(SUM(n.size) FILTER (WHERE n.kind = 'file' AND n.deleted_at IS NULL), 0) AS bytes,
		       COUNT(n.id) FILTER (WHERE n.kind = 'file' AND n.deleted_at IS NULL) AS files
		FROM workspaces w
		JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1
		LEFT JOIN nodes n ON n.workspace_id = w.id
		GROUP BY w.id, w.name, w.type
		ORDER BY w.type ASC, w.name ASC
	`, user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	var totalBytes, totalFiles int64
	var totalQuota int64
	hasAnyQuota := false
	by := []usageByWorkspace{}
	for rows.Next() {
		var u usageByWorkspace
		if err := rows.Scan(&u.ID, &u.Name, &u.Type, &u.Bytes, &u.Files); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		q, _ := h.App.EffectiveWorkspaceQuota(r.Context(), u.ID)
		u.QuotaBytes = q
		if q != nil {
			hasAnyQuota = true
			totalQuota += *q
		}
		totalBytes += u.Bytes
		totalFiles += u.Files
		by = append(by, u)
	}
	out := map[string]any{
		"bytes":        totalBytes,
		"files":        totalFiles,
		"by_workspace": by,
	}
	if hasAnyQuota {
		out["quota_bytes"] = totalQuota
	}
	httpjson.Write(w, http.StatusOK, out)
}
