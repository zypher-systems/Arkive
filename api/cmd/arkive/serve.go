package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/db"
	"github.com/arkive/arkive/internal/handlers"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/storage"
	"github.com/arkive/arkive/internal/webui"
	"github.com/jackc/pgx/v5/pgxpool"
)

func newLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
}

func runServe(args []string) int {
	fs := newFlagSet("serve", "")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	logger := newLogger()
	if err := serve(logger); err != nil {
		logger.Error("arkive stopped with error", "err", err)
		return 1
	}
	return 0
}

func serve(logger *slog.Logger) error {
	cfg := config.Load()

	trusted, err := middleware.ParseTrustedProxies(cfg.TrustedProxies)
	if err != nil {
		return err
	}
	middleware.SetTrustedProxies(trusted)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if err := db.Migrate(cfg.DatabaseURL, cfg.MigrationsDir); err != nil {
		return fmt.Errorf("migration failed: %w", err)
	}
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("database connect failed: %w", err)
	}
	defer pool.Close()

	if err := resolveSecrets(ctx, logger, &cfg, pool); err != nil {
		return err
	}
	if err := cfg.ValidateSecrets(); err != nil {
		return fmt.Errorf("refusing to start with insecure secrets: %w", err)
	}
	if !cfg.IsProduction() && cfg.UsingDevSecrets() {
		logger.Warn("using a well-known placeholder secret; unset ARKIVE_SESSION_SECRET / ARKIVE_SECRETS_KEY to use generated ones", "env", cfg.Env)
	}

	if cfg.S3Endpoint != "" {
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
			return fmt.Errorf("storage client failed: %w", err)
		}
		if err := s3.EnsureBucket(ctx); err != nil {
			logger.Warn("ensure bucket", "err", err)
		}
	}

	application := &app.App{
		DB:     pool,
		Stores: app.NewStoreRegistry(),
		Cfg:    cfg,
		Logger: logger,
	}
	if err := application.SeedDefaultBackend(ctx); err != nil {
		return fmt.Errorf("seed storage backend failed: %w", err)
	}
	announceSetup(ctx, logger, application)

	go application.CleanupExpiredSessions(ctx)
	go application.RunMigrationWorker(ctx)

	if !webui.New().HasUI() {
		logger.Warn("web UI not embedded in this build; serving a placeholder page (run `make build` or use the Vite dev server)")
	}

	srv := &http.Server{
		Addr:    cfg.HTTPAddr,
		Handler: handlers.NewRouter(application),
		// Only the header phase and idle keep-alives are bounded. ReadTimeout /
		// WriteTimeout would cap the *whole* body transfer, which breaks
		// multi-GB uploads, downloads and long WebDAV copies on slow links.
		// Slow-body abuse is limited by per-IP rate limits and upload quotas.
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("arkive listening", "addr", cfg.HTTPAddr, "version", version, "public_url", cfg.PublicURL)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
		close(errCh)
	}()

	select {
	case <-ctx.Done():
	case err := <-errCh:
		if err != nil {
			return fmt.Errorf("server failed: %w", err)
		}
	}
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	_ = srv.Shutdown(shutdownCtx)
	logger.Info("arkive stopped")
	return nil
}

// resolveSecrets fills unset secrets from <DataDir>/.arkive-secrets,
// generating them on first boot.
func resolveSecrets(ctx context.Context, logger *slog.Logger, cfg *config.Config, pool *pgxpool.Pool) error {
	var legacyErr error
	res, err := cfg.ResolveSecrets(func() string {
		key, encrypted := app.DetectLegacySecretsKey(ctx, pool)
		switch {
		case key != "" && !cfg.IsProduction():
			logger.Warn("upgrading a 1.0 install that used the placeholder ARKIVE_SECRETS_KEY; keeping it so stored credentials stay readable. Set a strong ARKIVE_SECRETS_KEY and re-enter storage/SMTP/OAuth credentials to rotate it.")
			return key
		case encrypted:
			legacyErr = errors.New("stored credentials are encrypted with a key Arkive cannot find: set ARKIVE_SECRETS_KEY to the value used before this upgrade (or to a new value and re-enter storage/SMTP/OAuth credentials)")
		}
		return ""
	})
	if legacyErr != nil {
		return legacyErr
	}
	if err != nil {
		return fmt.Errorf("secrets: %w (set ARKIVE_SESSION_SECRET and ARKIVE_SECRETS_KEY, or make ARKIVE_DATA_DIR writable)", err)
	}
	if res.Created {
		logger.Info("generated secrets and saved them; back this file up with your data", "path", res.Path)
	} else if res.Used {
		logger.Info("loaded secrets from file", "path", res.Path)
	}
	return nil
}

// announceSetup prints the one-time setup token while no account exists.
func announceSetup(ctx context.Context, logger *slog.Logger, a *app.App) {
	needed, err := a.SetupNeeded(ctx)
	if err != nil || !needed {
		return
	}
	setupURL := strings.TrimRight(a.Cfg.PublicURL, "/") + "/"
	if strings.TrimSpace(a.Cfg.SetupToken) != "" {
		logger.Info("no accounts yet: open the web UI and complete setup with ARKIVE_SETUP_TOKEN", "url", setupURL)
		return
	}
	token := a.SetupToken()
	logger.Warn("no accounts yet: open the web UI and complete setup with this one-time setup token", "url", setupURL, "setup_token", token)
	fmt.Fprintf(os.Stderr, "\n  Arkive first-run setup\n  Open %s and enter the setup token:\n\n      %s\n\n  (A new token is printed on every restart until setup is complete.)\n\n", setupURL, token)
}

// healthcheckURL maps ARKIVE_HTTP_ADDR to a loopback URL.
func healthcheckURL(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		host, port = "", strings.TrimPrefix(addr, ":")
	}
	switch host {
	case "", "0.0.0.0", "::", "[::]":
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port) + "/api/ready"
}

func runHealthcheck(args []string) int {
	fs := newFlagSet("healthcheck", "[--url URL]")
	url := fs.String("url", "", "URL to probe (default: /api/ready on ARKIVE_HTTP_ADDR)")
	timeout := fs.Duration("timeout", 5*time.Second, "request timeout")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	target := *url
	if target == "" {
		target = healthcheckURL(config.Load().HTTPAddr)
	}
	client := &http.Client{Timeout: *timeout}
	resp, err := client.Get(target)
	if err != nil {
		fmt.Fprintf(os.Stderr, "healthcheck: %v\n", err)
		return 1
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "healthcheck: %s returned %d\n", target, resp.StatusCode)
		return 1
	}
	return 0
}

func runMigrate(args []string) int {
	fs := newFlagSet("migrate", "")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	cfg := config.Load()
	if err := db.Migrate(cfg.DatabaseURL, cfg.MigrationsDir); err != nil {
		fmt.Fprintf(os.Stderr, "migrate: %v\n", err)
		return 1
	}
	fmt.Println("migrations up to date")
	return 0
}
