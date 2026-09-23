package app

import (
	"context"

	"github.com/google/uuid"
)

// PruneNodeVersions applies the per-file version retention limit. The WebDAV
// handler archives versions inside its own transaction (overwrite via
// MOVE/COPY) and calls this afterwards, mirroring ArchiveCurrentVersion.
func (a *App) PruneNodeVersions(ctx context.Context, nodeID uuid.UUID) error {
	return a.pruneVersions(ctx, nodeID)
}
