package app

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/arkive/arkive/internal/crypto"
	"github.com/arkive/arkive/internal/mail"
)

const (
	settingSMTPHost     = "smtp_host"
	settingSMTPPort     = "smtp_port"
	settingSMTPUser     = "smtp_user"
	settingSMTPPassword = "smtp_password"
	settingSMTPFrom     = "smtp_from"
)

type smtpCache struct {
	mu      sync.RWMutex
	value   mail.Config
	expires time.Time
}

func (a *App) InvalidateSMTPCache() {
	if a == nil {
		return
	}
	a.smtp.mu.Lock()
	a.smtp.expires = time.Time{}
	a.smtp.mu.Unlock()
}

func (a *App) ResolveSMTP(ctx context.Context) mail.Config {
	a.smtp.mu.RLock()
	if time.Now().Before(a.smtp.expires) {
		v := a.smtp.value
		a.smtp.mu.RUnlock()
		return v
	}
	a.smtp.mu.RUnlock()

	v := a.resolveSMTPUncached(ctx)
	a.smtp.mu.Lock()
	a.smtp.value = v
	a.smtp.expires = time.Now().Add(30 * time.Second)
	a.smtp.mu.Unlock()
	return v
}

func (a *App) resolveSMTPUncached(ctx context.Context) mail.Config {
	envHost := strings.TrimSpace(os.Getenv("ARKIVE_SMTP_HOST"))
	envFrom := strings.TrimSpace(os.Getenv("ARKIVE_SMTP_FROM"))
	if envHost != "" && envFrom != "" {
		return mail.Config{
			Host:     envHost,
			Port:     strings.TrimSpace(os.Getenv("ARKIVE_SMTP_PORT")),
			User:     strings.TrimSpace(os.Getenv("ARKIVE_SMTP_USER")),
			Password: strings.TrimSpace(os.Getenv("ARKIVE_SMTP_PASSWORD")),
			From:     envFrom,
		}
	}
	host, _ := a.getSetting(ctx, settingSMTPHost)
	port, _ := a.getSetting(ctx, settingSMTPPort)
	user, _ := a.getSetting(ctx, settingSMTPUser)
	from, _ := a.getSetting(ctx, settingSMTPFrom)
	encPass, _ := a.getSetting(ctx, settingSMTPPassword)
	pass := ""
	if encPass != "" {
		if s, err := crypto.Decrypt(a.Cfg.SecretsKey, encPass); err == nil {
			pass = s
		}
	}
	return mail.Config{
		Host:     host,
		Port:     port,
		User:     user,
		Password: pass,
		From:     from,
	}
}

func (a *App) SaveSMTPSettings(ctx context.Context, host, port, user, password, from string, clear bool) error {
	if clear || strings.TrimSpace(host) == "" {
		_ = a.deleteSetting(ctx, settingSMTPHost)
		_ = a.deleteSetting(ctx, settingSMTPPort)
		_ = a.deleteSetting(ctx, settingSMTPUser)
		_ = a.deleteSetting(ctx, settingSMTPPassword)
		_ = a.deleteSetting(ctx, settingSMTPFrom)
		a.InvalidateSMTPCache()
		return nil
	}
	if err := a.setSetting(ctx, settingSMTPHost, strings.TrimSpace(host)); err != nil {
		return err
	}
	_ = a.setSetting(ctx, settingSMTPPort, strings.TrimSpace(port))
	_ = a.setSetting(ctx, settingSMTPUser, strings.TrimSpace(user))
	_ = a.setSetting(ctx, settingSMTPFrom, strings.TrimSpace(from))
	if strings.TrimSpace(password) != "" {
		enc, err := crypto.Encrypt(a.Cfg.SecretsKey, strings.TrimSpace(password))
		if err != nil {
			return err
		}
		if err := a.setSetting(ctx, settingSMTPPassword, enc); err != nil {
			return err
		}
	}
	a.InvalidateSMTPCache()
	return nil
}

func (a *App) SMTPSettingsPublic(ctx context.Context) map[string]any {
	cfg := a.ResolveSMTP(ctx)
	source := "none"
	if cfg.Enabled() {
		if strings.TrimSpace(os.Getenv("ARKIVE_SMTP_HOST")) != "" {
			source = "env"
		} else {
			source = "db"
		}
	}
	enc, _ := a.getSetting(ctx, settingSMTPPassword)
	return map[string]any{
		"enabled":     cfg.Enabled(),
		"host":        cfg.Host,
		"port":        cfg.Port,
		"user":        cfg.User,
		"from":        cfg.From,
		"has_password": enc != "" || (source == "env" && cfg.Password != ""),
		"source":      source,
	}
}

func (a *App) SendSignupStatusEmail(ctx context.Context, email, displayName, status string) {
	cfg := a.ResolveSMTP(ctx)
	if !cfg.Enabled() {
		return
	}
	subject := "Arkive account update"
	body := ""
	switch status {
	case "active":
		subject = "Your Arkive account is approved"
		body = "Hi " + displayName + ",\n\nYour Arkive account has been approved. Sign in at:\n" +
			a.Cfg.PublicURL + "\n\n— Arkive\n"
	case "rejected":
		subject = "Your Arkive signup was not approved"
		body = "Hi " + displayName + ",\n\nYour Arkive signup request was not approved.\n\n— Arkive\n"
	default:
		return
	}
	if err := mail.Send(cfg, email, subject, body); err != nil && a.Logger != nil {
		a.Logger.Warn("signup email failed", "email", email, "status", status, "err", err)
	}
}

func (a *App) SendPasswordResetEmail(ctx context.Context, email, displayName, resetURL string) error {
	cfg := a.ResolveSMTP(ctx)
	if !cfg.Enabled() {
		return fmt.Errorf("smtp not configured")
	}
	subject := "Reset your Arkive password"
	body := "Hi " + displayName + ",\n\n" +
		"We received a request to reset your Arkive password. Open this link within one hour:\n\n" +
		resetURL + "\n\n" +
		"If you did not request this, you can ignore this email.\n\n— Arkive\n"
	return mail.Send(cfg, email, subject, body)
}
