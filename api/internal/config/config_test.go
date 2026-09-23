package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadDefaultStorageEnv(t *testing.T) {
	t.Setenv("ARKIVE_S3_ENDPOINT", "")
	t.Setenv("ARKIVE_DATA_DIR", "")
	cfg := Load()
	if cfg.S3Endpoint != "" {
		t.Fatalf("S3 endpoint should be empty, got %q", cfg.S3Endpoint)
	}
	if cfg.DataDir != "/data/arkive" {
		t.Fatalf("data dir=%q", cfg.DataDir)
	}
}

func TestLoadDatabaseURLDefaultsToSQLiteInDataDir(t *testing.T) {
	t.Setenv("ARKIVE_DATABASE_URL", "")
	t.Setenv("ARKIVE_DATA_DIR", "/srv/arkive")
	cfg := Load()
	if cfg.DatabaseURL != "sqlite:///srv/arkive/arkive.db" || !cfg.DatabaseURLDefaulted {
		t.Fatalf("default database url=%q defaulted=%v", cfg.DatabaseURL, cfg.DatabaseURLDefaulted)
	}
	t.Setenv("ARKIVE_DATABASE_URL", "postgres://a:b@db/arkive")
	cfg = Load()
	if cfg.DatabaseURL != "postgres://a:b@db/arkive" || cfg.DatabaseURLDefaulted {
		t.Fatalf("explicit database url=%q defaulted=%v", cfg.DatabaseURL, cfg.DatabaseURLDefaulted)
	}
}

func TestLoadSecretsFromEnv(t *testing.T) {
	t.Setenv("ARKIVE_SESSION_SECRET", "")
	t.Setenv("ARKIVE_SECRETS_KEY", "")
	cfg := Load()
	if cfg.SessionSecret != "" || cfg.SecretsKey != "" {
		t.Fatalf("unset secrets should stay empty until resolved, got %q/%q", cfg.SessionSecret, cfg.SecretsKey)
	}
	t.Setenv("ARKIVE_SESSION_SECRET", "only-session")
	cfg = Load()
	if cfg.SecretsKey != "only-session" {
		t.Fatalf("1.0 fallback: secrets key should reuse session secret, got %q", cfg.SecretsKey)
	}
}

func TestLoadMigrationsDirDefaultsToEmbedded(t *testing.T) {
	t.Setenv("ARKIVE_MIGRATIONS_DIR", "")
	if dir := Load().MigrationsDir; dir != "" {
		t.Fatalf("migrations dir=%q, want empty (embedded)", dir)
	}
}

func TestValidateSecretsProduction(t *testing.T) {
	weak := Config{Env: "production", SessionSecret: DefaultDevSessionSecret, SecretsKey: "ok-key-with-entropy"}
	if err := weak.ValidateSecrets(); err == nil {
		t.Fatal("expected error for default session secret")
	}
	weakKey := Config{Env: "production", SessionSecret: "strong-session", SecretsKey: DefaultDevSessionSecret}
	if err := weakKey.ValidateSecrets(); err == nil {
		t.Fatal("expected error for default secrets key")
	}
	placeholder := Config{Env: "production", SessionSecret: DefaultComposeSecret, SecretsKey: "strong-secrets"}
	if err := placeholder.ValidateSecrets(); err == nil {
		t.Fatal("expected error for compose placeholder session secret")
	}
	empty := Config{Env: "production"}
	if err := empty.ValidateSecrets(); err == nil {
		t.Fatal("expected error for unresolved secrets")
	}
	ok := Config{Env: "production", SessionSecret: "strong-session", SecretsKey: "strong-secrets"}
	if err := ok.ValidateSecrets(); err != nil {
		t.Fatal(err)
	}
	dev := Config{Env: "development", SessionSecret: DefaultDevSessionSecret, SecretsKey: DefaultDevSessionSecret}
	if err := dev.ValidateSecrets(); err != nil {
		t.Fatal("dev should allow defaults")
	}
}

func TestResolveSecretsGeneratesAndPersists(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	cfg := Config{Env: "production", DataDir: dir}
	res, err := cfg.ResolveSecrets(nil)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Created || !res.Used || res.Adopted {
		t.Fatalf("unexpected result %+v", res)
	}
	if len(cfg.SessionSecret) < 40 || len(cfg.SecretsKey) < 40 || cfg.SessionSecret == cfg.SecretsKey {
		t.Fatalf("weak generated secrets %q / %q", cfg.SessionSecret, cfg.SecretsKey)
	}
	// Production accepts generated secrets.
	if err := cfg.ValidateSecrets(); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(filepath.Join(dir, SecretsFileName))
	if err != nil {
		t.Fatal(err)
	}
	if st.Mode().Perm() != 0o600 {
		t.Fatalf("secrets file mode=%v, want 0600", st.Mode().Perm())
	}

	// Second boot reuses the persisted values and does not rewrite the file.
	again := Config{DataDir: dir}
	res2, err := again.ResolveSecrets(func() string { t.Fatal("adopt must not be called when the file exists"); return "" })
	if err != nil {
		t.Fatal(err)
	}
	if res2.Created || !res2.Used {
		t.Fatalf("unexpected second result %+v", res2)
	}
	if again.SessionSecret != cfg.SessionSecret || again.SecretsKey != cfg.SecretsKey {
		t.Fatal("persisted secrets not reused")
	}
}

func TestResolveSecretsEnvWins(t *testing.T) {
	dir := t.TempDir()
	first := Config{DataDir: dir}
	if _, err := first.ResolveSecrets(nil); err != nil {
		t.Fatal(err)
	}
	cfg := Config{DataDir: dir, SessionSecret: "from-env-session"}
	if _, err := cfg.ResolveSecrets(nil); err != nil {
		t.Fatal(err)
	}
	if cfg.SessionSecret != "from-env-session" {
		t.Fatalf("env session secret overridden: %q", cfg.SessionSecret)
	}
	if cfg.SecretsKey != first.SecretsKey {
		t.Fatal("secrets key should come from the file")
	}
	raw, _ := os.ReadFile(filepath.Join(dir, SecretsFileName))
	if strings.Contains(string(raw), "from-env-session") {
		t.Fatal("env values must not be written to the secrets file")
	}

	both := Config{DataDir: filepath.Join(t.TempDir(), "none"), SessionSecret: "a", SecretsKey: "b"}
	res, err := both.ResolveSecrets(nil)
	if err != nil {
		t.Fatal(err)
	}
	if res.Used || res.Created {
		t.Fatal("no file should be touched when env provides both")
	}
	if _, err := os.Stat(both.SecretsFilePath()); !os.IsNotExist(err) {
		t.Fatal("secrets file should not exist")
	}
}

func TestResolveSecretsAdoptsLegacyKey(t *testing.T) {
	cfg := Config{DataDir: t.TempDir()}
	res, err := cfg.ResolveSecrets(func() string { return DefaultComposeSecret })
	if err != nil {
		t.Fatal(err)
	}
	if !res.Adopted || cfg.SecretsKey != DefaultComposeSecret {
		t.Fatalf("legacy key not adopted: %+v key=%q", res, cfg.SecretsKey)
	}
	if cfg.SessionSecret == DefaultComposeSecret || cfg.SessionSecret == "" {
		t.Fatal("session secret should be freshly generated")
	}
}
