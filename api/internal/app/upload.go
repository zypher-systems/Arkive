package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"io"
	"path"
	"strings"

	"github.com/arkive/arkive/internal/db"
	"github.com/arkive/arkive/internal/models"
	"github.com/google/uuid"
)

var (
	// ErrNameRequired means the (sanitized) file name is empty.
	ErrNameRequired = errors.New("name required")
	// ErrNameConflict means a folder (or a concurrent upload) holds the name.
	ErrNameConflict = errors.New("name already exists")
	// ErrStorageWrite wraps a failure writing the blob; the original error is
	// also wrapped so callers can detect size limits (http.MaxBytesError).
	ErrStorageWrite = errors.New("storage write failed")
)

// SanitizeName strips path components and traversal sequences from a
// user-supplied file or folder name.
func SanitizeName(name string) string {
	name = strings.TrimSpace(name)
	name = path.Base(name)
	name = strings.ReplaceAll(name, "..", "")
	name = strings.Trim(name, "/\\")
	if name == "." {
		// path.Base("") is "."; an empty or dot name is no name at all
		// (a rename without "name" used to rename the node to ".").
		return ""
	}
	return name
}

// StoreFileParams describes one file write into a workspace folder.
type StoreFileParams struct {
	WorkspaceID uuid.UUID
	ParentID    *uuid.UUID // nil = workspace root
	Name        string     // raw user input; sanitized here
	ContentType string
	ActorID     uuid.UUID
	Body        io.Reader
	// Size is the exact body length when known, or -1. When known, quota is
	// checked up-front; otherwise the body is cut off at the quota headroom.
	Size int64
}

// StoreFileResult is the node after the write. Created is false when an
// existing same-name file received a new version.
type StoreFileResult struct {
	Node    models.Node
	Created bool
}

// StoreFile is the single finalize path for uploads (plain PUT and tus): it
// sanitizes the name, checks write permission and quota, writes the blob,
// records a SHA-256 checksum, turns an existing same-name file into a new
// version, and queues thumbnail + search indexing.
func (a *App) StoreFile(ctx context.Context, p StoreFileParams) (StoreFileResult, error) {
	name := SanitizeName(p.Name)
	if name == "" {
		return StoreFileResult{}, ErrNameRequired
	}
	if err := a.RequireUploadTarget(ctx, p.WorkspaceID, p.ParentID, p.ActorID); err != nil {
		return StoreFileResult{}, err
	}
	contentType := strings.TrimSpace(p.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	store, err := a.StoreForWorkspace(ctx, p.WorkspaceID)
	if err != nil {
		return StoreFileResult{}, fmt.Errorf("open storage: %w", err)
	}

	existingID, existingSize, found, err := a.findFileByName(ctx, p.WorkspaceID, p.ParentID, name)
	if err != nil {
		return StoreFileResult{}, err
	}
	replace := int64(0)
	if found {
		replace = existingSize
	}

	counted := &CountingReader{R: p.Body, Limit: -1}
	sizeHint := p.Size
	if sizeHint >= 0 {
		if err := a.EnsureQuota(ctx, p.WorkspaceID, sizeHint, replace); err != nil {
			return StoreFileResult{}, err
		}
		// Never store more than announced.
		counted.Limit = sizeHint
	} else {
		remaining, unlimited, err := a.QuotaHeadroom(ctx, p.WorkspaceID, replace)
		if err != nil {
			return StoreFileResult{}, err
		}
		if !unlimited {
			counted.Limit = remaining
		}
		sizeHint = -1
	}
	hasher := sha256.New()
	body := io.TeeReader(counted, hasher)

	key := StorageKey(p.WorkspaceID, uuid.New())
	if err := store.Put(ctx, key, body, sizeHint, contentType); err != nil {
		_ = store.Delete(ctx, key)
		if errors.Is(err, ErrQuotaExceeded) {
			return StoreFileResult{}, err
		}
		return StoreFileResult{}, fmt.Errorf("%w: %w", ErrStorageWrite, err)
	}
	size := counted.N
	if sizeHint >= 0 && size != sizeHint {
		_ = store.Delete(ctx, key)
		return StoreFileResult{}, fmt.Errorf("%w: short body (%d of %d bytes)", ErrStorageWrite, size, sizeHint)
	}
	sum := checksumString(hasher)

	res, err := a.commitStoredFile(ctx, p, name, contentType, key, size, sum, found, existingID)
	if err != nil && errors.Is(err, ErrNameConflict) && !found {
		// A concurrent upload created the same name: become a new version of it.
		if id, sz, ok, ferr := a.findFileByName(ctx, p.WorkspaceID, p.ParentID, name); ferr == nil && ok {
			if qerr := a.EnsureQuota(ctx, p.WorkspaceID, size, sz); qerr != nil {
				_ = store.Delete(ctx, key)
				return StoreFileResult{}, qerr
			}
			res, err = a.commitStoredFile(ctx, p, name, contentType, key, size, sum, true, id)
		}
	}
	if err != nil {
		_ = store.Delete(ctx, key)
		return StoreFileResult{}, err
	}
	if !res.Created {
		if perr := a.pruneVersions(ctx, res.Node.ID); perr != nil {
			a.log().Warn("version prune after upload failed", "node_id", res.Node.ID, "err", perr)
		}
	}
	a.SchedulePostUpload(p.WorkspaceID, res.Node.ID, contentType, key)
	return res, nil
}

// RequireUploadTarget checks that userID may write into the folder.
func (a *App) RequireUploadTarget(ctx context.Context, workspaceID uuid.UUID, parentID *uuid.UUID, userID uuid.UUID) error {
	if parentID != nil {
		if err := a.RequireParentInWorkspace(ctx, *parentID, workspaceID, userID, true); err != nil {
			return err
		}
		var kind string
		if err := a.DB.QueryRow(ctx, `SELECT kind FROM nodes WHERE id = $1 AND deleted_at IS NULL`, *parentID).Scan(&kind); err != nil {
			if errors.Is(err, db.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
		if kind != "folder" {
			return ErrWorkspaceMismatch
		}
		return nil
	}
	return a.RequireWorkspaceAccess(ctx, workspaceID, userID, true)
}

// findFileByName returns the live file with this name in the folder, if any.
func (a *App) findFileByName(ctx context.Context, workspaceID uuid.UUID, parentID *uuid.UUID, name string) (uuid.UUID, int64, bool, error) {
	var id uuid.UUID
	var size int64
	var err error
	if parentID == nil {
		err = a.DB.QueryRow(ctx, `
			SELECT id, size FROM nodes WHERE workspace_id = $1 AND parent_id IS NULL AND name = $2 AND kind = 'file' AND deleted_at IS NULL
		`, workspaceID, name).Scan(&id, &size)
	} else {
		err = a.DB.QueryRow(ctx, `
			SELECT id, size FROM nodes WHERE workspace_id = $1 AND parent_id = $2 AND name = $3 AND kind = 'file' AND deleted_at IS NULL
		`, workspaceID, *parentID, name).Scan(&id, &size)
	}
	if errors.Is(err, db.ErrNoRows) {
		return uuid.Nil, 0, false, nil
	}
	if err != nil {
		return uuid.Nil, 0, false, err
	}
	return id, size, true, nil
}

const nodeReturning = `RETURNING id, workspace_id, parent_id, name, kind, size, mime, checksum, created_by, created_at, updated_at`

func scanNode(row db.Row, n *models.Node) error {
	return row.Scan(&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt)
}

func (a *App) commitStoredFile(ctx context.Context, p StoreFileParams, name, contentType, key string, size int64, sum string, overwrite bool, existingID uuid.UUID) (StoreFileResult, error) {
	var n models.Node
	if !overwrite {
		err := scanNode(a.DB.QueryRow(ctx, `
			INSERT INTO nodes (workspace_id, parent_id, name, kind, size, mime, storage_key, checksum, created_by)
			VALUES ($1, $2, $3, 'file', $4, $5, $6, $7, $8)
			`+nodeReturning, p.WorkspaceID, p.ParentID, name, size, contentType, key, sum, p.ActorID), &n)
		if err != nil {
			if db.IsUniqueViolation(err) {
				return StoreFileResult{}, ErrNameConflict
			}
			return StoreFileResult{}, err
		}
		return StoreFileResult{Node: n, Created: true}, nil
	}

	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return StoreFileResult{}, err
	}
	defer tx.Rollback(ctx)
	var live bool
	if err := tx.QueryRow(ctx, `SELECT deleted_at IS NULL FROM nodes WHERE id = $1 FOR UPDATE`, existingID).Scan(&live); err != nil {
		if errors.Is(err, db.ErrNoRows) {
			return StoreFileResult{}, ErrNameConflict
		}
		return StoreFileResult{}, err
	}
	if !live {
		return StoreFileResult{}, ErrNameConflict
	}
	if _, err := a.archiveVersion(ctx, tx, existingID, p.ActorID); err != nil {
		return StoreFileResult{}, err
	}
	err = scanNode(tx.QueryRow(ctx, `
		UPDATE nodes SET storage_key = $1, size = $2, mime = $3, checksum = $4,
		       thumb_key = NULL, content_text = '', updated_at = now()
		WHERE id = $5
		`+nodeReturning, key, size, contentType, sum, existingID), &n)
	if err != nil {
		return StoreFileResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return StoreFileResult{}, err
	}
	return StoreFileResult{Node: n, Created: false}, nil
}

// checksumString renders nodes.checksum: lowercase hex SHA-256 of the content.
func checksumString(h hash.Hash) string {
	return hex.EncodeToString(h.Sum(nil))
}
