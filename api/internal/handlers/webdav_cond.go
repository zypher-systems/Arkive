package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/models"
	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// ETags
// ---------------------------------------------------------------------------

// davFileETag is a strong ETag for file content. Every content write (PUT,
// version restore, overwrite via MOVE/COPY) assigns a new storage key, so
// hashing the key + size changes exactly when the bytes change and is stable
// across renames, moves and PROPPATCH mtime updates.
func davFileETag(storageKey string, size int64) string {
	sum := sha256.Sum256([]byte(storageKey + "\x00" + strconv.FormatInt(size, 10)))
	return `"` + hex.EncodeToString(sum[:12]) + `"`
}

// davFolderETag identifies a collection's metadata state.
func davFolderETag(id uuid.UUID, updated time.Time) string {
	sum := sha256.Sum256([]byte(id.String() + "\x00" + strconv.FormatInt(updated.UnixNano(), 10)))
	return `"` + hex.EncodeToString(sum[:12]) + `"`
}

func davRootETag(ws uuid.UUID) string {
	sum := sha256.Sum256([]byte("root\x00" + ws.String()))
	return `"` + hex.EncodeToString(sum[:12]) + `"`
}

func davNodeETag(n *models.Node) string {
	if n == nil {
		return ""
	}
	if n.Kind == "file" {
		key := ""
		if n.StorageKey != nil {
			key = *n.StorageKey
		}
		return davFileETag(key, n.Size)
	}
	return davFolderETag(n.ID, n.UpdatedAt)
}

func davETagOpaque(tag string) string {
	tag = strings.TrimSpace(tag)
	tag = strings.TrimPrefix(tag, "W/")
	return tag
}

// davETagListMatch checks a comma-separated If-Match / If-None-Match value.
// weak=false uses the strong comparison function (weak tags never match).
func davETagListMatch(header, current string, weak bool) bool {
	if current == "" {
		return false
	}
	for _, part := range strings.Split(header, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if !weak && strings.HasPrefix(part, "W/") {
			continue
		}
		if davETagOpaque(part) == davETagOpaque(current) {
			return true
		}
	}
	return false
}

// davCheckConditional evaluates If-Match, If-None-Match, If-Unmodified-Since
// and If-Modified-Since (RFC 9110 §13.2.2 order). It returns 0 when the
// request may proceed, otherwise 412 or 304.
func davCheckConditional(r *http.Request, exists bool, etag string, mod time.Time) int {
	safe := r.Method == http.MethodGet || r.Method == http.MethodHead
	if im := strings.TrimSpace(r.Header.Get("If-Match")); im != "" {
		if im == "*" {
			if !exists {
				return http.StatusPreconditionFailed
			}
		} else if !exists || !davETagListMatch(im, etag, false) {
			return http.StatusPreconditionFailed
		}
	} else if ius := r.Header.Get("If-Unmodified-Since"); ius != "" && exists && !mod.IsZero() {
		if t, err := http.ParseTime(ius); err == nil && mod.Truncate(time.Second).After(t) {
			return http.StatusPreconditionFailed
		}
	}
	if inm := strings.TrimSpace(r.Header.Get("If-None-Match")); inm != "" {
		matched := false
		if inm == "*" {
			matched = exists
		} else {
			matched = exists && davETagListMatch(inm, etag, true)
		}
		if matched {
			if safe {
				return http.StatusNotModified
			}
			return http.StatusPreconditionFailed
		}
	} else if ims := r.Header.Get("If-Modified-Since"); ims != "" && safe && exists && !mod.IsZero() {
		if t, err := http.ParseTime(ims); err == nil && !mod.Truncate(time.Second).After(t) {
			return http.StatusNotModified
		}
	}
	return 0
}

// ---------------------------------------------------------------------------
// WebDAV If header (RFC 4918 §10.4)
// ---------------------------------------------------------------------------

type davIfCond struct {
	Not   bool
	Token string // state token (Coded-URL contents), or
	ETag  string // entity tag (including quotes)
}

type davIfList struct {
	Tag   string // resource tag URL; "" = untagged (applies to request URI)
	Conds []davIfCond
}

var errDAVBadIf = errors.New("malformed If header")

func parseDAVIf(h string) ([]davIfList, error) {
	var lists []davIfList
	tag := ""
	tagged := false
	i := 0
	skipWS := func() {
		for i < len(h) && (h[i] == ' ' || h[i] == '\t' || h[i] == '\r' || h[i] == '\n') {
			i++
		}
	}
	for {
		skipWS()
		if i >= len(h) {
			break
		}
		switch h[i] {
		case '<':
			end := strings.IndexByte(h[i:], '>')
			if end < 0 {
				return nil, errDAVBadIf
			}
			if len(lists) > 0 && !tagged {
				return nil, errDAVBadIf // cannot mix untagged and tagged lists
			}
			tag = h[i+1 : i+end]
			tagged = true
			i += end + 1
		case '(':
			i++
			l := davIfList{Tag: tag}
			for {
				skipWS()
				if i >= len(h) {
					return nil, errDAVBadIf
				}
				if h[i] == ')' {
					i++
					break
				}
				c := davIfCond{}
				if strings.HasPrefix(h[i:], "Not") {
					c.Not = true
					i += 3
					skipWS()
					if i >= len(h) {
						return nil, errDAVBadIf
					}
				}
				switch h[i] {
				case '<':
					end := strings.IndexByte(h[i:], '>')
					if end < 0 {
						return nil, errDAVBadIf
					}
					c.Token = h[i+1 : i+end]
					i += end + 1
				case '[':
					end := strings.IndexByte(h[i:], ']')
					if end < 0 {
						return nil, errDAVBadIf
					}
					c.ETag = strings.TrimSpace(h[i+1 : i+end])
					i += end + 1
				default:
					return nil, errDAVBadIf
				}
				l.Conds = append(l.Conds, c)
			}
			if len(l.Conds) == 0 {
				return nil, errDAVBadIf
			}
			if tagged && tag == "" {
				return nil, errDAVBadIf
			}
			lists = append(lists, l)
		default:
			return nil, errDAVBadIf
		}
	}
	if tagged && len(lists) == 0 {
		return nil, errDAVBadIf
	}
	return lists, nil
}

// davSubmittedTokens returns the lock tokens named (non-negated) in the If header.
func davSubmittedTokens(lists []davIfList) []string {
	var out []string
	for _, l := range lists {
		for _, c := range l.Conds {
			if c.Token != "" && !c.Not {
				out = append(out, c.Token)
			}
		}
	}
	return out
}

// davIfResource is what the If evaluator needs to know about a resource.
type davIfResource struct {
	Path   string
	Exists bool
	ETag   string
}

// evalDAVIf returns true when at least one list evaluates to true.
// resolve maps a list's resource tag ("" = request URI) to a resource; ok=false
// means the tag points outside this workspace (treated as false).
func evalDAVIf(lists []davIfList, resolve func(tag string) (davIfResource, bool), tokenValid func(path, token string) bool) bool {
	if len(lists) == 0 {
		return true
	}
	for _, l := range lists {
		res, ok := resolve(l.Tag)
		if !ok {
			continue
		}
		all := true
		for _, c := range l.Conds {
			var v bool
			if c.Token != "" {
				v = tokenValid(res.Path, c.Token)
			} else {
				v = res.Exists && davETagOpaque(c.ETag) == davETagOpaque(res.ETag)
			}
			if c.Not {
				v = !v
			}
			if !v {
				all = false
				break
			}
		}
		if all {
			return true
		}
	}
	return false
}
