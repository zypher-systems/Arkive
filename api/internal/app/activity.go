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
	raw, _ := json.Marshal(detail)
	_, _ = a.DB.Exec(ctx, `
		INSERT INTO activity_events (node_id, workspace_id, actor_user_id, action, detail)
		VALUES ($1, $2, $3, $4, $5::jsonb)
	`, nodeID, workspaceID, actorID, action, raw)
}
