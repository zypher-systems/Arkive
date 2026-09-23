package app

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/auth"
	"github.com/arkive/arkive/internal/crypto"
	"github.com/arkive/arkive/internal/db"
	"github.com/google/uuid"
)

const RecoveryCodeCount = 10

// Crockford base32 alphabet (no i, l, o, u): 32 symbols, so a random byte
// masked with 31 maps without bias.
const recoveryAlphabet = "0123456789abcdefghjkmnpqrstvwxyz"

var ErrTwoFactorNotEnabled = errors.New("two-factor authentication is not enabled")

// DBTX is what helpers that may run inside or outside a transaction take.
type DBTX = db.Querier

func (a *App) EncryptTOTPSecret(secret string) (string, error) {
	return crypto.Encrypt(a.Cfg.SecretsKey, secret)
}

func (a *App) DecryptTOTPSecret(stored string) (string, error) {
	return crypto.Decrypt(a.Cfg.SecretsKey, stored)
}

// TwoFactorEnabled reports whether the user has an active TOTP secret.
func (a *App) TwoFactorEnabled(ctx context.Context, userID uuid.UUID) (bool, error) {
	var enabled bool
	err := a.DB.QueryRow(ctx, `SELECT totp_enabled_at IS NOT NULL FROM users WHERE id = $1`, userID).Scan(&enabled)
	return enabled, err
}

// VerifyTOTP checks a code against the user's active secret and atomically
// advances totp_last_step so the same code (or an older one) cannot be reused.
func (a *App) VerifyTOTP(ctx context.Context, q DBTX, userID uuid.UUID, code string) (bool, error) {
	var stored *string
	var lastStep int64
	err := q.QueryRow(ctx, `
		SELECT totp_secret, COALESCE(totp_last_step, -1)
		FROM users WHERE id = $1 AND totp_enabled_at IS NOT NULL
	`, userID).Scan(&stored, &lastStep)
	if errors.Is(err, db.ErrNoRows) {
		return false, ErrTwoFactorNotEnabled
	}
	if err != nil {
		return false, err
	}
	if stored == nil || *stored == "" {
		return false, ErrTwoFactorNotEnabled
	}
	secret, err := a.DecryptTOTPSecret(*stored)
	if err != nil {
		return false, err
	}
	step, ok := auth.ValidateTOTP(secret, code, time.Now(), lastStep)
	if !ok {
		return false, nil
	}
	tag, err := q.Exec(ctx, `
		UPDATE users SET totp_last_step = $2
		WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)
	`, userID, step)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// NormalizeRecoveryCode lowercases, strips separators, and folds Crockford
// look-alikes so "ABCD-EFGH", "abcd efgh" and "abcdefgh" are equivalent.
func NormalizeRecoveryCode(code string) string {
	var b strings.Builder
	for _, c := range strings.ToLower(code) {
		switch {
		case c == '-' || c == ' ' || c == '\t':
			continue
		case c == 'o':
			b.WriteRune('0')
		case c == 'i' || c == 'l':
			b.WriteRune('1')
		default:
			b.WriteRune(c)
		}
	}
	return b.String()
}

// recoveryCodeHash: recovery codes carry 40 random bits. A plain SHA-256 of
// that could be brute-forced offline from a DB dump, and argon2id would cost
// up to ten slow hashes per login attempt (a DoS lever). HMAC-SHA256 keyed
// with ARKIVE_SECRETS_KEY (a server-side pepper not stored in the DB) makes a
// DB-only leak useless, while online guessing is bounded by the auth rate
// limiter and the 5-attempt challenge lockout. Bound to the user id too.
func (a *App) recoveryCodeHash(userID uuid.UUID, normalized string) string {
	mac := hmac.New(sha256.New, []byte(a.Cfg.SecretsKey))
	mac.Write([]byte("arkive-recovery|"))
	mac.Write([]byte(userID.String()))
	mac.Write([]byte("|"))
	mac.Write([]byte(normalized))
	return hex.EncodeToString(mac.Sum(nil))
}

func newRecoveryCode() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, 0, 9)
	for i, b := range buf {
		if i == 4 {
			out = append(out, '-')
		}
		out = append(out, recoveryAlphabet[b&31])
	}
	return string(out), nil
}

// ReplaceRecoveryCodes deletes the user's recovery codes and stores a fresh set.
// Returns the plaintext codes (shown to the user exactly once).
func (a *App) ReplaceRecoveryCodes(ctx context.Context, q DBTX, userID uuid.UUID) ([]string, error) {
	if _, err := q.Exec(ctx, `DELETE FROM user_recovery_codes WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	codes := make([]string, 0, RecoveryCodeCount)
	seen := map[string]bool{}
	for len(codes) < RecoveryCodeCount {
		c, err := newRecoveryCode()
		if err != nil {
			return nil, err
		}
		n := NormalizeRecoveryCode(c)
		if seen[n] {
			continue
		}
		seen[n] = true
		if _, err := q.Exec(ctx, `
			INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)
		`, userID, a.recoveryCodeHash(userID, n)); err != nil {
			return nil, err
		}
		codes = append(codes, c)
	}
	return codes, nil
}

// ConsumeRecoveryCode marks a matching unused recovery code as used. Single use
// is enforced by the conditional UPDATE.
func (a *App) ConsumeRecoveryCode(ctx context.Context, q DBTX, userID uuid.UUID, code string) (bool, error) {
	n := NormalizeRecoveryCode(code)
	if len(n) != 8 {
		return false, nil
	}
	tag, err := q.Exec(ctx, `
		UPDATE user_recovery_codes SET used_at = now()
		WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
	`, userID, a.recoveryCodeHash(userID, n))
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// VerifySecondFactor accepts either a 6-digit TOTP code or a recovery code.
// method is "totp" or "recovery" on success.
func (a *App) VerifySecondFactor(ctx context.Context, q DBTX, userID uuid.UUID, code string) (method string, ok bool, err error) {
	if auth.LooksLikeTOTPCode(code) {
		ok, err = a.VerifyTOTP(ctx, q, userID, code)
		return "totp", ok, err
	}
	ok, err = a.ConsumeRecoveryCode(ctx, q, userID, code)
	return "recovery", ok, err
}

func (a *App) RecoveryCodesRemaining(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := a.DB.QueryRow(ctx, `
		SELECT COUNT(*) FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL
	`, userID).Scan(&n)
	return n, err
}

// ResetTwoFactor removes all 2FA state for a user (used by disable and admin reset).
func (a *App) ResetTwoFactor(ctx context.Context, q DBTX, userID uuid.UUID) error {
	if _, err := q.Exec(ctx, `
		UPDATE users
		SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL
		WHERE id = $1
	`, userID); err != nil {
		return err
	}
	if _, err := q.Exec(ctx, `DELETE FROM user_recovery_codes WHERE user_id = $1`, userID); err != nil {
		return err
	}
	_, err := q.Exec(ctx, `DELETE FROM login_challenges WHERE user_id = $1`, userID)
	return err
}
