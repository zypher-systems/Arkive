package app

import (
	"bytes"
	"context"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"strings"

	"github.com/google/uuid"
	"golang.org/x/image/draw"
)

const thumbMaxEdge = 256

func ThumbKey(workspaceID, nodeID uuid.UUID) string {
	return "thumbs/" + workspaceID.String() + "/" + nodeID.String() + ".jpg"
}

func isImageMime(mime, name string) bool {
	m := strings.ToLower(mime)
	if strings.HasPrefix(m, "image/") && !strings.Contains(m, "svg") {
		return true
	}
	n := strings.ToLower(name)
	for _, ext := range []string{".png", ".jpg", ".jpeg", ".gif", ".bmp"} {
		if strings.HasSuffix(n, ext) {
			return true
		}
	}
	return false
}

// GenerateThumbnail creates a JPEG thumbnail for image nodes (best-effort;
// failures are logged).
func (a *App) GenerateThumbnail(ctx context.Context, workspaceID, nodeID uuid.UUID, mime, storageKey string) {
	if err := a.generateThumbnail(ctx, workspaceID, nodeID, mime, storageKey); err != nil {
		a.log().Warn("thumbnail failed", "workspace_id", workspaceID, "node_id", nodeID, "err", err)
	}
}

func (a *App) generateThumbnail(ctx context.Context, workspaceID, nodeID uuid.UUID, mime, storageKey string) error {
	if storageKey == "" {
		return nil
	}
	var name string
	if err := a.DB.QueryRow(ctx, `SELECT name FROM nodes WHERE id = $1`, nodeID).Scan(&name); err != nil {
		return fmt.Errorf("load node: %w", err)
	}
	if !isImageMime(mime, name) {
		return nil
	}
	store, err := a.StoreForWorkspace(ctx, workspaceID)
	if err != nil {
		return fmt.Errorf("open store: %w", err)
	}
	rc, _, err := store.Get(ctx, storageKey)
	if err != nil {
		return fmt.Errorf("read blob: %w", err)
	}
	defer rc.Close()
	img, _, err := image.Decode(io.LimitReader(rc, 32<<20))
	if err != nil || img == nil {
		// Undecodable or unsupported image format: nothing to do.
		return nil
	}
	thumb := resizeImage(img, thumbMaxEdge)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, thumb, &jpeg.Options{Quality: 82}); err != nil {
		return fmt.Errorf("encode: %w", err)
	}
	key := ThumbKey(workspaceID, nodeID)
	if err := store.Put(ctx, key, bytes.NewReader(buf.Bytes()), int64(buf.Len()), "image/jpeg"); err != nil {
		return fmt.Errorf("store thumbnail: %w", err)
	}
	if _, err := a.DB.Exec(ctx, `UPDATE nodes SET thumb_key = $1 WHERE id = $2`, key, nodeID); err != nil {
		return fmt.Errorf("save thumb key: %w", err)
	}
	return nil
}

func (a *App) DeleteThumbnail(ctx context.Context, workspaceID uuid.UUID, thumbKey *string) {
	if thumbKey == nil || *thumbKey == "" {
		return
	}
	store, err := a.StoreForWorkspace(ctx, workspaceID)
	if err != nil {
		return
	}
	_ = store.Delete(ctx, *thumbKey)
}

func resizeImage(src image.Image, maxEdge int) image.Image {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 0 || h <= 0 {
		return src
	}
	if w <= maxEdge && h <= maxEdge {
		return src
	}
	scale := float64(maxEdge) / float64(w)
	if h > w {
		scale = float64(maxEdge) / float64(h)
	}
	nw := int(float64(w) * scale)
	nh := int(float64(h) * scale)
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}
	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, b, draw.Over, nil)
	return dst
}
