package handlers

import (
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// WebDAV class 2 support: a minimal, in-memory, exclusive write-lock manager.
//
// Locks live in process memory only. They are lost on restart and are not
// shared between replicas; clients (Finder, Office, Windows) simply re-lock.
// Only exclusive write locks are granted; a shared-lock request is upgraded to
// an exclusive lock, which is strictly safer for the requester.

const (
	davLockDefaultTimeout = time.Hour
	davLockMaxTimeout     = time.Hour
	davLockTokenPrefix    = "opaquelocktoken:"
)

var (
	errDAVLocked       = errors.New("resource is locked")
	errDAVLockNotFound = errors.New("lock not found")
)

type davLock struct {
	Token     string
	Workspace uuid.UUID
	Path      string // canonical relative path, "" = workspace root
	Infinite  bool   // depth infinity (vs depth 0)
	OwnerXML  string // pre-rendered, safe <d:owner> content
	UserID    uuid.UUID
	Timeout   time.Duration
	Expires   time.Time
}

type davLockManager struct {
	mu    sync.Mutex
	locks map[string]*davLock // token -> lock
	now   func() time.Time
}

func newDAVLockManager() *davLockManager {
	return &davLockManager{locks: map[string]*davLock{}, now: time.Now}
}

// davPathCovers reports whether a lock rooted at lockPath (with the given depth)
// applies to target.
func davPathCovers(lockPath string, infinite bool, target string) bool {
	if lockPath == target {
		return true
	}
	if !infinite {
		return false
	}
	return davIsDescendant(target, lockPath)
}

// davIsDescendant reports whether p is strictly below ancestor.
func davIsDescendant(p, ancestor string) bool {
	if ancestor == "" {
		return p != ""
	}
	return strings.HasPrefix(p, ancestor+"/")
}

func (m *davLockManager) pruneLocked() {
	now := m.now()
	for tok, l := range m.locks {
		if !now.Before(l.Expires) {
			delete(m.locks, tok)
		}
	}
}

// covering returns active locks that apply to target (direct locks and
// depth-infinity locks on ancestors).
func (m *davLockManager) covering(ws uuid.UUID, target string) []davLock {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pruneLocked()
	var out []davLock
	for _, l := range m.locks {
		if l.Workspace == ws && davPathCovers(l.Path, l.Infinite, target) {
			out = append(out, *l)
		}
	}
	return out
}

// affecting returns the locks a namespace/content write on target must hold
// tokens for. recursive adds locks on descendants (DELETE/MOVE of a collection);
// membership adds a lock placed directly on the parent collection (adding or
// removing a member changes the parent, RFC 4918 §7.4).
func (m *davLockManager) affecting(ws uuid.UUID, target string, recursive, membership bool) []davLock {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pruneLocked()
	parent, hasParent := davParent(target)
	var out []davLock
	for _, l := range m.locks {
		if l.Workspace != ws {
			continue
		}
		switch {
		case davPathCovers(l.Path, l.Infinite, target):
		case recursive && davIsDescendant(l.Path, target):
		case membership && hasParent && l.Path == parent:
		default:
			continue
		}
		out = append(out, *l)
	}
	return out
}

// create grants a new exclusive lock or returns errDAVLocked on conflict.
func (m *davLockManager) create(l davLock) (davLock, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pruneLocked()
	for _, ex := range m.locks {
		if ex.Workspace != l.Workspace {
			continue
		}
		if davPathCovers(ex.Path, ex.Infinite, l.Path) || (l.Infinite && davIsDescendant(ex.Path, l.Path)) {
			return davLock{}, errDAVLocked
		}
	}
	l.Token = davLockTokenPrefix + uuid.NewString()
	l.Timeout = clampDAVTimeout(l.Timeout)
	l.Expires = m.now().Add(l.Timeout)
	cp := l
	m.locks[l.Token] = &cp
	return l, nil
}

// refresh extends a lock owned by userID that covers target.
func (m *davLockManager) refresh(ws uuid.UUID, target, token string, userID uuid.UUID, timeout time.Duration) (davLock, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pruneLocked()
	l, ok := m.locks[token]
	if !ok || l.Workspace != ws || l.UserID != userID || !davPathCovers(l.Path, l.Infinite, target) {
		return davLock{}, errDAVLockNotFound
	}
	l.Timeout = clampDAVTimeout(timeout)
	l.Expires = m.now().Add(l.Timeout)
	return *l, nil
}

// unlock removes a lock that covers target. Only the lock creator may unlock.
func (m *davLockManager) unlock(ws uuid.UUID, target, token string, userID uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pruneLocked()
	l, ok := m.locks[token]
	if !ok || l.Workspace != ws || !davPathCovers(l.Path, l.Infinite, target) {
		return errDAVLockNotFound
	}
	if l.UserID != userID {
		return errDAVLocked
	}
	delete(m.locks, token)
	return nil
}

// valid reports whether token is an active lock owned by userID covering target.
func (m *davLockManager) valid(ws uuid.UUID, target, token string, userID uuid.UUID) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pruneLocked()
	l, ok := m.locks[token]
	return ok && l.Workspace == ws && l.UserID == userID && davPathCovers(l.Path, l.Infinite, target)
}

// removeTree drops locks on target and everything below it (after DELETE/MOVE).
func (m *davLockManager) removeTree(ws uuid.UUID, target string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for tok, l := range m.locks {
		if l.Workspace == ws && (l.Path == target || davIsDescendant(l.Path, target)) {
			delete(m.locks, tok)
		}
	}
}

func davParent(p string) (string, bool) {
	if p == "" {
		return "", false
	}
	i := strings.LastIndex(p, "/")
	if i < 0 {
		return "", true
	}
	return p[:i], true
}

func clampDAVTimeout(d time.Duration) time.Duration {
	if d <= 0 {
		return davLockDefaultTimeout
	}
	if d > davLockMaxTimeout {
		return davLockMaxTimeout
	}
	return d
}

// parseDAVTimeout parses a Timeout header ("Second-600, Infinite"). The first
// understood value wins; the result is clamped to the server maximum.
func parseDAVTimeout(h string) time.Duration {
	for _, part := range strings.Split(h, ",") {
		part = strings.TrimSpace(part)
		if strings.EqualFold(part, "Infinite") {
			return davLockMaxTimeout
		}
		if len(part) > 7 && strings.EqualFold(part[:7], "Second-") {
			n, err := strconv.ParseInt(part[7:], 10, 64)
			if err == nil && n > 0 {
				if n > int64(davLockMaxTimeout/time.Second) {
					return davLockMaxTimeout
				}
				return time.Duration(n) * time.Second
			}
		}
	}
	return davLockDefaultTimeout
}
