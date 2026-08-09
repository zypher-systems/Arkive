package app

import (
	"context"
	"fmt"

	"github.com/arkive/arkive/internal/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const MaxVersionsPerFile = 10

// ArchiveCurrentVersion copies the current file blob metadata into node_versions
// before an overwrite. Does nothing if the node is not a file with a storage key.
func (a *App) ArchiveCurrentVersion(ctx context.Context, nodeID, actorID uuid.UUID) error {
	var kind string
	var storageKey *string
	var size int64
	var mime *string
	err := a.DB.QueryRow(ctx, `
		SELECT kind, storage_key, size, mime FROM nodes WHERE id = $1 AND deleted_at IS NULL
	`, nodeID).Scan(&kind, &storageKey, &size, &mime)
	if err != nil {
		return err
	}
	if kind != "file" || storageKey == nil || *storageKey == "" {
		return nil
	}

	var next int
	err = a.DB.QueryRow(ctx, `
		SELECT COALESCE(MAX(version), 0) + 1 FROM node_versions WHERE node_id = $1
	`, nodeID).Scan(&next)
	if err != nil {
		return err
	}
	_, err = a.DB.Exec(ctx, `
		INSERT INTO node_versions (node_id, version, storage_key, size, mime, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, nodeID, next, *storageKey, size, mime, actorID)
	if err != nil {
		return err
	}
	return a.pruneVersions(ctx, nodeID)
}

func (a *App) pruneVersions(ctx context.Context, nodeID uuid.UUID) error {
	rows, err := a.DB.Query(ctx, `
		SELECT id, storage_key FROM node_versions
		WHERE node_id = $1
		ORDER BY version DESC
		OFFSET $2
	`, nodeID, MaxVersionsPerFile)
	if err != nil {
		return err
	}
	defer rows.Close()

	type old struct {
		id  uuid.UUID
		key string
	}
	var outdated []old
	for rows.Next() {
		var o old
		if err := rows.Scan(&o.id, &o.key); err != nil {
			return err
		}
		outdated = append(outdated, o)
	}
	if len(outdated) == 0 {
		return nil
	}

	var workspaceID uuid.UUID
	if err := a.DB.QueryRow(ctx, `SELECT workspace_id FROM nodes WHERE id = $1`, nodeID).Scan(&workspaceID); err != nil {
		return err
	}
	store, err := a.StoreForWorkspace(ctx, workspaceID)
	if err != nil {
		return err
	}
	for _, o := range outdated {
		_, _ = a.DB.Exec(ctx, `DELETE FROM node_versions WHERE id = $1`, o.id)
		_ = store.Delete(ctx, o.key)
	}
	return nil
}

// RestoreVersion makes a version the current file content (archives current first).
func (a *App) RestoreVersion(ctx context.Context, nodeID uuid.UUID, version int, actorID uuid.UUID, store storage.BlobStore) error {
	var vKey string
	var vSize int64
	var vMime *string
	err := a.DB.QueryRow(ctx, `
		SELECT storage_key, size, mime FROM node_versions WHERE node_id = $1 AND version = $2
	`, nodeID, version).Scan(&vKey, &vSize, &vMime)
	if err != nil {
		if err == pgx.ErrNoRows {
			return ErrNotFound
		}
		return err
	}
	if err := a.ArchiveCurrentVersion(ctx, nodeID, actorID); err != nil {
		return err
	}
	// Copy blob to a new key so version history stays immutable
	var workspaceID uuid.UUID
	if err := a.DB.QueryRow(ctx, `SELECT workspace_id FROM nodes WHERE id = $1`, nodeID).Scan(&workspaceID); err != nil {
		return err
	}
	rc, meta, err := store.Get(ctx, vKey)
	if err != nil {
		return err
	}
	defer rc.Close()
	newKey := StorageKey(workspaceID, uuid.New())
	ct := "application/octet-stream"
	if vMime != nil && *vMime != "" {
		ct = *vMime
	} else if meta.ContentType != "" {
		ct = meta.ContentType
	}
	if err := store.Put(ctx, newKey, rc, meta.Size, ct); err != nil {
		return err
	}
	_, err = a.DB.Exec(ctx, `
		UPDATE nodes SET storage_key = $1, size = $2, mime = $3, updated_at = now()
		WHERE id = $4
	`, newKey, vSize, vMime, nodeID)
	return err
}

func (a *App) NextVersionNumber(ctx context.Context, nodeID uuid.UUID) (int, error) {
	var n int
	err := a.DB.QueryRow(ctx, `SELECT COALESCE(MAX(version), 0) + 1 FROM node_versions WHERE node_id = $1`, nodeID).Scan(&n)
	return n, err
}

func VersionStorageKey(workspaceID, nodeID uuid.UUID, version int) string {
	return fmt.Sprintf("%s/%s.v%d", workspaceID.String(), nodeID.String(), version)
}
