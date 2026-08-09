package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// NFSStore implements BlobStore over a local filesystem path
// (typically an NFS mount bind-mounted into the API container).
type NFSStore struct {
	MountPath string
}

func NewNFSStore(mountPath string) (*NFSStore, error) {
	mountPath = strings.TrimSpace(mountPath)
	if mountPath == "" {
		return nil, fmt.Errorf("mount_path required")
	}
	info, err := os.Stat(mountPath)
	if err != nil {
		return nil, fmt.Errorf("mount path: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("mount path is not a directory")
	}
	return &NFSStore{MountPath: mountPath}, nil
}

func (s *NFSStore) resolve(key string) (string, error) {
	key = strings.TrimPrefix(filepath.Clean("/"+key), "/")
	if key == "" || strings.Contains(key, "..") {
		return "", fmt.Errorf("invalid key")
	}
	full := filepath.Join(s.MountPath, filepath.FromSlash(key))
	rel, err := filepath.Rel(s.MountPath, full)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("invalid key path")
	}
	return full, nil
}

func (s *NFSStore) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	_ = ctx
	_ = contentType
	_ = size
	full, err := s.resolve(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	tmp := full + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(f, r)
	closeErr := f.Close()
	if copyErr != nil {
		_ = os.Remove(tmp)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(tmp)
		return closeErr
	}
	return os.Rename(tmp, full)
}

func (s *NFSStore) Get(ctx context.Context, key string) (io.ReadCloser, *ObjectMeta, error) {
	_ = ctx
	full, err := s.resolve(key)
	if err != nil {
		return nil, nil, err
	}
	f, err := os.Open(full)
	if err != nil {
		return nil, nil, err
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, nil, err
	}
	return f, &ObjectMeta{Size: info.Size(), ContentType: "application/octet-stream"}, nil
}

func (s *NFSStore) Delete(ctx context.Context, key string) error {
	_ = ctx
	full, err := s.resolve(key)
	if err != nil {
		return err
	}
	err = os.Remove(full)
	if os.IsNotExist(err) {
		return nil
	}
	return err
}

func (s *NFSStore) Ping(ctx context.Context) error {
	_ = ctx
	info, err := os.Stat(s.MountPath)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("not a directory")
	}
	test := filepath.Join(s.MountPath, ".arkive-write-test")
	if err := os.WriteFile(test, []byte("ok"), 0o644); err != nil {
		return fmt.Errorf("not writable: %w", err)
	}
	_ = os.Remove(test)
	return nil
}
