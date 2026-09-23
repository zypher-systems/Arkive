package app

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/arkive/arkive/internal/db"
	"github.com/google/uuid"
)

const migrateSyncKeyThreshold = 25

type MigrationJob struct {
	ID            uuid.UUID  `json:"id"`
	WorkspaceID   uuid.UUID  `json:"workspace_id"`
	FromBackendID *uuid.UUID `json:"from_backend_id,omitempty"`
	ToBackendID   uuid.UUID  `json:"to_backend_id"`
	Status        string     `json:"status"`
	Copied        int        `json:"copied"`
	Total         int        `json:"total"`
	Error         string     `json:"error"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// EnqueueOrRunMigration queues a background job, or runs sync when sync=true
// or the workspace has fewer than migrateSyncKeyThreshold keys.
func (a *App) EnqueueOrRunMigration(ctx context.Context, workspaceID, toBackendID uuid.UUID, actorID *uuid.UUID, sync bool) (*MigrationJob, *MigrateResult, error) {
	keys, err := a.workspaceStorageKeys(ctx, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	if sync || len(keys) < migrateSyncKeyThreshold {
		res, err := a.MigrateWorkspaceStorage(ctx, workspaceID, toBackendID)
		if err != nil {
			return nil, nil, err
		}
		return nil, res, nil
	}

	var fromID *uuid.UUID
	_ = a.DB.QueryRow(ctx, `SELECT storage_backend_id FROM workspaces WHERE id = $1`, workspaceID).Scan(&fromID)

	var jobID uuid.UUID
	err = a.DB.QueryRow(ctx, `
		INSERT INTO storage_migrations (workspace_id, from_backend_id, to_backend_id, status, total, created_by)
		VALUES ($1, $2, $3, 'queued', $4, $5)
		RETURNING id
	`, workspaceID, fromID, toBackendID, len(keys), actorID).Scan(&jobID)
	if err != nil {
		return nil, nil, err
	}
	job, err := a.GetMigrationJob(ctx, jobID)
	return job, nil, err
}

func (a *App) GetMigrationJob(ctx context.Context, id uuid.UUID) (*MigrationJob, error) {
	var j MigrationJob
	err := a.DB.QueryRow(ctx, `
		SELECT id, workspace_id, from_backend_id, to_backend_id, status, copied, total, error, created_at, updated_at
		FROM storage_migrations WHERE id = $1
	`, id).Scan(
		&j.ID, &j.WorkspaceID, &j.FromBackendID, &j.ToBackendID, &j.Status, &j.Copied, &j.Total, &j.Error, &j.CreatedAt, &j.UpdatedAt,
	)
	if errors.Is(err, db.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &j, nil
}

func (a *App) RunMigrationWorker(ctx context.Context) {
	// Re-queue jobs left in 'running' after a crash/restart (older than 1 hour).
	if _, err := a.DB.Exec(ctx, `
		UPDATE storage_migrations
		SET status = 'queued', error = 'requeued after stuck running', updated_at = now()
		WHERE status = 'running' AND updated_at < $1
	`, time.Now().Add(-time.Hour)); err != nil && a.Logger != nil {
		a.Logger.Warn("reset stuck migrations", "err", err)
	}
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := a.processNextMigration(ctx); err != nil && a.Logger != nil {
				a.Logger.Warn("migration worker", "err", err)
			}
		}
	}
}

func (a *App) processNextMigration(ctx context.Context) error {
	// Poll without a transaction first: on SQLite every transaction takes
	// the database write lock.
	var queued bool
	if err := a.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM storage_migrations WHERE status = 'queued')`).Scan(&queued); err != nil {
		return err
	}
	if !queued {
		return nil
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var job MigrationJob
	err = tx.QueryRow(ctx, `
		SELECT id, workspace_id, from_backend_id, to_backend_id, status, copied, total, error, created_at, updated_at
		FROM storage_migrations
		WHERE status = 'queued'
		ORDER BY created_at ASC
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	`).Scan(
		&job.ID, &job.WorkspaceID, &job.FromBackendID, &job.ToBackendID, &job.Status, &job.Copied, &job.Total, &job.Error, &job.CreatedAt, &job.UpdatedAt,
	)
	if errors.Is(err, db.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		UPDATE storage_migrations SET status = 'running', updated_at = now() WHERE id = $1
	`, job.ID)
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	res, err := a.MigrateWorkspaceStorage(ctx, job.WorkspaceID, job.ToBackendID)
	if err != nil {
		msg := err.Error()
		var me *MigrateError
		if errors.As(err, &me) {
			msg = me.Message
			if _, uerr := a.DB.Exec(ctx, `
				UPDATE storage_migrations
				SET status = 'failed', error = $1, copied = $2, total = $3, updated_at = now()
				WHERE id = $4
			`, msg, me.Copied, me.Total, job.ID); uerr != nil {
				return fmt.Errorf("mark migration failed: %w", uerr)
			}
			return nil
		}
		if _, uerr := a.DB.Exec(ctx, `
			UPDATE storage_migrations SET status = 'failed', error = $1, updated_at = now() WHERE id = $2
		`, msg, job.ID); uerr != nil {
			return fmt.Errorf("mark migration failed: %w", uerr)
		}
		return nil
	}
	copied, total := 0, 0
	if res != nil {
		copied, total = res.Copied, res.Total
	}
	if _, uerr := a.DB.Exec(ctx, `
		UPDATE storage_migrations
		SET status = 'completed', copied = $1, total = $2, error = '', updated_at = now()
		WHERE id = $3
	`, copied, total, job.ID); uerr != nil {
		return fmt.Errorf("mark migration completed: %w", uerr)
	}
	return nil
}

func (a *App) FormatMigrationJob(j *MigrationJob) map[string]any {
	if j == nil {
		return nil
	}
	return map[string]any{
		"id":              j.ID,
		"workspace_id":    j.WorkspaceID,
		"from_backend_id": j.FromBackendID,
		"to_backend_id":   j.ToBackendID,
		"status":          j.Status,
		"copied":          j.Copied,
		"total":           j.Total,
		"error":           j.Error,
		"created_at":      j.CreatedAt,
		"updated_at":      j.UpdatedAt,
	}
}

func (a *App) MigrationJobURL(id uuid.UUID) string {
	return fmt.Sprintf("/api/migrations/%s", id)
}
