package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const DefaultDevSessionSecret = "dev-secret-change-me"
const DefaultComposeSecret = "change-me-in-production-use-long-random-string"

type Config struct {
	Env       string
	HTTPAddr  string
	PublicURL string
	// DatabaseURL selects the engine: postgres:// or postgresql:// for
	// PostgreSQL, sqlite:///path or file:/path for SQLite. Empty
	// ARKIVE_DATABASE_URL means SQLite at <DataDir>/arkive.db.
	DatabaseURL string
	// DatabaseURLDefaulted is true when ARKIVE_DATABASE_URL was not set.
	DatabaseURLDefaulted bool
	// AllowNonEmptyDataDir skips the startup check that refuses a new, empty
	// database when DataDir already holds blobs (ARKIVE_ALLOW_NONEMPTY_DATA_DIR).
	AllowNonEmptyDataDir bool
	SessionSecret        string
	SecretsKey           string
	BootstrapAdminEmail  string
	CookieSecure         bool
	MigrationsDir        string
	MaxUploadBytes       int64
	DataDir              string
	S3Endpoint           string
	S3AccessKey          string
	S3SecretKey          string
	S3Bucket             string
	S3UseSSL             bool
	S3Region             string
	OIDCIssuer           string
	OIDCClientID         string
	OIDCClientSecret     string
	OIDCRedirectURL      string
	OIDCProviderName     string
	GoogleClientID       string
	GoogleClientSecret   string
	GoogleDriveRedirect  string
	// TrustedProxies is the raw ARKIVE_TRUSTED_PROXIES list (comma-separated
	// CIDRs or IPs). Parsed by middleware.ParseTrustedProxies.
	TrustedProxies string
	// SetupToken, when set, is required by POST /api/setup. When empty the
	// server generates a one-time token on boot (see app.SetupToken).
	SetupToken     string
	MetricsEnabled bool
	MetricsToken   string
}

func Load() Config {
	// Secrets may be empty here; ResolveSecrets fills them from (or generates)
	// <DataDir>/.arkive-secrets. Env values always win.
	session := strings.TrimSpace(os.Getenv("ARKIVE_SESSION_SECRET"))
	publicURL := strings.TrimRight(getenv("ARKIVE_PUBLIC_URL", "http://localhost:3080"), "/")
	env := strings.ToLower(strings.TrimSpace(getenv("ARKIVE_ENV", "development")))
	dataDir := getenv("ARKIVE_DATA_DIR", "/data/arkive")
	dbURL := strings.TrimSpace(os.Getenv("ARKIVE_DATABASE_URL"))
	dbDefaulted := dbURL == ""
	if dbDefaulted {
		dbURL = DefaultSQLiteURL(dataDir)
	}
	if env == "" {
		env = "development"
	}
	return Config{
		Env:                  env,
		HTTPAddr:             getenv("ARKIVE_HTTP_ADDR", ":8080"),
		PublicURL:            publicURL,
		DatabaseURL:          dbURL,
		DatabaseURLDefaulted: dbDefaulted,
		AllowNonEmptyDataDir: getenvBool("ARKIVE_ALLOW_NONEMPTY_DATA_DIR", false),
		SessionSecret:        session,
		// 1.0 compatibility: with only the session secret set, it doubled as
		// the secrets key. Keep that so encrypted settings stay readable.
		SecretsKey:          strings.TrimSpace(getenv("ARKIVE_SECRETS_KEY", session)),
		BootstrapAdminEmail: strings.ToLower(strings.TrimSpace(getenv("ARKIVE_BOOTSTRAP_ADMIN_EMAIL", ""))),
		CookieSecure:        getenvBool("ARKIVE_COOKIE_SECURE", false),
		MigrationsDir:       strings.TrimSpace(os.Getenv("ARKIVE_MIGRATIONS_DIR")), // empty = embedded
		MaxUploadBytes:      getenvInt64("ARKIVE_MAX_UPLOAD_BYTES", 10*1024*1024*1024),
		DataDir:             dataDir,
		S3Endpoint:          strings.TrimSpace(getenv("ARKIVE_S3_ENDPOINT", "")),
		S3AccessKey:         getenv("ARKIVE_S3_ACCESS_KEY", ""),
		S3SecretKey:         getenv("ARKIVE_S3_SECRET_KEY", ""),
		S3Bucket:            getenv("ARKIVE_S3_BUCKET", ""),
		S3UseSSL:            getenvBool("ARKIVE_S3_USE_SSL", false),
		S3Region:            getenv("ARKIVE_S3_REGION", "us-east-1"),
		OIDCIssuer:          strings.TrimSpace(getenv("ARKIVE_OIDC_ISSUER", "")),
		OIDCClientID:        strings.TrimSpace(getenv("ARKIVE_OIDC_CLIENT_ID", "")),
		OIDCClientSecret:    strings.TrimSpace(getenv("ARKIVE_OIDC_CLIENT_SECRET", "")),
		OIDCRedirectURL:     getenv("ARKIVE_OIDC_REDIRECT_URL", publicURL+"/api/auth/oidc/callback"),
		OIDCProviderName:    getenv("ARKIVE_OIDC_PROVIDER_NAME", "SSO"),
		GoogleClientID:      strings.TrimSpace(getenv("ARKIVE_GOOGLE_CLIENT_ID", "")),
		GoogleClientSecret:  strings.TrimSpace(getenv("ARKIVE_GOOGLE_CLIENT_SECRET", "")),
		GoogleDriveRedirect: getenv("ARKIVE_GOOGLE_REDIRECT_URL", publicURL+"/api/auth/google/drive/callback"),
		TrustedProxies:      strings.TrimSpace(os.Getenv("ARKIVE_TRUSTED_PROXIES")),
		SetupToken:          strings.TrimSpace(os.Getenv("ARKIVE_SETUP_TOKEN")),
		MetricsEnabled:      getenvBool("ARKIVE_METRICS_ENABLED", false),
		MetricsToken:        strings.TrimSpace(os.Getenv("ARKIVE_METRICS_TOKEN")),
	}
}

// DefaultSQLiteURL is the database used when ARKIVE_DATABASE_URL is unset.
func DefaultSQLiteURL(dataDir string) string {
	return "sqlite://" + filepath.ToSlash(filepath.Join(dataDir, "arkive.db"))
}

func (c Config) IsProduction() bool {
	return c.Env == "production" || c.Env == "prod"
}

// isWeakSecret reports empty values and the well-known placeholders that
// shipped in earlier examples. Generated secrets are never weak.
func isWeakSecret(s string) bool {
	s = strings.TrimSpace(s)
	return s == "" || s == DefaultDevSessionSecret || s == DefaultComposeSecret
}

func (c Config) UsingDevSecrets() bool {
	return isWeakSecret(c.SessionSecret) || isWeakSecret(c.SecretsKey)
}

// ValidateSecrets returns an error when production is using weak/default secrets.
func (c Config) ValidateSecrets() error {
	if !c.IsProduction() {
		return nil
	}
	if isWeakSecret(c.SessionSecret) {
		return fmt.Errorf("ARKIVE_SESSION_SECRET must be a strong value when ARKIVE_ENV=production (unset it to use a generated secret)")
	}
	if isWeakSecret(c.SecretsKey) {
		return fmt.Errorf("ARKIVE_SECRETS_KEY must be a strong value when ARKIVE_ENV=production (unset it to use a generated key; do not reuse a placeholder)")
	}
	return nil
}

func (c Config) OIDCEnabled() bool {
	return c.OIDCIssuer != "" && c.OIDCClientID != "" && c.OIDCClientSecret != ""
}

func (c Config) GoogleDriveEnabled() bool {
	return c.GoogleClientID != "" && c.GoogleClientSecret != ""
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getenvBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return fallback
	}
	return b
}

func getenvInt64(key string, fallback int64) int64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return fallback
	}
	return n
}
