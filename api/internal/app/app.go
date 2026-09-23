package app

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"strings"
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

func (a *App) CleanupExpiredSessions(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
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
			n, err := a.PurgeExpiredTrash(ctx)
			if err != nil {
				a.Logger.Warn("trash retention purge failed", "err", err)
			} else if n > 0 {
				a.Logger.Info("trash retention purge", "purged", n)
			}
		}
	}
}

func StorageKey(workspaceID, nodeID uuid.UUID) string {
	return workspaceID.String() + "/" + nodeID.String()
}
