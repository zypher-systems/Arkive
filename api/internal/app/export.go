package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/arkive/arkive/internal/storage"
	"github.com/google/uuid"
)

// ExportOptions tunes Export.
type ExportOptions struct {
	// IncludeTrash also exports soft-deleted (trashed) items, in their
	// original location. Live items keep their names; trashed ones get a
	// " (2)"-style suffix on collision.
	IncludeTrash bool
}

// ExportIssue is a non-fatal problem with one item (e.g. a missing blob).
type ExportIssue struct {
	WorkspaceID uuid.UUID `json:"workspace_id"`
	NodeID      uuid.UUID `json:"node_id,omitempty"`
	Path        string    `json:"path"`
	Error       string    `json:"error"`
}

// ExportReport summarizes an Export run. Paths are relative to OutDir.
type ExportReport struct {
	OutDir     string        `json:"out_dir"`
	Workspaces int           `json:"workspaces"`
	Folders    int           `json:"folders"`
	Files      int           `json:"files"`
	Bytes      int64         `json:"bytes"`
	Renamed    int           `json:"renamed"` // items written under a de-duplicated name
	Issues     []ExportIssue `json:"issues,omitempty"`
}

type exportNode struct {
	id         uuid.UUID
	parentID   *uuid.UUID
	name       string
	kind       string
	storageKey *string
	updatedAt  time.Time
	deleted    bool
}

// Export rebuilds the real folder tree of one workspace (workspaceID) or of
// every workspace (workspaceID == "") under outDir as
// "<outDir>/<workspace name>/<path>", streaming file contents from each
// workspace's storage backend and preserving modification times.
//
// Trashed items are skipped unless opts[0].IncludeTrash is set. Existing
// entries in outDir are never overwritten or followed: a name that is already
// taken (by an earlier sibling, a pre-existing file, or a symlink) is written
// as "name (2).ext", "name (3).ext", and so on. Names are sanitized so nothing
// is ever written outside outDir.
//
// Per-item failures (e.g. a blob missing from storage) are collected in
// ExportReport.Issues; the returned error is reserved for fatal problems
// (bad arguments, unreadable database, unwritable outDir).
func (a *App) Export(ctx context.Context, workspaceID string, outDir string, opts ...ExportOptions) (ExportReport, error) {
	var opt ExportOptions
	if len(opts) > 0 {
		opt = opts[0]
	}
	var rep ExportReport
	if strings.TrimSpace(outDir) == "" {
		return rep, errors.New("export: outDir required")
	}
	root, err := filepath.Abs(outDir)
	if err != nil {
		return rep, fmt.Errorf("export: %w", err)
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return rep, fmt.Errorf("export: create outDir: %w", err)
	}
	rep.OutDir = root

	type wsRow struct {
		id   uuid.UUID
		name string
	}
	var spaces []wsRow
	if strings.TrimSpace(workspaceID) != "" {
		id, err := uuid.Parse(strings.TrimSpace(workspaceID))
		if err != nil {
			return rep, fmt.Errorf("export: invalid workspace id %q", workspaceID)
		}
		var w wsRow
		if err := a.DB.QueryRow(ctx, `SELECT id, name FROM workspaces WHERE id = $1`, id).Scan(&w.id, &w.name); err != nil {
			if IsNoRows(err) {
				return rep, fmt.Errorf("export: workspace %s: %w", id, ErrNotFound)
			}
			return rep, fmt.Errorf("export: %w", err)
		}
		spaces = append(spaces, w)
	} else {
		rows, err := a.DB.Query(ctx, `SELECT id, name FROM workspaces ORDER BY name, created_at, id`)
		if err != nil {
			return rep, fmt.Errorf("export: list workspaces: %w", err)
		}
		for rows.Next() {
			var w wsRow
			if err := rows.Scan(&w.id, &w.name); err != nil {
				rows.Close()
				return rep, err
			}
			spaces = append(spaces, w)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return rep, err
		}
	}

	for _, w := range spaces {
		if err := ctx.Err(); err != nil {
			return rep, err
		}
		if err := a.exportWorkspace(ctx, w.id, w.name, root, opt, &rep); err != nil {
			return rep, err
		}
	}
	return rep, nil
}

func (a *App) exportWorkspace(ctx context.Context, wsID uuid.UUID, wsName, root string, opt ExportOptions, rep *ExportReport) error {
	q := `SELECT id, parent_id, name, kind, storage_key, updated_at, deleted_at IS NOT NULL
	      FROM nodes WHERE workspace_id = $1`
	if !opt.IncludeTrash {
		q += ` AND deleted_at IS NULL`
	}
	rows, err := a.DB.Query(ctx, q, wsID)
	if err != nil {
		return fmt.Errorf("export: list nodes: %w", err)
	}
	byID := map[uuid.UUID]*exportNode{}
	var all []*exportNode
	for rows.Next() {
		n := &exportNode{}
		if err := rows.Scan(&n.id, &n.parentID, &n.name, &n.kind, &n.storageKey, &n.updatedAt, &n.deleted); err != nil {
			rows.Close()
			return err
		}
		byID[n.id] = n
		all = append(all, n)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("export: list nodes: %w", err)
	}
	children := map[uuid.UUID][]*exportNode{}
	var top []*exportNode
	for _, n := range all {
		if n.parentID == nil {
			top = append(top, n)
			continue
		}
		if _, ok := byID[*n.parentID]; ok {
			children[*n.parentID] = append(children[*n.parentID], n)
		}
		// Items whose parent was excluded (trashed) are unreachable: skipped.
	}

	wsDir, _, err := createUniqueDir(root, exportSafeName(wsName))
	if err != nil {
		return fmt.Errorf("export: create workspace dir: %w", err)
	}
	rep.Workspaces++

	var store storage.BlobStore
	var storeErr error
	storeLoaded := false
	getStore := func() (storage.BlobStore, error) {
		if !storeLoaded {
			store, storeErr = a.StoreForWorkspace(ctx, wsID)
			storeLoaded = true
		}
		return store, storeErr
	}

	visited := map[uuid.UUID]bool{}
	var walk func(dir string, items []*exportNode) error
	walk = func(dir string, items []*exportNode) error {
		sortExportNodes(items)
		for _, n := range items {
			if err := ctx.Err(); err != nil {
				return err
			}
			if visited[n.id] {
				continue
			}
			visited[n.id] = true
			rel := func(p string) string {
				r, _ := filepath.Rel(root, p)
				return filepath.ToSlash(r)
			}
			switch n.kind {
			case "folder":
				sub, renamed, err := createUniqueDir(dir, exportSafeName(n.name))
				if err != nil {
					rep.Issues = append(rep.Issues, ExportIssue{WorkspaceID: wsID, NodeID: n.id, Path: rel(filepath.Join(dir, n.name)), Error: err.Error()})
					continue
				}
				if renamed {
					rep.Renamed++
				}
				rep.Folders++
				if err := walk(sub, children[n.id]); err != nil {
					return err
				}
				_ = os.Chtimes(sub, n.updatedAt, n.updatedAt)
			case "file":
				path, renamed, written, err := a.exportFile(ctx, getStore, dir, n)
				if err != nil {
					p := path
					if p == "" {
						p = filepath.Join(dir, exportSafeName(n.name))
					}
					rep.Issues = append(rep.Issues, ExportIssue{WorkspaceID: wsID, NodeID: n.id, Path: rel(p), Error: err.Error()})
					continue
				}
				if renamed {
					rep.Renamed++
				}
				rep.Files++
				rep.Bytes += written
			}
		}
		return nil
	}
	if err := walk(wsDir, top); err != nil {
		return err
	}
	return nil
}

func (a *App) exportFile(ctx context.Context, getStore func() (storage.BlobStore, error), dir string, n *exportNode) (string, bool, int64, error) {
	if n.storageKey == nil || *n.storageKey == "" {
		return "", false, 0, errors.New("file has no stored content")
	}
	st, err := getStore()
	if err != nil {
		return "", false, 0, fmt.Errorf("storage unavailable: %w", err)
	}
	rc, _, err := st.Get(ctx, *n.storageKey)
	if err != nil {
		return "", false, 0, fmt.Errorf("read blob: %w", err)
	}
	defer rc.Close()
	f, path, renamed, err := createUniqueFile(dir, exportSafeName(n.name))
	if err != nil {
		return "", false, 0, err
	}
	written, copyErr := io.Copy(f, rc)
	closeErr := f.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(path)
		if copyErr != nil {
			return path, renamed, 0, fmt.Errorf("copy: %w", copyErr)
		}
		return path, renamed, 0, closeErr
	}
	_ = os.Chtimes(path, n.updatedAt, n.updatedAt)
	return path, renamed, written, nil
}

// sortExportNodes orders live items before trashed ones (so live items keep
// their real names), then by name and id for deterministic output.
func sortExportNodes(items []*exportNode) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].deleted != items[j].deleted {
			return !items[i].deleted
		}
		if items[i].name != items[j].name {
			return items[i].name < items[j].name
		}
		return items[i].id.String() < items[j].id.String()
	})
}

const maxExportNameBytes = 240 // leaves room for a " (n)" suffix under 255

// exportSafeName turns a stored name into a single safe path component.
func exportSafeName(name string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r == '/' || r == '\\' || r == 0 || r < 0x20 || r == 0x7f:
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	s := strings.TrimSpace(b.String())
	if s == "" || s == "." || s == ".." {
		s = "_"
	}
	if len(s) > maxExportNameBytes {
		ext := filepath.Ext(s)
		if len(ext) > 16 {
			ext = ""
		}
		base := s[:maxExportNameBytes-len(ext)]
		for !utf8.ValidString(base) && len(base) > 0 {
			base = base[:len(base)-1]
		}
		s = base + ext
	}
	return s
}

// candidateName returns name for k == 1 and "base (k).ext" afterwards.
func candidateName(name string, k int, splitExt bool) string {
	if k == 1 {
		return name
	}
	ext := ""
	base := name
	if splitExt {
		ext = filepath.Ext(name)
		if ext == name { // ".bashrc"
			ext = ""
		}
		base = strings.TrimSuffix(name, ext)
	}
	return base + " (" + strconv.Itoa(k) + ")" + ext
}

const maxNameAttempts = 10000

func checkedJoin(dir, name string) (string, error) {
	if name == "" || name == "." || name == ".." || strings.ContainsAny(name, `/\`) {
		return "", fmt.Errorf("unsafe name %q", name)
	}
	p := filepath.Join(dir, name)
	if filepath.Dir(p) != filepath.Clean(dir) {
		return "", fmt.Errorf("unsafe name %q", name)
	}
	return p, nil
}

// createUniqueDir makes a new directory (never reusing an existing entry).
func createUniqueDir(dir, name string) (string, bool, error) {
	for k := 1; k <= maxNameAttempts; k++ {
		p, err := checkedJoin(dir, candidateName(name, k, false))
		if err != nil {
			return "", false, err
		}
		err = os.Mkdir(p, 0o755)
		if err == nil {
			return p, k > 1, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return "", false, err
		}
	}
	return "", false, fmt.Errorf("too many name collisions for %q", name)
}

// createUniqueFile creates a new file with O_EXCL (never following or
// overwriting an existing entry, including symlinks).
func createUniqueFile(dir, name string) (*os.File, string, bool, error) {
	for k := 1; k <= maxNameAttempts; k++ {
		p, err := checkedJoin(dir, candidateName(name, k, true))
		if err != nil {
			return nil, "", false, err
		}
		f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			return f, p, k > 1, nil
		}
		if !errors.Is(err, fs.ErrExist) {
			return nil, "", false, err
		}
	}
	return nil, "", false, fmt.Errorf("too many name collisions for %q", name)
}
