package config

import "testing"

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
	ok := Config{Env: "production", SessionSecret: "strong-session", SecretsKey: "strong-secrets"}
	if err := ok.ValidateSecrets(); err != nil {
		t.Fatal(err)
	}
	dev := Config{Env: "development", SessionSecret: DefaultDevSessionSecret, SecretsKey: DefaultDevSessionSecret}
	if err := dev.ValidateSecrets(); err != nil {
		t.Fatal("dev should allow defaults")
	}
}
