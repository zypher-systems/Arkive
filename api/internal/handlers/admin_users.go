package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/models"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type AdminUsersHandler struct {
	App *app.App
}

type adminUserDTO struct {
	ID              uuid.UUID `json:"id"`
	Email           string    `json:"email"`
	DisplayName     string    `json:"display_name"`
	IsInstanceAdmin bool      `json:"is_instance_admin"`
	Status          string    `json:"status"`
	QuotaBytes      *int64    `json:"quota_bytes,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

func (h *AdminUsersHandler) List(w http.ResponseWriter, r *http.Request) {
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	limit, offset := parsePage(r)
	fetch := limit + 1
	var rows pgx.Rows
	var err error
	if status == "" {
		rows, err = h.App.DB.Query(r.Context(), `
			SELECT id, email, display_name, is_instance_admin, status, quota_bytes, created_at
			FROM users
			ORDER BY
				CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
				created_at ASC
			LIMIT $1 OFFSET $2
		`, fetch, offset)
	} else {
		if status != "pending" && status != "active" && status != "rejected" && status != "disabled" {
			httpjson.Error(w, http.StatusBadRequest, "status must be pending, active, rejected, or disabled")
			return
		}
		rows, err = h.App.DB.Query(r.Context(), `
			SELECT id, email, display_name, is_instance_admin, status, quota_bytes, created_at
			FROM users WHERE status = $1
			ORDER BY created_at ASC
			LIMIT $2 OFFSET $3
		`, status, fetch, offset)
	}
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	out := []adminUserDTO{}
	for rows.Next() {
		var u adminUserDTO
		if err := rows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.IsInstanceAdmin, &u.Status, &u.QuotaBytes, &u.CreatedAt); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		out = append(out, u)
	}
	hasMore := len(out) > limit
	if hasMore {
		out = out[:limit]
	}
	nextOffset := 0
	if hasMore {
		nextOffset = offset + limit
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"items":       out,
		"has_more":    hasMore,
		"next_offset": nextOffset,
	})
}

func (h *AdminUsersHandler) Approve(w http.ResponseWriter, r *http.Request) {
	h.setStatus(w, r, "active")
}

func (h *AdminUsersHandler) Reject(w http.ResponseWriter, r *http.Request) {
	h.setStatus(w, r, "rejected")
}

func (h *AdminUsersHandler) setStatus(w http.ResponseWriter, r *http.Request, status string) {
	userID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var u models.User
	err = h.App.DB.QueryRow(r.Context(), `
		UPDATE users SET status = $1 WHERE id = $2
		RETURNING id, email, display_name, is_instance_admin, status, created_at
	`, status, userID).Scan(
		&u.ID, &u.Email, &u.DisplayName, &u.IsInstanceAdmin, &u.Status, &u.CreatedAt,
	)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "user not found")
		return
	}
	if status != "active" {
		_, _ = h.App.DB.Exec(r.Context(), `DELETE FROM sessions WHERE user_id = $1`, userID)
	}
	go h.App.SendSignupStatusEmail(context.Background(), u.Email, u.DisplayName, status)
	httpjson.Write(w, http.StatusOK, u)
}

func (h *AdminUsersHandler) Disable(w http.ResponseWriter, r *http.Request) {
	h.setStatus(w, r, "disabled")
}

func (h *AdminUsersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	actor := middleware.UserFromContext(r.Context())
	userID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if actor != nil && actor.ID == userID {
		httpjson.Error(w, http.StatusBadRequest, "cannot delete yourself")
		return
	}
	var isAdmin bool
	err = h.App.DB.QueryRow(r.Context(), `SELECT is_instance_admin FROM users WHERE id = $1`, userID).Scan(&isAdmin)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "user not found")
		return
	}
	if isAdmin {
		var admins int
		_ = h.App.DB.QueryRow(r.Context(), `
			SELECT COUNT(*) FROM users WHERE is_instance_admin = TRUE AND status = 'active'
		`).Scan(&admins)
		if admins <= 1 {
			httpjson.Error(w, http.StatusConflict, "cannot delete the last instance admin")
			return
		}
	}
	var teams int
	_ = h.App.DB.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM workspaces w
		JOIN workspace_members m ON m.workspace_id = w.id
		WHERE m.user_id = $1 AND m.role = 'owner' AND w.type = 'team'
	`, userID).Scan(&teams)
	if teams > 0 {
		httpjson.Error(w, http.StatusConflict, "user owns team workspaces — transfer or delete those first")
		return
	}
	_, _ = h.App.DB.Exec(r.Context(), `
		DELETE FROM workspaces WHERE id IN (
			SELECT w.id FROM workspaces w
			JOIN workspace_members m ON m.workspace_id = w.id
			WHERE m.user_id = $1 AND m.role = 'owner' AND w.type IN ('personal', 'mount')
		)
	`, userID)
	_, err = h.App.DB.Exec(r.Context(), `DELETE FROM users WHERE id = $1`, userID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not delete user")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *AdminUsersHandler) PatchAdmin(w http.ResponseWriter, r *http.Request) {
	userID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var body struct {
		IsInstanceAdmin *bool `json:"is_instance_admin"`
	}
	if err := httpjson.Decode(r, &body); err != nil || body.IsInstanceAdmin == nil {
		httpjson.Error(w, http.StatusBadRequest, "is_instance_admin required")
		return
	}
	if !*body.IsInstanceAdmin {
		var admins int
		_ = h.App.DB.QueryRow(r.Context(), `
			SELECT COUNT(*) FROM users WHERE is_instance_admin = TRUE AND status = 'active' AND id <> $1
		`, userID).Scan(&admins)
		if admins < 1 {
			httpjson.Error(w, http.StatusConflict, "cannot demote the last instance admin")
			return
		}
	}
	var u models.User
	err = h.App.DB.QueryRow(r.Context(), `
		UPDATE users SET is_instance_admin = $1 WHERE id = $2
		RETURNING id, email, display_name, is_instance_admin, status, created_at
	`, *body.IsInstanceAdmin, userID).Scan(
		&u.ID, &u.Email, &u.DisplayName, &u.IsInstanceAdmin, &u.Status, &u.CreatedAt,
	)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "user not found")
		return
	}
	httpjson.Write(w, http.StatusOK, u)
}
