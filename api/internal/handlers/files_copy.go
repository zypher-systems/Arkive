package handlers

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/db"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/models"
	"github.com/google/uuid"
)

type copyNodesRequest struct {
	NodeIDs           []uuid.UUID `json:"node_ids"`
	TargetWorkspaceID uuid.UUID   `json:"target_workspace_id"`
	TargetParentID    *uuid.UUID  `json:"target_parent_id"`
}

func (h *FileHandler) CopyNodes(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var req copyNodesRequest
	if err := httpjson.Decode(r, &req); err != nil || len(req.NodeIDs) == 0 {
		httpjson.Error(w, http.StatusBadRequest, "node_ids and target_workspace_id required")
		return
	}
	// The workspace root needs membership; a folder needs write access to it,
	// which a write share grants (pasting inside a folder shared with you).
	if req.TargetParentID == nil {
		if err := h.App.RequireWorkspaceAccess(r.Context(), req.TargetWorkspaceID, user.ID, true); err != nil {
			status, msg := app.WriteHTTPError(err)
			httpjson.Error(w, status, msg)
			return
		}
	} else {
		ws, err := h.App.RequireNodeAccess(r.Context(), *req.TargetParentID, user.ID, true)
		if err != nil {
			status, msg := app.WriteHTTPError(err)
			httpjson.Error(w, status, msg)
			return
		}
		if ws != req.TargetWorkspaceID {
			httpjson.Error(w, http.StatusBadRequest, "target parent not in workspace")
			return
		}
	}

	var need int64
	for _, id := range req.NodeIDs {
		if _, err := h.App.RequireNodeAccess(r.Context(), id, user.ID, false); err != nil {
			status, msg := app.WriteHTTPError(err)
			httpjson.Error(w, status, msg)
			return
		}
		if req.TargetParentID != nil {
			// A folder copied into itself would copy its own copy forever.
			inside, err := h.App.IsSelfOrDescendant(r.Context(), *req.TargetParentID, id)
			if err != nil {
				httpjson.Error(w, http.StatusInternalServerError, "query failed")
				return
			}
			if inside {
				httpjson.Error(w, http.StatusBadRequest, "cannot copy a folder into itself")
				return
			}
		}
		sz, err := h.App.TreeSize(r.Context(), id)
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "could not size source")
			return
		}
		need += sz
	}
	if err := h.App.EnsureQuota(r.Context(), req.TargetWorkspaceID, need, 0); err != nil {
		httpjson.Error(w, http.StatusRequestEntityTooLarge, "storage quota exceeded")
		return
	}

	created := []models.Node{}
	for _, id := range req.NodeIDs {
		n, err := h.copyNodeTree(r, id, req.TargetWorkspaceID, req.TargetParentID, user.ID)
		if err != nil {
			for _, c := range created {
				h.compensateCreatedCopy(r.Context(), req.TargetWorkspaceID, c.ID)
			}
			httpjson.Error(w, http.StatusInternalServerError, err.Error())
			return
		}
		created = append(created, n)
	}
	httpjson.Write(w, http.StatusCreated, map[string]any{"nodes": created})
}

func (h *FileHandler) copyNodeTree(r *http.Request, srcID, destWS uuid.UUID, destParent *uuid.UUID, actor uuid.UUID) (models.Node, error) {
	var src models.Node
	var storageKey *string
	err := h.App.DB.QueryRow(r.Context(), `
		SELECT id, workspace_id, parent_id, name, kind, size, mime, storage_key, checksum, created_by, created_at, updated_at
		FROM nodes WHERE id = $1 AND deleted_at IS NULL
	`, srcID).Scan(
		&src.ID, &src.WorkspaceID, &src.ParentID, &src.Name, &src.Kind, &src.Size, &src.Mime, &storageKey, &src.Checksum, &src.CreatedBy, &src.CreatedAt, &src.UpdatedAt,
	)
	if err != nil {
		return models.Node{}, err
	}

	newID := uuid.New()
	var newKey *string
	if src.Kind == "file" && storageKey != nil && *storageKey != "" {
		key := app.StorageKey(destWS, newID)
		newKey = &key
		srcStore, err := h.App.StoreForWorkspace(r.Context(), src.WorkspaceID)
		if err != nil {
			return models.Node{}, err
		}
		destStore, err := h.App.StoreForWorkspace(r.Context(), destWS)
		if err != nil {
			return models.Node{}, err
		}
		rc, meta, err := srcStore.Get(r.Context(), *storageKey)
		if err != nil {
			return models.Node{}, err
		}
		size := src.Size
		ct := "application/octet-stream"
		if meta != nil {
			if meta.Size >= 0 {
				size = meta.Size
			}
			if meta.ContentType != "" {
				ct = meta.ContentType
			}
		}
		err = destStore.Put(r.Context(), key, rc, size, ct)
		_ = rc.Close()
		if err != nil {
			return models.Node{}, err
		}
	}

	// Copying next to the original (or onto any taken name) picks "name (1)"
	// and so on, like uploads through a file request; the unique name indexes
	// make the pick race-free.
	var n models.Node
	for i := 0; i <= maxCollisionSuffix; i++ {
		name := collisionName(src.Name, i)
		if src.Kind == "folder" && i > 0 {
			name = fmt.Sprintf("%s (%d)", src.Name, i)
		}
		err = h.App.DB.QueryRow(r.Context(), `
			INSERT INTO nodes (id, workspace_id, parent_id, name, kind, size, mime, storage_key, checksum, created_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
			ON CONFLICT DO NOTHING
			RETURNING id, workspace_id, parent_id, name, kind, size, mime, checksum, created_by, created_at, updated_at
		`, newID, destWS, destParent, name, src.Kind, src.Size, src.Mime, newKey, src.Checksum, actor).Scan(
			&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt,
		)
		if !errors.Is(err, db.ErrNoRows) {
			break
		}
	}
	if err != nil {
		if newKey != nil {
			if destStore, serr := h.App.StoreForWorkspace(r.Context(), destWS); serr == nil {
				_ = destStore.Delete(r.Context(), *newKey)
			}
		}
		return models.Node{}, err
	}

	if src.Kind == "folder" {
		rows, err := h.App.DB.Query(r.Context(), `
			SELECT id FROM nodes WHERE parent_id = $1 AND deleted_at IS NULL ORDER BY name
		`, srcID)
		if err != nil {
			h.compensateCreatedCopy(r.Context(), destWS, n.ID)
			return models.Node{}, err
		}
		var children []uuid.UUID
		for rows.Next() {
			var cid uuid.UUID
			if err := rows.Scan(&cid); err != nil {
				rows.Close()
				h.compensateCreatedCopy(r.Context(), destWS, n.ID)
				return models.Node{}, err
			}
			children = append(children, cid)
		}
		rows.Close()
		for _, cid := range children {
			if _, err := h.copyNodeTree(r, cid, destWS, &n.ID, actor); err != nil {
				h.compensateCreatedCopy(r.Context(), destWS, n.ID)
				return models.Node{}, err
			}
		}
	}
	return n, nil
}

// compensateCreatedCopy removes a partially copied subtree and its blobs.
func (h *FileHandler) compensateCreatedCopy(ctx context.Context, workspaceID, rootID uuid.UUID) {
	keys, err := h.App.CollectNodeStorageKeys(ctx, rootID)
	if err == nil {
		if store, serr := h.App.StoreForWorkspace(ctx, workspaceID); serr == nil {
			for _, key := range keys {
				_ = store.Delete(ctx, key)
			}
		}
	}
	_, _ = h.App.DB.Exec(ctx, `DELETE FROM nodes WHERE id = $1`, rootID)
}
