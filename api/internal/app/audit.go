package app

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/arkive/arkive/internal/middleware"
	"github.com/google/uuid"
)

// AuditRetention is how long audit entries are kept before the hourly job purges them.
const AuditRetention = 180 * 24 * time.Hour

// Audit records a security-relevant event. It never fails the caller: errors
// are logged and swallowed. r may be nil (background jobs); actorUserID may be
// empty for anonymous actors (e.g. public upload links, failed logins for
// unknown emails). The actor's email is snapshotted so entries stay readable
// after the user is deleted.
func (a *App) Audit(ctx context.Context, r *http.Request, actorUserID, action, targetType, targetID string, meta map[string]any) {
	if a == nil || a.DB == nil {
		return
	}
	if meta == nil {
		meta = map[string]any{}
	}
	raw, err := json.Marshal(meta)
	if err != nil {
		a.auditWarn("audit meta marshal failed", action, err)
		raw = []byte("{}")
	}
	var actor *uuid.UUID
	if actorUserID != "" {
		if id, err := uuid.Parse(actorUserID); err == nil && id != uuid.Nil {
			actor = &id
		}
	}
	ip := ""
	if r != nil {
		// Same source the rate limiter keys on.
		ip = middleware.ClientIP(r)
	}
	// Detach from request cancellation so the record is written even if the
	// client hung up, but bound the time we spend on it.
	wctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if _, err := a.DB.Exec(wctx, `
		INSERT INTO audit_log (actor_user_id, actor_email, action, target_type, target_id, ip, meta)
		VALUES ($1, (SELECT email FROM users WHERE id = $1), $2, $3, $4, $5, $6::jsonb)
	`, actor, action, targetType, targetID, ip, raw); err != nil {
		a.auditWarn("audit insert failed", action, err)
	}
}

func (a *App) auditWarn(msg, action string, err error) {
	if a.Logger != nil {
		a.Logger.Warn(msg, "action", action, "err", err)
	}
}

// PurgeOldAudit deletes audit entries older than AuditRetention.
func (a *App) PurgeOldAudit(ctx context.Context) (int64, error) {
	tag, err := a.DB.Exec(ctx, `DELETE FROM audit_log WHERE created_at < $1`, time.Now().Add(-AuditRetention))
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}
