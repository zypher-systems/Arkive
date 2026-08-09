package app

import (
	"bytes"
	"context"
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

// GenerateThumbnail creates a JPEG thumbnail for image nodes (best-effort).
func (a *App) GenerateThumbnail(ctx context.Context, workspaceID, nodeID uuid.UUID, mime, storageKey string) {
	if storageKey == "" {
		return
	}
	var name string
	_ = a.DB.QueryRow(ctx, `SELECT name FROM nodes WHERE id = $1`, nodeID).Scan(&name)
	if !isImageMime(mime, name) {
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
	img, _, err := image.Decode(io.LimitReader(rc, 32<<20))
	if err != nil || img == nil {
		return
	}
	thumb := resizeImage(img, thumbMaxEdge)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, thumb, &jpeg.Options{Quality: 82}); err != nil {
		return
	}
	key := ThumbKey(workspaceID, nodeID)
	if err := store.Put(ctx, key, bytes.NewReader(buf.Bytes()), int64(buf.Len()), "image/jpeg"); err != nil {
		return
	}
	_, _ = a.DB.Exec(ctx, `UPDATE nodes SET thumb_key = $1 WHERE id = $2`, key, nodeID)
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
