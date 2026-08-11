package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/netutil"
)

// WebDAVStore stores opaque blobs on a remote WebDAV endpoint (e.g. Icedrive).
type WebDAVStore struct {
	base     string
	user     string
	password string
	client   *http.Client
}

type WebDAVOptions struct {
	URL      string
	Username string
	Password string
}

func NewWebDAVStore(opts WebDAVOptions) (*WebDAVStore, error) {
	base := strings.TrimRight(strings.TrimSpace(opts.URL), "/")
	if base == "" {
		return nil, fmt.Errorf("webdav url required")
	}
	if err := netutil.ValidateOutboundHTTPSURL(base); err != nil {
		return nil, fmt.Errorf("invalid webdav url: %w", err)
	}
	client := &http.Client{
		Timeout: 120 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			if err := netutil.ValidateOutboundHTTPSURL(req.URL.String()); err != nil {
				return fmt.Errorf("redirect blocked: %w", err)
			}
			return nil
		},
	}
	return &WebDAVStore{
		base:     base,
		user:     opts.Username,
		password: opts.Password,
		client:   client,
	}, nil
}

func (s *WebDAVStore) objectURL(key string) string {
	key = strings.TrimPrefix(key, "/")
	parts := strings.Split(key, "/")
	escaped := make([]string, 0, len(parts))
	for _, p := range parts {
		if p == "" {
			continue
		}
		escaped = append(escaped, url.PathEscape(p))
	}
	return s.base + "/" + strings.Join(escaped, "/")
}

func (s *WebDAVStore) ensureParents(ctx context.Context, key string) error {
	dir := path.Dir(key)
	if dir == "." || dir == "/" || dir == "" {
		return nil
	}
	parts := strings.Split(dir, "/")
	cur := ""
	for _, p := range parts {
		if p == "" {
			continue
		}
		if cur == "" {
			cur = p
		} else {
			cur = cur + "/" + p
		}
		req, err := http.NewRequestWithContext(ctx, "MKCOL", s.objectURL(cur), nil)
		if err != nil {
			return err
		}
		s.setAuth(req)
		res, err := s.client.Do(req)
		if err != nil {
			return err
		}
		res.Body.Close()
		// 201 created, 405/409 already exists
		if res.StatusCode >= 400 && res.StatusCode != 405 && res.StatusCode != 409 && res.StatusCode != 301 {
			// continue; parent may already exist
		}
	}
	return nil
}

func (s *WebDAVStore) setAuth(req *http.Request) {
	if s.user != "" {
		req.SetBasicAuth(s.user, s.password)
	}
}

func (s *WebDAVStore) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	if err := s.ensureParents(ctx, key); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, s.objectURL(key), r)
	if err != nil {
		return err
	}
	s.setAuth(req)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if size >= 0 {
		req.ContentLength = size
	}
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("webdav put %s: %s", res.Status, string(b))
	}
	return nil
}

func (s *WebDAVStore) Get(ctx context.Context, key string) (io.ReadCloser, *ObjectMeta, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.objectURL(key), nil)
	if err != nil {
		return nil, nil, err
	}
	s.setAuth(req)
	res, err := s.client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	if res.StatusCode >= 300 {
		res.Body.Close()
		return nil, nil, fmt.Errorf("webdav get: %s", res.Status)
	}
	meta := &ObjectMeta{
		Size:        res.ContentLength,
		ContentType: res.Header.Get("Content-Type"),
		ETag:        res.Header.Get("ETag"),
	}
	return res.Body, meta, nil
}

func (s *WebDAVStore) Delete(ctx context.Context, key string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, s.objectURL(key), nil)
	if err != nil {
		return err
	}
	s.setAuth(req)
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode != 404 {
		return fmt.Errorf("webdav delete: %s", res.Status)
	}
	return nil
}

func (s *WebDAVStore) Ping(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "PROPFIND", s.base+"/", bytes.NewReader(nil))
	if err != nil {
		return err
	}
	s.setAuth(req)
	req.Header.Set("Depth", "0")
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		return fmt.Errorf("webdav ping: %s", res.Status)
	}
	return nil
}
