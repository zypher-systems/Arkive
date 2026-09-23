package handlers

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/auth"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/models"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	loginChallengeTTL         = 5 * time.Minute
	loginChallengeMaxAttempts = 5
	totpIssuer                = "Arkive"
)

// startTwoFactorChallenge is called by Login after the password was verified
// for an account with 2FA enabled. No session cookie is set.
func (h *AuthHandler) startTwoFactorChallenge(w http.ResponseWriter, r *http.Request, userID uuid.UUID) {
	plain, hash, err := auth.NewSessionToken()
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not create challenge")
		return
	}
	_, err = h.App.DB.Exec(r.Context(), `
		INSERT INTO login_challenges (user_id, token_hash, expires_at) VALUES ($1, $2, $3)
	`, userID, hash, time.Now().Add(loginChallengeTTL))
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not create challenge")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"two_factor_required": true,
		"challenge":           plain,
	})
}

type loginTwoFactorRequest struct {
	Challenge string `json:"challenge"`
	Code      string `json:"code"`
}

// LoginTwoFactor completes a password login with a TOTP or recovery code.
// Errors: 401 "invalid code" (retry with the same challenge) or
// 401 "invalid or expired challenge" (start over with the password).
func (h *AuthHandler) LoginTwoFactor(w http.ResponseWriter, r *http.Request) {
	var req loginTwoFactorRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	challenge := strings.TrimSpace(req.Challenge)
	if challenge == "" || strings.TrimSpace(req.Code) == "" {
		httpjson.Error(w, http.StatusBadRequest, "challenge and code required")
		return
	}
	ctx := r.Context()
	tx, err := h.App.DB.Begin(ctx)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(ctx)

	// Row lock serializes concurrent attempts on the same challenge so the
	// attempt counter and single-use flag cannot be raced.
	var challengeID uuid.UUID
	var user models.User
	var attempts int
	var expires time.Time
	var usedAt *time.Time
	err = tx.QueryRow(ctx, `
		SELECT c.id, c.failed_attempts, c.expires_at, c.used_at,
		       u.id, u.email, u.display_name, u.is_instance_admin, u.status, u.created_at,
		       u.totp_enabled_at IS NOT NULL
		FROM login_challenges c
		JOIN users u ON u.id = c.user_id
		WHERE c.token_hash = $1
		FOR UPDATE OF c
	`, auth.HashToken(challenge)).Scan(
		&challengeID, &attempts, &expires, &usedAt,
		&user.ID, &user.Email, &user.DisplayName, &user.IsInstanceAdmin, &user.Status, &user.CreatedAt,
		&user.TwoFactorEnabled,
	)
	if err != nil || usedAt != nil || !expires.After(time.Now()) || attempts >= loginChallengeMaxAttempts ||
		user.Status != "active" || !user.TwoFactorEnabled {
		httpjson.Error(w, http.StatusUnauthorized, "invalid or expired challenge")
		return
	}

	method, ok, err := h.App.VerifySecondFactor(ctx, tx, user.ID, req.Code)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not verify code")
		return
	}
	if !ok {
		attempts++
		if _, err := tx.Exec(ctx, `
			UPDATE login_challenges SET failed_attempts = $2 WHERE id = $1
		`, challengeID, attempts); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "database error")
			return
		}
		if err := tx.Commit(ctx); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "database error")
			return
		}
		locked := attempts >= loginChallengeMaxAttempts
		h.App.Audit(ctx, r, user.ID.String(), "auth.login_failed", "user", user.ID.String(), map[string]any{
			"email":    user.Email,
			"reason":   "invalid_2fa_code",
			"attempts": attempts,
			"locked":   locked,
		})
		if locked {
			httpjson.Error(w, http.StatusUnauthorized, "invalid or expired challenge")
			return
		}
		httpjson.Error(w, http.StatusUnauthorized, "invalid code")
		return
	}
	tag, err := tx.Exec(ctx, `UPDATE login_challenges SET used_at = now() WHERE id = $1 AND used_at IS NULL`, challengeID)
	if err != nil || tag.RowsAffected() != 1 {
		httpjson.Error(w, http.StatusUnauthorized, "invalid or expired challenge")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "database error")
		return
	}
	if err := h.createSession(w, r, user.ID); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not create session")
		return
	}
	h.App.Audit(ctx, r, user.ID.String(), "auth.login", "user", user.ID.String(), map[string]any{
		"method":      "password",
		"second_step": method,
	})
	httpjson.Write(w, http.StatusOK, user)
}

// deleteOtherSessions removes every session of userID except the caller's.
func deleteOtherSessions(r *http.Request, q app.DBTX, userID uuid.UUID) error {
	current := ""
	if c, err := r.Cookie("arkive_session"); err == nil {
		current = auth.HashToken(c.Value)
	}
	_, err := q.Exec(r.Context(), `DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2`, userID, current)
	return err
}

func (h *AuthHandler) TwoFactorStatus(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	enabled, err := h.App.TwoFactorEnabled(r.Context(), user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	remaining := 0
	if enabled {
		remaining, err = h.App.RecoveryCodesRemaining(r.Context(), user.ID)
		if err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "query failed")
			return
		}
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"enabled":                  enabled,
		"recovery_codes_remaining": remaining,
	})
}

func (h *AuthHandler) TwoFactorSetup(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var hasPassword, enabled bool
	err := h.App.DB.QueryRow(r.Context(), `
		SELECT password_hash IS NOT NULL AND password_hash <> '', totp_enabled_at IS NOT NULL
		FROM users WHERE id = $1
	`, user.ID).Scan(&hasPassword, &enabled)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	if enabled {
		httpjson.Error(w, http.StatusConflict, "two-factor authentication already enabled")
		return
	}
	if !hasPassword {
		httpjson.Error(w, http.StatusBadRequest, "two-factor authentication applies to password logins; this account signs in via single sign-on")
		return
	}
	secret, err := auth.NewTOTPSecret()
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not generate secret")
		return
	}
	enc, err := h.App.EncryptTOTPSecret(secret)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not store secret")
		return
	}
	if _, err := h.App.DB.Exec(r.Context(), `
		UPDATE users SET totp_pending_secret = $2 WHERE id = $1 AND totp_enabled_at IS NULL
	`, user.ID, enc); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not store secret")
		return
	}
	httpjson.Write(w, http.StatusOK, map[string]string{
		"secret":      secret,
		"otpauth_url": auth.TOTPURL(totpIssuer, user.Email, secret),
	})
}

type twoFactorCodeRequest struct {
	Code     string `json:"code"`
	Password string `json:"password"`
}

func (h *AuthHandler) TwoFactorEnable(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var req twoFactorCodeRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	ctx := r.Context()
	tx, err := h.App.DB.Begin(ctx)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(ctx)
	var pending *string
	var enabled bool
	err = tx.QueryRow(ctx, `
		SELECT totp_pending_secret, totp_enabled_at IS NOT NULL FROM users WHERE id = $1 FOR UPDATE
	`, user.ID).Scan(&pending, &enabled)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	if enabled {
		httpjson.Error(w, http.StatusConflict, "two-factor authentication already enabled")
		return
	}
	if pending == nil || *pending == "" {
		httpjson.Error(w, http.StatusBadRequest, "call setup first")
		return
	}
	secret, err := h.App.DecryptTOTPSecret(*pending)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not read secret")
		return
	}
	step, ok := auth.ValidateTOTP(secret, req.Code, time.Now(), -1)
	if !ok {
		httpjson.Error(w, http.StatusBadRequest, "invalid code")
		return
	}
	if _, err := tx.Exec(ctx, `
		UPDATE users
		SET totp_secret = totp_pending_secret, totp_pending_secret = NULL,
		    totp_enabled_at = now(), totp_last_step = $2
		WHERE id = $1
	`, user.ID, step); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not enable")
		return
	}
	codes, err := h.App.ReplaceRecoveryCodes(ctx, tx, user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not create recovery codes")
		return
	}
	if err := deleteOtherSessions(r, tx, user.ID); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not enable")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not enable")
		return
	}
	h.App.Audit(ctx, r, user.ID.String(), "auth.2fa_enabled", "user", user.ID.String(), nil)
	httpjson.Write(w, http.StatusOK, map[string]any{"recovery_codes": codes})
}

func (h *AuthHandler) TwoFactorDisable(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var req twoFactorCodeRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Password == "" || strings.TrimSpace(req.Code) == "" {
		httpjson.Error(w, http.StatusBadRequest, "password and code required")
		return
	}
	ctx := r.Context()
	var hash *string
	if err := h.App.DB.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, user.ID).Scan(&hash); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	if hash == nil || !auth.CheckPassword(req.Password, *hash) {
		httpjson.Error(w, http.StatusForbidden, "invalid password")
		return
	}
	tx, err := h.App.DB.Begin(ctx)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(ctx)
	var enabled bool
	if err := tx.QueryRow(ctx, `
		SELECT totp_enabled_at IS NOT NULL FROM users WHERE id = $1 FOR UPDATE
	`, user.ID).Scan(&enabled); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "database error")
		return
	}
	if !enabled {
		httpjson.Error(w, http.StatusConflict, "two-factor authentication is not enabled")
		return
	}
	_, ok, err := h.App.VerifySecondFactor(ctx, tx, user.ID, req.Code)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not verify code")
		return
	}
	if !ok {
		httpjson.Error(w, http.StatusForbidden, "invalid code")
		return
	}
	if err := h.App.ResetTwoFactor(ctx, tx, user.ID); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not disable")
		return
	}
	if err := deleteOtherSessions(r, tx, user.ID); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not disable")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not disable")
		return
	}
	h.App.Audit(ctx, r, user.ID.String(), "auth.2fa_disabled", "user", user.ID.String(), nil)
	httpjson.Write(w, http.StatusOK, map[string]any{"enabled": false})
}

func (h *AuthHandler) TwoFactorRegenerateRecovery(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	var req twoFactorCodeRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	ctx := r.Context()
	tx, err := h.App.DB.Begin(ctx)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(ctx)
	ok, err := h.App.VerifyTOTP(ctx, tx, user.ID, req.Code)
	if errors.Is(err, app.ErrTwoFactorNotEnabled) {
		httpjson.Error(w, http.StatusConflict, "two-factor authentication is not enabled")
		return
	}
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not verify code")
		return
	}
	if !ok {
		httpjson.Error(w, http.StatusForbidden, "invalid code")
		return
	}
	codes, err := h.App.ReplaceRecoveryCodes(ctx, tx, user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not create recovery codes")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not create recovery codes")
		return
	}
	h.App.Audit(ctx, r, user.ID.String(), "auth.2fa_recovery_codes_regenerated", "user", user.ID.String(), nil)
	httpjson.Write(w, http.StatusOK, map[string]any{"recovery_codes": codes})
}

// ResetTwoFactor (admin) clears a user's 2FA so they can sign in with the password alone.
func (h *AdminUsersHandler) ResetTwoFactor(w http.ResponseWriter, r *http.Request) {
	actor := middleware.UserFromContext(r.Context())
	userID, err := uuid.Parse(chi.URLParam(r, "userID"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid user id")
		return
	}
	var exists bool
	if err := h.App.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, userID).Scan(&exists); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	if !exists {
		httpjson.Error(w, http.StatusNotFound, "user not found")
		return
	}
	err = pgx.BeginFunc(r.Context(), h.App.DB, func(tx pgx.Tx) error {
		return h.App.ResetTwoFactor(r.Context(), tx, userID)
	})
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not reset")
		return
	}
	h.App.Audit(r.Context(), r, actor.ID.String(), "user.2fa_reset", "user", userID.String(), nil)
	httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
}
