package handlers

import (
	"archive/zip"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/models"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type zipRequest struct {
	NodeIDs []uuid.UUID `json:"node_ids"`
}

func (h *FileHandler) DownloadZip(w http.ResponseWriter, r *http.Request) {
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
	var req zipRequest
	if err := httpjson.Decode(r, &req); err != nil || len(req.NodeIDs) == 0 {
		httpjson.Error(w, http.StatusBadRequest, "node_ids required")
		return
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
		if workspaceID != wsID {
			return app.ErrForbidden
		}
		if _, err := h.App.RequireNodeAccess(r.Context(), nodeID, user.ID, false); err != nil {
			return err
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

	for _, id := range req.NodeIDs {
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

	store, err := h.App.StoreForWorkspace(r.Context(), wsID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "storage unavailable")
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="arkive.zip"`)
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

func (h *FileHandler) Content(w http.ResponseWriter, r *http.Request) {
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

	var name, kind string
	var workspaceID uuid.UUID
	var storageKey *string
	var mime *string
	var size int64
	err = h.App.DB.QueryRow(r.Context(), `
		SELECT workspace_id, name, kind, storage_key, mime, size FROM nodes WHERE id = $1 AND deleted_at IS NULL
	`, nodeID).Scan(&workspaceID, &name, &kind, &storageKey, &mime, &size)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	if kind != "file" || storageKey == nil {
		httpjson.Error(w, http.StatusBadRequest, "not a file")
		return
	}

	ct := "application/octet-stream"
	if mime != nil && *mime != "" {
		ct = *mime
	}
	if !isPreviewable(ct, name) {
		httpjson.Error(w, http.StatusUnsupportedMediaType, "preview not supported for this type")
		return
	}
	// Cap text previews at 2MB
	if strings.HasPrefix(ct, "text/") || isTextExt(name) {
		if size > 2*1024*1024 {
			httpjson.Error(w, http.StatusRequestEntityTooLarge, "file too large to preview")
			return
		}
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
	if meta.ContentType != "" && ct == "application/octet-stream" {
		ct = meta.ContentType
	}
	w.Header().Set("Content-Type", ct)
	w.Header().Set("Content-Disposition", `inline; filename="`+strings.ReplaceAll(name, `"`, ``)+`"`)
	if meta.Size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(meta.Size, 10))
	}
	_, _ = io.Copy(w, rc)
}

func (h *FileHandler) Search(w http.ResponseWriter, r *http.Request) {
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
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 1 {
		httpjson.Write(w, http.StatusOK, []models.Node{})
		return
	}
	pattern := "%" + escapeLike(q) + "%"
	rows, err := h.App.DB.Query(r.Context(), `
		SELECT id, workspace_id, parent_id, name, kind, size, mime, checksum, created_by, created_at, updated_at
		FROM nodes
		WHERE workspace_id = $1 AND deleted_at IS NULL
		  AND (
		    search_vector @@ plainto_tsquery('english', $2)
		    OR name ILIKE $3 ESCAPE '\'
		  )
		ORDER BY
		  ts_rank(COALESCE(search_vector, ''::tsvector), plainto_tsquery('english', $2)) DESC,
		  kind DESC, name ASC
		LIMIT 50
	`, wsID, q, pattern)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	out := []models.Node{}
	for rows.Next() {
		var n models.Node
		if err := rows.Scan(&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		out = append(out, n)
	}
	httpjson.Write(w, http.StatusOK, out)
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

func isPreviewable(ct, name string) bool {
	ct = strings.ToLower(ct)
	if strings.HasPrefix(ct, "image/") || ct == "application/pdf" || strings.HasPrefix(ct, "text/") {
		return true
	}
	return isTextExt(name) || isImageExt(name) || strings.HasSuffix(strings.ToLower(name), ".pdf")
}

func isTextExt(name string) bool {
	n := strings.ToLower(name)
	for _, ext := range []string{".txt", ".md", ".json", ".yaml", ".yml", ".toml", ".csv", ".log", ".go", ".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".css", ".html", ".xml", ".sh", ".env"} {
		if strings.HasSuffix(n, ext) {
			return true
		}
	}
	return false
}

func isImageExt(name string) bool {
	n := strings.ToLower(name)
	for _, ext := range []string{".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp"} {
		if strings.HasSuffix(n, ext) {
			return true
		}
	}
	return false
}
