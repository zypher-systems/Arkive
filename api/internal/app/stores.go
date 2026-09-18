package app

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/arkive/arkive/internal/crypto"
	"github.com/arkive/arkive/internal/storage"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/oauth2"
)

type storeCacheEntry struct {
	store  storage.BlobStore
	config string
}

type StoreRegistry struct {
	mu    sync.RWMutex
	cache map[uuid.UUID]storeCacheEntry
}

func NewStoreRegistry() *StoreRegistry {
	return &StoreRegistry{cache: map[uuid.UUID]storeCacheEntry{}}
}

func (a *App) InvalidateStore(id uuid.UUID) {
	if a.Stores == nil {
		return
	}
	a.Stores.mu.Lock()
	delete(a.Stores.cache, id)
	a.Stores.mu.Unlock()
}

// ReplaceCachedStore swaps the live BlobStore for a backend. Tests inject
// failing stores this way; production does not call it.
func (a *App) ReplaceCachedStore(ctx context.Context, backendID uuid.UUID, st storage.BlobStore) error {
	if a.Stores == nil {
		a.Stores = NewStoreRegistry()
	}
	var raw []byte
	if err := a.DB.QueryRow(ctx, `SELECT config FROM storage_backends WHERE id = $1`, backendID).Scan(&raw); err != nil {
		return err
	}
	a.Stores.mu.Lock()
	a.Stores.cache[backendID] = storeCacheEntry{store: st, config: string(raw)}
	a.Stores.mu.Unlock()
	return nil
}

func (a *App) StoreForWorkspace(ctx context.Context, workspaceID uuid.UUID) (storage.BlobStore, error) {
	var backendID *uuid.UUID
	err := a.DB.QueryRow(ctx, `SELECT storage_backend_id FROM workspaces WHERE id = $1`, workspaceID).Scan(&backendID)
	if err != nil {
		return nil, err
	}
	if backendID == nil {
		id, err := a.DefaultBackendID(ctx)
		if err != nil {
			return nil, err
		}
		backendID = &id
	}
	return a.StoreForBackend(ctx, *backendID)
}

func (a *App) StoreForBackend(ctx context.Context, backendID uuid.UUID) (storage.BlobStore, error) {
	var typ string
	var raw []byte
	err := a.DB.QueryRow(ctx, `SELECT type, config FROM storage_backends WHERE id = $1`, backendID).Scan(&typ, &raw)
	if err != nil {
		return nil, err
	}
	cfgKey := string(raw)

	if a.Stores != nil {
		a.Stores.mu.RLock()
		if e, ok := a.Stores.cache[backendID]; ok && e.config == cfgKey {
			st := e.store
			a.Stores.mu.RUnlock()
			return st, nil
		}
		a.Stores.mu.RUnlock()
	}

	st, err := a.buildStore(ctx, backendID, typ, raw)
	if err != nil {
		return nil, err
	}
	if a.Stores != nil {
		a.Stores.mu.Lock()
		a.Stores.cache[backendID] = storeCacheEntry{store: st, config: cfgKey}
		a.Stores.mu.Unlock()
	}
	return st, nil
}

func (a *App) buildStore(ctx context.Context, backendID uuid.UUID, typ string, raw []byte) (storage.BlobStore, error) {
	switch typ {
	case "s3":
		cfg, err := crypto.DecryptS3Config(a.Cfg.SecretsKey, raw)
		if err != nil {
			return nil, err
		}
		return storage.NewS3StoreOpts(storage.S3Options{
			Endpoint:       cfg.Endpoint,
			AccessKey:      cfg.AccessKey,
			SecretKey:      cfg.SecretKey,
			Bucket:         cfg.Bucket,
			Region:         cfg.Region,
			UseSSL:         cfg.UseSSL,
			ForcePathStyle: cfg.ForcePathStyle,
		})
	case "nfs", "local":
		cfg, err := crypto.ParseNFSConfig(raw)
		if err != nil {
			return nil, err
		}
		return storage.NewNFSStore(cfg.MountPath)
	case "gdrive":
		cfg, err := crypto.DecryptGDriveConfig(a.Cfg.SecretsKey, raw)
		if err != nil {
			return nil, err
		}
		if cfg.Mode == "live" {
			return nil, fmt.Errorf("live google drive is browsed via API, not BlobStore")
		}
		var expiry time.Time
		if cfg.TokenExpiry != "" {
			expiry, _ = time.Parse(time.RFC3339, cfg.TokenExpiry)
		}
		oauth := a.ResolveGoogleOAuth(ctx)
		if !oauth.Enabled {
			return nil, fmt.Errorf("google drive oauth not configured")
		}
		return storage.NewGDriveStore(ctx, storage.GDriveOptions{
			ClientID:     oauth.ClientID,
			ClientSecret: oauth.ClientSecret,
			Config: storage.GDriveConfig{
				RefreshToken: cfg.RefreshToken,
				AccessToken:  cfg.AccessToken,
				TokenExpiry:  expiry,
				RootFolderID: cfg.RootFolderID,
				AccountEmail: cfg.AccountEmail,
			},
			OnToken: func(tok *oauth2.Token) error {
				return a.persistGDriveToken(context.Background(), backendID, cfg, tok)
			},
		})
	case "webdav", "internxt":
		cfg, err := crypto.DecryptWebDAVConfig(a.Cfg.SecretsKey, raw)
		if err != nil {
			return nil, err
		}
		return storage.NewWebDAVStore(storage.WebDAVOptions{
			URL: cfg.URL, Username: cfg.Username, Password: cfg.Password,
		})
	default:
		return nil, fmt.Errorf("unknown backend type %q", typ)
	}
}

func (a *App) persistGDriveToken(ctx context.Context, backendID uuid.UUID, cfg crypto.GDriveConfig, tok *oauth2.Token) error {
	if tok.AccessToken != "" {
		cfg.AccessToken = tok.AccessToken
	}
	if tok.RefreshToken != "" {
		cfg.RefreshToken = tok.RefreshToken
	}
	if !tok.Expiry.IsZero() {
		cfg.TokenExpiry = tok.Expiry.UTC().Format(time.RFC3339)
	}
	raw, err := crypto.EncryptGDriveConfig(a.Cfg.SecretsKey, cfg)
	if err != nil {
		return err
	}
	_, err = a.DB.Exec(ctx, `UPDATE storage_backends SET config = $1::jsonb WHERE id = $2`, raw, backendID)
	if err == nil {
		a.InvalidateStore(backendID)
	}
	return err
}

func (a *App) TestBackendConfig(ctx context.Context, typ string, raw []byte) error {
	// Use Nil UUID for tests that don't need persistence (s3/nfs). gdrive tests use real backend id path.
	st, err := a.buildStore(ctx, uuid.Nil, typ, raw)
	if err != nil {
		return err
	}
	switch t := st.(type) {
	case interface{ Ping(context.Context) error }:
		return t.Ping(ctx)
	default:
		return nil
	}
}

func (a *App) LoadBackendRow(ctx context.Context, id uuid.UUID) (typ string, raw []byte, err error) {
	err = a.DB.QueryRow(ctx, `SELECT type, config FROM storage_backends WHERE id = $1`, id).Scan(&typ, &raw)
	return
}

func (a *App) EncryptAndMarshalS3(cfg crypto.S3Config) ([]byte, error) {
	return crypto.EncryptS3Config(a.Cfg.SecretsKey, cfg)
}

func (a *App) BackendPublicConfig(typ string, raw []byte) (map[string]any, error) {
	switch typ {
	case "s3":
		cfg, err := crypto.DecryptS3Config(a.Cfg.SecretsKey, raw)
		if err != nil {
			return nil, err
		}
		return crypto.RedactS3Config(cfg), nil
	case "nfs", "local":
		cfg, err := crypto.ParseNFSConfig(raw)
		if err != nil {
			return nil, err
		}
		return map[string]any{"mount_path": cfg.MountPath}, nil
	case "gdrive":
		cfg, err := crypto.DecryptGDriveConfig(a.Cfg.SecretsKey, raw)
		if err != nil {
			return nil, err
		}
		return crypto.RedactGDriveConfig(cfg), nil
	case "webdav", "internxt":
		cfg, err := crypto.DecryptWebDAVConfig(a.Cfg.SecretsKey, raw)
		if err != nil {
			return nil, err
		}
		return crypto.RedactWebDAVConfig(cfg), nil
	default:
		var m map[string]any
		_ = json.Unmarshal(raw, &m)
		return m, nil
	}
}

func IsNoRows(err error) bool {
	return err == pgx.ErrNoRows
}
