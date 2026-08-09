package models

import (
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID              uuid.UUID `json:"id"`
	Email           string    `json:"email"`
	DisplayName     string    `json:"display_name"`
	IsInstanceAdmin bool      `json:"is_instance_admin"`
	Status          string    `json:"status"`
	CreatedAt       time.Time `json:"created_at"`
}

type Workspace struct {
	ID               uuid.UUID  `json:"id"`
	Type             string     `json:"type"`
	Name             string     `json:"name"`
	StorageBackendID *uuid.UUID `json:"storage_backend_id,omitempty"`
	InviteToken      *string    `json:"invite_token,omitempty"`
	Role             string     `json:"role,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
}

type WorkspaceMember struct {
	UserID      uuid.UUID `json:"user_id"`
	Email       string    `json:"email"`
	DisplayName string    `json:"display_name"`
	Role        string    `json:"role"`
	CreatedAt   time.Time `json:"created_at"`
}

type Node struct {
	ID          uuid.UUID  `json:"id"`
	WorkspaceID uuid.UUID  `json:"workspace_id"`
	ParentID    *uuid.UUID `json:"parent_id,omitempty"`
	Name        string     `json:"name"`
	Kind        string     `json:"kind"`
	Size        int64      `json:"size"`
	Mime        *string    `json:"mime,omitempty"`
	StorageKey  *string    `json:"-"`
	Checksum    *string    `json:"checksum,omitempty"`
	CreatedBy   *uuid.UUID `json:"created_by,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	DeletedAt   *time.Time `json:"deleted_at,omitempty"`
}

type PublicLink struct {
	ID            uuid.UUID  `json:"id"`
	NodeID        uuid.UUID  `json:"node_id"`
	Token         string     `json:"token"`
	HasPass       bool       `json:"has_password"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
	MaxDownloads  *int       `json:"max_downloads,omitempty"`
	DownloadCount int        `json:"download_count"`
	URL           string     `json:"url,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
}

type Share struct {
	ID                 uuid.UUID  `json:"id"`
	NodeID             uuid.UUID  `json:"node_id"`
	GranteeUserID      *uuid.UUID `json:"grantee_user_id,omitempty"`
	GranteeWorkspaceID *uuid.UUID `json:"grantee_workspace_id,omitempty"`
	GranteeEmail       *string    `json:"grantee_email,omitempty"`
	GranteeName        *string    `json:"grantee_name,omitempty"`
	Permission         string     `json:"permission"`
	CreatedBy          *uuid.UUID `json:"created_by,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
}

type Breadcrumb struct {
	ID   uuid.UUID `json:"id"`
	Name string    `json:"name"`
}
