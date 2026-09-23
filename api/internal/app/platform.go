package app

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"regexp"
	"strings"
	"sync"

	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/crypto"
	"github.com/arkive/arkive/internal/db"
	"github.com/arkive/arkive/internal/models"
	"github.com/google/uuid"
)

// ErrSetupDone is returned by CreateSetupAdmin once any user exists.
var ErrSetupDone = errors.New("setup already completed")

type setupState struct {
	once  sync.Once
	token string
}

// SetupToken returns the token POST /api/setup requires: ARKIVE_SETUP_TOKEN
// when configured, otherwise a random token generated once per process (the
// serve command prints it to the log on first boot).
func (a *App) SetupToken() string {
	if t := strings.TrimSpace(a.Cfg.SetupToken); t != "" {
		return t
	}
	a.setup.once.Do(func() {
		b := make([]byte, 18)
		if _, err := rand.Read(b); err != nil {
			panic(err)
		}
		a.setup.token = base64.RawURLEncoding.EncodeToString(b)
	})
	return a.setup.token
}

// SetupNeeded reports whether the instance has zero users.
func (a *App) SetupNeeded(ctx context.Context) (bool, error) {
	var exists bool
	if err := a.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users)`).Scan(&exists); err != nil {
		return false, err
	}
	return !exists, nil
}

// setupLockKey serializes concurrent first-run setup requests.
const setupLockKey int64 = 872364012

// CreateSetupAdmin creates the first user as an active instance admin with a
// personal workspace. It returns ErrSetupDone when any user already exists.
//
// Race safety: the transaction takes an advisory lock before checking for
// users, so two concurrent requests cannot both see an empty table. SQLite
// gets the same guarantee from BEGIN IMMEDIATE.
func (a *App) CreateSetupAdmin(ctx context.Context, email, passwordHash, displayName string) (models.User, error) {
	var user models.User
	backendID, err := a.DefaultBackendID(ctx)
	if err != nil {
		return user, err
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return user, err
	}
	defer tx.Rollback(ctx)

	// SQLite: BEGIN IMMEDIATE already serializes writers.
	if tx.Dialect() == db.Postgres {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, setupLockKey); err != nil {
			return user, err
		}
	}
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users)`).Scan(&exists); err != nil {
		return user, err
	}
	if exists {
		return user, ErrSetupDone
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, display_name, is_instance_admin, status)
		VALUES ($1, $2, $3, TRUE, 'active')
		RETURNING id, email, display_name, is_instance_admin, status, created_at
	`, email, passwordHash, displayName).Scan(
		&user.ID, &user.Email, &user.DisplayName, &user.IsInstanceAdmin, &user.Status, &user.CreatedAt,
	)
	if err != nil {
		return user, err
	}
	wsID := uuid.New()
	if _, err := tx.Exec(ctx, `
		INSERT INTO workspaces (id, type, name, storage_backend_id)
		VALUES ($1, 'personal', $2, $3)
	`, wsID, displayName+"'s Files", backendID); err != nil {
		return user, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, 'owner')
	`, wsID, user.ID); err != nil {
		return user, err
	}
	return user, tx.Commit(ctx)
}

// ActiveSessionCount backs the arkive_active_sessions gauge.
func (a *App) ActiveSessionCount(ctx context.Context) (int64, error) {
	var n int64
	err := a.DB.QueryRow(ctx, `SELECT COUNT(*) FROM sessions WHERE expires_at > now()`).Scan(&n)
	return n, err
}

// StorageBytesUsed backs the arkive_storage_bytes_used gauge: file bodies
// (trash included, it still occupies storage) plus retained old versions.
func (a *App) StorageBytesUsed(ctx context.Context) (int64, error) {
	var n int64
	err := a.DB.QueryRow(ctx, `
		SELECT
			COALESCE((SELECT SUM(size) FROM nodes WHERE kind = 'file'), 0) +
			COALESCE((SELECT SUM(size) FROM node_versions), 0)
	`).Scan(&n)
	return n, err
}

var encryptedValue = regexp.MustCompile(`enc:v1:[A-Za-z0-9+/]+`)

// DetectLegacySecretsKey supports upgrading a 1.0 install that never set
// ARKIVE_SECRETS_KEY: 1.0 then encrypted stored credentials with a well-known
// placeholder. If existing ciphertext decrypts with one of those placeholders,
// that key is returned so the data stays readable. ok=false with
// encrypted=true means ciphertext exists that no known placeholder opens.
func DetectLegacySecretsKey(ctx context.Context, q db.Querier) (key string, encrypted bool) {
	var samples []string
	collect := func(sql string) {
		rows, err := q.Query(ctx, sql)
		if err != nil {
			return
		}
		defer rows.Close()
		for rows.Next() && len(samples) < 20 {
			var s string
			if rows.Scan(&s) == nil {
				samples = append(samples, encryptedValue.FindAllString(s, -1)...)
			}
		}
	}
	collect(`SELECT CAST(config AS TEXT) FROM storage_backends WHERE CAST(config AS TEXT) LIKE '%enc:v1:%'`)
	collect(`SELECT value FROM instance_settings WHERE value LIKE '%enc:v1:%'`)
	if len(samples) == 0 {
		return "", false
	}
	for _, candidate := range []string{config.DefaultComposeSecret, config.DefaultDevSessionSecret} {
		if _, err := crypto.Decrypt(candidate, samples[0]); err == nil {
			return candidate, true
		}
	}
	return "", true
}
