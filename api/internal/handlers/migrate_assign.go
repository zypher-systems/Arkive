package handlers

import (
	"errors"
	"net/http"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/google/uuid"
)

func writeAssignResult(w http.ResponseWriter, r *http.Request, a *app.App, wsID, backendID uuid.UUID, migrate bool) {
	if !migrate {
		_, err := a.DB.Exec(r.Context(), `
			UPDATE workspaces SET storage_backend_id = $1 WHERE id = $2
		`, backendID, wsID)
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "update failed")
			return
		}
		httpjson.Write(w, http.StatusOK, map[string]any{
			"status":             "ok",
			"storage_backend_id": backendID,
			"migrated":           false,
			"copied":             0,
			"total":              0,
		})
		return
	}

	result, err := a.MigrateWorkspaceStorage(r.Context(), wsID, backendID)
	if err != nil {
		var me *app.MigrateError
		if errors.As(err, &me) {
			httpjson.Write(w, http.StatusInternalServerError, map[string]any{
				"error":      me.Message,
				"copied":     me.Copied,
				"total":      me.Total,
				"failed_key": me.FailedKey,
			})
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"status":             "ok",
		"storage_backend_id": result.Backend,
		"migrated":           result.Migrated,
		"copied":             result.Copied,
		"total":              result.Total,
	})
}
