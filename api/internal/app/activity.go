package app

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
)

func (a *App) LogActivity(ctx context.Context, nodeID *uuid.UUID, workspaceID *uuid.UUID, actorID *uuid.UUID, action string, detail map[string]any) {
	if detail == nil {
		detail = map[string]any{}
	}
	raw, err := json.Marshal(detail)
	if err != nil {
		if a.Logger != nil {
			a.Logger.Warn("activity detail marshal failed", "action", action, "err", err)
		}
		raw = []byte("{}")
	}
	if _, err := a.DB.Exec(ctx, `
		INSERT INTO activity_events (node_id, workspace_id, actor_user_id, action, detail)
		VALUES ($1, $2, $3, $4, $5::jsonb)
	`, nodeID, workspaceID, actorID, action, raw); err != nil && a.Logger != nil {
		a.Logger.Warn("activity insert failed", "action", action, "err", err)
	}
}
