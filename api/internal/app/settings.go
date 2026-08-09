package app

import (
	"context"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/arkive/arkive/internal/crypto"
)

const (
	settingGoogleClientID     = "google_client_id"
	settingGoogleClientSecret = "google_client_secret"
	settingGoogleRedirectURL  = "google_redirect_url"
)

type GoogleOAuth struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	Source       string // env | db | none
	Enabled      bool
}

type googleOAuthCache struct {
	mu      sync.RWMutex
	value   GoogleOAuth
	expires time.Time
}

func (a *App) InvalidateGoogleOAuthCache() {
	if a == nil {
		return
	}
	a.googleOAuth.mu.Lock()
	a.googleOAuth.expires = time.Time{}
	a.googleOAuth.mu.Unlock()
}

func (a *App) ResolveGoogleOAuth(ctx context.Context) GoogleOAuth {
	a.googleOAuth.mu.RLock()
	if time.Now().Before(a.googleOAuth.expires) {
		v := a.googleOAuth.value
		a.googleOAuth.mu.RUnlock()
		return v
	}
	a.googleOAuth.mu.RUnlock()

	v := a.resolveGoogleOAuthUncached(ctx)

	a.googleOAuth.mu.Lock()
	a.googleOAuth.value = v
	a.googleOAuth.expires = time.Now().Add(30 * time.Second)
	a.googleOAuth.mu.Unlock()
	return v
}

func (a *App) resolveGoogleOAuthUncached(ctx context.Context) GoogleOAuth {
	defaultRedirect := strings.TrimRight(a.Cfg.PublicURL, "/") + "/api/auth/google/drive/callback"

	envID := strings.TrimSpace(os.Getenv("ARKIVE_GOOGLE_CLIENT_ID"))
	envSecret := strings.TrimSpace(os.Getenv("ARKIVE_GOOGLE_CLIENT_SECRET"))
	envRedirect := strings.TrimSpace(os.Getenv("ARKIVE_GOOGLE_REDIRECT_URL"))
	if envID != "" && envSecret != "" {
		redirect := envRedirect
		if redirect == "" {
			redirect = defaultRedirect
		}
		return GoogleOAuth{
			ClientID:     envID,
			ClientSecret: envSecret,
			RedirectURL:  redirect,
			Source:       "env",
			Enabled:      true,
		}
	}

	id, _ := a.getSetting(ctx, settingGoogleClientID)
	encSecret, _ := a.getSetting(ctx, settingGoogleClientSecret)
	redirect, _ := a.getSetting(ctx, settingGoogleRedirectURL)
	secret := ""
	if encSecret != "" {
		if s, err := crypto.Decrypt(a.Cfg.SecretsKey, encSecret); err == nil {
			secret = s
		}
	}
	if redirect == "" {
		redirect = defaultRedirect
	}
	if id != "" && secret != "" {
		return GoogleOAuth{
			ClientID:     id,
			ClientSecret: secret,
			RedirectURL:  redirect,
			Source:       "db",
			Enabled:      true,
		}
	}
	return GoogleOAuth{
		ClientID:    id,
		RedirectURL: redirect,
		Source:      "none",
		Enabled:     false,
	}
}

func (a *App) getSetting(ctx context.Context, key string) (string, error) {
	var value string
	err := a.DB.QueryRow(ctx, `SELECT value FROM instance_settings WHERE key = $1`, key).Scan(&value)
	if err != nil {
		return "", err
	}
	return value, nil
}

func (a *App) setSetting(ctx context.Context, key, value string) error {
	_, err := a.DB.Exec(ctx, `
		INSERT INTO instance_settings (key, value, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
	`, key, value)
	return err
}

func (a *App) deleteSetting(ctx context.Context, key string) error {
	_, err := a.DB.Exec(ctx, `DELETE FROM instance_settings WHERE key = $1`, key)
	return err
}

func (a *App) SaveGoogleOAuthSettings(ctx context.Context, clientID, clientSecret, redirectURL string, clear bool) error {
	if clear || strings.TrimSpace(clientID) == "" {
		_ = a.deleteSetting(ctx, settingGoogleClientID)
		_ = a.deleteSetting(ctx, settingGoogleClientSecret)
		_ = a.deleteSetting(ctx, settingGoogleRedirectURL)
		a.InvalidateGoogleOAuthCache()
		return nil
	}
	if err := a.setSetting(ctx, settingGoogleClientID, strings.TrimSpace(clientID)); err != nil {
		return err
	}
	if strings.TrimSpace(clientSecret) != "" {
		enc, err := crypto.Encrypt(a.Cfg.SecretsKey, strings.TrimSpace(clientSecret))
		if err != nil {
			return err
		}
		if err := a.setSetting(ctx, settingGoogleClientSecret, enc); err != nil {
			return err
		}
	}
	redirectURL = strings.TrimSpace(redirectURL)
	if redirectURL == "" {
		_ = a.deleteSetting(ctx, settingGoogleRedirectURL)
	} else {
		if err := a.setSetting(ctx, settingGoogleRedirectURL, redirectURL); err != nil {
			return err
		}
	}
	a.InvalidateGoogleOAuthCache()
	return nil
}

func (a *App) DBGoogleSecretPresent(ctx context.Context) bool {
	enc, err := a.getSetting(ctx, settingGoogleClientSecret)
	return err == nil && enc != ""
}

func (a *App) GoogleOAuthSettingsPublic(ctx context.Context) map[string]any {
	resolved := a.ResolveGoogleOAuth(ctx)
	dbID, _ := a.getSetting(ctx, settingGoogleClientID)
	dbRedirect, _ := a.getSetting(ctx, settingGoogleRedirectURL)
	clientID := dbID
	if resolved.Source == "env" {
		clientID = resolved.ClientID
	} else if resolved.Source == "db" {
		clientID = resolved.ClientID
	}
	redirect := resolved.RedirectURL
	if resolved.Source != "env" && dbRedirect != "" {
		redirect = dbRedirect
	}
	return map[string]any{
		"enabled":      resolved.Enabled,
		"client_id":    clientID,
		"has_secret":   a.DBGoogleSecretPresent(ctx),
		"redirect_url": redirect,
		"source":       resolved.Source,
	}
}
