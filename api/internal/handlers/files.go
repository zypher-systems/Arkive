package handlers

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/db"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/models"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

type FileHandler struct {
	App *app.App
}

func (h *FileHandler) List(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	wsID, err := uuid.Parse(chi.URLParam(r, "workspaceID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid workspace id")
		return
	}
	var parentID *uuid.UUID
	if p := r.URL.Query().Get("parent_id"); p != "" {
		id, err := uuid.Parse(p)
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, "invalid parent_id")
			return
		}
		parentID = &id
		if err := h.App.RequireParentInWorkspace(r.Context(), id, wsID, user.ID, false); err != nil {
			status, msg := app.WriteHTTPError(err)
			httpjson.Error(w, status, msg)
			return
		}
	} else if err := h.App.RequireWorkspaceAccess(r.Context(), wsID, user.ID, false); err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}

	limit, offset := parsePage(r)
	fetch := limit + 1

	var rows db.Rows
	if parentID == nil {
		rows, err = h.App.DB.Query(r.Context(), `
			SELECT id, workspace_id, parent_id, name, kind, size, mime, checksum, created_by, created_at, updated_at
			FROM nodes WHERE workspace_id = $1 AND parent_id IS NULL AND deleted_at IS NULL
			ORDER BY kind DESC, name ASC
			LIMIT $2 OFFSET $3
		`, wsID, fetch, offset)
	} else {
		rows, err = h.App.DB.Query(r.Context(), `
			SELECT id, workspace_id, parent_id, name, kind, size, mime, checksum, created_by, created_at, updated_at
			FROM nodes WHERE workspace_id = $1 AND parent_id = $2 AND deleted_at IS NULL
			ORDER BY kind DESC, name ASC
			LIMIT $3 OFFSET $4
		`, wsID, *parentID, fetch, offset)
	}
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

	hasMore := len(nodes) > limit
	if hasMore {
		nodes = nodes[:limit]
	}

	breadcrumbs := []models.Breadcrumb{}
	if parentID != nil {
		breadcrumbs, err = h.buildBreadcrumbs(r, *parentID)
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "breadcrumb failed")
			return
		}
		// Someone browsing a shared folder only sees the path from the
		// highest folder they can open, not the owner's folders above it.
		if _, err := h.App.WorkspaceRole(r.Context(), wsID, user.ID); errors.Is(err, app.ErrForbidden) {
			for i, b := range breadcrumbs {
				if _, err := h.App.RequireNodeAccess(r.Context(), b.ID, user.ID, false); err == nil {
					breadcrumbs = breadcrumbs[i:]
					break
				}
			}
		}
	}

	nextOffset := 0
	if hasMore {
		nextOffset = offset + limit
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"nodes":       nodes,
		"breadcrumbs": breadcrumbs,
		"has_more":    hasMore,
		"next_offset": nextOffset,
	})
}

func (h *FileHandler) buildBreadcrumbs(r *http.Request, nodeID uuid.UUID) ([]models.Breadcrumb, error) {
	var chain []models.Breadcrumb
	current := &nodeID
	for current != nil {
		var id uuid.UUID
		var name string
		var parent *uuid.UUID
		err := h.App.DB.QueryRow(r.Context(), `
			SELECT id, name, parent_id FROM nodes WHERE id = $1
		`, *current).Scan(&id, &name, &parent)
		if err != nil {
			return nil, err
		}
		chain = append([]models.Breadcrumb{{ID: id, Name: name}}, chain...)
		current = parent
	}
	return chain, nil
}

type mkdirRequest struct {
	Name     string     `json:"name"`
	ParentID *uuid.UUID `json:"parent_id"`
}

func (h *FileHandler) Mkdir(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	wsID, err := uuid.Parse(chi.URLParam(r, "workspaceID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid workspace id")
		return
	}
	var req mkdirRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	name := sanitizeName(req.Name)
	if name == "" {
		httpjson.Error(w, http.StatusBadRequest, "name required")
		return
	}
	if req.ParentID != nil {
		if err := h.App.RequireParentInWorkspace(r.Context(), *req.ParentID, wsID, user.ID, true); err != nil {
			status, msg := app.WriteHTTPError(err)
			httpjson.Error(w, status, msg)
			return
		}
	} else if err := h.App.RequireWorkspaceAccess(r.Context(), wsID, user.ID, true); err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}

	var n models.Node
	err = h.App.DB.QueryRow(r.Context(), `
		INSERT INTO nodes (workspace_id, parent_id, name, kind, created_by)
		VALUES ($1, $2, $3, 'folder', $4)
		RETURNING id, workspace_id, parent_id, name, kind, size, mime, checksum, created_by, created_at, updated_at
	`, wsID, req.ParentID, name, user.ID).Scan(
		&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt,
	)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			httpjson.Error(w, http.StatusConflict, "name already exists")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "could not create folder")
		return
	}
	httpjson.Write(w, http.StatusCreated, n)
}

func (h *FileHandler) Upload(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	wsID, err := uuid.Parse(chi.URLParam(r, "workspaceID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid workspace id")
		return
	}
	if err := h.limitUpload(w, r); err != nil {
		httpjson.Error(w, http.StatusRequestEntityTooLarge, "payload too large")
		return
	}

	var parentID *uuid.UUID
	if p := r.URL.Query().Get("parent_id"); p != "" {
		id, err := uuid.Parse(p)
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, "invalid parent_id")
			return
		}
		parentID = &id
	}
	// Permission errors take precedence over validation errors (as before).
	if err := h.App.RequireUploadTarget(r.Context(), wsID, parentID, user.ID); err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}

	name := sanitizeName(r.URL.Query().Get("name"))
	if name == "" {
		name = sanitizeName(r.Header.Get("X-File-Name"))
	}
	if name == "" {
		httpjson.Error(w, http.StatusBadRequest, "name required")
		return
	}
	size := r.ContentLength
	if size < 0 {
		size = -1
	}
	res, err := h.App.StoreFile(r.Context(), app.StoreFileParams{
		WorkspaceID: wsID,
		ParentID:    parentID,
		Name:        name,
		ContentType: r.Header.Get("Content-Type"),
		ActorID:     user.ID,
		Body:        r.Body,
		Size:        size,
	})
	if err != nil {
		status, msg := storeFileHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	if res.Created {
		httpjson.Write(w, http.StatusCreated, res.Node)
		return
	}
	httpjson.Write(w, http.StatusOK, res.Node)
}

// storeFileHTTPError maps app.StoreFile errors to HTTP status + message.
func storeFileHTTPError(err error) (int, string) {
	switch {
	case errors.Is(err, app.ErrQuotaExceeded):
		return http.StatusRequestEntityTooLarge, "storage quota exceeded"
	case isUploadTooLarge(err):
		return http.StatusRequestEntityTooLarge, "payload too large"
	case errors.Is(err, app.ErrNameRequired):
		return http.StatusBadRequest, "name required"
	case errors.Is(err, app.ErrNameConflict):
		return http.StatusConflict, "name already exists"
	case errors.Is(err, app.ErrNotFound), errors.Is(err, app.ErrForbidden), errors.Is(err, app.ErrWorkspaceMismatch):
		return app.WriteHTTPError(err)
	case errors.Is(err, app.ErrStorageWrite):
		return http.StatusInternalServerError, "upload failed"
	default:
		return http.StatusInternalServerError, "could not save file"
	}
}

func (h *FileHandler) Download(w http.ResponseWriter, r *http.Request) {
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
	err = h.App.DB.QueryRow(r.Context(), `
		SELECT workspace_id, name, kind, storage_key, mime FROM nodes WHERE id = $1 AND deleted_at IS NULL
	`, nodeID).Scan(&workspaceID, &name, &kind, &storageKey, &mime)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
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
	_, _ = io.Copy(w, rc)
}

type renameRequest struct {
	Name     string     `json:"name"`
	ParentID *uuid.UUID `json:"parent_id"`
	Move     bool       `json:"move"`
}

func (h *FileHandler) RenameOrMove(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	nodeID, err := uuid.Parse(chi.URLParam(r, "nodeID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid node id")
		return
	}
	sourceWS, err := h.App.RequireNodeAccess(r.Context(), nodeID, user.ID, true)
	if err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	var req renameRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	var currentName string
	err = h.App.DB.QueryRow(r.Context(), `SELECT name FROM nodes WHERE id = $1 AND deleted_at IS NULL`, nodeID).Scan(&currentName)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	name := sanitizeName(req.Name)
	if name == "" {
		name = currentName
	}
	if req.ParentID != nil {
		if req.Move && *req.ParentID == nodeID {
			httpjson.Error(w, http.StatusBadRequest, "cannot move into itself")
			return
		}
		if err := h.App.RequireParentInWorkspace(r.Context(), *req.ParentID, sourceWS, user.ID, true); err != nil {
			status, msg := app.WriteHTTPError(err)
			httpjson.Error(w, status, msg)
			return
		}
		if req.Move {
			inside, err := h.App.IsSelfOrDescendant(r.Context(), *req.ParentID, nodeID)
			if err != nil {
				httpjson.Error(w, http.StatusInternalServerError, "query failed")
				return
			}
			if inside {
				httpjson.Error(w, http.StatusBadRequest, "cannot move a folder into itself")
				return
			}
		}
	} else if req.Move {
		// Moving to the workspace root needs membership: a write share on a
		// folder must not let its grantee move items out of the shared tree.
		if err := h.App.RequireWorkspaceAccess(r.Context(), sourceWS, user.ID, true); err != nil {
			status, msg := app.WriteHTTPError(err)
			httpjson.Error(w, status, msg)
			return
		}
	}

	var n models.Node
	if req.Move {
		err = h.App.DB.QueryRow(r.Context(), `
			UPDATE nodes SET name = $1, parent_id = $2, updated_at = now()
			WHERE id = $3 AND deleted_at IS NULL
			RETURNING id, workspace_id, parent_id, name, kind, size, mime, checksum, created_by, created_at, updated_at
		`, name, req.ParentID, nodeID).Scan(
			&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt,
		)
	} else {
		err = h.App.DB.QueryRow(r.Context(), `
			UPDATE nodes SET name = $1, parent_id = COALESCE($2, parent_id), updated_at = now()
			WHERE id = $3 AND deleted_at IS NULL
			RETURNING id, workspace_id, parent_id, name, kind, size, mime, checksum, created_by, created_at, updated_at
		`, name, req.ParentID, nodeID).Scan(
			&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt,
		)
	}
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			httpjson.Error(w, http.StatusConflict, "name already exists")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "update failed")
		return
	}
	httpjson.Write(w, http.StatusOK, n)
}

func (h *FileHandler) Delete(w http.ResponseWriter, r *http.Request) {
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

	// Soft-delete node and all descendants
	_, err = h.App.DB.Exec(r.Context(), `
		WITH RECURSIVE tree AS (
			SELECT id FROM nodes WHERE id = $1 AND deleted_at IS NULL
			UNION ALL
			SELECT n.id FROM nodes n
			JOIN tree t ON n.parent_id = t.id
			WHERE n.deleted_at IS NULL
		)
		UPDATE nodes SET deleted_at = now(), updated_at = now()
		WHERE id IN (SELECT id FROM tree)
	`, nodeID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "delete failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *FileHandler) Trash(w http.ResponseWriter, r *http.Request) {
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
	limit, offset := parsePage(r)
	fetch := limit + 1
	rows, err := h.App.DB.Query(r.Context(), `
		SELECT id, workspace_id, parent_id, name, kind, size, mime, checksum, created_by, created_at, updated_at, deleted_at
		FROM nodes
		WHERE workspace_id = $1 AND deleted_at IS NOT NULL
		  AND (parent_id IS NULL OR parent_id NOT IN (
		    SELECT id FROM nodes WHERE workspace_id = $1 AND deleted_at IS NOT NULL
		  ))
		ORDER BY deleted_at DESC
		LIMIT $2 OFFSET $3
	`, wsID, fetch, offset)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	nodes := []models.Node{}
	for rows.Next() {
		var n models.Node
		if err := rows.Scan(&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt, &n.DeletedAt); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		nodes = append(nodes, n)
	}
	hasMore := len(nodes) > limit
	if hasMore {
		nodes = nodes[:limit]
	}
	nextOffset := 0
	if hasMore {
		nextOffset = offset + limit
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"items":       nodes,
		"has_more":    hasMore,
		"next_offset": nextOffset,
	})
}

func (h *FileHandler) Restore(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	nodeID, err := uuid.Parse(chi.URLParam(r, "nodeID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid node id")
		return
	}
	var workspaceID uuid.UUID
	var parentID *uuid.UUID
	err = h.App.DB.QueryRow(r.Context(), `
		SELECT workspace_id, parent_id FROM nodes WHERE id = $1 AND deleted_at IS NOT NULL
	`, nodeID).Scan(&workspaceID, &parentID)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	if err := h.App.RequireWorkspaceAccess(r.Context(), workspaceID, user.ID, true); err != nil {
		// Someone with a write share may undo their own delete inside the
		// shared folder: write access to the (live) parent is enough.
		if !errors.Is(err, app.ErrForbidden) || parentID == nil {
			status, msg := app.WriteHTTPError(err)
			httpjson.Error(w, status, msg)
			return
		}
		if _, perr := h.App.RequireNodeAccess(r.Context(), *parentID, user.ID, true); perr != nil {
			status, msg := app.WriteHTTPError(perr)
			httpjson.Error(w, status, msg)
			return
		}
	}
	_, err = h.App.DB.Exec(r.Context(), `
		WITH RECURSIVE tree AS (
			SELECT id FROM nodes WHERE id = $1
			UNION ALL
			SELECT n.id FROM nodes n
			JOIN tree t ON n.parent_id = t.id
			WHERE n.deleted_at IS NOT NULL
		)
		UPDATE nodes SET deleted_at = NULL, updated_at = now()
		WHERE id IN (SELECT id FROM tree)
	`, nodeID)
	if err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			httpjson.Error(w, http.StatusConflict, "name conflict — rename or clear the live path first")
			return
		}
		httpjson.Error(w, http.StatusInternalServerError, "restore failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *FileHandler) EmptyTrash(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	wsID, err := uuid.Parse(chi.URLParam(r, "workspaceID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid workspace id")
		return
	}
	if err := h.App.RequireWorkspaceAccess(r.Context(), wsID, user.ID, true); err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	rows, err := h.App.DB.Query(r.Context(), `
		SELECT id FROM nodes
		WHERE workspace_id = $1 AND deleted_at IS NOT NULL
		  AND (parent_id IS NULL OR parent_id NOT IN (
		    SELECT id FROM nodes WHERE workspace_id = $1 AND deleted_at IS NOT NULL
		  ))
	`, wsID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	var roots []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		roots = append(roots, id)
	}
	purged := 0
	for _, root := range roots {
		if err := h.App.PurgeDeletedNode(r.Context(), root); err != nil {
			continue
		}
		purged++
	}
	httpjson.Write(w, http.StatusOK, map[string]any{"status": "ok", "purged": purged})
}

func (h *FileHandler) Purge(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	nodeID, err := uuid.Parse(chi.URLParam(r, "nodeID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid node id")
		return
	}
	var workspaceID uuid.UUID
	err = h.App.DB.QueryRow(r.Context(), `
		SELECT workspace_id FROM nodes WHERE id = $1 AND deleted_at IS NOT NULL
	`, nodeID).Scan(&workspaceID)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	if err := h.App.RequireWorkspaceAccess(r.Context(), workspaceID, user.ID, true); err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	if err := h.App.PurgeDeletedNode(r.Context(), nodeID); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "purge failed")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *FileHandler) Thumb(w http.ResponseWriter, r *http.Request) {
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
	var workspaceID uuid.UUID
	var thumbKey *string
	var storageKey *string
	var mime *string
	err = h.App.DB.QueryRow(r.Context(), `
		SELECT workspace_id, thumb_key, storage_key, mime FROM nodes
		WHERE id = $1 AND deleted_at IS NULL AND kind = 'file'
	`, nodeID).Scan(&workspaceID, &thumbKey, &storageKey, &mime)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "not found")
		return
	}
	store, err := h.App.StoreForWorkspace(r.Context(), workspaceID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "storage unavailable")
		return
	}
	key := ""
	if thumbKey != nil && *thumbKey != "" {
		key = *thumbKey
	} else if storageKey != nil && *storageKey != "" {
		// Lazy generate
		ct := ""
		if mime != nil {
			ct = *mime
		}
		h.App.GenerateThumbnail(r.Context(), workspaceID, nodeID, ct, *storageKey)
		_ = h.App.DB.QueryRow(r.Context(), `SELECT thumb_key FROM nodes WHERE id = $1`, nodeID).Scan(&thumbKey)
		if thumbKey != nil {
			key = *thumbKey
		}
	}
	if key == "" {
		httpjson.Error(w, http.StatusNotFound, "no thumbnail")
		return
	}
	rc, meta, err := store.Get(r.Context(), key)
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "no thumbnail")
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	if meta != nil && meta.Size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(meta.Size, 10))
	}
	_, _ = io.Copy(w, rc)
}

func (h *FileHandler) GetSharedWithMe(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	limit, offset := parsePage(r)
	fetch := limit + 1
	rows, err := h.App.DB.Query(r.Context(), `
		SELECT n.id, n.workspace_id, n.parent_id, n.name, n.kind, n.size, n.mime, n.checksum, n.created_by, n.created_at, n.updated_at,
		       CASE WHEN MAX(CASE WHEN s.permission = 'write' THEN 1 ELSE 0 END) = 1 THEN 'write' ELSE 'read' END
		FROM shares s
		JOIN nodes n ON n.id = s.node_id
		WHERE n.deleted_at IS NULL
		  AND (
		    s.grantee_user_id = $1
		    OR s.grantee_workspace_id IN (
		      SELECT workspace_id FROM workspace_members WHERE user_id = $1
		    )
		  )
		GROUP BY n.id, n.workspace_id, n.parent_id, n.name, n.kind, n.size, n.mime, n.checksum, n.created_by, n.created_at, n.updated_at
		ORDER BY n.name ASC
		LIMIT $2 OFFSET $3
	`, user.ID, fetch, offset)
	if err != nil {
		h.App.Log().Error("shared-with-me query", "err", err)
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	nodes := []models.Node{}
	for rows.Next() {
		var n models.Node
		var perm string
		if err := rows.Scan(
			&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt, &perm,
		); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		n.Permission = &perm
		nodes = append(nodes, n)
	}
	hasMore := len(nodes) > limit
	if hasMore {
		nodes = nodes[:limit]
	}
	nextOffset := 0
	if hasMore {
		nextOffset = offset + limit
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"items":       nodes,
		"has_more":    hasMore,
		"next_offset": nextOffset,
	})
}

func sanitizeName(name string) string {
	return app.SanitizeName(name)
}

func max64(v, min int64) int64 {
	if v < min {
		return min
	}
	return v
}
