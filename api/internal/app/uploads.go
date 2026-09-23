package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// UploadSessionTTL is how long an idle resumable upload is kept.
const UploadSessionTTL = 24 * time.Hour

// uploadOrphanGrace is how old a partial file without a session row must be
// before it is removed (covers the window between file create and row insert).
const uploadOrphanGrace = time.Hour

var (
	ErrUploadNotFound       = errors.New("upload not found")
	ErrUploadOffsetMismatch = errors.New("upload offset mismatch")
	ErrUploadLocked         = errors.New("upload is locked by another request")
	ErrUploadTooLarge       = errors.New("upload exceeds maximum size")
	ErrUploadExceedsLength  = errors.New("upload body exceeds declared length")
)

// UploadSession is one tus upload (row in the uploads table).
type UploadSession struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	WorkspaceID uuid.UUID
	ParentID    *uuid.UUID
	Filename    string
	ContentType string
	Length      int64
	Offset      int64
	CreatedAt   time.Time
	UpdatedAt   time.Time
	ExpiresAt   time.Time
}

// UploadsDir is the local staging directory for partial tus uploads. It is
// always on local disk regardless of the workspace's storage backend.
func (a *App) UploadsDir() string {
	dir := strings.TrimSpace(a.Cfg.DataDir)
	if dir == "" {
		dir = "/data/arkive"
	}
	return filepath.Join(dir, ".uploads")
}

func (a *App) uploadPartPath(id uuid.UUID) string {
	return filepath.Join(a.UploadsDir(), id.String())
}

// LockUpload takes the in-process lock guarding one upload. ok is false when
// another request (PATCH/DELETE/purge) holds it.
func (a *App) LockUpload(id uuid.UUID) (unlock func(), ok bool) {
	v, _ := a.uploadLocks.LoadOrStore(id, &sync.Mutex{})
	mu := v.(*sync.Mutex)
	if !mu.TryLock() {
		return nil, false
	}
	return mu.Unlock, true
}

// forgetUploadLock drops the lock entry of a session that no longer exists.
func (a *App) forgetUploadLock(id uuid.UUID) {
	a.uploadLocks.Delete(id)
}

// CreateUploadSessionParams are the validated inputs of a tus creation request.
type CreateUploadSessionParams struct {
	UserID      uuid.UUID
	WorkspaceID uuid.UUID
	ParentID    *uuid.UUID
	Filename    string
	ContentType string
	Length      int64
}

// CreateUploadSession checks permission, size limit and quota, then records a
// new session and creates its (empty) partial file.
func (a *App) CreateUploadSession(ctx context.Context, p CreateUploadSessionParams) (*UploadSession, error) {
	name := SanitizeName(p.Filename)
	if name == "" {
		return nil, ErrNameRequired
	}
	if p.Length < 0 {
		return nil, fmt.Errorf("invalid length")
	}
	if max := a.Cfg.MaxUploadBytes; max > 0 && p.Length > max {
		return nil, ErrUploadTooLarge
	}
	if err := a.RequireUploadTarget(ctx, p.WorkspaceID, p.ParentID, p.UserID); err != nil {
		return nil, err
	}
	_, existingSize, found, err := a.findFileByName(ctx, p.WorkspaceID, p.ParentID, name)
	if err != nil {
		return nil, err
	}
	replace := int64(0)
	if found {
		replace = existingSize
	}
	// Reserve room for other in-flight uploads into the same workspace so
	// parallel sessions cannot collectively overshoot the quota on disk.
	var pending int64
	if err := a.DB.QueryRow(ctx, `
		SELECT COALESCE(SUM(length), 0) FROM uploads WHERE workspace_id = $1 AND expires_at > now()
	`, p.WorkspaceID).Scan(&pending); err != nil {
		return nil, err
	}
	if p.Length > 0 || pending > 0 {
		if err := a.EnsureQuota(ctx, p.WorkspaceID, p.Length+pending, replace); err != nil {
			return nil, err
		}
	}
	ct := strings.TrimSpace(p.ContentType)
	if ct == "" {
		ct = "application/octet-stream"
	}

	if err := os.MkdirAll(a.UploadsDir(), 0o700); err != nil {
		return nil, fmt.Errorf("uploads dir: %w", err)
	}
	s := &UploadSession{
		ID:          uuid.New(),
		UserID:      p.UserID,
		WorkspaceID: p.WorkspaceID,
		ParentID:    p.ParentID,
		Filename:    name,
		ContentType: ct,
		Length:      p.Length,
	}
	f, err := os.OpenFile(a.uploadPartPath(s.ID), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return nil, fmt.Errorf("create partial file: %w", err)
	}
	_ = f.Close()
	err = a.DB.QueryRow(ctx, `
		INSERT INTO uploads (id, user_id, workspace_id, parent_id, filename, content_type, length, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, now() + $8::interval)
		RETURNING created_at, updated_at, expires_at
	`, s.ID, s.UserID, s.WorkspaceID, s.ParentID, s.Filename, s.ContentType, s.Length, ttlInterval()).Scan(&s.CreatedAt, &s.UpdatedAt, &s.ExpiresAt)
	if err != nil {
		_ = os.Remove(a.uploadPartPath(s.ID))
		return nil, err
	}
	return s, nil
}

func ttlInterval() string {
	return fmt.Sprintf("%d seconds", int64(UploadSessionTTL/time.Second))
}

// GetUploadSession loads a live session owned by userID. Other users' and
// expired sessions are reported as ErrUploadNotFound.
func (a *App) GetUploadSession(ctx context.Context, id, userID uuid.UUID) (*UploadSession, error) {
	s := &UploadSession{}
	err := a.DB.QueryRow(ctx, `
		SELECT id, user_id, workspace_id, parent_id, filename, content_type, length, "offset", created_at, updated_at, expires_at
		FROM uploads WHERE id = $1 AND user_id = $2 AND expires_at > now()
	`, id, userID).Scan(&s.ID, &s.UserID, &s.WorkspaceID, &s.ParentID, &s.Filename, &s.ContentType, &s.Length, &s.Offset, &s.CreatedAt, &s.UpdatedAt, &s.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrUploadNotFound
	}
	if err != nil {
		return nil, err
	}
	return s, nil
}

// WriteUploadChunk appends body at offset. The caller must hold LockUpload.
// Bytes received before a transfer error are kept (and the offset advanced) so
// the client can resume. Returns the new offset.
func (a *App) WriteUploadChunk(ctx context.Context, s *UploadSession, offset int64, body io.Reader) (int64, error) {
	if offset != s.Offset {
		return s.Offset, ErrUploadOffsetMismatch
	}
	f, err := os.OpenFile(a.uploadPartPath(s.ID), os.O_WRONLY, 0)
	if err != nil {
		if os.IsNotExist(err) {
			// Partial data vanished; the session cannot be resumed.
			_ = a.deleteUploadRow(ctx, s.ID)
			return s.Offset, ErrUploadNotFound
		}
		return s.Offset, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return s.Offset, err
	}
	if st.Size() != s.Offset {
		if st.Size() > s.Offset {
			// Bytes written but never acknowledged (crash mid-PATCH): drop them.
			if err := f.Truncate(s.Offset); err != nil {
				return s.Offset, err
			}
		} else {
			// File is shorter than recorded: trust the file and make the
			// client re-sync via HEAD.
			if _, err := a.DB.Exec(ctx, `UPDATE uploads SET "offset" = $1, updated_at = now() WHERE id = $2`, st.Size(), s.ID); err != nil {
				return s.Offset, err
			}
			s.Offset = st.Size()
			return s.Offset, ErrUploadOffsetMismatch
		}
	}
	if _, err := f.Seek(s.Offset, io.SeekStart); err != nil {
		return s.Offset, err
	}
	remaining := s.Length - s.Offset
	n, copyErr := io.Copy(f, io.LimitReader(body, remaining))
	if n > 0 {
		if err := f.Sync(); err != nil {
			_ = f.Truncate(s.Offset)
			return s.Offset, fmt.Errorf("sync partial file: %w", err)
		}
		// Use a fresh context: record progress even if the client went away.
		dbctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		_, err := a.DB.Exec(dbctx, `
			UPDATE uploads SET "offset" = $1, updated_at = now(), expires_at = now() + $2::interval WHERE id = $3
		`, s.Offset+n, ttlInterval(), s.ID)
		cancel()
		if err != nil {
			_ = f.Truncate(s.Offset)
			return s.Offset, err
		}
		s.Offset += n
		s.ExpiresAt = time.Now().Add(UploadSessionTTL)
	}
	if copyErr != nil {
		return s.Offset, copyErr
	}
	if s.Offset == s.Length {
		var one [1]byte
		if m, _ := body.Read(one[:]); m > 0 {
			return s.Offset, ErrUploadExceedsLength
		}
	}
	return s.Offset, nil
}

// FinalizeUploadSession turns a complete upload into a node via StoreFile
// (same semantics as the PUT upload). The caller must hold LockUpload. On
// success, or on a permanent failure (quota, permission, name), the session
// and its partial file are removed; transient failures keep it so a PATCH
// with an empty body at the final offset retries the finalize.
func (a *App) FinalizeUploadSession(ctx context.Context, s *UploadSession) (StoreFileResult, error) {
	if s.Offset != s.Length {
		return StoreFileResult{}, fmt.Errorf("upload incomplete: %d of %d bytes", s.Offset, s.Length)
	}
	f, err := os.Open(a.uploadPartPath(s.ID))
	if err != nil {
		if os.IsNotExist(err) {
			_ = a.deleteUploadRow(ctx, s.ID)
			return StoreFileResult{}, ErrUploadNotFound
		}
		return StoreFileResult{}, err
	}
	res, err := a.StoreFile(ctx, StoreFileParams{
		WorkspaceID: s.WorkspaceID,
		ParentID:    s.ParentID,
		Name:        s.Filename,
		ContentType: s.ContentType,
		ActorID:     s.UserID,
		Body:        f,
		Size:        s.Length,
	})
	_ = f.Close()
	if err != nil {
		if isPermanentStoreError(err) {
			a.removeUploadSession(context.WithoutCancel(ctx), s.ID)
		}
		return StoreFileResult{}, err
	}
	a.removeUploadSession(context.WithoutCancel(ctx), s.ID)
	return res, nil
}

func isPermanentStoreError(err error) bool {
	return errors.Is(err, ErrQuotaExceeded) || errors.Is(err, ErrNameRequired) ||
		errors.Is(err, ErrNameConflict) || errors.Is(err, ErrForbidden) ||
		errors.Is(err, ErrNotFound) || errors.Is(err, ErrWorkspaceMismatch)
}

// DeleteUploadSession aborts an upload (tus termination). Caller holds the lock.
func (a *App) DeleteUploadSession(ctx context.Context, s *UploadSession) error {
	if err := a.deleteUploadRow(ctx, s.ID); err != nil {
		return err
	}
	if err := os.Remove(a.uploadPartPath(s.ID)); err != nil && !os.IsNotExist(err) {
		a.log().Warn("remove partial upload failed", "upload_id", s.ID, "err", err)
	}
	a.forgetUploadLock(s.ID)
	return nil
}

func (a *App) removeUploadSession(ctx context.Context, id uuid.UUID) {
	if err := a.deleteUploadRow(ctx, id); err != nil {
		a.log().Warn("delete upload session failed", "upload_id", id, "err", err)
	}
	if err := os.Remove(a.uploadPartPath(id)); err != nil && !os.IsNotExist(err) {
		a.log().Warn("remove partial upload failed", "upload_id", id, "err", err)
	}
	a.forgetUploadLock(id)
}

func (a *App) deleteUploadRow(ctx context.Context, id uuid.UUID) error {
	_, err := a.DB.Exec(ctx, `DELETE FROM uploads WHERE id = $1`, id)
	return err
}

// UploadPurgeReport summarizes PurgeExpiredUploads.
type UploadPurgeReport struct {
	ExpiredSessions int   `json:"expired_sessions"`
	OrphanFiles     int   `json:"orphan_files"`
	Bytes           int64 `json:"bytes"`
}

// PurgeExpiredUploads removes expired sessions with their partial files, and
// partial files that have no session row (older than an hour). Sessions that
// are being written right now (locked) are skipped. dryRun only counts.
func (a *App) PurgeExpiredUploads(ctx context.Context, dryRun bool) (UploadPurgeReport, error) {
	var rep UploadPurgeReport
	rows, err := a.DB.Query(ctx, `SELECT id FROM uploads WHERE expires_at <= now()`)
	if err != nil {
		return rep, err
	}
	var expired []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return rep, err
		}
		expired = append(expired, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return rep, err
	}
	for _, id := range expired {
		unlock, ok := a.LockUpload(id)
		if !ok {
			continue
		}
		if st, err := os.Stat(a.uploadPartPath(id)); err == nil {
			rep.Bytes += st.Size()
		}
		rep.ExpiredSessions++
		if !dryRun {
			// Re-check expiry under the lock: a PATCH may have just extended it.
			tag, err := a.DB.Exec(ctx, `DELETE FROM uploads WHERE id = $1 AND expires_at <= now()`, id)
			if err == nil && tag.RowsAffected() == 1 {
				_ = os.Remove(a.uploadPartPath(id))
			}
		}
		unlock()
		if !dryRun {
			a.forgetUploadLock(id)
		}
	}

	entries, err := os.ReadDir(a.UploadsDir())
	if err != nil {
		if os.IsNotExist(err) {
			return rep, nil
		}
		return rep, err
	}
	known := map[uuid.UUID]bool{}
	rows, err = a.DB.Query(ctx, `SELECT id FROM uploads`)
	if err != nil {
		return rep, err // never delete files when the DB cannot be read
	}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return rep, err
		}
		known[id] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return rep, err
	}
	cutoff := time.Now().Add(-uploadOrphanGrace)
	for _, e := range entries {
		if !e.Type().IsRegular() {
			continue
		}
		id, err := uuid.Parse(e.Name())
		if err != nil || known[id] {
			continue
		}
		info, err := e.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		rep.OrphanFiles++
		rep.Bytes += info.Size()
		if !dryRun {
			_ = os.Remove(filepath.Join(a.UploadsDir(), e.Name()))
		}
	}
	return rep, nil
}
