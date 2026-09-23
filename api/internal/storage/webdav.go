package storage

import (
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strconv"
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

type davMultistatus struct {
	Responses []struct {
		Href     string `xml:"href"`
		Propstat []struct {
			Prop struct {
				ResourceType struct {
					Collection *struct{} `xml:"collection"`
				} `xml:"resourcetype"`
				ContentLength string `xml:"getcontentlength"`
				LastModified  string `xml:"getlastmodified"`
			} `xml:"prop"`
			Status string `xml:"status"`
		} `xml:"propstat"`
	} `xml:"response"`
}

const davListBody = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>`

// List walks the remote tree with Depth: 1 PROPFINDs (Depth: infinity is
// commonly disabled). Keys are paths relative to the configured base URL.
func (s *WebDAVStore) List(ctx context.Context, prefix string, fn func(ObjectInfo) error) error {
	baseURL, err := url.Parse(s.base)
	if err != nil {
		return err
	}
	basePath := strings.TrimRight(baseURL.Path, "/")
	queue := []string{""}
	seen := map[string]bool{"": true}
	for len(queue) > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}
		dir := queue[0]
		queue = queue[1:]
		// Only descend into directories that can contain matching keys.
		if dir != "" && !strings.HasPrefix(dir+"/", prefix) && !strings.HasPrefix(prefix, dir+"/") {
			continue
		}
		target := s.base + "/"
		if dir != "" {
			target = s.objectURL(dir) + "/"
		}
		req, err := http.NewRequestWithContext(ctx, "PROPFIND", target, strings.NewReader(davListBody))
		if err != nil {
			return err
		}
		s.setAuth(req)
		req.Header.Set("Depth", "1")
		req.Header.Set("Content-Type", "application/xml; charset=utf-8")
		res, err := s.client.Do(req)
		if err != nil {
			return err
		}
		if res.StatusCode == http.StatusNotFound && dir != "" {
			res.Body.Close()
			continue
		}
		if res.StatusCode != http.StatusMultiStatus {
			res.Body.Close()
			return fmt.Errorf("webdav propfind %s: %s", dir, res.Status)
		}
		var ms davMultistatus
		err = xml.NewDecoder(io.LimitReader(res.Body, 64<<20)).Decode(&ms)
		res.Body.Close()
		if err != nil {
			return fmt.Errorf("webdav propfind decode: %w", err)
		}
		for _, r := range ms.Responses {
			hrefURL, err := url.Parse(strings.TrimSpace(r.Href))
			if err != nil {
				continue
			}
			p := hrefURL.Path // already percent-decoded
			rel := strings.Trim(strings.TrimPrefix(p, basePath), "/")
			if p != basePath && !strings.HasPrefix(p, basePath+"/") {
				continue
			}
			if rel == "" || rel == dir {
				continue
			}
			isDir := false
			var size int64 = -1
			var mod time.Time
			for _, ps := range r.Propstat {
				if ps.Status != "" && !strings.Contains(ps.Status, " 200") {
					continue
				}
				if ps.Prop.ResourceType.Collection != nil {
					isDir = true
				}
				if ps.Prop.ContentLength != "" {
					if n, err := strconv.ParseInt(strings.TrimSpace(ps.Prop.ContentLength), 10, 64); err == nil {
						size = n
					}
				}
				if ps.Prop.LastModified != "" {
					if t, err := http.ParseTime(strings.TrimSpace(ps.Prop.LastModified)); err == nil {
						mod = t
					}
				}
			}
			if isDir {
				if !seen[rel] {
					seen[rel] = true
					queue = append(queue, rel)
				}
				continue
			}
			if !strings.HasPrefix(rel, prefix) {
				continue
			}
			if err := fn(ObjectInfo{Key: rel, Size: size, ModTime: mod}); err != nil {
				return err
			}
		}
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
