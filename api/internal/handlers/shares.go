package handlers

import (
	"context"
	"net/http"
	"strings"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/models"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type ShareHandler struct {
	App *app.App
}

type createShareRequest struct {
	GranteeEmail       string     `json:"grantee_email"`
	GranteeUserID      *uuid.UUID `json:"grantee_user_id"`
	GranteeWorkspaceID *uuid.UUID `json:"grantee_workspace_id"`
	Permission         string     `json:"permission"`
}

func (h *ShareHandler) List(w http.ResponseWriter, r *http.Request) {
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
		SELECT s.id, s.node_id, s.grantee_user_id, s.grantee_workspace_id, s.permission, s.created_by, s.created_at,
		       u.email, COALESCE(u.display_name, w.name)
		FROM shares s
		LEFT JOIN users u ON u.id = s.grantee_user_id
		LEFT JOIN workspaces w ON w.id = s.grantee_workspace_id
		WHERE s.node_id = $1
		ORDER BY s.created_at ASC
	`, nodeID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	out := []models.Share{}
	for rows.Next() {
		var s models.Share
		var email, name *string
		if err := rows.Scan(
			&s.ID, &s.NodeID, &s.GranteeUserID, &s.GranteeWorkspaceID, &s.Permission, &s.CreatedBy, &s.CreatedAt,
			&email, &name,
		); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		s.GranteeEmail = email
		s.GranteeName = name
		out = append(out, s)
	}
	httpjson.Write(w, http.StatusOK, out)
}

func (h *ShareHandler) Create(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	nodeID, err := uuid.Parse(chi.URLParam(r, "nodeID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid node id")
		return
	}
	if _, err := h.App.RequireNodeAccess(r.Context(), nodeID, user.ID, true); err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}

	var req createShareRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Permission != "read" && req.Permission != "write" {
		httpjson.Error(w, http.StatusBadRequest, "permission must be read or write")
		return
	}

	var granteeUserID *uuid.UUID
	var granteeWorkspaceID *uuid.UUID

	if req.GranteeWorkspaceID != nil {
		// Sharer must belong to the target workspace. Otherwise any writer could
		// attach a node to an arbitrary team and grant every member access.
		if err := h.App.RequireWorkspaceAccess(r.Context(), *req.GranteeWorkspaceID, user.ID, false); err != nil {
			status, msg := app.WriteHTTPError(err)
			httpjson.Error(w, status, msg)
			return
		}
		granteeWorkspaceID = req.GranteeWorkspaceID
	} else if req.GranteeUserID != nil {
		granteeUserID = req.GranteeUserID
	} else if email := strings.ToLower(strings.TrimSpace(req.GranteeEmail)); email != "" {
		var id uuid.UUID
		err := h.App.DB.QueryRow(r.Context(), `SELECT id FROM users WHERE email = $1`, email).Scan(&id)
		if err != nil {
			httpjson.Error(w, http.StatusNotFound, "user not found")
			return
		}
		granteeUserID = &id
	} else {
		httpjson.Error(w, http.StatusBadRequest, "grantee required")
		return
	}

	var s models.Share
	err = h.App.DB.QueryRow(r.Context(), `
		INSERT INTO shares (node_id, grantee_user_id, grantee_workspace_id, permission, created_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, node_id, grantee_user_id, grantee_workspace_id, permission, created_by, created_at
	`, nodeID, granteeUserID, granteeWorkspaceID, req.Permission, user.ID).Scan(
		&s.ID, &s.NodeID, &s.GranteeUserID, &s.GranteeWorkspaceID, &s.Permission, &s.CreatedBy, &s.CreatedAt,
	)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not create share")
		return
	}
	actor := user.ID
	h.App.LogActivity(r.Context(), &nodeID, nil, &actor, "share.created", map[string]any{
		"permission": req.Permission,
		"share_id":   s.ID.String(),
	})
	h.App.Audit(r.Context(), r, user.ID.String(), "share.created", "share", s.ID.String(), map[string]any{
		"node_id":              nodeID.String(),
		"permission":           req.Permission,
		"grantee_user_id":      s.GranteeUserID,
		"grantee_workspace_id": s.GranteeWorkspaceID,
	})
	if granteeUserID != nil {
		var toEmail, nodeName string
		_ = h.App.DB.QueryRow(r.Context(), `SELECT email FROM users WHERE id = $1`, *granteeUserID).Scan(&toEmail)
		_ = h.App.DB.QueryRow(r.Context(), `SELECT name FROM nodes WHERE id = $1`, nodeID).Scan(&nodeName)
		if toEmail != "" {
			go func() {
				_ = h.App.SendShareEmail(context.Background(), toEmail, nodeName, user.DisplayName, req.Permission)
			}()
		}
	}
	httpjson.Write(w, http.StatusCreated, s)
}

func (h *ShareHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	shareID, err := uuid.Parse(chi.URLParam(r, "shareID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid share id")
		return
	}
	var nodeID uuid.UUID
	err = h.App.DB.QueryRow(r.Context(), `SELECT node_id FROM shares WHERE id = $1`, shareID).Scan(&nodeID)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	if _, err := h.App.RequireNodeAccess(r.Context(), nodeID, user.ID, true); err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	_, err = h.App.DB.Exec(r.Context(), `DELETE FROM shares WHERE id = $1`, shareID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "delete failed")
		return
	}
	h.App.Audit(r.Context(), r, user.ID.String(), "share.deleted", "share", shareID.String(), map[string]any{
		"node_id": nodeID.String(),
	})
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}
