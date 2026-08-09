package app

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

// EnsureDriveMount returns the user's Google Drive mount workspace for backendID,
// creating it (type=mount, owner membership) if missing.
func (a *App) EnsureDriveMount(ctx context.Context, userID, backendID uuid.UUID) (uuid.UUID, error) {
	var wsID uuid.UUID
	err := a.DB.QueryRow(ctx, `
		SELECT w.id
		FROM workspaces w
		JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1 AND m.role = 'owner'
		WHERE w.type = 'mount' AND w.storage_backend_id = $2
		LIMIT 1
	`, userID, backendID).Scan(&wsID)
	if err == nil {
		return wsID, nil
	}

	// Reuse an existing Drive mount that lost its backend pointer (e.g. after disconnect).
	err = a.DB.QueryRow(ctx, `
		SELECT w.id
		FROM workspaces w
		JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1 AND m.role = 'owner'
		WHERE w.type = 'mount' AND w.name = 'Google Drive'
		ORDER BY w.created_at ASC
		LIMIT 1
	`, userID).Scan(&wsID)
	if err == nil {
		_, err = a.DB.Exec(ctx, `
			UPDATE workspaces SET storage_backend_id = $1 WHERE id = $2
		`, backendID, wsID)
		if err != nil {
			return uuid.Nil, fmt.Errorf("reattach drive mount: %w", err)
		}
		return wsID, nil
	}

	return a.EnsureNamedMount(ctx, userID, backendID, "Google Drive")
}

// EnsureDriveMountsForUser creates mount workspaces for every user-owned cloud connection.
func (a *App) EnsureDriveMountsForUser(ctx context.Context, userID uuid.UUID) error {
	rows, err := a.DB.Query(ctx, `
		SELECT id, type, name FROM storage_backends
		WHERE owner_user_id = $1 AND type IN ('gdrive', 'webdav', 'internxt')
	`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var backendID uuid.UUID
		var typ, name string
		if err := rows.Scan(&backendID, &typ, &name); err != nil {
			return err
		}
		mountName := name
		if typ == "gdrive" {
			mountName = "Google Drive"
		}
		if _, err := a.EnsureNamedMount(ctx, userID, backendID, mountName); err != nil {
			return err
		}
	}
	return rows.Err()
}

// EnsureNamedMount is like EnsureDriveMount but with a custom workspace name.
func (a *App) EnsureNamedMount(ctx context.Context, userID, backendID uuid.UUID, name string) (uuid.UUID, error) {
	if name == "" {
		name = "Cloud"
	}
	var wsID uuid.UUID
	err := a.DB.QueryRow(ctx, `
		SELECT w.id
		FROM workspaces w
		JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1 AND m.role = 'owner'
		WHERE w.type = 'mount' AND w.storage_backend_id = $2
		LIMIT 1
	`, userID, backendID).Scan(&wsID)
	if err == nil {
		return wsID, nil
	}

	err = a.DB.QueryRow(ctx, `
		SELECT w.id
		FROM workspaces w
		JOIN workspace_members m ON m.workspace_id = w.id AND m.user_id = $1 AND m.role = 'owner'
		WHERE w.type = 'mount' AND w.name = $2
		ORDER BY w.created_at ASC
		LIMIT 1
	`, userID, name).Scan(&wsID)
	if err == nil {
		_, err = a.DB.Exec(ctx, `UPDATE workspaces SET storage_backend_id = $1 WHERE id = $2`, backendID, wsID)
		if err != nil {
			return uuid.Nil, err
		}
		return wsID, nil
	}

	wsID = uuid.New()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `
		INSERT INTO workspaces (id, type, name, storage_backend_id)
		VALUES ($1, 'mount', $2, $3)
	`, wsID, name, backendID)
	if err != nil {
		return uuid.Nil, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
	`, wsID, userID)
	if err != nil {
		return uuid.Nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return wsID, nil
}
