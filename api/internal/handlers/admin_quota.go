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
	h.App.Audit(r.Context(), r, actorID(r), "settings.updated", "setting", "quota", map[string]any{
		"default_workspace_quota_bytes": body.DefaultWorkspaceQuotaBytes,
	})
	httpjson.Write(w, http.StatusOK, map[string]any{
		"status":                        "ok",
		"default_workspace_quota_bytes": body.DefaultWorkspaceQuotaBytes,
	})
}

func (h *SettingsHandler) GetTrashRetention(w http.ResponseWriter, r *http.Request) {
	httpjson.Write(w, http.StatusOK, map[string]any{
		"trash_retention_days": h.App.TrashRetentionDays(r.Context()),
	})
}

func (h *SettingsHandler) PutTrashRetention(w http.ResponseWriter, r *http.Request) {
	var body struct {
		TrashRetentionDays *int `json:"trash_retention_days"`
	}
	if err := httpjson.Decode(r, &body); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	days := 30
	if body.TrashRetentionDays != nil {
		days = *body.TrashRetentionDays
	}
	if days < 0 {
		httpjson.Error(w, http.StatusBadRequest, "trash_retention_days must be >= 0")
		return
	}
	if err := h.App.PutSetting(r.Context(), "trash_retention_days", strconv.Itoa(days)); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "save failed")
		return
	}
	h.App.Audit(r.Context(), r, actorID(r), "settings.updated", "setting", "trash", map[string]any{
		"trash_retention_days": days,
	})
	httpjson.Write(w, http.StatusOK, map[string]any{
		"status":               "ok",
		"trash_retention_days": days,
	})
}

func (h *SettingsHandler) ReindexSearch(w http.ResponseWriter, r *http.Request) {
	n, err := h.App.ReindexMissing(r.Context(), 2000)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	remaining, _ := h.App.CountUnindexed(r.Context())
	httpjson.Write(w, http.StatusOK, map[string]any{"status": "ok", "indexed": n, "remaining": remaining})
}

func (h *SettingsHandler) GetRegistration(w http.ResponseWriter, r *http.Request) {
	httpjson.Write(w, http.StatusOK, map[string]any{
		"registration_open": h.App.RegistrationOpen(r.Context()),
	})
}

func (h *SettingsHandler) PutRegistration(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RegistrationOpen *bool `json:"registration_open"`
	}
	if err := httpjson.Decode(r, &body); err != nil || body.RegistrationOpen == nil {
		httpjson.Error(w, http.StatusBadRequest, "registration_open required")
		return
	}
	val := "true"
	if !*body.RegistrationOpen {
		val = "false"
	}
	if err := h.App.PutSetting(r.Context(), "registration_open", val); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "save failed")
		return
	}
	h.App.Audit(r.Context(), r, actorID(r), "settings.updated", "setting", "registration", map[string]any{
		"registration_open": *body.RegistrationOpen,
	})
	httpjson.Write(w, http.StatusOK, map[string]any{
		"status":            "ok",
		"registration_open": *body.RegistrationOpen,
	})
}
