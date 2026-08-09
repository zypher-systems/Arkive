package app

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"path"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

const maxIndexedText = 256 * 1024

// IndexNodeText extracts searchable text for text-like and Office files after upload.
func (a *App) IndexNodeText(ctx context.Context, workspaceID, nodeID uuid.UUID, mime string, storageKey string) {
	if storageKey == "" {
		return
	}
	var name string
	_ = a.DB.QueryRow(ctx, `SELECT name FROM nodes WHERE id = $1`, nodeID).Scan(&name)
	if !isIndexable(mime, name) {
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
	buf, err := io.ReadAll(io.LimitReader(rc, 8<<20))
	if err != nil {
		return
	}
	text := extractText(mime, name, buf)
	if text == "" {
		return
	}
	if len(text) > maxIndexedText {
		text = text[:maxIndexedText]
	}
	if !utf8.ValidString(text) {
		text = strings.ToValidUTF8(text, "")
	}
	_, _ = a.DB.Exec(ctx, `UPDATE nodes SET content_text = $1 WHERE id = $2`, text, nodeID)
}

// ReindexMissing walks files without content_text (instance admin job).
func (a *App) ReindexMissing(ctx context.Context, limit int) (int, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := a.DB.Query(ctx, `
		SELECT id, workspace_id, mime, storage_key, name
		FROM nodes
		WHERE kind = 'file' AND deleted_at IS NULL AND storage_key IS NOT NULL
		  AND (content_text IS NULL OR content_text = '')
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id, ws uuid.UUID
		var mime *string
		var key, name string
		if err := rows.Scan(&id, &ws, &mime, &key, &name); err != nil {
			return n, err
		}
		m := ""
		if mime != nil {
			m = *mime
		}
		a.IndexNodeText(ctx, ws, id, m, key)
		n++
	}
	return n, rows.Err()
}

func isIndexable(mime, name string) bool {
	return isTextMime(mime) || isOfficeName(name) || isOfficeMime(mime)
}

func isTextMime(mime string) bool {
	mime = strings.ToLower(strings.TrimSpace(mime))
	if strings.HasPrefix(mime, "text/") {
		return true
	}
	switch mime {
	case "application/json", "application/xml", "application/javascript", "application/csv",
		"application/x-sh", "application/x-yaml":
		return true
	default:
		return false
	}
}

func isOfficeMime(mime string) bool {
	m := strings.ToLower(mime)
	return strings.Contains(m, "wordprocessingml") ||
		strings.Contains(m, "spreadsheetml") ||
		strings.Contains(m, "presentationml") ||
		m == "application/msword" ||
		m == "application/vnd.ms-excel" ||
		m == "application/vnd.ms-powerpoint"
}

func isOfficeName(name string) bool {
	n := strings.ToLower(name)
	for _, ext := range []string{".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp"} {
		if strings.HasSuffix(n, ext) {
			return true
		}
	}
	return false
}

func extractText(mime, name string, data []byte) string {
	n := strings.ToLower(name)
	if isTextMime(mime) || looksTextExt(n) {
		if utf8.Valid(data) {
			return string(data)
		}
		return ""
	}
	if strings.HasSuffix(n, ".docx") || strings.Contains(strings.ToLower(mime), "wordprocessingml") {
		return zipXMLText(data, "word/document.xml")
	}
	if strings.HasSuffix(n, ".xlsx") || strings.Contains(strings.ToLower(mime), "spreadsheetml") {
		return zipXMLText(data, "xl/sharedStrings.xml")
	}
	if strings.HasSuffix(n, ".pptx") || strings.Contains(strings.ToLower(mime), "presentationml") {
		return zipCollectPrefix(data, "ppt/slides/slide")
	}
	if strings.HasSuffix(n, ".odt") || strings.HasSuffix(n, ".ods") || strings.HasSuffix(n, ".odp") {
		return zipXMLText(data, "content.xml")
	}
	return ""
}

func looksTextExt(n string) bool {
	for _, ext := range []string{".txt", ".md", ".json", ".yaml", ".yml", ".csv", ".log", ".go", ".ts", ".js", ".py", ".rs", ".css", ".html", ".xml", ".sh"} {
		if strings.HasSuffix(n, ext) {
			return true
		}
	}
	return false
}

func zipXMLText(data []byte, entry string) string {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return ""
	}
	for _, f := range zr.File {
		if f.Name != entry && path.Base(f.Name) != path.Base(entry) {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return ""
		}
		b, _ := io.ReadAll(io.LimitReader(rc, maxIndexedText*2))
		_ = rc.Close()
		return stripXML(string(b))
	}
	return ""
}

func zipCollectPrefix(data []byte, prefix string) string {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return ""
	}
	var b strings.Builder
	for _, f := range zr.File {
		if !strings.HasPrefix(f.Name, prefix) || !strings.HasSuffix(f.Name, ".xml") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		raw, _ := io.ReadAll(io.LimitReader(rc, 256*1024))
		_ = rc.Close()
		b.WriteString(stripXML(string(raw)))
		b.WriteByte(' ')
		if b.Len() > maxIndexedText {
			break
		}
	}
	return b.String()
}

func stripXML(s string) string {
	var out strings.Builder
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
			out.WriteByte(' ')
		case !inTag:
			out.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(out.String()), " ")
}
