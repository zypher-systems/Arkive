package storage

import (
	"context"
	"io"
)

type ObjectMeta struct {
	Size        int64
	ContentType string
	ETag        string
}

type BlobStore interface {
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Get(ctx context.Context, key string) (io.ReadCloser, *ObjectMeta, error)
	Delete(ctx context.Context, key string) error
}
