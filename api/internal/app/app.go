package app

import (
	"context"
	"log/slog"
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
}

func (a *App) SeedDefaultBackend(ctx context.Context) error {
	var count int
	if err := a.DB.QueryRow(ctx, `SELECT COUNT(*) FROM storage_backends`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
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
		VALUES ('Default MinIO', 's3', $1::jsonb, TRUE)
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
		}
	}
}

func StorageKey(workspaceID, nodeID uuid.UUID) string {
	return workspaceID.String() + "/" + nodeID.String()
}
