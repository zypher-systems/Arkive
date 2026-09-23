package handlers

import (
	"archive/zip"
	"bytes"
	"fmt"
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

const maxTextEditBytes = 2 * 1024 * 1024

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

	rangeHdr := r.Header.Get("Range")
	textLike := isTextPreview(ct, name)
	// Full text body capped at 2MB; Range peeks on text are allowed for larger files.
	if textLike && rangeHdr == "" && size > 2*1024*1024 {
		httpjson.Error(w, http.StatusRequestEntityTooLarge, "file too large to preview")
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
	if meta.ContentType != "" && ct == "application/octet-stream" {
		ct = meta.ContentType
	}
	total := size
	if meta.Size > 0 {
		total = meta.Size
	}

	safeName := strings.ReplaceAll(name, `"`, ``)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	if isDangerousInline(ct, name) {
		// Never execute uploaded HTML/SVG in the app origin.
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="`+safeName+`"`)
	} else {
		w.Header().Set("Content-Type", ct)
		w.Header().Set("Content-Disposition", `inline; filename="`+safeName+`"`)
	}
	w.Header().Set("Accept-Ranges", "bytes")

	if textLike && rangeHdr != "" {
		start, end, ok := parseBytesRange(rangeHdr, total)
		if !ok {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", total))
			httpjson.Error(w, http.StatusRequestedRangeNotSatisfiable, "invalid range")
			return
		}
		// Cap a single text range response
		if end-start+1 > 64*1024 {
			end = start + 64*1024 - 1
			if end >= total {
				end = total - 1
			}
		}
		if start > 0 {
			if _, err := io.CopyN(io.Discard, rc, start); err != nil {
				httpjson.Error(w, http.StatusInternalServerError, "storage error")
				return
			}
		}
		length := end - start + 1
		w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, total))
		w.Header().Set("Content-Length", strconv.FormatInt(length, 10))
		w.WriteHeader(http.StatusPartialContent)
		_, _ = io.CopyN(w, rc, length)
		return
	}

	if total > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(total, 10))
	}
	_, _ = io.Copy(w, rc)
}

func (h *FileHandler) PutContent(w http.ResponseWriter, r *http.Request) {
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

	var name, kind string
	var workspaceID uuid.UUID
	var storageKey *string
	var mime *string
	var existingSize int64
	err = h.App.DB.QueryRow(r.Context(), `
		SELECT workspace_id, name, kind, storage_key, mime, size FROM nodes WHERE id = $1 AND deleted_at IS NULL
	`, nodeID).Scan(&workspaceID, &name, &kind, &storageKey, &mime, &existingSize)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	if kind != "file" || storageKey == nil {
		httpjson.Error(w, http.StatusBadRequest, "not a file")
		return
	}

	ct := ""
	if mime != nil && *mime != "" {
		ct = *mime
	}
	if !isTextPreview(ct, name) {
		httpjson.Error(w, http.StatusUnsupportedMediaType, "only text files can be edited")
		return
	}

	max := int64(maxTextEditBytes)
	if h.App.Cfg.MaxUploadBytes > 0 && h.App.Cfg.MaxUploadBytes < max {
		max = h.App.Cfg.MaxUploadBytes
	}
	if r.ContentLength > max {
		httpjson.Error(w, http.StatusRequestEntityTooLarge, "payload too large")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, max+1))
	if err != nil {
		if isUploadTooLarge(err) {
			httpjson.Error(w, http.StatusRequestEntityTooLarge, "payload too large")
			return
		}
		httpjson.Error(w, http.StatusBadRequest, "could not read body")
		return
	}
	if int64(len(body)) > max {
		httpjson.Error(w, http.StatusRequestEntityTooLarge, "payload too large")
		return
	}
	incoming := int64(len(body))

	contentType := r.Header.Get("Content-Type")
	if contentType == "" || contentType == "application/octet-stream" {
		if mime != nil && *mime != "" {
			contentType = *mime
		} else {
			contentType = "text/plain; charset=utf-8"
		}
	}

	store, err := h.App.StoreForWorkspace(r.Context(), workspaceID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "storage unavailable")
		return
	}
	if err := h.App.EnsureQuota(r.Context(), workspaceID, incoming, existingSize); err != nil {
		httpjson.Error(w, http.StatusRequestEntityTooLarge, "storage quota exceeded")
		return
	}
	_ = h.App.ArchiveCurrentVersion(r.Context(), nodeID, user.ID)
	newKey := app.StorageKey(workspaceID, uuid.New())
	if err := store.Put(r.Context(), newKey, bytes.NewReader(body), incoming, contentType); err != nil {
		if isUploadTooLarge(err) {
			httpjson.Error(w, http.StatusRequestEntityTooLarge, "payload too large")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "upload failed")
		return
	}

	var n models.Node
	err = h.App.DB.QueryRow(r.Context(), `
		UPDATE nodes SET storage_key = $1, size = $2, mime = $3, updated_at = now()
		WHERE id = $4
		RETURNING id, workspace_id, parent_id, name, kind, size, mime, checksum, created_by, created_at, updated_at
	`, newKey, incoming, contentType, nodeID).Scan(
		&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt,
	)
	if err != nil {
		_ = store.Delete(r.Context(), newKey)
		httpjson.Error(w, http.StatusInternalServerError, "could not update file")
		return
	}
	h.App.SchedulePostUpload(workspaceID, n.ID, contentType, newKey)
	httpjson.Write(w, http.StatusOK, n)
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
	out, err := h.App.SearchNodes(r.Context(), app.SearchScope{Cond: "n.workspace_id = $1", Arg: wsID}, q)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	httpjson.Write(w, http.StatusOK, out)
}

func (h *FileHandler) SearchAll(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 1 {
		httpjson.Write(w, http.StatusOK, []models.Node{})
		return
	}
	out, err := h.App.SearchNodes(r.Context(), app.SearchScope{
		Cond: "n.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = $1)",
		Arg:  user.ID,
	}, q)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	httpjson.Write(w, http.StatusOK, out)
}

func escapeLike(s string) string { return app.EscapeLike(s) }

func isTextPreview(ct, name string) bool {
	ct = strings.ToLower(ct)
	if strings.HasPrefix(ct, "text/") ||
		ct == "application/json" ||
		ct == "application/xml" ||
		ct == "application/javascript" ||
		ct == "application/x-sh" ||
		ct == "application/x-yaml" {
		return true
	}
	return isTextExt(name)
}

// parseBytesRange handles a single "bytes=start-end" range.
func parseBytesRange(h string, size int64) (start, end int64, ok bool) {
	if size <= 0 {
		return 0, 0, false
	}
	h = strings.TrimSpace(h)
	if !strings.HasPrefix(h, "bytes=") {
		return 0, 0, false
	}
	spec := strings.TrimPrefix(h, "bytes=")
	if strings.Contains(spec, ",") {
		return 0, 0, false
	}
	parts := strings.SplitN(spec, "-", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	if parts[0] == "" {
		// suffix form bytes=-N
		n, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || n <= 0 {
			return 0, 0, false
		}
		if n > size {
			n = size
		}
		return size - n, size - 1, true
	}
	start, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || start < 0 || start >= size {
		return 0, 0, false
	}
	if parts[1] == "" {
		return start, size - 1, true
	}
	end, err = strconv.ParseInt(parts[1], 10, 64)
	if err != nil || end < start {
		return 0, 0, false
	}
	if end >= size {
		end = size - 1
	}
	return start, end, true
}

func isDangerousInline(ct, name string) bool {
	ct = strings.ToLower(ct)
	n := strings.ToLower(name)
	if strings.Contains(ct, "html") || strings.Contains(ct, "svg") {
		return true
	}
	return strings.HasSuffix(n, ".html") || strings.HasSuffix(n, ".htm") || strings.HasSuffix(n, ".svg") || strings.HasSuffix(n, ".svgz")
}

func isPreviewable(ct, name string) bool {
	if isDangerousInline(ct, name) {
		return false
	}
	ct = strings.ToLower(ct)
	if strings.HasPrefix(ct, "image/") ||
		strings.HasPrefix(ct, "video/") ||
		strings.HasPrefix(ct, "audio/") ||
		ct == "application/pdf" ||
		strings.HasPrefix(ct, "text/") ||
		ct == "application/json" ||
		ct == "application/xml" ||
		ct == "application/javascript" ||
		ct == "application/x-sh" ||
		ct == "application/x-yaml" {
		return true
	}
	n := strings.ToLower(name)
	return isTextExt(name) ||
		isImageExt(name) ||
		isVideoExt(name) ||
		isAudioExt(name) ||
		strings.HasSuffix(n, ".pdf")
}

func isTextExt(name string) bool {
	n := strings.ToLower(name)
	for _, ext := range []string{
		".txt", ".md", ".markdown", ".json", ".yaml", ".yml", ".toml", ".csv", ".tsv", ".log",
		".go", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".css", ".scss", ".less",
		".xml", ".sh", ".bash", ".zsh", ".env", ".ini", ".conf", ".cfg", ".sql",
		".rb", ".java", ".kt", ".c", ".cc", ".cpp", ".h", ".hpp", ".php", ".vue", ".svelte",
		".swift", ".dart", ".lua", ".r", ".pl", ".ps1",
	} {
		if strings.HasSuffix(n, ext) {
			return true
		}
	}
	return false
}

func isImageExt(name string) bool {
	n := strings.ToLower(name)
	for _, ext := range []string{".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".avif", ".ico", ".jfif"} {
		if strings.HasSuffix(n, ext) {
			return true
		}
	}
	return false
}

func isVideoExt(name string) bool {
	n := strings.ToLower(name)
	for _, ext := range []string{".mp4", ".webm", ".ogg", ".ogv", ".mov", ".m4v", ".mkv"} {
		if strings.HasSuffix(n, ext) {
			return true
		}
	}
	return false
}

func isAudioExt(name string) bool {
	n := strings.ToLower(name)
	for _, ext := range []string{".mp3", ".wav", ".ogg", ".oga", ".m4a", ".flac", ".aac", ".opus"} {
		if strings.HasSuffix(n, ext) {
			return true
		}
	}
	return false
}
