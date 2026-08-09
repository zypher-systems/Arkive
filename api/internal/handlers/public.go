package handlers

import (
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/auth"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/models"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type PublicHandler struct {
	App *app.App
}

type createLinkRequest struct {
	Password  string     `json:"password"`
	ExpiresAt *time.Time `json:"expires_at"`
}

func (h *PublicHandler) Create(w http.ResponseWriter, r *http.Request) {
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
	var req createLinkRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	token := randomToken(24)
	var passHash *string
	if strings.TrimSpace(req.Password) != "" {
		hsh, err := auth.HashPassword(req.Password)
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "could not hash password")
			return
		}
		passHash = &hsh
	}
	var link models.PublicLink
	var storedHash *string
	err = h.App.DB.QueryRow(r.Context(), `
		INSERT INTO public_links (node_id, token, password_hash, expires_at, created_by)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, node_id, token, password_hash, expires_at, created_at
	`, nodeID, token, passHash, req.ExpiresAt, user.ID).Scan(
		&link.ID, &link.NodeID, &link.Token, &storedHash, &link.ExpiresAt, &link.CreatedAt,
	)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not create link")
		return
	}
	link.HasPass = storedHash != nil && *storedHash != ""
	link.URL = "/s/" + link.Token
	actor := user.ID
	h.App.LogActivity(r.Context(), &nodeID, nil, &actor, "link.created", map[string]any{
		"link_id":       link.ID.String(),
		"has_password":  link.HasPass,
		"has_expiry":    req.ExpiresAt != nil,
	})
	httpjson.Write(w, http.StatusCreated, link)
}

func (h *PublicHandler) List(w http.ResponseWriter, r *http.Request) {
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
		SELECT id, node_id, token, password_hash, expires_at, created_at
		FROM public_links
		WHERE node_id = $1
		  AND (expires_at IS NULL OR expires_at > now())
		ORDER BY created_at DESC
	`, nodeID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []models.PublicLink{}
	for rows.Next() {
		var link models.PublicLink
		var hash *string
		if err := rows.Scan(&link.ID, &link.NodeID, &link.Token, &hash, &link.ExpiresAt, &link.CreatedAt); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		link.HasPass = hash != nil && *hash != ""
		link.URL = "/s/" + link.Token
		out = append(out, link)
	}
	httpjson.Write(w, http.StatusOK, out)
}

func (h *PublicHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	linkID, err := uuid.Parse(chi.URLParam(r, "linkID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid link id")
		return
	}
	var nodeID uuid.UUID
	err = h.App.DB.QueryRow(r.Context(), `SELECT node_id FROM public_links WHERE id = $1`, linkID).Scan(&nodeID)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	if _, err := h.App.RequireNodeAccess(r.Context(), nodeID, user.ID, true); err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	_, _ = h.App.DB.Exec(r.Context(), `DELETE FROM public_links WHERE id = $1`, linkID)
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}

type resolvedPublic struct {
	nodeID      uuid.UUID
	workspaceID uuid.UUID
	name        string
	kind        string
	storageKey  *string
	mime        *string
	needsPass   bool
	errCode     int
	errMsg      string
}

func (h *PublicHandler) resolveLink(r *http.Request, token string) resolvedPublic {
	var passHash *string
	var expires *time.Time
	var out resolvedPublic
	err := h.App.DB.QueryRow(r.Context(), `
		SELECT pl.password_hash, pl.expires_at, n.id, n.workspace_id, n.name, n.kind, n.storage_key, n.mime
		FROM public_links pl
		JOIN nodes n ON n.id = pl.node_id
		WHERE pl.token = $1 AND n.deleted_at IS NULL
	`, token).Scan(&passHash, &expires, &out.nodeID, &out.workspaceID, &out.name, &out.kind, &out.storageKey, &out.mime)
	if err != nil {
		out.errCode = http.StatusNotFound
		out.errMsg = "not found"
		return out
	}
	if expires != nil && expires.Before(time.Now()) {
		out.errCode = http.StatusGone
		out.errMsg = "link expired"
		return out
	}
	if passHash != nil && *passHash != "" {
		pass := r.Header.Get("X-Link-Password")
		if pass == "" {
			pass = r.URL.Query().Get("password")
		}
		if pass == "" || !auth.CheckPassword(pass, *passHash) {
			out.errCode = http.StatusUnauthorized
			out.errMsg = "password required"
			out.needsPass = true
			return out
		}
	}
	return out
}

func (h *PublicHandler) Meta(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	res := h.resolveLink(r, token)
	if res.needsPass {
		httpjson.Write(w, http.StatusUnauthorized, map[string]any{
			"error":          res.errMsg,
			"needs_password": true,
		})
		return
	}
	if res.errCode != 0 {
		httpjson.Error(w, res.errCode, res.errMsg)
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"node_id": res.nodeID,
		"name":    res.name,
		"kind":    res.kind,
		"mime":    res.mime,
	})
}

func (h *PublicHandler) Download(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	res := h.resolveLink(r, token)
	if res.needsPass {
		httpjson.Write(w, http.StatusUnauthorized, map[string]any{
			"error":          res.errMsg,
			"needs_password": true,
		})
		return
	}
	if res.errCode != 0 {
		httpjson.Error(w, res.errCode, res.errMsg)
		return
	}
	workspaceID := res.workspaceID
	name := res.name
	kind := res.kind
	storageKey := res.storageKey
	mime := res.mime
	if kind != "file" || storageKey == nil {
		httpjson.Error(w, http.StatusBadRequest, "not a file")
		return
	}
	store, err := h.App.StoreForWorkspace(r.Context(), workspaceID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "storage unavailable")
		return
	}
	rc, meta, err := store.Get(r.Context(), *storageKey)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "storage error")
		return
	}
	defer rc.Close()
	ct := "application/octet-stream"
	if mime != nil && *mime != "" {
		ct = *mime
	} else if meta.ContentType != "" {
		ct = meta.ContentType
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Disposition", `attachment; filename="`+strings.ReplaceAll(name, `"`, ``)+`"`)
	if meta.Size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(meta.Size, 10))
	}
	nid := res.nodeID
	ws := workspaceID
	h.App.LogActivity(r.Context(), &nid, &ws, nil, "link.downloaded", map[string]any{
		"token": token,
	})
	_, _ = io.Copy(w, rc)
}
