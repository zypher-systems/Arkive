package handlers

import (
	"net/http"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/httpjson"
)

type versionSettings struct {
	MaxVersions *int `json:"max_versions"`
}

// GetVersionRetention: GET /api/admin/settings/versions → {"max_versions": n}
func (h *SettingsHandler) GetVersionRetention(w http.ResponseWriter, r *http.Request) {
	httpjson.Write(w, http.StatusOK, map[string]int{"max_versions": h.App.MaxVersionsPerFile(r.Context())})
}

// PutVersionRetention: PUT /api/admin/settings/versions {"max_versions": n}
// (0 keeps no old versions, max 100). Lowering it prunes lazily.
func (h *SettingsHandler) PutVersionRetention(w http.ResponseWriter, r *http.Request) {
	var req versionSettings
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.MaxVersions == nil || *req.MaxVersions < 0 || *req.MaxVersions > app.MaxVersionsLimit {
		httpjson.Error(w, http.StatusBadRequest, "max_versions must be between 0 and 100")
		return
	}
	if err := h.App.SetMaxVersionsPerFile(r.Context(), *req.MaxVersions); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not save settings")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]int{"max_versions": h.App.MaxVersionsPerFile(r.Context())})
}
