package handlers

import (
	"bytes"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	mimepkg "mime"
	"net/http"
	"net/url"
	"path"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/auth"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/models"
	"github.com/arkive/arkive/internal/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// WebDAVHandler serves /dav/{workspaceID}/… (RFC 4918 class 1 and 2).
// See docs/webdav.md for client notes and behaviour decisions.
type WebDAVHandler struct {
	App *app.App

	lockOnce sync.Once
	lockMgr  *davLockManager
}

const (
	davClassHeader = "1, 2"
	davAllowHeader = "OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE, PROPFIND, PROPPATCH, LOCK, UNLOCK"
)

var errDAVBadPath = errors.New("invalid path")

func (h *WebDAVHandler) locks() *davLockManager {
	h.lockOnce.Do(func() {
		if h.lockMgr == nil {
			h.lockMgr = newDAVLockManager()
		}
	})
	return h.lockMgr
}

func (h *WebDAVHandler) BasicLookup() middleware.BasicAuthLookup {
	return func(r *http.Request, email, password string) (*models.User, error) {
		email = strings.ToLower(strings.TrimSpace(email))
		var user models.User
		var hash *string
		err := h.App.DB.QueryRow(r.Context(), `
			SELECT id, email, display_name, is_instance_admin, status, created_at, password_hash,
			       totp_enabled_at IS NOT NULL
			FROM users WHERE email = $1
		`, email).Scan(&user.ID, &user.Email, &user.DisplayName, &user.IsInstanceAdmin, &user.Status, &user.CreatedAt, &hash, &user.TwoFactorEnabled)
		if err != nil {
			return nil, err
		}
		if user.Status != "active" {
			return nil, pgx.ErrNoRows
		}
		// Prefer account password, then app password (ark_<prefix>_<secret>).
		// With 2FA enabled the account password alone is not enough: app passwords only.
		if !user.TwoFactorEnabled && hash != nil && auth.CheckPassword(password, *hash) {
			return &user, nil
		}
		prefix, ok := parseAppPasswordPrefix(password)
		if !ok {
			return nil, pgx.ErrNoRows
		}
		var appID uuid.UUID
		var secretHash string
		err = h.App.DB.QueryRow(r.Context(), `
			SELECT id, secret_hash FROM app_passwords
			WHERE user_id = $1 AND prefix = $2 AND revoked_at IS NULL
		`, user.ID, prefix).Scan(&appID, &secretHash)
		if err != nil || !auth.CheckPassword(password, secretHash) {
			return nil, pgx.ErrNoRows
		}
		_, _ = h.App.DB.Exec(r.Context(), `
			UPDATE app_passwords SET last_used_at = now() WHERE id = $1
		`, appID)
		return &user, nil
	}
}

// parseDAVPath extracts the workspace id and the normalized relative path from
// /dav/{workspaceID}/…. urlPath must already be percent-decoded (r.URL.Path).
func parseDAVPath(urlPath string) (wsID uuid.UUID, rel string, err error) {
	rest := strings.TrimPrefix(urlPath, "/dav/")
	wsPart, relPath, _ := strings.Cut(rest, "/")
	wsID, err = uuid.Parse(wsPart)
	if err != nil {
		return uuid.Nil, "", err
	}
	rel, err = cleanDAVRel(relPath)
	if err != nil {
		return uuid.Nil, "", err
	}
	return wsID, rel, nil
}

// cleanDAVRel collapses empty segments and rejects dot segments and NULs.
// Names are otherwise kept byte-for-byte so clients see exactly what they wrote.
func cleanDAVRel(p string) (string, error) {
	var segs []string
	for _, s := range strings.Split(p, "/") {
		if s == "" {
			continue
		}
		if s == "." || s == ".." || strings.ContainsRune(s, 0) {
			return "", errDAVBadPath
		}
		segs = append(segs, s)
	}
	return strings.Join(segs, "/"), nil
}

// davRelFromURL maps a Destination header or If-header resource tag (absolute
// URL or absolute path) to a path in workspace ws. status is 400 for a
// malformed value and 502 for a URL outside this workspace.
func davRelFromURL(raw string, ws uuid.UUID) (rel string, status int) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Path == "" {
		return "", http.StatusBadRequest
	}
	p := u.Path
	marker := "/dav/" + ws.String()
	idx := strings.Index(p, marker)
	if idx < 0 {
		if strings.Contains(p, "/dav/") {
			return "", http.StatusBadGateway
		}
		return "", http.StatusBadRequest
	}
	rest := p[idx+len(marker):]
	if rest != "" && rest[0] != '/' {
		return "", http.StatusBadRequest
	}
	rel, err = cleanDAVRel(rest)
	if err != nil {
		return "", http.StatusBadRequest
	}
	return rel, 0
}

func davIsWrite(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions, "PROPFIND":
		return false
	}
	return true
}

func (h *WebDAVHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if r.URL.Path == "/dav/" || r.URL.Path == "/dav" {
		h.serveTop(w, r, user)
		return
	}
	wsID, rel, err := parseDAVPath(r.URL.Path)
	if err != nil {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	if err := h.App.RequireWorkspaceAccess(r.Context(), wsID, user.ID, davIsWrite(r.Method)); err != nil {
		if errors.Is(err, app.ErrForbidden) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	switch r.Method {
	case http.MethodOptions:
		davOptionsHeaders(w)
		w.WriteHeader(http.StatusOK)
	case "PROPFIND":
		h.propfind(w, r, wsID, rel)
	case "PROPPATCH":
		h.proppatch(w, r, wsID, user, rel)
	case http.MethodGet, http.MethodHead:
		h.get(w, r, wsID, rel)
	case http.MethodPut:
		h.put(w, r, wsID, user, rel)
	case "MKCOL":
		h.mkcol(w, r, wsID, user, rel)
	case http.MethodDelete:
		h.delete(w, r, wsID, user, rel)
	case "MOVE":
		h.transfer(w, r, wsID, user, rel, true)
	case "COPY":
		h.transfer(w, r, wsID, user, rel, false)
	case "LOCK":
		h.lock(w, r, wsID, user, rel)
	case "UNLOCK":
		h.unlock(w, r, wsID, user, rel)
	default:
		w.Header().Set("Allow", davAllowHeader)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func davOptionsHeaders(w http.ResponseWriter) {
	w.Header().Set("Allow", davAllowHeader)
	w.Header().Set("DAV", davClassHeader)
	w.Header().Set("MS-Author-Via", "DAV")
	w.Header().Set("Accept-Ranges", "bytes")
}

// serveTop handles /dav/ itself: a read-only collection listing the
// workspaces the user belongs to, so clients can be pointed at /dav/.
func (h *WebDAVHandler) serveTop(w http.ResponseWriter, r *http.Request, user *models.User) {
	switch r.Method {
	case http.MethodOptions:
		davOptionsHeaders(w)
		w.WriteHeader(http.StatusOK)
		return
	case "PROPFIND":
	default:
		w.Header().Set("Allow", "OPTIONS, PROPFIND")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	depth, ok := davPropfindDepth(w, r)
	if !ok {
		return
	}
	body, err := readDAVBody(r)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	spec, err := parsePropfind(body)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	pc := davPropContext{
		quota: func() (davQuota, bool) { return davQuota{}, false },
		locks: func(string) []davLock { return nil },
	}
	now := time.Now().UTC()
	entries := []davEntry{{Href: "/dav/", IsDir: true, Name: "Arkive", Modified: now, Created: now}}
	if depth == "1" {
		rows, err := h.App.DB.Query(r.Context(), `
			SELECT w.id, w.name, w.created_at FROM workspaces w
			JOIN workspace_members m ON m.workspace_id = w.id
			WHERE m.user_id = $1
			ORDER BY w.type DESC, w.name ASC
		`, user.ID)
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		for rows.Next() {
			var id uuid.UUID
			var name string
			var created time.Time
			if err := rows.Scan(&id, &name, &created); err != nil {
				rows.Close()
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			entries = append(entries, davEntry{Href: davHref(id, "", true), IsDir: true, Name: name, Modified: created, Created: created, ETag: davRootETag(id)})
		}
		rows.Close()
	}
	ms := newDAVMultistatus()
	for _, e := range entries {
		ms.add(e.Href, davPropstats(e, spec, pc))
	}
	ms.write(w)
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

type davTarget struct {
	Rel      string
	Node     *models.Node // nil for the workspace root or an unmapped path
	Root     bool
	ParentOK bool       // the parent collection exists
	ParentID *uuid.UUID // parent folder id (nil = workspace root)
	Name     string     // last path segment
}

func (t davTarget) exists() bool { return t.Root || t.Node != nil }
func (t davTarget) isDir() bool  { return t.Root || (t.Node != nil && t.Node.Kind == "folder") }

func (t davTarget) modTime() time.Time {
	if t.Node != nil {
		return t.Node.UpdatedAt
	}
	return time.Time{}
}

func davTargetETag(ws uuid.UUID, t davTarget) string {
	if t.Root {
		return davRootETag(ws)
	}
	return davNodeETag(t.Node)
}

const davNodeCols = `id, workspace_id, parent_id, name, kind, size, mime, storage_key, checksum, created_by, created_at, updated_at`

func scanDAVNode(row pgx.Row, n *models.Node) error {
	return row.Scan(&n.ID, &n.WorkspaceID, &n.ParentID, &n.Name, &n.Kind, &n.Size, &n.Mime, &n.StorageKey, &n.Checksum, &n.CreatedBy, &n.CreatedAt, &n.UpdatedAt)
}

// lookup walks rel segment by segment. Only database failures are errors; a
// missing resource is reported through the returned davTarget.
func (h *WebDAVHandler) lookup(ctx context.Context, ws uuid.UUID, rel string) (davTarget, error) {
	t := davTarget{Rel: rel}
	if rel == "" {
		t.Root, t.ParentOK = true, true
		return t, nil
	}
	parts := strings.Split(rel, "/")
	var parent *uuid.UUID
	for i, part := range parts {
		var n models.Node
		var err error
		if parent == nil {
			err = scanDAVNode(h.App.DB.QueryRow(ctx, `SELECT `+davNodeCols+` FROM nodes
				WHERE workspace_id = $1 AND parent_id IS NULL AND name = $2 AND deleted_at IS NULL`, ws, part), &n)
		} else {
			err = scanDAVNode(h.App.DB.QueryRow(ctx, `SELECT `+davNodeCols+` FROM nodes
				WHERE workspace_id = $1 AND parent_id = $2 AND name = $3 AND deleted_at IS NULL`, ws, *parent, part), &n)
		}
		last := i == len(parts)-1
		if errors.Is(err, pgx.ErrNoRows) {
			if last {
				t.ParentOK, t.ParentID, t.Name = true, parent, part
			}
			return t, nil
		}
		if err != nil {
			return t, err
		}
		if last {
			t.Node, t.ParentOK, t.ParentID, t.Name = &n, true, parent, part
			return t, nil
		}
		if n.Kind != "folder" {
			return t, nil
		}
		id := n.ID
		parent = &id
	}
	return t, nil
}

// lookupOrFail resolves rel and writes a 500 on database failure.
func (h *WebDAVHandler) lookupOrFail(w http.ResponseWriter, r *http.Request, ws uuid.UUID, rel string) (davTarget, bool) {
	t, err := h.lookup(r.Context(), ws, rel)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return t, false
	}
	return t, true
}

// ---------------------------------------------------------------------------
// If header + locks
// ---------------------------------------------------------------------------

type davGuardTarget struct {
	t          davTarget
	recursive  bool // also require tokens for locks below t (DELETE/MOVE of a collection)
	membership bool // t is being created or removed: the parent's own lock applies
}

// guard evaluates the If header (412 when false) and enforces write locks on
// targets (423 unless the owner submitted the lock token). It writes the error
// response and returns false when the request must not proceed.
func (h *WebDAVHandler) guard(w http.ResponseWriter, r *http.Request, ws uuid.UUID, user *models.User, req davTarget, targets ...davGuardTarget) bool {
	var tokens []string
	if ih := strings.TrimSpace(r.Header.Get("If")); ih != "" {
		lists, err := parseDAVIf(ih)
		if err != nil {
			http.Error(w, "malformed If header", http.StatusBadRequest)
			return false
		}
		resolve := func(tag string) (davIfResource, bool) {
			t := req
			if tag != "" {
				rel, status := davRelFromURL(tag, ws)
				if status != 0 {
					return davIfResource{}, false
				}
				lt, err := h.lookup(r.Context(), ws, rel)
				if err != nil {
					return davIfResource{}, false
				}
				t = lt
			}
			return davIfResource{Path: t.Rel, Exists: t.exists(), ETag: davTargetETag(ws, t)}, true
		}
		valid := func(p, tok string) bool { return h.locks().valid(ws, p, tok, user.ID) }
		if !evalDAVIf(lists, resolve, valid) {
			http.Error(w, "precondition failed", http.StatusPreconditionFailed)
			return false
		}
		tokens = davSubmittedTokens(lists)
	}
	for _, gt := range targets {
		for _, l := range h.locks().affecting(ws, gt.t.Rel, gt.recursive, gt.membership) {
			if l.UserID == user.ID && slices.Contains(tokens, l.Token) {
				continue
			}
			davWriteError(w, http.StatusLocked,
				`<d:lock-token-submitted><d:href>`+xmlEscape(davHref(ws, l.Path, false))+`</d:href></d:lock-token-submitted>`)
			return false
		}
	}
	return true
}

// preconditions evaluates HTTP conditional headers against t and writes the
// 304/412 response when they fail.
func davPreconditions(w http.ResponseWriter, r *http.Request, ws uuid.UUID, t davTarget) bool {
	etag := davTargetETag(ws, t)
	st := davCheckConditional(r, t.exists(), etag, t.modTime())
	if st == 0 {
		return true
	}
	if st == http.StatusNotModified {
		if etag != "" {
			w.Header().Set("ETag", etag)
		}
		w.WriteHeader(st)
		return false
	}
	http.Error(w, "precondition failed", st)
	return false
}

// ---------------------------------------------------------------------------
// PROPFIND / PROPPATCH
// ---------------------------------------------------------------------------

// davPropfindDepth validates Depth. A missing header is treated as 1 (RFC 4918
// says infinity, but no mainstream client relies on that and it is costly);
// explicit infinity is refused with 403 propfind-finite-depth.
func davPropfindDepth(w http.ResponseWriter, r *http.Request) (string, bool) {
	switch d := strings.ToLower(strings.TrimSpace(r.Header.Get("Depth"))); d {
	case "0", "1":
		return d, true
	case "":
		return "1", true
	case "infinity":
		davWriteError(w, http.StatusForbidden, `<d:propfind-finite-depth/>`)
		return "", false
	default:
		http.Error(w, "invalid Depth", http.StatusBadRequest)
		return "", false
	}
}

func (h *WebDAVHandler) propContext(ctx context.Context, ws uuid.UUID) davPropContext {
	var q davQuota
	var qok, qdone bool
	return davPropContext{
		quota: func() (davQuota, bool) {
			if !qdone {
				qdone = true
				info, err := h.App.WorkspaceQuotaInfo(ctx, ws)
				if err == nil {
					qok = true
					q.Used = info.UsedBytes
					if info.QuotaBytes != nil {
						q.Limited = true
						q.Available = max(*info.QuotaBytes-info.UsedBytes, 0)
					}
				}
			}
			return q, qok
		},
		locks: func(rel string) []davLock { return h.locks().covering(ws, rel) },
	}
}

func davEntryFromNode(ws uuid.UUID, rel string, n *models.Node) davEntry {
	e := davEntry{
		Rel:      rel,
		IsDir:    n.Kind == "folder",
		Name:     n.Name,
		Size:     n.Size,
		Modified: n.UpdatedAt,
		Created:  n.CreatedAt,
		ETag:     davNodeETag(n),
	}
	if n.Mime != nil {
		e.Mime = *n.Mime
	}
	e.Href = davHref(ws, rel, e.IsDir)
	return e
}

func davPropstats(e davEntry, spec davPropfindSpec, pc davPropContext) []davPropstat {
	ok := davPropstat{Status: http.StatusOK}
	missing := davPropstat{Status: http.StatusNotFound}
	switch spec.Mode {
	case davPropNames:
		for _, n := range davEntryPropNames(e, pc) {
			ok.Props = append(ok.Props, davPropElem(n, ""))
		}
	case davAllProp:
		for _, n := range davEntryPropNames(e, pc) {
			if v, found := davPropValue(e, n, pc); found {
				ok.Props = append(ok.Props, davPropElem(n, v))
			}
		}
	default:
		for _, n := range spec.Names {
			if v, found := davPropValue(e, n, pc); found {
				ok.Props = append(ok.Props, davPropElem(n, v))
			} else {
				missing.Props = append(missing.Props, davPropElem(n, ""))
			}
		}
	}
	return []davPropstat{ok, missing}
}

func (h *WebDAVHandler) propfind(w http.ResponseWriter, r *http.Request, ws uuid.UUID, rel string) {
	depth, ok := davPropfindDepth(w, r)
	if !ok {
		return
	}
	body, err := readDAVBody(r)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	spec, err := parsePropfind(body)
	if err != nil {
		http.Error(w, "malformed propfind body", http.StatusBadRequest)
		return
	}
	t, ok := h.lookupOrFail(w, r, ws, rel)
	if !ok {
		return
	}
	if !t.exists() {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	var entries []davEntry
	if t.Root {
		var name string
		var created time.Time
		if err := h.App.DB.QueryRow(r.Context(), `SELECT name, created_at FROM workspaces WHERE id = $1`, ws).Scan(&name, &created); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		entries = append(entries, davEntry{Href: davHref(ws, "", true), IsDir: true, Name: name, Modified: created, Created: created, ETag: davRootETag(ws)})
	} else {
		entries = append(entries, davEntryFromNode(ws, rel, t.Node))
	}

	if depth == "1" && t.isDir() {
		var rows pgx.Rows
		if t.Root {
			rows, err = h.App.DB.Query(r.Context(), `SELECT `+davNodeCols+` FROM nodes
				WHERE workspace_id = $1 AND parent_id IS NULL AND deleted_at IS NULL
				ORDER BY kind DESC, name ASC`, ws)
		} else {
			rows, err = h.App.DB.Query(r.Context(), `SELECT `+davNodeCols+` FROM nodes
				WHERE workspace_id = $1 AND parent_id = $2 AND deleted_at IS NULL
				ORDER BY kind DESC, name ASC`, ws, t.Node.ID)
		}
		if err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		for rows.Next() {
			var n models.Node
			if err := scanDAVNode(rows, &n); err != nil {
				rows.Close()
				http.Error(w, "internal error", http.StatusInternalServerError)
				return
			}
			entries = append(entries, davEntryFromNode(ws, davJoin(rel, n.Name), &n))
		}
		rows.Close()
		if rows.Err() != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
	}

	pc := h.propContext(r.Context(), ws)
	ms := newDAVMultistatus()
	for _, e := range entries {
		ms.add(e.Href, davPropstats(e, spec, pc))
	}
	ms.write(w)
}

const msNS = "urn:schemas-microsoft-com:"

// davIsMtimeProp reports whether a PROPPATCH property sets the modification time.
func davIsMtimeProp(n xml.Name) bool {
	switch {
	case n.Space == davNS && (n.Local == "getlastmodified" || n.Local == "lastmodified"):
		return true
	case n.Space == msNS && n.Local == "Win32LastModifiedTime":
		return true
	}
	return false
}

// davIsProtectedProp lists live properties clients must not set.
func davIsProtectedProp(n xml.Name) bool {
	if n.Space != davNS {
		return false
	}
	switch n.Local {
	case "resourcetype", "getetag", "getcontentlength", "lockdiscovery", "supportedlock",
		"quota-available-bytes", "quota-used-bytes":
		return true
	}
	return false
}

// parseDAVTime accepts unix seconds (rclone's owncloud mode), HTTP dates
// (getlastmodified, Win32LastModifiedTime) and RFC 3339.
func parseDAVTime(v string) (time.Time, bool) {
	v = strings.TrimSpace(v)
	if v == "" {
		return time.Time{}, false
	}
	if f, err := strconv.ParseFloat(v, 64); err == nil {
		if f <= 0 || f > 1e11 {
			return time.Time{}, false
		}
		sec := int64(f)
		return time.Unix(sec, int64((f-float64(sec))*1e9)).UTC(), true
	}
	if t, err := http.ParseTime(v); err == nil {
		return t.UTC(), true
	}
	if t, err := time.Parse(time.RFC3339Nano, v); err == nil {
		return t.UTC(), true
	}
	return time.Time{}, false
}

// proppatch applies modification-time updates. Other dead properties are
// answered 200 but not stored: Windows Explorer aborts copies when its
// Win32* PROPPATCH fails, and nothing reads those values back.
func (h *WebDAVHandler) proppatch(w http.ResponseWriter, r *http.Request, ws uuid.UUID, user *models.User, rel string) {
	t, ok := h.lookupOrFail(w, r, ws, rel)
	if !ok {
		return
	}
	if !t.exists() {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if !davPreconditions(w, r, ws, t) {
		return
	}
	if !h.guard(w, r, ws, user, t, davGuardTarget{t: t}) {
		return
	}
	body, err := readDAVBody(r)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	ops, err := parseProppatch(body)
	if err != nil {
		http.Error(w, "malformed propertyupdate body", http.StatusBadRequest)
		return
	}

	type result struct {
		name   xml.Name
		status int
		err    string
	}
	results := make([]result, 0, len(ops))
	var newMtime *time.Time
	failed := false
	for _, op := range ops {
		res := result{name: op.Name, status: http.StatusOK}
		switch {
		case davIsMtimeProp(op.Name) && !op.Remove:
			if tm, ok := parseDAVTime(op.Value); ok {
				newMtime = &tm
			} else {
				res.status = http.StatusConflict
			}
		case davIsProtectedProp(op.Name):
			res.status = http.StatusForbidden
			res.err = `<d:cannot-modify-protected-property/>`
		}
		if res.status != http.StatusOK {
			failed = true
		}
		results = append(results, res)
	}
	if failed {
		for i := range results {
			if results[i].status == http.StatusOK {
				results[i].status = http.StatusFailedDependency
			}
		}
	} else if newMtime != nil && t.Node != nil {
		if _, err := h.App.DB.Exec(r.Context(), `UPDATE nodes SET updated_at = $1 WHERE id = $2`, *newMtime, t.Node.ID); err != nil {
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
	}

	var stats []davPropstat
	for _, res := range results {
		idx := slices.IndexFunc(stats, func(s davPropstat) bool { return s.Status == res.status })
		if idx < 0 {
			stats = append(stats, davPropstat{Status: res.status, Error: res.err})
			idx = len(stats) - 1
		}
		stats[idx].Props = append(stats[idx].Props, davPropElem(res.name, ""))
	}
	ms := newDAVMultistatus()
	ms.add(davHref(ws, rel, t.isDir()), stats)
	ms.write(w)
}

// ---------------------------------------------------------------------------
// GET / HEAD / PUT
// ---------------------------------------------------------------------------

func (h *WebDAVHandler) get(w http.ResponseWriter, r *http.Request, ws uuid.UUID, rel string) {
	t, ok := h.lookupOrFail(w, r, ws, rel)
	if !ok {
		return
	}
	if !t.exists() || (t.Node != nil && t.Node.Kind == "file" && t.Node.StorageKey == nil) {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	etag := davTargetETag(ws, t)
	if !davPreconditions(w, r, ws, t) {
		return
	}
	w.Header().Set("ETag", etag)
	if t.isDir() {
		// Some clients probe collections with HEAD/GET; answer instead of 404.
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodGet {
			_, _ = io.WriteString(w, "This is a WebDAV collection. Open it with a WebDAV client.\n")
		}
		return
	}
	n := t.Node
	store, err := h.App.StoreForWorkspace(r.Context(), ws)
	if err != nil {
		http.Error(w, "storage error", http.StatusInternalServerError)
		return
	}
	rc, meta, err := store.Get(r.Context(), *n.StorageKey)
	if err != nil {
		http.Error(w, "storage error", http.StatusInternalServerError)
		return
	}
	defer rc.Close()
	ct := "application/octet-stream"
	if n.Mime != nil && *n.Mime != "" {
		ct = *n.Mime
	} else if meta.ContentType != "" {
		ct = meta.ContentType
	}
	size := n.Size
	if meta.Size > 0 {
		size = meta.Size
	}
	hdr := w.Header()
	hdr.Set("Content-Type", ct)
	hdr.Set("Last-Modified", n.UpdatedAt.UTC().Format(http.TimeFormat))
	hdr.Set("Accept-Ranges", "bytes")
	// Served from the app origin with cookie auth: never let uploaded HTML/SVG run.
	hdr.Set("X-Content-Type-Options", "nosniff")
	hdr.Set("Content-Security-Policy", "default-src 'none'; sandbox")

	if rng := r.Header.Get("Range"); rng != "" && size > 0 && davIfRangeOK(r, etag, n.UpdatedAt) {
		if start, end, ok := parseBytesRange(rng, size); ok {
			if start > 0 {
				if s, isSeeker := rc.(io.Seeker); isSeeker {
					_, err = s.Seek(start, io.SeekStart)
				} else {
					_, err = io.CopyN(io.Discard, rc, start)
				}
				if err != nil {
					http.Error(w, "storage error", http.StatusInternalServerError)
					return
				}
			}
			length := end - start + 1
			hdr.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, size))
			hdr.Set("Content-Length", strconv.FormatInt(length, 10))
			w.WriteHeader(http.StatusPartialContent)
			if r.Method == http.MethodGet {
				_, _ = io.CopyN(w, rc, length)
			}
			return
		}
		if strings.HasPrefix(strings.TrimSpace(rng), "bytes=") && !strings.Contains(rng, ",") {
			hdr.Set("Content-Range", fmt.Sprintf("bytes */%d", size))
			http.Error(w, "range not satisfiable", http.StatusRequestedRangeNotSatisfiable)
			return
		}
		// Multi-range requests fall through to a full 200 response.
	}
	hdr.Set("Content-Length", strconv.FormatInt(size, 10))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = io.Copy(w, rc)
	}
}

func davIfRangeOK(r *http.Request, etag string, mod time.Time) bool {
	ir := strings.TrimSpace(r.Header.Get("If-Range"))
	if ir == "" {
		return true
	}
	if strings.HasPrefix(ir, `"`) {
		return ir == etag
	}
	if strings.HasPrefix(ir, "W/") {
		return false
	}
	t, err := http.ParseTime(ir)
	return err == nil && mod.UTC().Truncate(time.Second).Equal(t)
}

// davContentType prefers the client's Content-Type, then the file extension.
func davContentType(r *http.Request, name string) string {
	ct := strings.TrimSpace(r.Header.Get("Content-Type"))
	if ct != "" && ct != "application/octet-stream" {
		return ct
	}
	if byExt := mimepkg.TypeByExtension(path.Ext(name)); byExt != "" {
		return byExt
	}
	return "application/octet-stream"
}

// parseOCMtime reads rclone/ownCloud's X-OC-Mtime (unix seconds).
func parseOCMtime(v string) (*time.Time, bool) {
	if strings.TrimSpace(v) == "" {
		return nil, false
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil || f <= 0 || f > 1e11 {
		return nil, false
	}
	sec := int64(f)
	t := time.Unix(sec, int64((f-float64(sec))*1e9)).UTC()
	return &t, true
}

func (h *WebDAVHandler) put(w http.ResponseWriter, r *http.Request, ws uuid.UUID, user *models.User, rel string) {
	t, ok := h.lookupOrFail(w, r, ws, rel)
	if !ok {
		return
	}
	if t.Root || (t.Node != nil && t.Node.Kind != "file") {
		w.Header().Set("Allow", "OPTIONS, PROPFIND, PROPPATCH, MKCOL, DELETE, MOVE, COPY, LOCK, UNLOCK")
		http.Error(w, "cannot PUT to a collection", http.StatusMethodNotAllowed)
		return
	}
	if !t.ParentOK {
		http.Error(w, "parent collection does not exist", http.StatusConflict)
		return
	}
	exists := t.Node != nil
	if st := davCheckConditional(r, exists, davTargetETag(ws, t), t.modTime()); st != 0 {
		http.Error(w, "precondition failed", http.StatusPreconditionFailed)
		return
	}
	if !h.guard(w, r, ws, user, t, davGuardTarget{t: t, membership: !exists}) {
		return
	}
	mtime, hasMtime := parseOCMtime(r.Header.Get("X-OC-Mtime"))

	store, err := h.App.StoreForWorkspace(r.Context(), ws)
	if err != nil {
		http.Error(w, "storage error", http.StatusInternalServerError)
		return
	}
	if err := h.limitUpload(w, r); err != nil {
		http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
		return
	}
	ct := davContentType(r, t.Name)
	replace := int64(0)
	if exists {
		replace = t.Node.Size
	}
	counted, sizeHint, qerr := wrapQuotaBody(h.App, r, ws, replace)
	if qerr != nil {
		davQuotaError(w, qerr)
		return
	}

	nodeID := uuid.New()
	if exists {
		nodeID = t.Node.ID
	}
	key := app.StorageKey(ws, uuid.New())
	if !exists {
		key = app.StorageKey(ws, nodeID)
	}
	if err := store.Put(r.Context(), key, counted, sizeHint, ct); err != nil {
		_ = store.Delete(r.Context(), key)
		davUploadError(w, err)
		return
	}
	size := storedSize(counted, sizeHint)

	status := http.StatusCreated
	if exists {
		// Archive only after the new blob is safely stored.
		_ = h.App.ArchiveCurrentVersion(r.Context(), nodeID, user.ID)
		_, err = h.App.DB.Exec(r.Context(), `
			UPDATE nodes SET storage_key = $1, size = $2, mime = $3, checksum = NULL, updated_at = COALESCE($4, now())
			WHERE id = $5
		`, key, size, ct, mtime, nodeID)
		status = http.StatusNoContent
	} else {
		_, err = h.App.DB.Exec(r.Context(), `
			INSERT INTO nodes (id, workspace_id, parent_id, name, kind, size, mime, storage_key, created_by, updated_at)
			VALUES ($1, $2, $3, $4, 'file', $5, $6, $7, $8, COALESCE($9, now()))
		`, nodeID, ws, t.ParentID, t.Name, size, ct, key, user.ID, mtime)
	}
	if err != nil {
		_ = store.Delete(r.Context(), key)
		if davIsUniqueViolation(err) {
			http.Error(w, "resource was created concurrently", http.StatusConflict)
			return
		}
		http.Error(w, "could not save file", http.StatusInternalServerError)
		return
	}
	h.App.SchedulePostUpload(ws, nodeID, ct, key)
	if hasMtime {
		w.Header().Set("X-OC-Mtime", "accepted")
	}
	w.Header().Set("ETag", davFileETag(key, size))
	w.WriteHeader(status)
}

func davQuotaError(w http.ResponseWriter, err error) {
	if errors.Is(err, app.ErrQuotaExceeded) {
		davWriteError(w, http.StatusInsufficientStorage, `<d:quota-not-exceeded/>`)
		return
	}
	http.Error(w, "internal error", http.StatusInternalServerError)
}

func davUploadError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, app.ErrQuotaExceeded):
		davWriteError(w, http.StatusInsufficientStorage, `<d:quota-not-exceeded/>`)
	case isUploadTooLarge(err):
		http.Error(w, "payload too large", http.StatusRequestEntityTooLarge)
	default:
		http.Error(w, "upload failed", http.StatusInternalServerError)
	}
}

func davIsUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// ---------------------------------------------------------------------------
// MKCOL / DELETE
// ---------------------------------------------------------------------------

func (h *WebDAVHandler) mkcol(w http.ResponseWriter, r *http.Request, ws uuid.UUID, user *models.User, rel string) {
	if r.ContentLength > 0 {
		http.Error(w, "MKCOL body not supported", http.StatusUnsupportedMediaType)
		return
	}
	if r.Body != nil && r.ContentLength < 0 {
		var one [1]byte
		if n, _ := r.Body.Read(one[:]); n > 0 {
			http.Error(w, "MKCOL body not supported", http.StatusUnsupportedMediaType)
			return
		}
	}
	t, ok := h.lookupOrFail(w, r, ws, rel)
	if !ok {
		return
	}
	if t.exists() {
		w.Header().Set("Allow", davAllowHeader)
		http.Error(w, "already exists", http.StatusMethodNotAllowed)
		return
	}
	if !t.ParentOK {
		http.Error(w, "parent collection does not exist", http.StatusConflict)
		return
	}
	if !h.guard(w, r, ws, user, t, davGuardTarget{t: t, membership: true}) {
		return
	}
	_, err := h.App.DB.Exec(r.Context(), `
		INSERT INTO nodes (workspace_id, parent_id, name, kind, created_by)
		VALUES ($1, $2, $3, 'folder', $4)
	`, ws, t.ParentID, t.Name, user.ID)
	if err != nil {
		if davIsUniqueViolation(err) {
			http.Error(w, "already exists", http.StatusMethodNotAllowed)
			return
		}
		http.Error(w, "create failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

type davExecer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// davTrashTree soft-deletes a node and its descendants (same as the REST
// delete: the tree lands in the workspace trash and can be restored).
func davTrashTree(ctx context.Context, db davExecer, id uuid.UUID) error {
	_, err := db.Exec(ctx, `
		WITH RECURSIVE tree AS (
			SELECT id FROM nodes WHERE id = $1 AND deleted_at IS NULL
			UNION ALL
			SELECT n.id FROM nodes n JOIN tree t ON n.parent_id = t.id WHERE n.deleted_at IS NULL
		)
		UPDATE nodes SET deleted_at = now(), updated_at = now()
		WHERE id IN (SELECT id FROM tree)
	`, id)
	return err
}

func (h *WebDAVHandler) delete(w http.ResponseWriter, r *http.Request, ws uuid.UUID, user *models.User, rel string) {
	t, ok := h.lookupOrFail(w, r, ws, rel)
	if !ok {
		return
	}
	if t.Root {
		http.Error(w, "cannot delete the workspace root", http.StatusForbidden)
		return
	}
	if !t.exists() {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if d := strings.ToLower(strings.TrimSpace(r.Header.Get("Depth"))); d != "" && d != "infinity" && t.isDir() {
		http.Error(w, "DELETE of a collection requires Depth: infinity", http.StatusBadRequest)
		return
	}
	if !davPreconditions(w, r, ws, t) {
		return
	}
	if !h.guard(w, r, ws, user, t, davGuardTarget{t: t, recursive: true, membership: true}) {
		return
	}
	if err := davTrashTree(r.Context(), h.App.DB, t.Node.ID); err != nil {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	h.locks().removeTree(ws, rel)
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// MOVE / COPY
// ---------------------------------------------------------------------------

// transfer implements MOVE and COPY (RFC 4918 §9.8, §9.9).
//
// Overwrite: T (default) replaces an existing destination and answers 204;
// F answers 412 when the destination exists; 201 when it was created.
//
// Replacing a file with a file keeps the destination node and turns the
// incoming content into its new current version (the old content becomes a
// restorable version). That makes the "write temp file, rename over original"
// save pattern (Office, LibreOffice, editors, rclone --inplace=false) keep the
// document's id, shares, public links and full version history. Any other
// replacement (collections involved) moves the old destination to the trash,
// exactly like DELETE, so nothing is ever destroyed outright.
func (h *WebDAVHandler) transfer(w http.ResponseWriter, r *http.Request, ws uuid.UUID, user *models.User, rel string, move bool) {
	destHdr := r.Header.Get("Destination")
	if strings.TrimSpace(destHdr) == "" {
		http.Error(w, "Destination header required", http.StatusBadRequest)
		return
	}
	destRel, status := davRelFromURL(destHdr, ws)
	if status != 0 {
		http.Error(w, "invalid destination", status)
		return
	}
	overwrite := true
	switch strings.ToUpper(strings.TrimSpace(r.Header.Get("Overwrite"))) {
	case "", "T":
	case "F":
		overwrite = false
	default:
		http.Error(w, "invalid Overwrite header", http.StatusBadRequest)
		return
	}
	deep := true
	switch strings.ToLower(strings.TrimSpace(r.Header.Get("Depth"))) {
	case "", "infinity":
	case "0":
		if move {
			http.Error(w, "MOVE requires Depth: infinity", http.StatusBadRequest)
			return
		}
		deep = false
	default:
		http.Error(w, "invalid Depth", http.StatusBadRequest)
		return
	}

	src, ok := h.lookupOrFail(w, r, ws, rel)
	if !ok {
		return
	}
	if !src.exists() {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if src.Root || destRel == "" {
		http.Error(w, "cannot move or copy the workspace root", http.StatusForbidden)
		return
	}
	if destRel == rel {
		http.Error(w, "source and destination are the same", http.StatusForbidden)
		return
	}
	if davIsDescendant(destRel, rel) {
		http.Error(w, "cannot move or copy a collection into itself", http.StatusConflict)
		return
	}
	dst, ok := h.lookupOrFail(w, r, ws, destRel)
	if !ok {
		return
	}
	if !dst.ParentOK {
		http.Error(w, "destination parent does not exist", http.StatusConflict)
		return
	}
	destExists := dst.Node != nil
	if destExists && davIsDescendant(rel, destRel) {
		http.Error(w, "destination contains the source", http.StatusConflict)
		return
	}
	if !davPreconditions(w, r, ws, src) {
		return
	}
	targets := []davGuardTarget{{t: dst, recursive: true, membership: true}}
	if move {
		targets = append(targets, davGuardTarget{t: src, recursive: true, membership: true})
	}
	if !h.guard(w, r, ws, user, src, targets...) {
		return
	}
	if destExists && !overwrite {
		http.Error(w, "destination exists", http.StatusPreconditionFailed)
		return
	}
	fileOverFile := destExists && src.Node.Kind == "file" && dst.Node.Kind == "file"

	var err error
	if move {
		err = h.doMove(r.Context(), ws, user.ID, src.Node, dst, fileOverFile)
	} else {
		err = h.doCopy(r.Context(), ws, user.ID, src.Node, dst, fileOverFile, deep)
	}
	if err != nil {
		switch {
		case errors.Is(err, app.ErrQuotaExceeded):
			davQuotaError(w, err)
		case davIsUniqueViolation(err):
			http.Error(w, "destination was created concurrently", http.StatusConflict)
		default:
			http.Error(w, "operation failed", http.StatusInternalServerError)
		}
		return
	}
	if move {
		h.locks().removeTree(ws, rel)
	}
	if destExists && !fileOverFile {
		h.locks().removeTree(ws, destRel)
	}
	if destExists {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *WebDAVHandler) doMove(ctx context.Context, ws, actor uuid.UUID, src *models.Node, dst davTarget, fileOverFile bool) error {
	if fileOverFile {
		return h.replaceContent(ctx, ws, actor, dst.Node.ID, src.ID, "", true)
	}
	tx, err := h.App.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if dst.Node != nil {
		if err := davTrashTree(ctx, tx, dst.Node.ID); err != nil {
			return err
		}
	}
	// A rename keeps the modification time, like a filesystem rename.
	if _, err := tx.Exec(ctx, `UPDATE nodes SET name = $1, parent_id = $2 WHERE id = $3`, dst.Name, dst.ParentID, src.ID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (h *WebDAVHandler) doCopy(ctx context.Context, ws, actor uuid.UUID, src *models.Node, dst davTarget, fileOverFile, deep bool) error {
	incoming := src.Size
	if src.Kind == "folder" {
		incoming = 0
		if deep {
			total, err := h.App.TreeSize(ctx, src.ID)
			if err != nil {
				return err
			}
			incoming = total
		}
	}
	replaced := int64(0)
	if dst.Node != nil {
		total, err := h.App.TreeSize(ctx, dst.Node.ID)
		if err != nil {
			return err
		}
		replaced = total
	}
	if err := h.App.EnsureQuota(ctx, ws, incoming, replaced); err != nil {
		return err
	}
	if fileOverFile {
		store, err := h.App.StoreForWorkspace(ctx, ws)
		if err != nil {
			return err
		}
		newKey := app.StorageKey(ws, uuid.New())
		if err := h.copyBlob(ctx, store, src, newKey); err != nil {
			return err
		}
		if err := h.replaceContent(ctx, ws, actor, dst.Node.ID, src.ID, newKey, false); err != nil {
			_ = store.Delete(ctx, newKey)
			return err
		}
		return nil
	}
	if dst.Node != nil {
		if err := davTrashTree(ctx, h.App.DB, dst.Node.ID); err != nil {
			return err
		}
	}
	return h.copyNode(ctx, ws, actor, src, dst.ParentID, dst.Name, deep)
}

// replaceContent makes the source's content the current content of dst,
// archiving dst's previous content as a version, all in one transaction.
// move=true re-points dst at the source blob, appends the source's own version
// history to dst and removes the source row. move=false uses newKey (a fresh
// copy of the source blob).
func (h *WebDAVHandler) replaceContent(ctx context.Context, ws, actor, dstID, srcID uuid.UUID, newKey string, move bool) error {
	tx, err := h.App.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var dstThumb *string
	if err := tx.QueryRow(ctx, `SELECT thumb_key FROM nodes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, dstID).Scan(&dstThumb); err != nil {
		return err
	}
	var (
		key      *string
		size     int64
		mime     *string
		checksum *string
		text     string
		srcThumb *string
		mod      time.Time
	)
	if err := tx.QueryRow(ctx, `
		SELECT storage_key, size, mime, checksum, content_text, thumb_key, updated_at
		FROM nodes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE
	`, srcID).Scan(&key, &size, &mime, &checksum, &text, &srcThumb, &mod); err != nil {
		return err
	}
	if !move {
		key = &newKey
		mod = time.Now().UTC()
	}
	if key == nil || *key == "" {
		return errors.New("source has no content")
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO node_versions (node_id, version, storage_key, size, mime, created_by)
		SELECT n.id, COALESCE((SELECT MAX(v.version) FROM node_versions v WHERE v.node_id = n.id), 0) + 1,
		       n.storage_key, n.size, n.mime, $2
		FROM nodes n WHERE n.id = $1 AND n.storage_key IS NOT NULL AND n.storage_key <> ''
	`, dstID, actor); err != nil {
		return err
	}
	if move {
		var base int
		if err := tx.QueryRow(ctx, `SELECT COALESCE(MAX(version), 0) FROM node_versions WHERE node_id = $1`, dstID).Scan(&base); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE node_versions SET node_id = $1, version = version + $2 WHERE node_id = $3`, dstID, base, srcID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE nodes SET storage_key = $1, size = $2, mime = $3, checksum = $4, content_text = $5,
		       thumb_key = NULL, updated_at = $6
		WHERE id = $7
	`, *key, size, mime, checksum, text, mod, dstID); err != nil {
		return err
	}
	if move {
		// The source's blob now belongs to dst; its versions were re-parented.
		if _, err := tx.Exec(ctx, `DELETE FROM nodes WHERE id = $1`, srcID); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	_ = h.App.PruneNodeVersions(ctx, dstID)
	h.App.DeleteThumbnail(ctx, ws, dstThumb)
	if move {
		h.App.DeleteThumbnail(ctx, ws, srcThumb)
	}
	ct := ""
	if mime != nil {
		ct = *mime
	}
	// Re-indexing text is idempotent, so the shared post-upload queue covers
	// both the thumbnail and a missing search index.
	h.App.SchedulePostUpload(ws, dstID, ct, *key)
	return nil
}

func (h *WebDAVHandler) copyBlob(ctx context.Context, store storage.BlobStore, src *models.Node, newKey string) error {
	if src.StorageKey == nil || *src.StorageKey == "" {
		return errors.New("source has no content")
	}
	rc, meta, err := store.Get(ctx, *src.StorageKey)
	if err != nil {
		return err
	}
	defer rc.Close()
	ct := "application/octet-stream"
	if src.Mime != nil && *src.Mime != "" {
		ct = *src.Mime
	}
	if err := store.Put(ctx, newKey, rc, meta.Size, ct); err != nil {
		_ = store.Delete(ctx, newKey)
		return err
	}
	return nil
}

// copyNode copies src (recursively when deep) to parentID/name as new nodes.
func (h *WebDAVHandler) copyNode(ctx context.Context, ws, actor uuid.UUID, src *models.Node, parentID *uuid.UUID, name string, deep bool) error {
	newID := uuid.New()
	if src.Kind == "folder" {
		if _, err := h.App.DB.Exec(ctx, `
			INSERT INTO nodes (id, workspace_id, parent_id, name, kind, created_by)
			VALUES ($1, $2, $3, $4, 'folder', $5)
		`, newID, ws, parentID, name, actor); err != nil {
			return err
		}
		if !deep {
			return nil
		}
		// Read all children before recursing so no pool connection is held
		// across the recursion.
		rows, err := h.App.DB.Query(ctx, `SELECT `+davNodeCols+` FROM nodes WHERE parent_id = $1 AND deleted_at IS NULL`, src.ID)
		if err != nil {
			return err
		}
		var children []models.Node
		for rows.Next() {
			var c models.Node
			if err := scanDAVNode(rows, &c); err != nil {
				rows.Close()
				return err
			}
			children = append(children, c)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		for i := range children {
			if err := h.copyNode(ctx, ws, actor, &children[i], &newID, children[i].Name, true); err != nil {
				return err
			}
		}
		return nil
	}
	store, err := h.App.StoreForWorkspace(ctx, ws)
	if err != nil {
		return err
	}
	key := app.StorageKey(ws, newID)
	if err := h.copyBlob(ctx, store, src, key); err != nil {
		return err
	}
	if _, err := h.App.DB.Exec(ctx, `
		INSERT INTO nodes (id, workspace_id, parent_id, name, kind, size, mime, storage_key, checksum, created_by, content_text)
		SELECT $1, $2, $3, $4, 'file', size, mime, $5, checksum, $6, content_text FROM nodes WHERE id = $7
	`, newID, ws, parentID, name, key, actor, src.ID); err != nil {
		_ = store.Delete(ctx, key)
		return err
	}
	ct := ""
	if src.Mime != nil {
		ct = *src.Mime
	}
	h.App.SchedulePostUpload(ws, newID, ct, key)
	return nil
}

// ---------------------------------------------------------------------------
// LOCK / UNLOCK
// ---------------------------------------------------------------------------

func (h *WebDAVHandler) lock(w http.ResponseWriter, r *http.Request, ws uuid.UUID, user *models.User, rel string) {
	body, err := readDAVBody(r)
	if err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	timeout := parseDAVTimeout(r.Header.Get("Timeout"))
	t, ok := h.lookupOrFail(w, r, ws, rel)
	if !ok {
		return
	}

	if isBlank(body) {
		// Refresh: the lock token comes in the If header.
		lists, err := parseDAVIf(r.Header.Get("If"))
		tokens := davSubmittedTokens(lists)
		if err != nil || len(tokens) == 0 {
			http.Error(w, "lock refresh requires an If header with the lock token", http.StatusBadRequest)
			return
		}
		for _, tok := range tokens {
			if l, err := h.locks().refresh(ws, rel, tok, user.ID, timeout); err == nil {
				davWriteLockResponse(w, l, http.StatusOK)
				return
			}
		}
		davWriteError(w, http.StatusPreconditionFailed, `<d:lock-token-matches-request-uri/>`)
		return
	}

	owner, err := parseLockInfo(body)
	if err != nil {
		http.Error(w, "malformed lockinfo body", http.StatusBadRequest)
		return
	}
	infinite := true
	switch strings.ToLower(strings.TrimSpace(r.Header.Get("Depth"))) {
	case "", "infinity":
	case "0":
		infinite = false
	default:
		http.Error(w, "invalid Depth", http.StatusBadRequest)
		return
	}
	if !t.exists() && !t.ParentOK {
		http.Error(w, "parent collection does not exist", http.StatusConflict)
		return
	}
	if !davPreconditions(w, r, ws, t) {
		return
	}
	var targets []davGuardTarget
	if !t.exists() {
		targets = append(targets, davGuardTarget{t: t, membership: true})
	}
	if !h.guard(w, r, ws, user, t, targets...) {
		return
	}
	l, err := h.locks().create(davLock{Workspace: ws, Path: rel, Infinite: infinite && t.isDir(), OwnerXML: owner, UserID: user.ID, Timeout: timeout})
	if err != nil {
		davWriteError(w, http.StatusLocked, `<d:no-conflicting-lock/>`)
		return
	}
	status := http.StatusOK
	if !t.exists() {
		// RFC 4918 §9.10.4: locking an unmapped URL creates an empty resource.
		if err := h.createEmpty(r.Context(), ws, user.ID, t); err != nil {
			_ = h.locks().unlock(ws, rel, l.Token, user.ID)
			if errors.Is(err, app.ErrQuotaExceeded) {
				davQuotaError(w, err)
				return
			}
			http.Error(w, "could not create resource", http.StatusConflict)
			return
		}
		status = http.StatusCreated
	}
	w.Header().Set("Lock-Token", "<"+l.Token+">")
	davWriteLockResponse(w, l, status)
}

func davWriteLockResponse(w http.ResponseWriter, l davLock, status int) {
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, xml.Header+`<d:prop xmlns:d="DAV:"><d:lockdiscovery>`+davActiveLockXML(l, time.Now())+`</d:lockdiscovery></d:prop>`)
}

func (h *WebDAVHandler) createEmpty(ctx context.Context, ws, actor uuid.UUID, t davTarget) error {
	store, err := h.App.StoreForWorkspace(ctx, ws)
	if err != nil {
		return err
	}
	nodeID := uuid.New()
	key := app.StorageKey(ws, nodeID)
	ct := "application/octet-stream"
	if byExt := mimepkg.TypeByExtension(path.Ext(t.Name)); byExt != "" {
		ct = byExt
	}
	if err := store.Put(ctx, key, bytes.NewReader(nil), 0, ct); err != nil {
		return err
	}
	if _, err := h.App.DB.Exec(ctx, `
		INSERT INTO nodes (id, workspace_id, parent_id, name, kind, size, mime, storage_key, created_by)
		VALUES ($1, $2, $3, $4, 'file', 0, $5, $6, $7)
	`, nodeID, ws, t.ParentID, t.Name, ct, key, actor); err != nil {
		_ = store.Delete(ctx, key)
		return err
	}
	return nil
}

func (h *WebDAVHandler) unlock(w http.ResponseWriter, r *http.Request, ws uuid.UUID, user *models.User, rel string) {
	tok := strings.TrimSpace(r.Header.Get("Lock-Token"))
	tok = strings.TrimSuffix(strings.TrimPrefix(tok, "<"), ">")
	if tok == "" {
		http.Error(w, "Lock-Token header required", http.StatusBadRequest)
		return
	}
	switch err := h.locks().unlock(ws, rel, tok, user.ID); {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, errDAVLocked):
		http.Error(w, "lock belongs to another user", http.StatusForbidden)
	default:
		davWriteError(w, http.StatusConflict, `<d:lock-token-matches-request-uri/>`)
	}
}
