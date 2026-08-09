package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/arkive/arkive/internal/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type quotaPatch struct {
	QuotaBytes *int64 `json:"quota_bytes"` // null clears
}

func (h *AdminUsersHandler) PatchQuota(w http.ResponseWriter, r *http.Request) {
	userID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var req quotaPatch
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	_, err = h.App.DB.Exec(r.Context(), `UPDATE users SET quota_bytes = $1 WHERE id = $2`, req.QuotaBytes, userID)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "user not found")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]any{"status": "ok", "quota_bytes": req.QuotaBytes})
}

func (h *BackendHandler) PatchWorkspaceQuota(w http.ResponseWriter, r *http.Request) {
	wsID, err := uuid.Parse(chi.URLParam(r, "workspaceID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid workspace id")
		return
	}
	var req quotaPatch
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	_, err = h.App.DB.Exec(r.Context(), `UPDATE workspaces SET quota_bytes = $1 WHERE id = $2`, req.QuotaBytes, wsID)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "workspace not found")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]any{"status": "ok", "quota_bytes": req.QuotaBytes})
}

func (h *SettingsHandler) GetQuotaDefaults(w http.ResponseWriter, r *http.Request) {
	raw, _ := h.App.GetSettingPublic(r.Context(), "default_workspace_quota_bytes")
	var q *int64
	if strings.TrimSpace(raw) != "" {
		if n, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64); err == nil && n > 0 {
			q = &n
		}
	}
	httpjson.Write(w, http.StatusOK, map[string]any{"default_workspace_quota_bytes": q})
}

func (h *SettingsHandler) PutQuotaDefaults(w http.ResponseWriter, r *http.Request) {
	var body struct {
		DefaultWorkspaceQuotaBytes *int64 `json:"default_workspace_quota_bytes"`
	}
	if err := httpjson.Decode(r, &body); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	val := ""
	if body.DefaultWorkspaceQuotaBytes != nil && *body.DefaultWorkspaceQuotaBytes > 0 {
		val = strconv.FormatInt(*body.DefaultWorkspaceQuotaBytes, 10)
	}
	if err := h.App.PutSetting(r.Context(), "default_workspace_quota_bytes", val); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "save failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"status":                         "ok",
		"default_workspace_quota_bytes": body.DefaultWorkspaceQuotaBytes,
	})
}

func (h *SettingsHandler) ReindexSearch(w http.ResponseWriter, r *http.Request) {
	n, err := h.App.ReindexMissing(r.Context(), 500)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]any{"status": "ok", "indexed": n})
}
