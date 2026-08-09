package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type ActivityHandler struct {
	App *app.App
}

type activityDTO struct {
	ID        uuid.UUID      `json:"id"`
	Action    string         `json:"action"`
	Actor     *string        `json:"actor,omitempty"`
	Detail    map[string]any `json:"detail"`
	CreatedAt time.Time      `json:"created_at"`
}

func (h *ActivityHandler) ListForNode(w http.ResponseWriter, r *http.Request) {
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
		SELECT e.id, e.action, e.detail, e.created_at, u.display_name
		FROM activity_events e
		LEFT JOIN users u ON u.id = e.actor_user_id
		WHERE e.node_id = $1
		ORDER BY e.created_at DESC
		LIMIT 100
	`, nodeID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []activityDTO{}
	for rows.Next() {
		var a activityDTO
		var raw []byte
		var actor *string
		if err := rows.Scan(&a.ID, &a.Action, &raw, &a.CreatedAt, &actor); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		_ = json.Unmarshal(raw, &a.Detail)
		if a.Detail == nil {
			a.Detail = map[string]any{}
		}
		a.Actor = actor
		out = append(out, a)
	}
	httpjson.Write(w, http.StatusOK, out)
}

type recentDTO struct {
	ID          uuid.UUID `json:"id"`
	Action      string    `json:"action"`
	NodeID      *uuid.UUID `json:"node_id,omitempty"`
	NodeName    *string   `json:"node_name,omitempty"`
	WorkspaceID *uuid.UUID `json:"workspace_id,omitempty"`
	ParentID    *uuid.UUID `json:"parent_id,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

func (h *ActivityHandler) Recent(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	rows, err := h.App.DB.Query(r.Context(), `
		SELECT e.id, e.action, e.node_id, n.name, COALESCE(e.workspace_id, n.workspace_id), n.parent_id, e.created_at
		FROM activity_events e
		LEFT JOIN nodes n ON n.id = e.node_id AND n.deleted_at IS NULL
		WHERE e.actor_user_id = $1
		   OR e.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = $1)
		   OR e.node_id IN (
		     SELECT s.node_id FROM shares s
		     WHERE s.grantee_user_id = $1
		        OR s.grantee_workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = $1)
		   )
		ORDER BY e.created_at DESC
		LIMIT 40
	`, user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []recentDTO{}
	for rows.Next() {
		var a recentDTO
		if err := rows.Scan(&a.ID, &a.Action, &a.NodeID, &a.NodeName, &a.WorkspaceID, &a.ParentID, &a.CreatedAt); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		out = append(out, a)
	}
	httpjson.Write(w, http.StatusOK, out)
}
