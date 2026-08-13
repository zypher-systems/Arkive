package handlers

import (
	"archive/zip"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/auth"
	"github.com/arkive/arkive/internal/crypto"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/models"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

var errDownloadLimit = errors.New("download limit reached")

type PublicHandler struct {
	App *app.App
}

type createLinkRequest struct {
	Password     string     `json:"password"`
	ExpiresAt    *time.Time `json:"expires_at"`
	MaxDownloads *int       `json:"max_downloads"`
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
	if req.MaxDownloads != nil && *req.MaxDownloads <= 0 {
		httpjson.Error(w, http.StatusBadRequest, "max_downloads must be > 0")
		return
	}
	var link models.PublicLink
	var storedHash *string
	err = h.App.DB.QueryRow(r.Context(), `
		INSERT INTO public_links (node_id, token, password_hash, expires_at, max_downloads, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, node_id, token, password_hash, expires_at, max_downloads, download_count, created_at
	`, nodeID, token, passHash, req.ExpiresAt, req.MaxDownloads, user.ID).Scan(
		&link.ID, &link.NodeID, &link.Token, &storedHash, &link.ExpiresAt, &link.MaxDownloads, &link.DownloadCount, &link.CreatedAt,
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
		"max_downloads": req.MaxDownloads,
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
		SELECT id, node_id, token, password_hash, expires_at, max_downloads, download_count, created_at
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
		if err := rows.Scan(
			&link.ID, &link.NodeID, &link.Token, &hash, &link.ExpiresAt,
			&link.MaxDownloads, &link.DownloadCount, &link.CreatedAt,
		); err != nil {
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
	linkID      uuid.UUID
	nodeID      uuid.UUID
	workspaceID uuid.UUID
	name        string
	kind        string
	storageKey  *string
	mime        *string
	needsPass   bool
	unlocked    bool // password verified this request; mint unlock cookie
	errCode     int
	errMsg      string
}

func linkUnlockCookieName(token string) string {
	return "arkive_pl_" + token
}

func (h *PublicHandler) setLinkUnlockCookie(w http.ResponseWriter, token string, unlocked bool) {
	if !unlocked {
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     linkUnlockCookieName(token),
		Value:    crypto.MintLinkUnlock(h.App.Cfg.SecretsKey, token),
		Path:     "/api/public/" + token,
		MaxAge:   int(crypto.LinkUnlockTTL.Seconds()),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   h.App.Cfg.CookieSecure,
	})
}

func (h *PublicHandler) resolveLink(r *http.Request, token string) resolvedPublic {
	var passHash *string
	var expires *time.Time
	var out resolvedPublic
	err := h.App.DB.QueryRow(r.Context(), `
		SELECT pl.id, pl.password_hash, pl.expires_at, n.id, n.workspace_id, n.name, n.kind, n.storage_key, n.mime
		FROM public_links pl
		JOIN nodes n ON n.id = pl.node_id
		WHERE pl.token = $1 AND n.deleted_at IS NULL
	`, token).Scan(
		&out.linkID, &passHash, &expires, &out.nodeID, &out.workspaceID, &out.name, &out.kind, &out.storageKey, &out.mime,
	)
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
		if pass := r.Header.Get("X-Link-Password"); pass != "" && auth.CheckPassword(pass, *passHash) {
			out.unlocked = true
		} else if c, err := r.Cookie(linkUnlockCookieName(token)); err == nil &&
			crypto.VerifyLinkUnlock(h.App.Cfg.SecretsKey, token, c.Value) {
			// already unlocked via cookie
		} else {
			out.errCode = http.StatusUnauthorized
			out.errMsg = "password required"
			out.needsPass = true
			return out
		}
	}
	return out
}

func (h *PublicHandler) consumeDownloadBudget(r *http.Request, linkID uuid.UUID) error {
	tag, err := h.App.DB.Exec(r.Context(), `
		UPDATE public_links
		SET download_count = download_count + 1
		WHERE id = $1
		  AND (max_downloads IS NULL OR download_count < max_downloads)
	`, linkID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errDownloadLimit
	}
	return nil
}

func (h *PublicHandler) writeResolveError(w http.ResponseWriter, res resolvedPublic) bool {
	if res.needsPass {
		httpjson.Write(w, http.StatusUnauthorized, map[string]any{
			"error":          res.errMsg,
			"needs_password": true,
		})
		return true
	}
	if res.errCode != 0 {
		httpjson.Error(w, res.errCode, res.errMsg)
		return true
	}
	return false
}

// nodeUnderShareRoot reports whether nodeID is the share root or a descendant of it.
func (h *PublicHandler) nodeUnderShareRoot(r *http.Request, rootID, nodeID uuid.UUID) bool {
	if nodeID == rootID {
		return true
	}
	current := nodeID
	for i := 0; i < 256; i++ {
		var parent *uuid.UUID
		err := h.App.DB.QueryRow(r.Context(), `
			SELECT parent_id FROM nodes WHERE id = $1 AND deleted_at IS NULL
		`, current).Scan(&parent)
		if err != nil || parent == nil {
			return false
		}
		if *parent == rootID {
			return true
		}
		current = *parent
	}
	return false
}

func (h *PublicHandler) buildShareBreadcrumbs(r *http.Request, rootID, currentID uuid.UUID) ([]models.Breadcrumb, error) {
	var chain []models.Breadcrumb
	cur := currentID
	for i := 0; i < 256; i++ {
		var id uuid.UUID
		var name string
		var parent *uuid.UUID
		err := h.App.DB.QueryRow(r.Context(), `
			SELECT id, name, parent_id FROM nodes WHERE id = $1 AND deleted_at IS NULL
		`, cur).Scan(&id, &name, &parent)
		if err != nil {
			return nil, err
		}
		chain = append([]models.Breadcrumb{{ID: id, Name: name}}, chain...)
		if id == rootID {
			break
		}
		if parent == nil {
			// Escaped above root — reject by returning empty + error via caller check
			return nil, app.ErrForbidden
		}
		cur = *parent
	}
	if len(chain) == 0 || chain[0].ID != rootID {
		return nil, app.ErrForbidden
	}
	return chain, nil
}

func (h *PublicHandler) Meta(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	res := h.resolveLink(r, token)
	if h.writeResolveError(w, res) {
		return
	}
	h.setLinkUnlockCookie(w, token, res.unlocked)
	httpjson.Write(w, http.StatusOK, map[string]any{
		"node_id": res.nodeID,
		"name":    res.name,
		"kind":    res.kind,
		"mime":    res.mime,
	})
}

func (h *PublicHandler) ListNodes(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	res := h.resolveLink(r, token)
	if h.writeResolveError(w, res) {
		return
	}
	h.setLinkUnlockCookie(w, token, res.unlocked)
	if res.kind != "folder" {
		httpjson.Error(w, http.StatusBadRequest, "not a folder")
		return
	}

	parentID := res.nodeID
	if p := r.URL.Query().Get("parent_id"); p != "" {
		id, err := uuid.Parse(p)
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, "invalid parent_id")
			return
		}
		if !h.nodeUnderShareRoot(r, res.nodeID, id) {
			httpjson.Error(w, http.StatusForbidden, "outside shared folder")
			return
		}
		var kind string
		err = h.App.DB.QueryRow(r.Context(), `
			SELECT kind FROM nodes WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
		`, id, res.workspaceID).Scan(&kind)
		if err != nil {
			httpjson.Error(w, http.StatusNotFound, "not found")
			return
		}
		if kind != "folder" {
			httpjson.Error(w, http.StatusBadRequest, "parent is not a folder")
			return
		}
		parentID = id
	}

	rows, err := h.App.DB.Query(r.Context(), `
		SELECT id, workspace_id, parent_id, name, kind, size, mime, checksum, created_by, created_at, updated_at
		FROM nodes
		WHERE parent_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
		ORDER BY kind DESC, name ASC
	`, parentID, res.workspaceID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()

	nodes := []models.Node{}
	for rows.Next() {
		var n models.Node
		if err := rows.Scan(&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		nodes = append(nodes, n)
	}

	breadcrumbs, err := h.buildShareBreadcrumbs(r, res.nodeID, parentID)
	if err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}

	httpjson.Write(w, http.StatusOK, map[string]any{
		"root": map[string]any{
			"id":   res.nodeID,
			"name": res.name,
			"kind": res.kind,
		},
		"nodes":       nodes,
		"breadcrumbs": breadcrumbs,
	})
}

func (h *PublicHandler) Download(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	res := h.resolveLink(r, token)
	if h.writeResolveError(w, res) {
		return
	}
	h.setLinkUnlockCookie(w, token, res.unlocked)

	targetID := res.nodeID
	if q := r.URL.Query().Get("node_id"); q != "" {
		id, err := uuid.Parse(q)
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, "invalid node_id")
			return
		}
		if !h.nodeUnderShareRoot(r, res.nodeID, id) {
			httpjson.Error(w, http.StatusForbidden, "outside shared folder")
			return
		}
		targetID = id
	}

	var name, kind string
	var workspaceID uuid.UUID
	var storageKey *string
	var mime *string
	err := h.App.DB.QueryRow(r.Context(), `
		SELECT workspace_id, name, kind, storage_key, mime
		FROM nodes WHERE id = $1 AND deleted_at IS NULL
	`, targetID).Scan(&workspaceID, &name, &kind, &storageKey, &mime)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	if workspaceID != res.workspaceID {
		httpjson.Error(w, http.StatusForbidden, "outside shared folder")
		return
	}
	if kind != "file" || storageKey == nil {
		httpjson.Error(w, http.StatusBadRequest, "not a file")
		return
	}
	if err := h.consumeDownloadBudget(r, res.linkID); err != nil {
		if errors.Is(err, errDownloadLimit) {
			httpjson.Error(w, http.StatusForbidden, "download limit reached")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "could not record download")
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
	nid := targetID
	ws := workspaceID
	h.App.LogActivity(r.Context(), &nid, &ws, nil, "link.downloaded", map[string]any{
		"token": token,
	})
	_, _ = io.Copy(w, rc)
}

type publicZipRequest struct {
	NodeIDs []uuid.UUID `json:"node_ids"`
}

func (h *PublicHandler) DownloadZip(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	res := h.resolveLink(r, token)
	if h.writeResolveError(w, res) {
		return
	}
	h.setLinkUnlockCookie(w, token, res.unlocked)
	if res.kind != "folder" {
		httpjson.Error(w, http.StatusBadRequest, "not a folder")
		return
	}

	var req publicZipRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	ids := req.NodeIDs
	if len(ids) == 0 {
		ids = []uuid.UUID{res.nodeID}
	}
	for _, id := range ids {
		if !h.nodeUnderShareRoot(r, res.nodeID, id) {
			httpjson.Error(w, http.StatusForbidden, "outside shared folder")
			return
		}
	}

	type fileEntry struct {
		zipPath string
		key     string
	}
	var files []fileEntry

	var walk func(nodeID uuid.UUID, prefix string) error
	walk = func(nodeID uuid.UUID, prefix string) error {
		var name, kind string
		var workspaceID uuid.UUID
		var storageKey *string
		err := h.App.DB.QueryRow(r.Context(), `
			SELECT workspace_id, name, kind, storage_key FROM nodes
			WHERE id = $1 AND deleted_at IS NULL
		`, nodeID).Scan(&workspaceID, &name, &kind, &storageKey)
		if err != nil {
			return err
		}
		if workspaceID != res.workspaceID {
			return app.ErrForbidden
		}
		entryPath := name
		if prefix != "" {
			entryPath = path.Join(prefix, name)
		}
		if kind == "file" {
			if storageKey != nil {
				files = append(files, fileEntry{zipPath: entryPath, key: *storageKey})
			}
			return nil
		}
		rows, err := h.App.DB.Query(r.Context(), `
			SELECT id FROM nodes WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY name
		`, nodeID)
		if err != nil {
			return err
		}
		defer rows.Close()
		var children []uuid.UUID
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				return err
			}
			children = append(children, id)
		}
		for _, id := range children {
			if err := walk(id, entryPath); err != nil {
				return err
			}
		}
		return nil
	}

	for _, id := range ids {
		if err := walk(id, ""); err != nil {
			status, msg := app.WriteHTTPError(err)
			if status == 500 {
				httpjson.Error(w, http.StatusBadRequest, "could not collect files")
				return
			}
			httpjson.Error(w, status, msg)
			return
		}
	}
	if len(files) == 0 {
		httpjson.Error(w, http.StatusBadRequest, "no files to download")
		return
	}
	if err := h.consumeDownloadBudget(r, res.linkID); err != nil {
		if errors.Is(err, errDownloadLimit) {
			httpjson.Error(w, http.StatusForbidden, "download limit reached")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "could not record download")
		return
	}

	store, err := h.App.StoreForWorkspace(r.Context(), res.workspaceID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "storage unavailable")
		return
	}

	zipName := strings.ReplaceAll(res.name, `"`, ``)
	if zipName == "" {
		zipName = "arkive"
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+zipName+`.zip"`)
	zw := zip.NewWriter(w)
	defer zw.Close()

	for _, f := range files {
		rc, _, err := store.Get(r.Context(), f.key)
		if err != nil {
			continue
		}
		fw, err := zw.Create(f.zipPath)
		if err != nil {
			_ = rc.Close()
			continue
		}
		_, _ = io.Copy(fw, rc)
		_ = rc.Close()
	}
}
