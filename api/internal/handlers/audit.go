package handlers

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/google/uuid"
)

type AuditHandler struct {
	App *app.App
}

type auditEntry struct {
	ID          uuid.UUID       `json:"id"`
	CreatedAt   time.Time       `json:"created_at"`
	ActorUserID *uuid.UUID      `json:"actor_user_id"`
	ActorEmail  *string         `json:"actor_email"`
	Action      string          `json:"action"`
	TargetType  string          `json:"target_type"`
	TargetID    string          `json:"target_id"`
	IP          string          `json:"ip"`
	Meta        json.RawMessage `json:"meta"`
}

// Cursor is opaque to clients: base64url("<created_at RFC3339Nano>|<id>").
func encodeAuditCursor(t time.Time, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString([]byte(t.UTC().Format(time.RFC3339Nano) + "|" + id.String()))
}

func decodeAuditCursor(s string) (time.Time, uuid.UUID, error) {
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	ts, idStr, ok := strings.Cut(string(raw), "|")
	if !ok {
		return time.Time{}, uuid.Nil, errors.New("bad cursor")
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	return t, id, nil
}

// List: GET /api/admin/audit?limit=50&cursor=&action=<prefix>&actor=<user id>
// Newest first; keyset pagination on (created_at, id).
func (h *AuditHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit := 50
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			httpjson.Error(w, http.StatusBadRequest, "invalid limit")
			return
		}
		limit = min(n, 200)
	}
	where := []string{"TRUE"}
	args := []any{}
	arg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(len(args))
	}
	if c := q.Get("cursor"); c != "" {
		t, id, err := decodeAuditCursor(c)
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, "invalid cursor")
			return
		}
		where = append(where, "(created_at, id) < ("+arg(t)+"::timestamptz, "+arg(id)+"::uuid)")
	}
	if a := strings.TrimSpace(q.Get("action")); a != "" {
		where = append(where, "action LIKE "+arg(escapeLike(a)+"%")+` ESCAPE '\'`)
	}
	if a := strings.TrimSpace(q.Get("actor")); a != "" {
		id, err := uuid.Parse(a)
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, "invalid actor")
			return
		}
		where = append(where, "actor_user_id = "+arg(id))
	}
	sql := `
		SELECT id, created_at, actor_user_id, actor_email, action, target_type, target_id, ip, meta
		FROM audit_log
		WHERE ` + strings.Join(where, " AND ") + `
		ORDER BY created_at DESC, id DESC
		LIMIT ` + arg(limit+1)
	rows, err := h.App.DB.Query(r.Context(), sql, args...)
	if err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	defer rows.Close()
	items := []auditEntry{}
	for rows.Next() {
		var e auditEntry
		var meta []byte
		if err := rows.Scan(&e.ID, &e.CreatedAt, &e.ActorUserID, &e.ActorEmail, &e.Action, &e.TargetType, &e.TargetID, &e.IP, &meta); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "scan failed")
			return
		}
		if len(meta) == 0 {
			meta = []byte("{}")
		}
		e.Meta = meta
		items = append(items, e)
	}
	if err := rows.Err(); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "query failed")
		return
	}
	var next *string
	if len(items) > limit {
		items = items[:limit]
		last := items[len(items)-1]
		c := encodeAuditCursor(last.CreatedAt, last.ID)
		next = &c
	}
	httpjson.Write(w, http.StatusOK, map[string]any{
		"items":       items,
		"next_cursor": next,
	})
}

// actorID returns the authenticated user's id as a string ("" when anonymous).
func actorID(r *http.Request) string {
	if u := middleware.UserFromContext(r.Context()); u != nil {
		return u.ID.String()
	}
	return ""
}
