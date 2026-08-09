package app

import (
	"context"
	"io"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

const maxIndexedText = 256 * 1024

// IndexNodeText extracts searchable text for text-like files after upload.
func (a *App) IndexNodeText(ctx context.Context, workspaceID, nodeID uuid.UUID, mime string, storageKey string) {
	if storageKey == "" || !isTextMime(mime) {
		return
	}
	store, err := a.StoreForWorkspace(ctx, workspaceID)
	if err != nil {
		return
	}
	rc, _, err := store.Get(ctx, storageKey)
	if err != nil {
		return
	}
	defer rc.Close()
	buf, err := io.ReadAll(io.LimitReader(rc, maxIndexedText))
	if err != nil || !utf8.Valid(buf) {
		return
	}
	text := string(buf)
	_, _ = a.DB.Exec(ctx, `UPDATE nodes SET content_text = $1 WHERE id = $2`, text, nodeID)
}

func isTextMime(mime string) bool {
	mime = strings.ToLower(strings.TrimSpace(mime))
	if strings.HasPrefix(mime, "text/") {
		return true
	}
	switch mime {
	case "application/json", "application/xml", "application/javascript", "application/csv":
		return true
	default:
		return false
	}
}
