package app

import (
	"context"
	"errors"

	"github.com/arkive/arkive/internal/db"
	"github.com/google/uuid"
)

var (
	ErrForbidden         = errors.New("forbidden")
	ErrNotFound          = errors.New("not found")
	ErrWorkspaceMismatch = errors.New("parent not in workspace")
)

type AccessLevel int

const (
	AccessNone AccessLevel = iota
	AccessRead
	AccessWrite
)

func roleAllowsWrite(role string) bool {
	return role == "owner" || role == "admin" || role == "member"
}

func (a *App) WorkspaceRole(ctx context.Context, workspaceID, userID uuid.UUID) (string, error) {
	var role string
	err := a.DB.QueryRow(ctx, `
		SELECT role FROM workspace_members
		WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, userID).Scan(&role)
	if errors.Is(err, db.ErrNoRows) {
		return "", ErrForbidden
	}
	return role, err
}

func (a *App) RequireWorkspaceAccess(ctx context.Context, workspaceID, userID uuid.UUID, write bool) error {
	role, err := a.WorkspaceRole(ctx, workspaceID, userID)
	if err != nil {
		return err
	}
	if write && !roleAllowsWrite(role) {
		return ErrForbidden
	}
	return nil
}

// NodeAccess returns the effective access for a user on a node.
// Checks workspace membership first, then share grants on the node or any ancestor.
func (a *App) NodeAccess(ctx context.Context, nodeID, userID uuid.UUID) (AccessLevel, uuid.UUID, error) {
	var workspaceID uuid.UUID
	var parentID *uuid.UUID
	err := a.DB.QueryRow(ctx, `
		SELECT workspace_id, parent_id FROM nodes WHERE id = $1 AND deleted_at IS NULL
	`, nodeID).Scan(&workspaceID, &parentID)
	if errors.Is(err, db.ErrNoRows) {
		return AccessNone, uuid.Nil, ErrNotFound
	}
	if err != nil {
		return AccessNone, uuid.Nil, err
	}

	role, err := a.WorkspaceRole(ctx, workspaceID, userID)
	if err == nil {
		if roleAllowsWrite(role) {
			return AccessWrite, workspaceID, nil
		}
		return AccessRead, workspaceID, nil
	}
	if !errors.Is(err, ErrForbidden) {
		return AccessNone, uuid.Nil, err
	}

	// Walk ancestors for share grants
	current := &nodeID
	for current != nil {
		level, err := a.shareAccess(ctx, *current, userID)
		if err != nil {
			return AccessNone, uuid.Nil, err
		}
		if level > AccessNone {
			return level, workspaceID, nil
		}
		var next *uuid.UUID
		err = a.DB.QueryRow(ctx, `SELECT parent_id FROM nodes WHERE id = $1`, *current).Scan(&next)
		if errors.Is(err, db.ErrNoRows) {
			break
		}
		if err != nil {
			return AccessNone, uuid.Nil, err
		}
		current = next
	}
	return AccessNone, workspaceID, ErrForbidden
}

func (a *App) shareAccess(ctx context.Context, nodeID, userID uuid.UUID) (AccessLevel, error) {
	rows, err := a.DB.Query(ctx, `
		SELECT s.permission
		FROM shares s
		WHERE s.node_id = $1
		  AND (
		    s.grantee_user_id = $2
		    OR s.grantee_workspace_id IN (
		      SELECT workspace_id FROM workspace_members WHERE user_id = $2
		    )
		  )
	`, nodeID, userID)
	if err != nil {
		return AccessNone, err
	}
	defer rows.Close()

	level := AccessNone
	for rows.Next() {
		var perm string
		if err := rows.Scan(&perm); err != nil {
			return AccessNone, err
		}
		if perm == "write" {
			return AccessWrite, nil
		}
		if perm == "read" {
			level = AccessRead
		}
	}
	return level, rows.Err()
}

func (a *App) RequireNodeAccess(ctx context.Context, nodeID, userID uuid.UUID, write bool) (uuid.UUID, error) {
	level, workspaceID, err := a.NodeAccess(ctx, nodeID, userID)
	if err != nil {
		return uuid.Nil, err
	}
	if write && level < AccessWrite {
		return uuid.Nil, ErrForbidden
	}
	if level < AccessRead {
		return uuid.Nil, ErrForbidden
	}
	return workspaceID, nil
}

// RequireParentInWorkspace ensures the user can access parentID and that it belongs to workspaceID.
func (a *App) RequireParentInWorkspace(ctx context.Context, parentID, workspaceID, userID uuid.UUID, write bool) error {
	parentWS, err := a.RequireNodeAccess(ctx, parentID, userID, write)
	if err != nil {
		return err
	}
	if parentWS != workspaceID {
		return ErrWorkspaceMismatch
	}
	return nil
}

func WriteHTTPError(err error) (int, string) {
	switch {
	case errors.Is(err, ErrNotFound):
		return 404, "not found"
	case errors.Is(err, ErrForbidden):
		return 403, "forbidden"
	case errors.Is(err, ErrWorkspaceMismatch):
		return 400, "parent not in workspace"
	default:
		return 500, "internal error"
	}
}
