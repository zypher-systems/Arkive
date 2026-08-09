package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/db"
	"github.com/arkive/arkive/internal/handlers"
	"github.com/arkive/arkive/internal/storage"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg := config.Load()

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if err := db.Migrate(cfg.DatabaseURL, cfg.MigrationsDir); err != nil {
		logger.Error("migration failed", "err", err)
		os.Exit(1)
	}

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("database connect failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	// Ensure compose MinIO bucket exists for the seeded default backend.
	s3, err := storage.NewS3StoreOpts(storage.S3Options{
		Endpoint:       cfg.S3Endpoint,
		AccessKey:      cfg.S3AccessKey,
		SecretKey:      cfg.S3SecretKey,
		Bucket:         cfg.S3Bucket,
		Region:         cfg.S3Region,
		UseSSL:         cfg.S3UseSSL,
		ForcePathStyle: true,
	})
	if err != nil {
		logger.Error("storage client failed", "err", err)
		os.Exit(1)
	}
	if err := s3.EnsureBucket(ctx); err != nil {
		logger.Warn("ensure bucket", "err", err)
	}

	application := &app.App{
		DB:     pool,
		Stores: app.NewStoreRegistry(),
		Cfg:    cfg,
		Logger: logger,
	}
	if err := application.SeedDefaultBackend(ctx); err != nil {
		logger.Error("seed storage backend failed", "err", err)
		os.Exit(1)
	}

	go application.CleanupExpiredSessions(ctx)
	go application.RunMigrationWorker(ctx)

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           handlers.NewRouter(application),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		logger.Info("arkive api listening", "addr", cfg.HTTPAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("server failed", "err", err)
			cancel()
		}
	}()

	<-ctx.Done()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	_ = srv.Shutdown(shutdownCtx)
	logger.Info("arkive api stopped")
}
