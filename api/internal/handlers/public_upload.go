package handlers

import (
	"context"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/db"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

const (
	linkModeView   = "view"
	linkModeUpload = "upload"

	maxPublicUploadNameBytes = 255
	maxCollisionSuffix       = 1000
)

// rejectUploadOnly answers 403 for listing/download endpoints on upload links.
func (h *PublicHandler) rejectUploadOnly(w http.ResponseWriter, res resolvedPublic) bool {
	if res.mode == linkModeUpload {
		httpjson.Error(w, http.StatusForbidden, "this link only accepts uploads")
		return true
	}
	return false
}

func cleanPublicUploadName(raw string) string {
	name := sanitizeName(raw)
	if name == "." || name == "" || !utf8.ValidString(name) {
		return ""
	}
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" || name == "." {
		return ""
	}
	for len(name) > maxPublicUploadNameBytes {
		_, size := utf8.DecodeLastRuneInString(name)
		name = name[:len(name)-size]
	}
	return name
}

// collisionName returns "name (n).ext" for n >= 1 ("name" for n == 0).
// Dotfiles such as ".env" are treated as having no extension.
func collisionName(name string, n int) string {
	if n == 0 {
		return name
	}
	ext := path.Ext(name)
	base := strings.TrimSuffix(name, ext)
	if base == "" {
		base, ext = name, ""
	}
	return fmt.Sprintf("%s (%d)%s", base, n, ext)
}

// Upload handles PUT /api/public/{token}/upload?name=<filename> for upload-only
// links ("file requests"). The body is streamed straight to the store.
//
// Uploaded nodes are attributed to nobody (created_by NULL): the uploader is an
// anonymous visitor, and crediting the link creator would misstate authorship
// in version history and activity. The link id is recorded in activity/audit.
func (h *PublicHandler) Upload(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	res := h.resolveLink(r, token)
	if h.writeResolveError(w, res) {
		return
	}
	h.setLinkUnlockCookie(w, token, res.unlocked)
	if res.mode != linkModeUpload {
		httpjson.Error(w, http.StatusForbidden, "this link does not accept uploads")
		return
	}
	if res.kind != "folder" {
		httpjson.Error(w, http.StatusBadRequest, "not a folder")
		return
	}
	if err := limitRequestBody(w, r, h.App.Cfg.MaxUploadBytes); err != nil {
		httpjson.Error(w, http.StatusRequestEntityTooLarge, "payload too large")
		return
	}
	name := cleanPublicUploadName(r.URL.Query().Get("name"))
	if name == "" {
		name = cleanPublicUploadName(r.Header.Get("X-File-Name"))
	}
	if name == "" {
		httpjson.Error(w, http.StatusBadRequest, "name required")
		return
	}
	// Never trust an anonymous client's Content-Type; derive from extension.
	contentType := mime.TypeByExtension(strings.ToLower(path.Ext(name)))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	wsID := res.workspaceID
	folderID := res.nodeID
	store, err := h.App.StoreForWorkspace(r.Context(), wsID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "storage unavailable")
		return
	}
	counted, sizeHint, qerr := wrapQuotaBody(h.App, r, wsID, 0)
	if qerr != nil {
		if errors.Is(qerr, app.ErrQuotaExceeded) {
			httpjson.Error(w, http.StatusRequestEntityTooLarge, "storage quota exceeded")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "quota check failed")
		return
	}

	nodeID := uuid.New()
	key := app.StorageKey(wsID, nodeID)
	if err := store.Put(r.Context(), key, counted, sizeHint, contentType); err != nil {
		_ = store.Delete(context.WithoutCancel(r.Context()), key)
		if isUploadTooLarge(err) {
			httpjson.Error(w, http.StatusRequestEntityTooLarge, "payload too large")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "upload failed")
		return
	}
	size := storedSize(counted, sizeHint)

	// Pick the final name at insert time: ON CONFLICT DO NOTHING covers the
	// partial unique indexes on (workspace_id, parent_id, name), so concurrent
	// uploads of the same name each get their own suffix and nothing is ever
	// overwritten.
	finalName := ""
	for i := 0; i <= maxCollisionSuffix; i++ {
		candidate := collisionName(name, i)
		var got string
		err = h.App.DB.QueryRow(r.Context(), `
			INSERT INTO nodes (id, workspace_id, parent_id, name, kind, size, mime, storage_key, created_by)
			VALUES ($1, $2, $3, $4, 'file', $5, $6, $7, NULL)
			ON CONFLICT DO NOTHING
			RETURNING name
		`, nodeID, wsID, folderID, candidate, size, contentType, key).Scan(&got)
		if errors.Is(err, db.ErrNoRows) {
			continue
		}
		if err != nil {
			break
		}
		finalName = got
		break
	}
	if finalName == "" {
		_ = store.Delete(context.WithoutCancel(r.Context()), key)
		if err != nil && !errors.Is(err, db.ErrNoRows) {
			httpjson.Error(w, http.StatusInternalServerError, "could not save file metadata")
			return
		}
		httpjson.Error(w, http.StatusConflict, "too many files with this name")
		return
	}

	nid, ws := nodeID, wsID
	h.App.LogActivity(r.Context(), &nid, &ws, nil, "link.uploaded", map[string]any{
		"link_id":   res.linkID.String(),
		"folder_id": folderID.String(),
		"name":      finalName,
		"size":      size,
	})
	h.App.Audit(r.Context(), r, "", "link.upload", "node", nodeID.String(), map[string]any{
		"link_id":   res.linkID.String(),
		"folder_id": folderID.String(),
		"name":      finalName,
		"size":      size,
	})
	go h.App.IndexNodeText(context.Background(), wsID, nodeID, contentType, key)
	go h.App.GenerateThumbnail(context.Background(), wsID, nodeID, contentType, key)
	httpjson.Write(w, http.StatusCreated, map[string]any{"name": finalName, "size": size})
}
