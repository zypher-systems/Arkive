package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/option"
)

const arkiveKeyProp = "arkiveKey"
const arkiveRootFolderName = "Arkive"

type GDriveConfig struct {
	RefreshToken string
	AccessToken  string
	TokenExpiry  time.Time
	RootFolderID string
	AccountEmail string
}

type GDriveOptions struct {
	ClientID     string
	ClientSecret string
	Config       GDriveConfig
	OnToken      func(tok *oauth2.Token) error
}

type GDriveStore struct {
	mu           sync.Mutex
	oauth        *oauth2.Config
	token        *oauth2.Token
	onToken      func(tok *oauth2.Token) error
	srv          *drive.Service
	rootFolderID string
	accountEmail string
}

func NewGDriveStore(ctx context.Context, opts GDriveOptions) (*GDriveStore, error) {
	if opts.ClientID == "" || opts.ClientSecret == "" {
		return nil, fmt.Errorf("google oauth client not configured")
	}
	oauthCfg := &oauth2.Config{
		ClientID:     opts.ClientID,
		ClientSecret: opts.ClientSecret,
		Endpoint:     google.Endpoint,
		Scopes:       []string{drive.DriveFileScope, "email"},
	}
	tok := &oauth2.Token{
		AccessToken:  opts.Config.AccessToken,
		RefreshToken: opts.Config.RefreshToken,
		Expiry:       opts.Config.TokenExpiry,
		TokenType:    "Bearer",
	}
	s := &GDriveStore{
		oauth:        oauthCfg,
		token:        tok,
		onToken:      opts.OnToken,
		rootFolderID: opts.Config.RootFolderID,
		accountEmail: opts.Config.AccountEmail,
	}
	if err := s.ensureService(ctx); err != nil {
		return nil, err
	}
	if s.rootFolderID == "" {
		id, err := s.ensureRootFolder(ctx)
		if err != nil {
			return nil, err
		}
		s.rootFolderID = id
	}
	return s, nil
}

func (s *GDriveStore) RootFolderID() string { return s.rootFolderID }
func (s *GDriveStore) AccountEmail() string { return s.accountEmail }

func (s *GDriveStore) ensureService(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	ts := &persistingTokenSource{
		base:    s.oauth.TokenSource(ctx, s.token),
		onToken: s.onToken,
		current: s.token,
	}
	client := oauth2.NewClient(ctx, ts)
	srv, err := drive.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return err
	}
	s.srv = srv
	return nil
}

type persistingTokenSource struct {
	base    oauth2.TokenSource
	onToken func(*oauth2.Token) error
	mu      sync.Mutex
	current *oauth2.Token
}

func (p *persistingTokenSource) Token() (*oauth2.Token, error) {
	tok, err := p.base.Token()
	if err != nil {
		return nil, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.current == nil || tok.AccessToken != p.current.AccessToken || !tok.Expiry.Equal(p.current.Expiry) {
		p.current = tok
		if p.onToken != nil {
			_ = p.onToken(tok)
		}
	}
	return tok, nil
}

func (s *GDriveStore) ensureRootFolder(ctx context.Context) (string, error) {
	q := fmt.Sprintf("name = '%s' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and 'root' in parents", arkiveRootFolderName)
	resp, err := s.srv.Files.List().Context(ctx).Q(q).Spaces("drive").Fields("files(id,name)").PageSize(1).Do()
	if err != nil {
		return "", err
	}
	if len(resp.Files) > 0 {
		return resp.Files[0].Id, nil
	}
	f := &drive.File{
		Name:     arkiveRootFolderName,
		MimeType: "application/vnd.google-apps.folder",
	}
	created, err := s.srv.Files.Create(f).Context(ctx).Fields("id").Do()
	if err != nil {
		return "", err
	}
	return created.Id, nil
}

func (s *GDriveStore) Ping(ctx context.Context) error {
	_, err := s.srv.Files.Get(s.rootFolderID).Context(ctx).Fields("id").Do()
	return err
}

func fileNameForKey(key string) string {
	return strings.ReplaceAll(key, "/", "__")
}

func (s *GDriveStore) findByKey(ctx context.Context, key string) (string, error) {
	escaped := strings.ReplaceAll(key, `\`, `\\`)
	escaped = strings.ReplaceAll(escaped, `'`, `\'`)
	q := fmt.Sprintf("appProperties has { key='%s' and value='%s' } and '%s' in parents and trashed = false",
		arkiveKeyProp, escaped, s.rootFolderID)
	resp, err := s.srv.Files.List().Context(ctx).Q(q).Spaces("drive").Fields("files(id)").PageSize(1).Do()
	if err != nil {
		return "", err
	}
	if len(resp.Files) == 0 {
		return "", fmt.Errorf("object not found: %s", key)
	}
	return resp.Files[0].Id, nil
}

func (s *GDriveStore) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	body := r
	if size < 0 {
		buf, err := io.ReadAll(r)
		if err != nil {
			return err
		}
		body = bytes.NewReader(buf)
		size = int64(len(buf))
	}

	existingID, err := s.findByKey(ctx, key)
	if err == nil {
		_, err = s.srv.Files.Update(existingID, &drive.File{
			MimeType: contentType,
		}).Context(ctx).Media(body, googleapi.ContentType(contentType)).Fields("id").Do()
		return err
	}

	meta := &drive.File{
		Name:     fileNameForKey(key),
		MimeType: contentType,
		Parents:  []string{s.rootFolderID},
		AppProperties: map[string]string{
			arkiveKeyProp: key,
		},
	}
	_, err = s.srv.Files.Create(meta).Context(ctx).Media(body, googleapi.ContentType(contentType)).Fields("id").Do()
	return err
}

func (s *GDriveStore) Get(ctx context.Context, key string) (io.ReadCloser, *ObjectMeta, error) {
	id, err := s.findByKey(ctx, key)
	if err != nil {
		return nil, nil, err
	}
	meta, err := s.srv.Files.Get(id).Context(ctx).Fields("id,size,mimeType,md5Checksum").Do()
	if err != nil {
		return nil, nil, err
	}
	resp, err := s.srv.Files.Get(id).Context(ctx).Download()
	if err != nil {
		return nil, nil, err
	}
	return resp.Body, &ObjectMeta{
		Size:        meta.Size,
		ContentType: meta.MimeType,
		ETag:        meta.Md5Checksum,
	}, nil
}

func (s *GDriveStore) Delete(ctx context.Context, key string) error {
	id, err := s.findByKey(ctx, key)
	if err != nil {
		return nil // already gone
	}
	return s.srv.Files.Delete(id).Context(ctx).Do()
}

// List is not supported for Google Drive: orphan GC skips these backends.
func (s *GDriveStore) List(ctx context.Context, prefix string, fn func(ObjectInfo) error) error {
	return ErrNotSupported
}

// FetchGoogleEmail returns the Google account email for the token.
func FetchGoogleEmail(ctx context.Context, client *http.Client) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://www.googleapis.com/oauth2/v2/userinfo", nil)
	if err != nil {
		return "", err
	}
	res, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(res.Body)
		return "", fmt.Errorf("userinfo: %s", string(b))
	}
	var info struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
		return "", err
	}
	return strings.ToLower(strings.TrimSpace(info.Email)), nil
}

func GoogleOAuthConfig(clientID, clientSecret, redirectURL string) *oauth2.Config {
	return &oauth2.Config{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		RedirectURL:  redirectURL,
		Endpoint:     google.Endpoint,
		Scopes:       []string{drive.DriveFileScope, "email"},
	}
}
