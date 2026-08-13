package app

import (
	"context"
	"fmt"

	"github.com/arkive/arkive/internal/storage"
	"github.com/google/uuid"
)

// migrateFlipOverride, when set, replaces the destination backend id used for
// the pointer flip. Tests use it to force a failed flip after a successful copy.
var migrateFlipOverride *uuid.UUID

type MigrateResult struct {
	Migrated bool      `json:"migrated"`
	Copied   int       `json:"copied"`
	Total    int       `json:"total"`
	Backend  uuid.UUID `json:"storage_backend_id"`
}

type MigrateError struct {
	Message   string
	Copied    int
	Total     int
	FailedKey string
}

func (e *MigrateError) Error() string {
	if e.FailedKey != "" {
		return fmt.Sprintf("%s (copied %d/%d, failed_key=%s)", e.Message, e.Copied, e.Total, e.FailedKey)
	}
	return fmt.Sprintf("%s (copied %d/%d)", e.Message, e.Copied, e.Total)
}

// MigrateWorkspaceStorage copies all blob keys for a workspace to newBackendID,
// then updates workspaces.storage_backend_id. On copy failure the backend is unchanged.
func (a *App) MigrateWorkspaceStorage(ctx context.Context, workspaceID, newBackendID uuid.UUID) (*MigrateResult, error) {
	var current *uuid.UUID
	err := a.DB.QueryRow(ctx, `SELECT storage_backend_id FROM workspaces WHERE id = $1`, workspaceID).Scan(&current)
	if err != nil {
		return nil, fmt.Errorf("workspace not found")
	}
	oldBackendID := current
	if oldBackendID == nil {
		id, err := a.DefaultBackendID(ctx)
		if err != nil {
			return nil, err
		}
		oldBackendID = &id
	}
	if *oldBackendID == newBackendID {
		_, err = a.DB.Exec(ctx, `UPDATE workspaces SET storage_backend_id = $1 WHERE id = $2`, newBackendID, workspaceID)
		if err != nil {
			return nil, err
		}
		return &MigrateResult{Migrated: false, Copied: 0, Total: 0, Backend: newBackendID}, nil
	}

	keys, err := a.workspaceStorageKeys(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	total := len(keys)
	if total == 0 {
		_, err = a.DB.Exec(ctx, `UPDATE workspaces SET storage_backend_id = $1 WHERE id = $2`, newBackendID, workspaceID)
		if err != nil {
			return nil, err
		}
		return &MigrateResult{Migrated: true, Copied: 0, Total: 0, Backend: newBackendID}, nil
	}

	oldStore, err := a.StoreForBackend(ctx, *oldBackendID)
	if err != nil {
		return nil, fmt.Errorf("open source storage: %w", err)
	}
	newStore, err := a.StoreForBackend(ctx, newBackendID)
	if err != nil {
		return nil, fmt.Errorf("open destination storage: %w", err)
	}

	copied := 0
	for _, key := range keys {
		// Skip if already on destination.
		if rc, _, gerr := newStore.Get(ctx, key); gerr == nil {
			_ = rc.Close()
			copied++
			continue
		}
		rc, meta, gerr := oldStore.Get(ctx, key)
		if gerr != nil {
			a.deleteStoreKeys(ctx, newStore, keys)
			return nil, &MigrateError{
				Message:   "failed to read source object",
				Copied:    copied,
				Total:     total,
				FailedKey: key,
			}
		}
		size := int64(-1)
		ct := "application/octet-stream"
		if meta != nil {
			size = meta.Size
			if meta.ContentType != "" {
				ct = meta.ContentType
			}
		}
		perr := newStore.Put(ctx, key, rc, size, ct)
		_ = rc.Close()
		if perr != nil {
			a.deleteStoreKeys(ctx, newStore, keys)
			return nil, &MigrateError{
				Message:   "failed to write destination object",
				Copied:    copied,
				Total:     total,
				FailedKey: key,
			}
		}
		copied++
	}

	flipTo := newBackendID
	if migrateFlipOverride != nil {
		flipTo = *migrateFlipOverride
	}
	_, err = a.DB.Exec(ctx, `UPDATE workspaces SET storage_backend_id = $1 WHERE id = $2`, flipTo, workspaceID)
	if err != nil {
		// Compensating cleanup: destination holds duplicates while DB still points at old.
		a.deleteStoreKeys(ctx, newStore, keys)
		return nil, err
	}

	// Leave source objects in place. Deleting them here risks data loss if the
	// pointer flip is later rolled back; a sweeper can reclaim them later.
	_ = oldStore

	return &MigrateResult{Migrated: true, Copied: copied, Total: total, Backend: newBackendID}, nil
}

func (a *App) deleteStoreKeys(ctx context.Context, store storage.BlobStore, keys []string) {
	for _, key := range keys {
		if derr := store.Delete(ctx, key); derr != nil && a.Logger != nil {
			a.Logger.Warn("migrate dest cleanup failed", "key", key, "err", derr)
		}
	}
}

func (a *App) workspaceStorageKeys(ctx context.Context, workspaceID uuid.UUID) ([]string, error) {
	rows, err := a.DB.Query(ctx, `
		SELECT DISTINCT key FROM (
			SELECT storage_key AS key FROM nodes
			WHERE workspace_id = $1 AND kind = 'file' AND storage_key IS NOT NULL AND storage_key <> ''
			UNION
			SELECT v.storage_key AS key FROM node_versions v
			INNER JOIN nodes n ON n.id = v.node_id
			WHERE n.workspace_id = $1 AND v.storage_key IS NOT NULL AND v.storage_key <> ''
		) keys
		ORDER BY key
	`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		out = append(out, key)
	}
	return out, rows.Err()
}
