package handlers

import (
	"encoding/xml"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/auth"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/models"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type WebDAVHandler struct {
	App *app.App
}

func (h *WebDAVHandler) BasicLookup() middleware.BasicAuthLookup {
	return func(r *http.Request, email, password string) (*models.User, error) {
		email = strings.ToLower(strings.TrimSpace(email))
		var user models.User
		var hash *string
		err := h.App.DB.QueryRow(r.Context(), `
			SELECT id, email, display_name, is_instance_admin, status, created_at, password_hash
			FROM users WHERE email = $1
		`, email).Scan(&user.ID, &user.Email, &user.DisplayName, &user.IsInstanceAdmin, &user.Status, &user.CreatedAt, &hash)
		if err != nil || hash == nil || !auth.CheckPassword(password, *hash) {
			return nil, err
		}
		if user.Status != "active" {
			return nil, pgx.ErrNoRows
		}
		return &user, nil
	}
}

// parseDAVPath extracts workspace id and relative path from /dav/{workspaceID}/...
func parseDAVPath(urlPath string) (wsID uuid.UUID, rel string, err error) {
	rest := strings.TrimPrefix(urlPath, "/dav/")
	wsPart, relPath, _ := strings.Cut(rest, "/")
	wsID, err = uuid.Parse(wsPart)
	if err != nil {
		return uuid.Nil, "", err
	}
	rel = strings.Trim(relPath, "/")
	rel, _ = url.PathUnescape(rel)
	return wsID, rel, nil
}

func (h *WebDAVHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	wsID, rel, err := parseDAVPath(r.URL.Path)
	if err != nil {
		http.Error(w, "invalid workspace", http.StatusBadRequest)
		return
	}
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	write := r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != "PROPFIND" && r.Method != http.MethodOptions
	if err := h.App.RequireWorkspaceAccess(r.Context(), wsID, user.ID, write); err != nil {
		if err == app.ErrForbidden {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	switch r.Method {
	case http.MethodOptions:
		w.Header().Set("Allow", "OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, DELETE, MOVE, COPY")
		w.Header().Set("DAV", "1, 2")
		w.WriteHeader(http.StatusOK)
	case "PROPFIND":
		h.propfind(w, r, wsID, user, rel)
	case http.MethodGet, http.MethodHead:
		h.get(w, r, wsID, user, rel)
	case http.MethodPut:
		h.put(w, r, wsID, user, rel)
	case "MKCOL":
		h.mkcol(w, r, wsID, user, rel)
	case http.MethodDelete:
		h.delete(w, r, wsID, user, rel)
	case "MOVE":
		h.move(w, r, wsID, user, rel)
	case "COPY":
		h.copy(w, r, wsID, user, rel)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (h *WebDAVHandler) resolvePath(r *http.Request, wsID uuid.UUID, rel string) (node *models.Node, parentID *uuid.UUID, name string, err error) {
	if rel == "" {
		return nil, nil, "", nil // workspace root
	}
	parts := strings.Split(rel, "/")
	var currentParent *uuid.UUID
	for i, part := range parts {
		part = sanitizeName(part)
		if part == "" {
			return nil, nil, "", pgx.ErrNoRows
		}
		var n models.Node
		var qerr error
		if currentParent == nil {
			qerr = h.App.DB.QueryRow(r.Context(), `
				SELECT id, workspace_id, parent_id, name, kind, size, mime, storage_key, checksum, created_by, created_at, updated_at
				FROM nodes WHERE workspace_id = $1 AND parent_id IS NULL AND name = $2 AND deleted_at IS NULL
			`, wsID, part).Scan(
				&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.StorageKey, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt,
			)
		} else {
			qerr = h.App.DB.QueryRow(r.Context(), `
				SELECT id, workspace_id, parent_id, name, kind, size, mime, storage_key, checksum, created_by, created_at, updated_at
				FROM nodes WHERE workspace_id = $1 AND parent_id = $2 AND name = $3 AND deleted_at IS NULL
			`, wsID, *currentParent, part).Scan(
				&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.StorageKey, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt,
			)
		}
		if qerr != nil {
			if i == len(parts)-1 {
				return nil, currentParent, part, pgx.ErrNoRows
			}
			return nil, nil, "", qerr
		}
		if i == len(parts)-1 {
			return &n, currentParent, part, nil
		}
		if n.Kind != "folder" {
			return nil, nil, "", pgx.ErrNoRows
		}
		id := n.ID
		currentParent = &id
	}
	return nil, nil, "", pgx.ErrNoRows
}

func (h *WebDAVHandler) propfind(w http.ResponseWriter, r *http.Request, wsID uuid.UUID, user *models.User, rel string) {
	depth := r.Header.Get("Depth")
	if depth == "" {
		depth = "1"
	}
	node, _, _, err := h.resolvePath(r, wsID, rel)
	if err != nil && err != pgx.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if rel != "" && node == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	type resp struct {
		Href     string
		IsDir    bool
		Name     string
		Size     int64
		Modified time.Time
		Mime     string
	}
	var items []resp
	hrefBase := "/dav/" + wsID.String() + "/"
	if rel != "" {
		hrefBase += rel
		if node.Kind == "folder" && !strings.HasSuffix(hrefBase, "/") {
			hrefBase += "/"
		}
	}

	if rel == "" {
		items = append(items, resp{Href: "/dav/" + wsID.String() + "/", IsDir: true, Name: "", Modified: time.Now().UTC()})
	} else if node != nil {
		mime := ""
		if node.Mime != nil {
			mime = *node.Mime
		}
		items = append(items, resp{
			Href: hrefBase, IsDir: node.Kind == "folder", Name: node.Name,
			Size: node.Size, Modified: node.UpdatedAt.UTC(), Mime: mime,
		})
	}

	if depth != "0" {
		var parent *uuid.UUID
		if node != nil {
			if node.Kind != "folder" {
				// file: no children
			} else {
				id := node.ID
				parent = &id
			}
		}
		var rows pgx.Rows
		var qerr error
		if rel == "" || (node != nil && node.Kind == "folder") {
			if parent == nil && rel == "" {
				rows, qerr = h.App.DB.Query(r.Context(), `
					SELECT id, name, kind, size, mime, updated_at FROM nodes
					WHERE workspace_id = $1 AND parent_id IS NULL AND deleted_at IS NULL
					ORDER BY kind DESC, name ASC
				`, wsID)
			} else if parent != nil {
				rows, qerr = h.App.DB.Query(r.Context(), `
					SELECT id, name, kind, size, mime, updated_at FROM nodes
					WHERE workspace_id = $1 AND parent_id = $2 AND deleted_at IS NULL
					ORDER BY kind DESC, name ASC
				`, wsID, *parent)
			}
		}
		if qerr == nil && rows != nil {
			defer rows.Close()
			for rows.Next() {
				var id uuid.UUID
				var name, kind string
				var size int64
				var mime *string
				var updated time.Time
				if err := rows.Scan(&id, &name, &kind, &size, &mime, &updated); err != nil {
					continue
				}
				childHref := "/dav/" + wsID.String() + "/"
				if rel != "" {
					childHref += strings.TrimSuffix(rel, "/") + "/"
				}
				childHref += name
				if kind == "folder" {
					childHref += "/"
				}
				m := ""
				if mime != nil {
					m = *mime
				}
				items = append(items, resp{
					Href: childHref, IsDir: kind == "folder", Name: name,
					Size: size, Modified: updated.UTC(), Mime: m,
				})
			}
		}
	}

	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(http.StatusMultiStatus)
	_, _ = w.Write([]byte(xml.Header))
	_, _ = w.Write([]byte(`<d:multistatus xmlns:d="DAV:">`))
	for _, it := range items {
		_, _ = w.Write([]byte(`<d:response><d:href>` + xmlEscape(it.Href) + `</d:href><d:propstat><d:prop>`))
		_, _ = w.Write([]byte(`<d:displayname>` + xmlEscape(it.Name) + `</d:displayname>`))
		_, _ = w.Write([]byte(`<d:getlastmodified>` + it.Modified.Format(http.TimeFormat) + `</d:getlastmodified>`))
		if it.IsDir {
			_, _ = w.Write([]byte(`<d:resourcetype><d:collection/></d:resourcetype>`))
		} else {
			_, _ = w.Write([]byte(`<d:resourcetype/><d:getcontentlength>` + strconv.FormatInt(it.Size, 10) + `</d:getcontentlength>`))
			if it.Mime != "" {
				_, _ = w.Write([]byte(`<d:getcontenttype>` + xmlEscape(it.Mime) + `</d:getcontenttype>`))
			}
		}
		_, _ = w.Write([]byte(`</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`))
	}
	_, _ = w.Write([]byte(`</d:multistatus>`))
	_ = user
}

func (h *WebDAVHandler) get(w http.ResponseWriter, r *http.Request, wsID uuid.UUID, user *models.User, rel string) {
	node, _, _, err := h.resolvePath(r, wsID, rel)
	if err != nil || node == nil || node.Kind != "file" || node.StorageKey == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	store, err := h.App.StoreForWorkspace(r.Context(), wsID)
	if err != nil {
		http.Error(w, "storage error", http.StatusInternalServerError)
		return
	}
	rc, meta, err := store.Get(r.Context(), *node.StorageKey)
	if err != nil {
		http.Error(w, "storage error", http.StatusInternalServerError)
		return
	}
	defer rc.Close()
	ct := "application/octet-stream"
	if node.Mime != nil && *node.Mime != "" {
		ct = *node.Mime
	} else if meta.ContentType != "" {
		ct = meta.ContentType
	}
	w.Header().Set("Content-Type", ct)
	if meta.Size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(meta.Size, 10))
	}
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}
	_, _ = io.Copy(w, rc)
	_ = user
}

func (h *WebDAVHandler) put(w http.ResponseWriter, r *http.Request, wsID uuid.UUID, user *models.User, rel string) {
	if rel == "" {
		http.Error(w, "cannot put root", http.StatusMethodNotAllowed)
		return
	}
	node, parentID, name, err := h.resolvePath(r, wsID, rel)
	if err != nil && err != pgx.ErrNoRows {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	// Ensure parent path exists when creating
	if node == nil {
		dir := path.Dir(rel)
		if dir == "." || dir == "/" || dir == "" {
			parentID = nil
			if err := h.App.RequireWorkspaceAccess(r.Context(), wsID, user.ID, true); err != nil {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
		} else {
			parent, _, _, perr := h.resolvePath(r, wsID, dir)
			if perr != nil || parent == nil || parent.Kind != "folder" {
				http.Error(w, "parent not found", http.StatusConflict)
				return
			}
			parentID = &parent.ID
		}
		name = sanitizeName(path.Base(rel))
	} else if node.Kind != "file" {
		http.Error(w, "is a collection", http.StatusMethodNotAllowed)
		return
	}

	store, err := h.App.StoreForWorkspace(r.Context(), wsID)
	if err != nil {
		http.Error(w, "storage error", http.StatusInternalServerError)
		return
	}
	if err := h.limitUpload(w, r); err != nil {
		http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
		return
	}
	ct := r.Header.Get("Content-Type")
	if ct == "" {
		ct = "application/octet-stream"
	}
	size := r.ContentLength

	if node != nil {
		_ = h.App.ArchiveCurrentVersion(r.Context(), node.ID, user.ID)
		newKey := app.StorageKey(wsID, uuid.New())
		if err := store.Put(r.Context(), newKey, r.Body, size, ct); err != nil {
			if isUploadTooLarge(err) {
				http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
				return
			}
			http.Error(w, "upload failed", http.StatusInternalServerError)
			return
		}
		oldKey := node.StorageKey
		_, err = h.App.DB.Exec(r.Context(), `
			UPDATE nodes SET storage_key = $1, size = $2, mime = $3, updated_at = now() WHERE id = $4
		`, newKey, max64(size, 0), ct, node.ID)
		if err != nil {
			_ = store.Delete(r.Context(), newKey)
			http.Error(w, "update failed", http.StatusInternalServerError)
			return
		}
		// old key is kept in versions table
		_ = oldKey
		w.WriteHeader(http.StatusNoContent)
		return
	}

	nodeID := uuid.New()
	key := app.StorageKey(wsID, nodeID)
	if err := store.Put(r.Context(), key, r.Body, size, ct); err != nil {
		if isUploadTooLarge(err) {
			http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
			return
		}
		http.Error(w, "upload failed", http.StatusInternalServerError)
		return
	}
	_, err = h.App.DB.Exec(r.Context(), `
		INSERT INTO nodes (id, workspace_id, parent_id, name, kind, size, mime, storage_key, created_by)
		VALUES ($1, $2, $3, $4, 'file', $5, $6, $7, $8)
	`, nodeID, wsID, parentID, name, max64(size, 0), ct, key, user.ID)
	if err != nil {
		_ = store.Delete(r.Context(), key)
		http.Error(w, "create failed", http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *WebDAVHandler) mkcol(w http.ResponseWriter, r *http.Request, wsID uuid.UUID, user *models.User, rel string) {
	if rel == "" {
		http.Error(w, "exists", http.StatusMethodNotAllowed)
		return
	}
	node, parentID, name, err := h.resolvePath(r, wsID, rel)
	if node != nil {
		http.Error(w, "exists", http.StatusMethodNotAllowed)
		return
	}
	if err != nil && err != pgx.ErrNoRows {
		http.Error(w, "not found", http.StatusConflict)
		return
	}
	dir := path.Dir(rel)
	if dir != "." && dir != "/" && dir != "" {
		parent, _, _, perr := h.resolvePath(r, wsID, dir)
		if perr != nil || parent == nil || parent.Kind != "folder" {
			http.Error(w, "parent not found", http.StatusConflict)
			return
		}
		parentID = &parent.ID
	} else {
		parentID = nil
	}
	name = sanitizeName(path.Base(rel))
	_, err = h.App.DB.Exec(r.Context(), `
		INSERT INTO nodes (workspace_id, parent_id, name, kind, created_by)
		VALUES ($1, $2, $3, 'folder', $4)
	`, wsID, parentID, name, user.ID)
	if err != nil {
		http.Error(w, "create failed", http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *WebDAVHandler) delete(w http.ResponseWriter, r *http.Request, wsID uuid.UUID, user *models.User, rel string) {
	node, _, _, err := h.resolvePath(r, wsID, rel)
	if err != nil || node == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	_, err = h.App.DB.Exec(r.Context(), `
		WITH RECURSIVE tree AS (
			SELECT id FROM nodes WHERE id = $1 AND deleted_at IS NULL
			UNION ALL
			SELECT n.id FROM nodes n JOIN tree t ON n.parent_id = t.id WHERE n.deleted_at IS NULL
		)
		UPDATE nodes SET deleted_at = now(), updated_at = now()
		WHERE id IN (SELECT id FROM tree)
	`, node.ID)
	if err != nil {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
	_ = user
	_ = wsID
}

func (h *WebDAVHandler) move(w http.ResponseWriter, r *http.Request, wsID uuid.UUID, user *models.User, rel string) {
	dest := r.Header.Get("Destination")
	if dest == "" {
		http.Error(w, "destination required", http.StatusBadRequest)
		return
	}
	destPath, ok := h.parseDest(dest, wsID)
	if !ok {
		http.Error(w, "invalid destination", http.StatusBadRequest)
		return
	}
	node, _, _, err := h.resolvePath(r, wsID, rel)
	if err != nil || node == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	_, parentID, name, err := h.resolvePath(r, wsID, destPath)
	if err == nil {
		// destination exists
		http.Error(w, "exists", http.StatusPreconditionFailed)
		return
	}
	if destPath != "" {
		dir := path.Dir(destPath)
		name = sanitizeName(path.Base(destPath))
		if dir != "." && dir != "/" && dir != "" {
			parent, _, _, perr := h.resolvePath(r, wsID, dir)
			if perr != nil || parent == nil {
				http.Error(w, "parent not found", http.StatusConflict)
				return
			}
			parentID = &parent.ID
		} else {
			parentID = nil
		}
	}
	_, err = h.App.DB.Exec(r.Context(), `
		UPDATE nodes SET name = $1, parent_id = $2, updated_at = now() WHERE id = $3
	`, name, parentID, node.ID)
	if err != nil {
		http.Error(w, "move failed", http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusCreated)
	_ = user
}

func (h *WebDAVHandler) copy(w http.ResponseWriter, r *http.Request, wsID uuid.UUID, user *models.User, rel string) {
	dest := r.Header.Get("Destination")
	destPath, ok := h.parseDest(dest, wsID)
	if !ok || destPath == "" {
		http.Error(w, "invalid destination", http.StatusBadRequest)
		return
	}
	node, _, _, err := h.resolvePath(r, wsID, rel)
	if err != nil || node == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	var parentID *uuid.UUID
	name := sanitizeName(path.Base(destPath))
	dir := path.Dir(destPath)
	if dir != "." && dir != "/" && dir != "" {
		parent, _, _, perr := h.resolvePath(r, wsID, dir)
		if perr != nil || parent == nil {
			http.Error(w, "parent not found", http.StatusConflict)
			return
		}
		parentID = &parent.ID
	}
	if err := h.copyNode(r, wsID, user.ID, node, parentID, name); err != nil {
		http.Error(w, "copy failed", http.StatusConflict)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *WebDAVHandler) copyNode(r *http.Request, wsID, userID uuid.UUID, src *models.Node, parentID *uuid.UUID, name string) error {
	newID := uuid.New()
	if src.Kind == "folder" {
		_, err := h.App.DB.Exec(r.Context(), `
			INSERT INTO nodes (id, workspace_id, parent_id, name, kind, created_by)
			VALUES ($1, $2, $3, $4, 'folder', $5)
		`, newID, wsID, parentID, name, userID)
		if err != nil {
			return err
		}
		rows, err := h.App.DB.Query(r.Context(), `
			SELECT id, workspace_id, parent_id, name, kind, size, mime, storage_key, checksum, created_by, created_at, updated_at
			FROM nodes WHERE parent_id = $1 AND deleted_at IS NULL
		`, src.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var child models.Node
			if err := rows.Scan(&child.ID, &child.WorkspaceID, &child.ParentID, &child.Name, &child.Kind, &child.Size, &child.Mime, &child.StorageKey, &child.Checksum, &child.CreatedBy, &child.CreatedAt, &child.UpdatedAt); err != nil {
				return err
			}
			pid := newID
			if err := h.copyNode(r, wsID, userID, &child, &pid, child.Name); err != nil {
				return err
			}
		}
		return nil
	}
	store, err := h.App.StoreForWorkspace(r.Context(), wsID)
	if err != nil {
		return err
	}
	if src.StorageKey == nil {
		return pgx.ErrNoRows
	}
	rc, meta, err := store.Get(r.Context(), *src.StorageKey)
	if err != nil {
		return err
	}
	defer rc.Close()
	key := app.StorageKey(wsID, newID)
	ct := "application/octet-stream"
	if src.Mime != nil {
		ct = *src.Mime
	}
	if err := store.Put(r.Context(), key, rc, meta.Size, ct); err != nil {
		return err
	}
	_, err = h.App.DB.Exec(r.Context(), `
		INSERT INTO nodes (id, workspace_id, parent_id, name, kind, size, mime, storage_key, created_by)
		VALUES ($1, $2, $3, $4, 'file', $5, $6, $7, $8)
	`, newID, wsID, parentID, name, src.Size, src.Mime, key, userID)
	return err
}

func (h *WebDAVHandler) parseDest(dest string, wsID uuid.UUID) (string, bool) {
	u, err := url.Parse(dest)
	if err != nil {
		return "", false
	}
	p := u.Path
	if p == "" {
		p = dest
	}
	prefix := "/dav/" + wsID.String()
	if !strings.HasPrefix(p, prefix) {
		// allow relative destination
		if strings.HasPrefix(p, "/") && strings.Contains(p, wsID.String()) {
			idx := strings.Index(p, wsID.String())
			p = p[idx+len(wsID.String()):]
			return strings.Trim(p, "/"), true
		}
		return "", false
	}
	return strings.Trim(strings.TrimPrefix(p, prefix), "/"), true
}

func xmlEscape(s string) string {
	var b strings.Builder
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}
