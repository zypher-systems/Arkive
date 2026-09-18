package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

const DefaultDevSessionSecret = "dev-secret-change-me"
const DefaultComposeSecret = "change-me-in-production-use-long-random-string"

type Config struct {
	Env                 string
	HTTPAddr            string
	PublicURL           string
	DatabaseURL         string
	SessionSecret       string
	SecretsKey          string
	BootstrapAdminEmail string
	CookieSecure        bool
	MigrationsDir       string
	MaxUploadBytes      int64
	DataDir             string
	S3Endpoint          string
	S3AccessKey         string
	S3SecretKey         string
	S3Bucket            string
	S3UseSSL            bool
	S3Region            string
	OIDCIssuer          string
	OIDCClientID        string
	OIDCClientSecret    string
	OIDCRedirectURL     string
	OIDCProviderName    string
	GoogleClientID      string
	GoogleClientSecret  string
	GoogleDriveRedirect string
}

func Load() Config {
	session := getenv("ARKIVE_SESSION_SECRET", DefaultDevSessionSecret)
	publicURL := strings.TrimRight(getenv("ARKIVE_PUBLIC_URL", "http://localhost:3080"), "/")
	env := strings.ToLower(strings.TrimSpace(getenv("ARKIVE_ENV", "development")))
	if env == "" {
		env = "development"
	}
	return Config{
		Env:                 env,
		HTTPAddr:            getenv("ARKIVE_HTTP_ADDR", ":8080"),
		PublicURL:           publicURL,
		DatabaseURL:         getenv("ARKIVE_DATABASE_URL", "postgres://arkive:arkive@localhost:5432/arkive?sslmode=disable"),
		SessionSecret:       session,
		SecretsKey:          getenv("ARKIVE_SECRETS_KEY", session),
		BootstrapAdminEmail: strings.ToLower(strings.TrimSpace(getenv("ARKIVE_BOOTSTRAP_ADMIN_EMAIL", ""))),
		CookieSecure:        getenvBool("ARKIVE_COOKIE_SECURE", false),
		MigrationsDir:       getenv("ARKIVE_MIGRATIONS_DIR", "migrations"),
		MaxUploadBytes:      getenvInt64("ARKIVE_MAX_UPLOAD_BYTES", 10*1024*1024*1024),
		DataDir:             getenv("ARKIVE_DATA_DIR", "/data/arkive"),
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
	}
}

func (c Config) IsProduction() bool {
	return c.Env == "production" || c.Env == "prod"
}

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
		return fmt.Errorf("ARKIVE_SESSION_SECRET must be set to a strong value when ARKIVE_ENV=production")
	}
	if isWeakSecret(c.SecretsKey) {
		return fmt.Errorf("ARKIVE_SECRETS_KEY must be set to a strong value when ARKIVE_ENV=production (do not reuse the default session secret)")
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
