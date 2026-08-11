package handlers

import (
	"context"
	"net/http"

	"github.com/arkive/arkive/internal/app"
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
	if err := h.App.RequireWorkspaceAccess(r.Context(), req.TargetWorkspaceID, user.ID, true); err != nil {
		status, msg := app.WriteHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	if req.TargetParentID != nil {
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

	var n models.Node
	err = h.App.DB.QueryRow(r.Context(), `
		INSERT INTO nodes (id, workspace_id, parent_id, name, kind, size, mime, storage_key, checksum, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, workspace_id, parent_id, name, kind, size, mime, checksum, created_by, created_at, updated_at
	`, newID, destWS, destParent, src.Name, src.Kind, src.Size, src.Mime, newKey, src.Checksum, actor).Scan(
		&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt,
	)
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
