package app

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/crypto"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type App struct {
	DB          *pgxpool.Pool
	Stores      *StoreRegistry
	Cfg         config.Config
	Logger      *slog.Logger
	googleOAuth googleOAuthCache
	smtp        smtpCache
	bg          bgPool
	uploadLocks sync.Map // upload id -> *sync.Mutex (tus PATCH/DELETE guard)
	setup       setupState
}

func (a *App) SeedDefaultBackend(ctx context.Context) error {
	var n int
	if err := a.DB.QueryRow(ctx, `SELECT COUNT(*) FROM storage_backends WHERE is_default = TRUE`).Scan(&n); err != nil {
		return err
	}
	if n > 0 {
		return nil
	}
	if strings.TrimSpace(a.Cfg.S3Endpoint) != "" {
		raw, err := a.EncryptAndMarshalS3(crypto.S3Config{
			Endpoint:       a.Cfg.S3Endpoint,
			AccessKey:      a.Cfg.S3AccessKey,
			SecretKey:      a.Cfg.S3SecretKey,
			Bucket:         a.Cfg.S3Bucket,
			Region:         a.Cfg.S3Region,
			UseSSL:         a.Cfg.S3UseSSL,
			ForcePathStyle: true,
		})
		if err != nil {
			return err
		}
		_, err = a.DB.Exec(ctx, `
			INSERT INTO storage_backends (name, type, config, is_default)
			VALUES ('Default S3', 's3', $1::jsonb, TRUE)
		`, raw)
		return err
	}
	dir := strings.TrimSpace(a.Cfg.DataDir)
	if dir == "" {
		dir = "/data/arkive"
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	raw, err := json.Marshal(crypto.NFSConfig{MountPath: dir})
	if err != nil {
		return err
	}
	_, err = a.DB.Exec(ctx, `
		INSERT INTO storage_backends (name, type, config, is_default)
		VALUES ('Default local', 'local', $1::jsonb, TRUE)
	`, raw)
	return err
}

func (a *App) DefaultBackendID(ctx context.Context) (uuid.UUID, error) {
	var id uuid.UUID
	err := a.DB.QueryRow(ctx, `
		SELECT id FROM storage_backends WHERE is_default = TRUE ORDER BY created_at LIMIT 1
	`).Scan(&id)
	return id, err
}

// gcInterval is how often the orphan blob GC runs from the background loop.
const gcInterval = 24 * time.Hour

func (a *App) CleanupExpiredSessions(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	// First GC roughly an hour after start, then daily.
	lastGC := time.Now().Add(-gcInterval + time.Hour)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, err := a.DB.Exec(ctx, `DELETE FROM sessions WHERE expires_at < now()`)
			if err != nil {
				a.Logger.Warn("session cleanup failed", "err", err)
			}
			_, err = a.DB.Exec(ctx, `DELETE FROM public_links WHERE expires_at IS NOT NULL AND expires_at < now()`)
			if err != nil {
				a.Logger.Warn("public link cleanup failed", "err", err)
			}
			_, err = a.DB.Exec(ctx, `DELETE FROM login_challenges WHERE expires_at < now()`)
			if err != nil {
				a.Logger.Warn("login challenge cleanup failed", "err", err)
			}
			if purged, err := a.PurgeOldAudit(ctx); err != nil {
				a.Logger.Warn("audit retention purge failed", "err", err)
			} else if purged > 0 {
				a.Logger.Info("audit retention purge", "purged", purged)
			}
			n, err := a.PurgeExpiredTrash(ctx)
			if err != nil {
				a.Logger.Warn("trash retention purge failed", "err", err)
			} else if n > 0 {
				a.Logger.Info("trash retention purge", "purged", n)
			}
			a.runMaintenance(ctx, &lastGC)
		}
	}
}

// runMaintenance is the hourly upload/version housekeeping plus the daily GC.
func (a *App) runMaintenance(ctx context.Context, lastGC *time.Time) {
	if rep, err := a.PurgeExpiredUploads(ctx, false); err != nil {
		a.log().Warn("upload session purge failed", "err", err)
	} else if rep.ExpiredSessions > 0 || rep.OrphanFiles > 0 {
		a.log().Info("upload session purge", "expired_sessions", rep.ExpiredSessions, "orphan_files", rep.OrphanFiles, "bytes", rep.Bytes)
	}
	if n, err := a.PruneAllVersions(ctx); err != nil {
		a.log().Warn("version retention prune failed", "err", err)
	} else if n > 0 {
		a.log().Info("version retention prune", "files", n)
	}
	if time.Since(*lastGC) < gcInterval {
		return
	}
	*lastGC = time.Now()
	rep, err := a.GarbageCollect(ctx, false)
	if err != nil {
		a.log().Warn("orphan gc failed", "err", err)
		return
	}
	skipped := 0
	errs := 0
	for _, b := range rep.Backends {
		if b.Skipped != "" {
			skipped++
		}
		errs += len(b.Errors)
		if len(b.Errors) > 0 {
			a.log().Warn("orphan gc backend errors", "backend", b.Name, "skipped", b.Skipped, "errors", b.Errors)
		}
	}
	a.log().Info("orphan gc",
		"backends", len(rep.Backends), "skipped_backends", skipped,
		"orphans", rep.Orphans, "deleted", rep.Deleted, "deleted_bytes", rep.DeletedBytes,
		"expired_uploads", rep.Uploads.ExpiredSessions, "errors", errs,
		"duration", rep.FinishedAt.Sub(rep.StartedAt).Round(time.Millisecond))
}

func StorageKey(workspaceID, nodeID uuid.UUID) string {
	return workspaceID.String() + "/" + nodeID.String()
}
