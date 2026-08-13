package app

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

var ErrQuotaExceeded = errors.New("storage quota exceeded")

const settingDefaultWorkspaceQuota = "default_workspace_quota_bytes"

type QuotaInfo struct {
	UsedBytes  int64  `json:"used_bytes"`
	QuotaBytes *int64 `json:"quota_bytes,omitempty"` // nil = unlimited
	Files      int64  `json:"files"`
}

func (a *App) WorkspaceUsedBytes(ctx context.Context, workspaceID uuid.UUID) (bytes int64, files int64, err error) {
	err = a.DB.QueryRow(ctx, `
		SELECT COALESCE(SUM(size), 0), COUNT(*)
		FROM nodes
		WHERE workspace_id = $1 AND kind = 'file' AND deleted_at IS NULL
	`, workspaceID).Scan(&bytes, &files)
	return
}

// EffectiveWorkspaceQuota: workspace.quota_bytes → owner user.quota_bytes (personal) → instance default.
func (a *App) EffectiveWorkspaceQuota(ctx context.Context, workspaceID uuid.UUID) (*int64, error) {
	var wsQuota *int64
	var wsType string
	var ownerID *uuid.UUID
	err := a.DB.QueryRow(ctx, `
		SELECT w.quota_bytes, w.type,
		       (SELECT m.user_id FROM workspace_members m
		        WHERE m.workspace_id = w.id AND m.role = 'owner' LIMIT 1)
		FROM workspaces w WHERE w.id = $1
	`, workspaceID).Scan(&wsQuota, &wsType, &ownerID)
	if err != nil {
		return nil, err
	}
	if wsQuota != nil && *wsQuota > 0 {
		return wsQuota, nil
	}
	if wsType == "personal" && ownerID != nil {
		var userQuota *int64
		if err := a.DB.QueryRow(ctx, `SELECT quota_bytes FROM users WHERE id = $1`, *ownerID).Scan(&userQuota); err == nil {
			if userQuota != nil && *userQuota > 0 {
				return userQuota, nil
			}
		}
	}
	raw, _ := a.getSetting(ctx, settingDefaultWorkspaceQuota)
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || n <= 0 {
		return nil, nil
	}
	return &n, nil
}

func (a *App) WorkspaceQuotaInfo(ctx context.Context, workspaceID uuid.UUID) (QuotaInfo, error) {
	used, files, err := a.WorkspaceUsedBytes(ctx, workspaceID)
	if err != nil {
		return QuotaInfo{}, err
	}
	q, err := a.EffectiveWorkspaceQuota(ctx, workspaceID)
	if err != nil {
		return QuotaInfo{}, err
	}
	return QuotaInfo{UsedBytes: used, QuotaBytes: q, Files: files}, nil
}

// EnsureQuota allows adding `incoming` bytes (use 0 to only read). deltaExisting is size replaced on overwrite.
func (a *App) EnsureQuota(ctx context.Context, workspaceID uuid.UUID, incoming, replaceExisting int64) error {
	if incoming <= 0 {
		return nil
	}
	info, err := a.WorkspaceQuotaInfo(ctx, workspaceID)
	if err != nil {
		return err
	}
	if info.QuotaBytes == nil {
		return nil
	}
	projected := info.UsedBytes - replaceExisting + incoming
	if projected < 0 {
		projected = incoming
	}
	if projected > *info.QuotaBytes {
		return fmt.Errorf("%w: used %d + %d exceeds quota %d", ErrQuotaExceeded, info.UsedBytes, incoming-replaceExisting, *info.QuotaBytes)
	}
	return nil
}

// QuotaHeadroom is remaining bytes that may be added after replacing replaceExisting.
// unlimited is true when the workspace has no quota.
func (a *App) QuotaHeadroom(ctx context.Context, workspaceID uuid.UUID, replaceExisting int64) (remaining int64, unlimited bool, err error) {
	info, err := a.WorkspaceQuotaInfo(ctx, workspaceID)
	if err != nil {
		return 0, false, err
	}
	if info.QuotaBytes == nil {
		return 0, true, nil
	}
	used := info.UsedBytes - replaceExisting
	if used < 0 {
		used = 0
	}
	remaining = *info.QuotaBytes - used
	if remaining < 0 {
		remaining = 0
	}
	if remaining == 0 {
		return 0, false, fmt.Errorf("%w: used %d exceeds quota %d", ErrQuotaExceeded, info.UsedBytes, *info.QuotaBytes)
	}
	return remaining, false, nil
}

func (a *App) TreeSize(ctx context.Context, nodeID uuid.UUID) (int64, error) {
	var total int64
	err := a.DB.QueryRow(ctx, `
		WITH RECURSIVE t AS (
			SELECT id, kind, size FROM nodes WHERE id = $1 AND deleted_at IS NULL
			UNION ALL
			SELECT n.id, n.kind, n.size FROM nodes n
			JOIN t ON n.parent_id = t.id
			WHERE n.deleted_at IS NULL
		)
		SELECT COALESCE(SUM(size), 0) FROM t WHERE kind = 'file'
	`, nodeID).Scan(&total)
	return total, err
}
