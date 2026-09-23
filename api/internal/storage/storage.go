package storage

import (
	"context"
	"errors"
	"io"
	"time"
)

// ErrNotSupported is returned by optional operations a backend cannot perform
// (for example List on Google Drive).
var ErrNotSupported = errors.New("storage: operation not supported")

type ObjectMeta struct {
	Size        int64
	ContentType string
	ETag        string
}

// ObjectInfo describes one stored blob as returned by List.
type ObjectInfo struct {
	Key     string
	Size    int64
	ModTime time.Time // zero when the backend does not report it
}

type BlobStore interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, *ObjectMeta, error)
	Delete(ctx context.Context, key string) error
	// List calls fn for every blob whose key starts with prefix ("" = all).
	// Returning an error from fn stops the walk and that error is returned.
	// Backends that cannot enumerate their contents return ErrNotSupported.
	List(ctx context.Context, prefix string, fn func(ObjectInfo) error) error
}
