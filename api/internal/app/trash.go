package app

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

const settingTrashRetentionDays = "trash_retention_days"
const defaultTrashRetentionDays = 30

// TrashRetentionDays returns auto-purge retention in days. 0 disables auto-purge.
func (a *App) TrashRetentionDays(ctx context.Context) int {
	raw, err := a.getSetting(ctx, settingTrashRetentionDays)
	if err != nil || strings.TrimSpace(raw) == "" {
		return defaultTrashRetentionDays
	}
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n < 0 {
		return defaultTrashRetentionDays
	}
	return n
}

// CollectNodeStorageKeys returns blob keys (current, thumbs, versions) under a node tree.
func (a *App) CollectNodeStorageKeys(ctx context.Context, root uuid.UUID) ([]string, error) {
	rows, err := a.DB.Query(ctx, `
		WITH RECURSIVE tree AS (
			SELECT id, kind, storage_key, thumb_key FROM nodes WHERE id = $1
			UNION ALL
			SELECT n.id, n.kind, n.storage_key, n.thumb_key FROM nodes n
			JOIN tree t ON n.parent_id = t.id
		)
		SELECT storage_key FROM tree WHERE kind = 'file' AND storage_key IS NOT NULL
		UNION ALL
		SELECT thumb_key FROM tree WHERE thumb_key IS NOT NULL
		UNION ALL
		SELECT nv.storage_key FROM node_versions nv
		JOIN tree t ON nv.node_id = t.id
		WHERE nv.storage_key IS NOT NULL
	`, root)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, rows.Err()
}

// PurgeDeletedNode hard-deletes a soft-deleted node tree and its storage objects.
func (a *App) PurgeDeletedNode(ctx context.Context, nodeID uuid.UUID) error {
	var workspaceID uuid.UUID
	err := a.DB.QueryRow(ctx, `
		SELECT workspace_id FROM nodes WHERE id = $1 AND deleted_at IS NOT NULL
	`, nodeID).Scan(&workspaceID)
	if err != nil {
		return err
	}
	keys, err := a.CollectNodeStorageKeys(ctx, nodeID)
	if err != nil {
		return err
	}
	store, err := a.StoreForWorkspace(ctx, workspaceID)
	if err != nil {
		return err
	}
	// Delete blobs first so a failed storage delete leaves the soft-deleted row for retry.
	for _, key := range keys {
		if err := store.Delete(ctx, key); err != nil {
			if a.Logger != nil {
				a.Logger.Warn("trash blob delete failed", "node_id", nodeID, "key", key, "err", err)
			}
			return fmt.Errorf("delete storage object: %w", err)
		}
	}
	if _, err := a.DB.Exec(ctx, `DELETE FROM nodes WHERE id = $1`, nodeID); err != nil {
		return err
	}
	return nil
}

// PurgeExpiredTrash hard-deletes trash roots older than the retention window.
func (a *App) PurgeExpiredTrash(ctx context.Context) (int, error) {
	days := a.TrashRetentionDays(ctx)
	if days <= 0 {
		return 0, nil
	}
	rows, err := a.DB.Query(ctx, `
		SELECT id FROM nodes
		WHERE deleted_at IS NOT NULL
		  AND deleted_at < now() - make_interval(days => $1)
		  AND (parent_id IS NULL OR parent_id NOT IN (
		    SELECT id FROM nodes WHERE deleted_at IS NOT NULL
		  ))
	`, days)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var roots []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		roots = append(roots, id)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	purged := 0
	for _, root := range roots {
		if err := a.PurgeDeletedNode(ctx, root); err != nil {
			a.Logger.Warn("trash purge failed", "node_id", root, "err", err)
			continue
		}
		purged++
	}
	return purged, nil
}
