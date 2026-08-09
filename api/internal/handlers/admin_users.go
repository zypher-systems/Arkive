package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/httpjson"
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
	CreatedAt       time.Time `json:"created_at"`
}

func (h *AdminUsersHandler) List(w http.ResponseWriter, r *http.Request) {
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	var rows pgx.Rows
	var err error
	if status == "" {
		rows, err = h.App.DB.Query(r.Context(), `
			SELECT id, email, display_name, is_instance_admin, status, created_at
			FROM users
			ORDER BY
				CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END,
				created_at ASC
		`)
	} else {
		if status != "pending" && status != "active" && status != "rejected" {
			httpjson.Error(w, http.StatusBadRequest, "status must be pending, active, or rejected")
			return
		}
		rows, err = h.App.DB.Query(r.Context(), `
			SELECT id, email, display_name, is_instance_admin, status, created_at
			FROM users WHERE status = $1
			ORDER BY created_at ASC
		`, status)
	}
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	out := []adminUserDTO{}
	for rows.Next() {
		var u adminUserDTO
		if err := rows.Scan(&u.ID, &u.Email, &u.DisplayName, &u.IsInstanceAdmin, &u.Status, &u.CreatedAt); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		out = append(out, u)
	}
	httpjson.Write(w, http.StatusOK, out)
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
