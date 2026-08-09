package handlers

import (
	"errors"
	"net/http"
	"strings"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/models"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type WorkspaceHandler struct {
	App *app.App
}

func (h *WorkspaceHandler) List(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	_ = h.App.EnsureDriveMountsForUser(r.Context(), user.ID)
	rows, err := h.App.DB.Query(r.Context(), `
		SELECT w.id, w.type, w.name, w.storage_backend_id, w.invite_token, w.created_at, m.role
		FROM workspaces w
		JOIN workspace_members m ON m.workspace_id = w.id
		WHERE m.user_id = $1
		ORDER BY w.type ASC, w.name ASC
	`, user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	out := []models.Workspace{}
	for rows.Next() {
		var ws models.Workspace
		if err := rows.Scan(&ws.ID, &ws.Type, &ws.Name, &ws.StorageBackendID, &ws.InviteToken, &ws.CreatedAt, &ws.Role); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		out = append(out, ws)
	}
	httpjson.Write(w, http.StatusOK, out)
}

type createTeamRequest struct {
	Name string `json:"name"`
}

func (h *WorkspaceHandler) CreateTeam(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var req createTeamRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		httpjson.Error(w, http.StatusBadRequest, "name required")
		return
	}
	backendID, err := h.App.DefaultBackendID(r.Context())
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "no storage backend")
		return
	}
	token := randomToken(16)
	wsID := uuid.New()

	tx, err := h.App.DB.Begin(r.Context())
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(r.Context())

	var ws models.Workspace
	err = tx.QueryRow(r.Context(), `
		INSERT INTO workspaces (id, type, name, storage_backend_id, invite_token)
		VALUES ($1, 'team', $2, $3, $4)
		RETURNING id, type, name, storage_backend_id, invite_token, created_at
	`, wsID, name, backendID, token).Scan(
		&ws.ID, &ws.Type, &ws.Name, &ws.StorageBackendID, &ws.InviteToken, &ws.CreatedAt,
	)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not create team")
		return
	}
	_, err = tx.Exec(r.Context(), `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
	`, ws.ID, user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not add owner")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "commit failed")
		return
	}
	ws.Role = "owner"
	httpjson.Write(w, http.StatusCreated, ws)
}

func (h *WorkspaceHandler) Members(w http.ResponseWriter, r *http.Request) {
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
	rows, err := h.App.DB.Query(r.Context(), `
		SELECT u.id, u.email, u.display_name, m.role, m.created_at
		FROM workspace_members m
		JOIN users u ON u.id = m.user_id
		WHERE m.workspace_id = $1
		ORDER BY m.created_at ASC
	`, wsID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	out := []models.WorkspaceMember{}
	for rows.Next() {
		var m models.WorkspaceMember
		if err := rows.Scan(&m.UserID, &m.Email, &m.DisplayName, &m.Role, &m.CreatedAt); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		out = append(out, m)
	}
	httpjson.Write(w, http.StatusOK, out)
}

type joinRequest struct {
	Token string `json:"token"`
}

func (h *WorkspaceHandler) Join(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var req joinRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	token := strings.TrimSpace(req.Token)
	if token == "" {
		httpjson.Error(w, http.StatusBadRequest, "token required")
		return
	}
	var ws models.Workspace
	err := h.App.DB.QueryRow(r.Context(), `
		SELECT id, type, name, storage_backend_id, invite_token, created_at
		FROM workspaces WHERE invite_token = $1 AND type = 'team'
	`, token).Scan(&ws.ID, &ws.Type, &ws.Name, &ws.StorageBackendID, &ws.InviteToken, &ws.CreatedAt)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "invalid invite")
		return
	}
	_, err = h.App.DB.Exec(r.Context(), `
		INSERT INTO workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, 'member')
		ON CONFLICT DO NOTHING
	`, ws.ID, user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not join")
		return
	}
	ws.Role = "member"
	httpjson.Write(w, http.StatusOK, ws)
}

type updateMemberRequest struct {
	Role string `json:"role"`
}

func (h *WorkspaceHandler) UpdateMember(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	wsID, err := uuid.Parse(chi.URLParam(r, "workspaceID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid workspace id")
		return
	}
	memberID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid user id")
		return
	}
	role, err := h.App.WorkspaceRole(r.Context(), wsID, user.ID)
	if err != nil || (role != "owner" && role != "admin") {
		httpjson.Error(w, http.StatusForbidden, "forbidden")
		return
	}
	var req updateMemberRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Role != "admin" && req.Role != "member" && req.Role != "viewer" {
		httpjson.Error(w, http.StatusBadRequest, "invalid role")
		return
	}
	tag, err := h.App.DB.Exec(r.Context(), `
		UPDATE workspace_members SET role = $1
		WHERE workspace_id = $2 AND user_id = $3 AND role <> 'owner'
	`, req.Role, wsID, memberID)
	if err != nil || tag.RowsAffected() == 0 {
		httpjson.Error(w, http.StatusBadRequest, "could not update member")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *WorkspaceHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	wsID, err := uuid.Parse(chi.URLParam(r, "workspaceID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid workspace id")
		return
	}
	memberID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid user id")
		return
	}
	role, err := h.App.WorkspaceRole(r.Context(), wsID, user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusForbidden, "forbidden")
		return
	}
	if user.ID != memberID && role != "owner" && role != "admin" {
		httpjson.Error(w, http.StatusForbidden, "forbidden")
		return
	}
	tag, err := h.App.DB.Exec(r.Context(), `
		DELETE FROM workspace_members
		WHERE workspace_id = $1 AND user_id = $2 AND role <> 'owner'
	`, wsID, memberID)
	if err != nil || tag.RowsAffected() == 0 {
		httpjson.Error(w, http.StatusBadRequest, "could not remove member")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *WorkspaceHandler) RotateInvite(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	wsID, err := uuid.Parse(chi.URLParam(r, "workspaceID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid workspace id")
		return
	}
	role, err := h.App.WorkspaceRole(r.Context(), wsID, user.ID)
	if err != nil || (role != "owner" && role != "admin") {
		httpjson.Error(w, http.StatusForbidden, "forbidden")
		return
	}
	token := randomToken(16)
	_, err = h.App.DB.Exec(r.Context(), `
		UPDATE workspaces SET invite_token = $1 WHERE id = $2 AND type = 'team'
	`, token, wsID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not rotate invite")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]string{"invite_token": token})
}

type migrateWorkspaceRequest struct {
	StorageBackendID *uuid.UUID `json:"storage_backend_id"`
	UseDefault       bool       `json:"use_default"`
}

func (h *WorkspaceHandler) Migrate(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	wsID, err := uuid.Parse(chi.URLParam(r, "workspaceID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid workspace id")
		return
	}
	var role string
	err = h.App.DB.QueryRow(r.Context(), `
		SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2
	`, wsID, user.ID).Scan(&role)
	if err != nil || role != "owner" {
		httpjson.Error(w, http.StatusForbidden, "owner required")
		return
	}

	var req migrateWorkspaceRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}

	var backendID uuid.UUID
	if req.UseDefault || req.StorageBackendID == nil {
		backendID, err = h.App.DefaultBackendID(r.Context())
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "no default backend")
			return
		}
	} else {
		backendID = *req.StorageBackendID
		var owner *uuid.UUID
		var typ string
		err = h.App.DB.QueryRow(r.Context(), `
			SELECT owner_user_id, type FROM storage_backends WHERE id = $1
		`, backendID).Scan(&owner, &typ)
		if err != nil {
			httpjson.Error(w, http.StatusNotFound, "backend not found")
			return
		}
		if typ == "gdrive" {
			if owner == nil || *owner != user.ID {
				httpjson.Error(w, http.StatusForbidden, "not your connection")
				return
			}
		} else if owner != nil {
			httpjson.Error(w, http.StatusForbidden, "not allowed")
			return
		}
	}

	sync := r.URL.Query().Get("sync") == "1" || r.URL.Query().Get("sync") == "true"
	actor := user.ID
	job, res, err := h.App.EnqueueOrRunMigration(r.Context(), wsID, backendID, &actor, sync)
	if err != nil {
		var me *app.MigrateError
		if errors.As(err, &me) {
			httpjson.Write(w, http.StatusInternalServerError, map[string]any{
				"error": me.Message, "copied": me.Copied, "total": me.Total, "failed_key": me.FailedKey,
			})
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, err.Error())
		return
	}
	if job != nil {
		httpjson.Write(w, http.StatusAccepted, map[string]any{
			"status":  "queued",
			"job":     h.App.FormatMigrationJob(job),
			"job_url": h.App.MigrationJobURL(job.ID),
		})
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"status":             "ok",
		"storage_backend_id": res.Backend,
		"migrated":           res.Migrated,
		"copied":             res.Copied,
		"total":              res.Total,
	})
}

func (h *WorkspaceHandler) GetMigration(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	jobID, err := uuid.Parse(chi.URLParam(r, "jobID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid job id")
		return
	}
	job, err := h.App.GetMigrationJob(r.Context(), jobID)
	if err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	if err := h.App.RequireWorkspaceAccess(r.Context(), job.WorkspaceID, user.ID, false); err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	httpjson.Write(w, http.StatusOK, h.App.FormatMigrationJob(job))
}
