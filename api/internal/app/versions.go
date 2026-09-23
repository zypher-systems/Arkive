package app

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/arkive/arkive/internal/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	settingMaxVersions = "max_versions_per_file"
	// DefaultMaxVersionsPerFile is used when the instance setting is unset.
	DefaultMaxVersionsPerFile = 10
	// MaxVersionsLimit is the highest value an admin may configure.
	MaxVersionsLimit = 100
)

var ErrInvalidSetting = errors.New("invalid setting value")

// MaxVersionsPerFile returns how many old versions are kept per file (0 = none).
func (a *App) MaxVersionsPerFile(ctx context.Context) int {
	raw, err := a.getSetting(ctx, settingMaxVersions)
	if err != nil || strings.TrimSpace(raw) == "" {
		return DefaultMaxVersionsPerFile
	}
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || n < 0 {
		return DefaultMaxVersionsPerFile
	}
	if n > MaxVersionsLimit {
		return MaxVersionsLimit
	}
	return n
}

// SetMaxVersionsPerFile stores the retention setting. Lowering it prunes lazily
// (on the next write to a file and in the hourly background job).
func (a *App) SetMaxVersionsPerFile(ctx context.Context, n int) error {
	if n < 0 || n > MaxVersionsLimit {
		return fmt.Errorf("%w: max_versions must be between 0 and %d", ErrInvalidSetting, MaxVersionsLimit)
	}
	return a.setSetting(ctx, settingMaxVersions, strconv.Itoa(n))
}

// ArchiveCurrentVersion copies the current file blob metadata into node_versions
// before an overwrite, then prunes to the retention limit. Does nothing if the
// node is not a file with a storage key. Pruning never deletes a blob that is
// still some node's current content, so callers that update the node after
// calling this cannot lose data (with retention 0 the superseded blob is
// reclaimed by the orphan GC instead).
func (a *App) ArchiveCurrentVersion(ctx context.Context, nodeID, actorID uuid.UUID) error {
	if _, err := a.archiveVersion(ctx, a.DB, nodeID, actorID); err != nil {
		return err
	}
	return a.pruneVersions(ctx, nodeID)
}

type dbQuerier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// archiveVersion inserts the node's current blob as the next version row.
// It returns false when there was nothing to archive.
func (a *App) archiveVersion(ctx context.Context, q dbQuerier, nodeID, actorID uuid.UUID) (bool, error) {
	var kind string
	var storageKey *string
	var size int64
	var mime *string
	err := q.QueryRow(ctx, `
		SELECT kind, storage_key, size, mime FROM nodes WHERE id = $1 AND deleted_at IS NULL
	`, nodeID).Scan(&kind, &storageKey, &size, &mime)
	if err != nil {
		return false, err
	}
	if kind != "file" || storageKey == nil || *storageKey == "" {
		return false, nil
	}
	var next int
	err = q.QueryRow(ctx, `
		SELECT COALESCE(MAX(version), 0) + 1 FROM node_versions WHERE node_id = $1
	`, nodeID).Scan(&next)
	if err != nil {
		return false, err
	}
	var actor *uuid.UUID
	if actorID != uuid.Nil {
		actor = &actorID
	}
	_, err = q.Exec(ctx, `
		INSERT INTO node_versions (node_id, version, storage_key, size, mime, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, nodeID, next, *storageKey, size, mime, actor)
	if err != nil {
		return false, err
	}
	return true, nil
}

// PruneNodeVersions trims a file's history to the configured retention.
func (a *App) PruneNodeVersions(ctx context.Context, nodeID uuid.UUID) error {
	return a.pruneVersions(ctx, nodeID)
}

func (a *App) pruneVersions(ctx context.Context, nodeID uuid.UUID) error {
	keep := a.MaxVersionsPerFile(ctx)
	rows, err := a.DB.Query(ctx, `
		SELECT id, storage_key FROM node_versions
		WHERE node_id = $1
		ORDER BY version DESC
		OFFSET $2
	`, nodeID, keep)
	if err != nil {
		return err
	}
	type old struct {
		id  uuid.UUID
		key string
	}
	var outdated []old
	for rows.Next() {
		var o old
		if err := rows.Scan(&o.id, &o.key); err != nil {
			rows.Close()
			return err
		}
		outdated = append(outdated, o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
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
		// Only delete the blob when nothing else references it: the node may
		// still point at it mid-overwrite (retention 0), or rows may share keys.
		var inUse bool
		if err := a.DB.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM nodes WHERE storage_key = $1)
			    OR EXISTS (SELECT 1 FROM node_versions WHERE storage_key = $1 AND id <> $2)
		`, o.key, o.id).Scan(&inUse); err != nil {
			return err
		}
		if !inUse {
			if err := store.Delete(ctx, o.key); err != nil {
				a.log().Warn("version blob delete failed", "node_id", nodeID, "version_id", o.id, "key", o.key, "err", err)
				return fmt.Errorf("delete version blob: %w", err)
			}
		}
		if _, err := a.DB.Exec(ctx, `DELETE FROM node_versions WHERE id = $1`, o.id); err != nil {
			a.log().Warn("version row delete failed", "node_id", nodeID, "version_id", o.id, "err", err)
			return err
		}
	}
	return nil
}

// PruneAllVersions applies the retention setting to every file that has too
// many versions (hourly job; makes a lowered setting take effect everywhere).
// It returns the number of files pruned.
func (a *App) PruneAllVersions(ctx context.Context) (int, error) {
	keep := a.MaxVersionsPerFile(ctx)
	rows, err := a.DB.Query(ctx, `
		SELECT node_id FROM node_versions GROUP BY node_id HAVING COUNT(*) > $1 LIMIT 5000
	`, keep)
	if err != nil {
		return 0, err
	}
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	n := 0
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return n, err
		}
		if err := a.pruneVersions(ctx, id); err != nil {
			a.log().Warn("version prune failed", "node_id", id, "err", err)
			continue
		}
		n++
	}
	return n, nil
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
	var workspaceID uuid.UUID
	if err := a.DB.QueryRow(ctx, `SELECT workspace_id FROM nodes WHERE id = $1`, nodeID).Scan(&workspaceID); err != nil {
		return err
	}
	// Copy the version blob to a new key first (version history stays immutable,
	// and pruning below can never remove the source before it is copied).
	rc, meta, err := store.Get(ctx, vKey)
	if err != nil {
		return err
	}
	newKey := StorageKey(workspaceID, uuid.New())
	ct := "application/octet-stream"
	if vMime != nil && *vMime != "" {
		ct = *vMime
	} else if meta.ContentType != "" {
		ct = meta.ContentType
	}
	err = store.Put(ctx, newKey, rc, meta.Size, ct)
	_ = rc.Close()
	if err != nil {
		_ = store.Delete(ctx, newKey)
		return err
	}

	tx, err := a.DB.Begin(ctx)
	if err != nil {
		_ = store.Delete(ctx, newKey)
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT 1 FROM nodes WHERE id = $1 FOR UPDATE`, nodeID); err != nil {
		_ = store.Delete(ctx, newKey)
		return err
	}
	if _, err := a.archiveVersion(ctx, tx, nodeID, actorID); err != nil {
		_ = store.Delete(ctx, newKey)
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE nodes SET storage_key = $1, size = $2, mime = $3, thumb_key = NULL, content_text = NULL, updated_at = now()
		WHERE id = $4
	`, newKey, vSize, vMime, nodeID); err != nil {
		_ = store.Delete(ctx, newKey)
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		_ = store.Delete(ctx, newKey)
		return err
	}
	if err := a.pruneVersions(ctx, nodeID); err != nil {
		a.log().Warn("version prune after restore failed", "node_id", nodeID, "err", err)
	}
	a.SchedulePostUpload(workspaceID, nodeID, ct, newKey)
	return nil
}

func (a *App) NextVersionNumber(ctx context.Context, nodeID uuid.UUID) (int, error) {
	var n int
	err := a.DB.QueryRow(ctx, `SELECT COALESCE(MAX(version), 0) + 1 FROM node_versions WHERE node_id = $1`, nodeID).Scan(&n)
	return n, err
}

func VersionStorageKey(workspaceID, nodeID uuid.UUID, version int) string {
	return fmt.Sprintf("%s/%s.v%d", workspaceID.String(), nodeID.String(), version)
}
