package app

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/storage"
	"github.com/google/uuid"
)

// GCMinAge protects in-flight writes: blobs (and .tmp files) modified more
// recently than this are never collected.
const GCMinAge = time.Hour

// GCBackendReport is the per-backend part of a GCReport.
type GCBackendReport struct {
	BackendID    uuid.UUID `json:"backend_id"`
	Name         string    `json:"name"`
	Type         string    `json:"type"`
	Scanned      int       `json:"scanned"`       // blobs listed
	Ignored      int       `json:"ignored"`       // keys not in Arkive's key layout (never touched)
	KeptRecent   int       `json:"kept_recent"`   // unreferenced but newer than GCMinAge (or no mtime)
	Orphans      int       `json:"orphans"`       // unreferenced blobs older than GCMinAge
	OrphanBytes  int64     `json:"orphan_bytes"`  //
	StaleTmp     int       `json:"stale_tmp"`     // leftover "<key>.tmp" files (local backends)
	Deleted      int       `json:"deleted"`       // orphans + tmp files actually removed
	DeletedBytes int64     `json:"deleted_bytes"` //
	Skipped      string    `json:"skipped,omitempty"`
	Errors       []string  `json:"errors,omitempty"`
}

// GCReport summarizes one GarbageCollect run.
type GCReport struct {
	DryRun       bool              `json:"dry_run"`
	StartedAt    time.Time         `json:"started_at"`
	FinishedAt   time.Time         `json:"finished_at"`
	Backends     []GCBackendReport `json:"backends"`
	Uploads      UploadPurgeReport `json:"uploads"`
	Orphans      int               `json:"orphans"`
	OrphanBytes  int64             `json:"orphan_bytes"`
	Deleted      int               `json:"deleted"`
	DeletedBytes int64             `json:"deleted_bytes"`
}

type gcCandidate struct {
	key   string
	size  int64
	isTmp bool
}

// GarbageCollect removes blobs that no node or version row references, stale
// ".tmp" files on local backends, and expired tus sessions with their partial
// files. With dryRun nothing is deleted; the report says what would be.
//
// Safety rules: only keys in Arkive's layout ("<workspace uuid>/<name>" and
// "thumbs/<workspace uuid>/<name>") are considered; blobs newer than GCMinAge
// are kept; backends with a queued/running storage migration are skipped;
// if the database cannot be read nothing is deleted; each orphan is re-checked
// against the database right before it is deleted. Keys are matched against
// references from all workspaces, so a key still referenced anywhere is kept.
func (a *App) GarbageCollect(ctx context.Context, dryRun bool) (GCReport, error) {
	rep := GCReport{DryRun: dryRun, StartedAt: time.Now().UTC()}

	type backendRow struct {
		id        uuid.UUID
		name, typ string
	}
	rows, err := a.DB.Query(ctx, `SELECT id, name, type FROM storage_backends ORDER BY created_at`)
	if err != nil {
		return rep, fmt.Errorf("list backends: %w", err)
	}
	var backends []backendRow
	for rows.Next() {
		var b backendRow
		if err := rows.Scan(&b.id, &b.name, &b.typ); err != nil {
			rows.Close()
			return rep, err
		}
		backends = append(backends, b)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return rep, err
	}

	busy := map[uuid.UUID]bool{}
	rows, err = a.DB.Query(ctx, `
		SELECT from_backend_id, to_backend_id FROM storage_migrations WHERE status IN ('queued', 'running')
	`)
	if err != nil {
		return rep, fmt.Errorf("list migrations: %w", err)
	}
	for rows.Next() {
		var from *uuid.UUID
		var to uuid.UUID
		if err := rows.Scan(&from, &to); err != nil {
			rows.Close()
			return rep, err
		}
		if from != nil {
			busy[*from] = true
		}
		busy[to] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return rep, err
	}

	// Phase 1: list every backend and collect old, layout-matching candidates.
	cutoff := time.Now().Add(-GCMinAge)
	stores := make([]storage.BlobStore, len(backends))
	candidates := make([][]gcCandidate, len(backends))
	for i, b := range backends {
		br := GCBackendReport{BackendID: b.id, Name: b.name, Type: b.typ}
		switch {
		case b.typ == "gdrive":
			br.Skipped = "listing not supported"
		case busy[b.id]:
			br.Skipped = "storage migration in progress"
		}
		if br.Skipped == "" {
			st, err := a.StoreForBackend(ctx, b.id)
			if err != nil {
				br.Skipped = "storage unavailable"
				br.Errors = append(br.Errors, err.Error())
			} else {
				stores[i] = st
				localFS := b.typ == "local" || b.typ == "nfs"
				lerr := st.List(ctx, "", func(o storage.ObjectInfo) error {
					br.Scanned++
					key := o.Key
					isTmp := false
					if localFS && strings.HasSuffix(key, ".tmp") {
						isTmp = true
						key = strings.TrimSuffix(key, ".tmp")
					}
					if !isManagedKey(key) {
						br.Ignored++
						return nil
					}
					if o.ModTime.IsZero() || o.ModTime.After(cutoff) {
						br.KeptRecent++
						return nil
					}
					candidates[i] = append(candidates[i], gcCandidate{key: o.Key, size: o.Size, isTmp: isTmp})
					return nil
				})
				if lerr != nil {
					if errors.Is(lerr, storage.ErrNotSupported) {
						br.Skipped = "listing not supported"
					} else {
						br.Skipped = "listing failed"
						br.Errors = append(br.Errors, lerr.Error())
					}
					// Never act on a partial listing.
					candidates[i] = nil
				}
			}
		}
		rep.Backends = append(rep.Backends, br)
	}

	// Phase 2: load references after listing, so any row written before a
	// blob was listed is seen. Abort on any DB error.
	refs, err := a.referencedBlobKeys(ctx)
	if err != nil {
		return rep, fmt.Errorf("load referenced keys: %w", err)
	}

	// Phase 3: delete.
	for i := range backends {
		br := &rep.Backends[i]
		for _, c := range candidates[i] {
			if err := ctx.Err(); err != nil {
				return rep, err
			}
			if c.isTmp {
				br.StaleTmp++
			} else {
				if _, ok := refs[c.key]; ok {
					continue
				}
				br.Orphans++
				br.OrphanBytes += c.size
			}
			if dryRun {
				continue
			}
			if !c.isTmp {
				inUse, err := a.blobKeyReferenced(ctx, c.key)
				if err != nil {
					br.Errors = append(br.Errors, fmt.Sprintf("recheck %s: %v", c.key, err))
					continue
				}
				if inUse {
					br.Orphans--
					br.OrphanBytes -= c.size
					continue
				}
			}
			if err := stores[i].Delete(ctx, c.key); err != nil {
				br.Errors = append(br.Errors, fmt.Sprintf("delete %s: %v", c.key, err))
				continue
			}
			br.Deleted++
			br.DeletedBytes += c.size
		}
		rep.Orphans += br.Orphans
		rep.OrphanBytes += br.OrphanBytes
		rep.Deleted += br.Deleted
		rep.DeletedBytes += br.DeletedBytes
	}

	up, err := a.PurgeExpiredUploads(ctx, dryRun)
	rep.Uploads = up
	rep.FinishedAt = time.Now().UTC()
	if err != nil {
		return rep, fmt.Errorf("purge uploads: %w", err)
	}
	return rep, nil
}

// isManagedKey reports whether key follows Arkive's blob layout:
// "<workspace uuid>/<name>" or "thumbs/<workspace uuid>/<name>".
func isManagedKey(key string) bool {
	parts := strings.Split(key, "/")
	switch len(parts) {
	case 2:
		return isUUID(parts[0]) && parts[1] != ""
	case 3:
		return parts[0] == "thumbs" && isUUID(parts[1]) && parts[2] != ""
	default:
		return false
	}
}

func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	_, err := uuid.Parse(s)
	return err == nil
}

func (a *App) referencedBlobKeys(ctx context.Context) (map[string]struct{}, error) {
	rows, err := a.DB.Query(ctx, `
		SELECT storage_key FROM nodes WHERE storage_key IS NOT NULL AND storage_key <> ''
		UNION
		SELECT thumb_key FROM nodes WHERE thumb_key IS NOT NULL AND thumb_key <> ''
		UNION
		SELECT storage_key FROM node_versions WHERE storage_key IS NOT NULL AND storage_key <> ''
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	refs := map[string]struct{}{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		refs[k] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return refs, nil
}

func (a *App) blobKeyReferenced(ctx context.Context, key string) (bool, error) {
	var ok bool
	err := a.DB.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM nodes WHERE storage_key = $1 OR thumb_key = $1)
		    OR EXISTS (SELECT 1 FROM node_versions WHERE storage_key = $1)
	`, key).Scan(&ok)
	return ok, err
}
