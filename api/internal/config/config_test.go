package config

import "testing"

func TestValidateSecretsProduction(t *testing.T) {
	weak := Config{Env: "production", SessionSecret: DefaultDevSessionSecret, SecretsKey: "ok-key-with-entropy"}
	if err := weak.ValidateSecrets(); err == nil {
		t.Fatal("expected error for default session secret")
	}
	weakKey := Config{Env: "production", SessionSecret: "strong-session", SecretsKey: DefaultDevSessionSecret}
	if err := weakKey.ValidateSecrets(); err == nil {
		t.Fatal("expected error for default secrets key")
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
