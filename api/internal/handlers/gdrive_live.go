package handlers

import (
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/crypto"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/arkive/arkive/internal/storage"
	"github.com/google/uuid"
	"golang.org/x/oauth2"
	"google.golang.org/api/drive/v3"
	"google.golang.org/api/option"
)

type liveItemDTO struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"` // file | folder
	Size     int64  `json:"size"`
	Mime     string `json:"mime"`
	Modified string `json:"modified,omitempty"`
}

func (h *GDriveHandler) liveService(r *http.Request, userID uuid.UUID) (*drive.Service, error) {
	oauth := h.App.ResolveGoogleOAuth(r.Context())
	if !oauth.Enabled {
		return nil, errString("google drive not configured")
	}
	var raw []byte
	err := h.App.DB.QueryRow(r.Context(), `
		SELECT config FROM storage_backends
		WHERE owner_user_id = $1 AND type = 'gdrive' LIMIT 1
	`, userID).Scan(&raw)
	if err != nil {
		return nil, errString("connect google drive first")
	}
	cfg, err := crypto.DecryptGDriveConfig(h.App.Cfg.SecretsKey, raw)
	if err != nil {
		return nil, err
	}
	var expiry time.Time
	if cfg.TokenExpiry != "" {
		expiry, _ = time.Parse(time.RFC3339, cfg.TokenExpiry)
	}
	tok := &oauth2.Token{
		AccessToken:  cfg.AccessToken,
		RefreshToken: cfg.RefreshToken,
		Expiry:       expiry,
	}
	ocfg := storage.GoogleOAuthConfig(oauth.ClientID, oauth.ClientSecret, oauth.RedirectURL)
	// Broader browse needs drive.readonly; fall back to drive.file for files the app created.
	client := ocfg.Client(r.Context(), tok)
	return drive.NewService(r.Context(), option.WithHTTPClient(client))
}

func (h *GDriveHandler) ListLive(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	svc, err := h.liveService(r, user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	parent := strings.TrimSpace(r.URL.Query().Get("parent"))
	if parent == "" {
		parent = "root"
	}
	safe := strings.ReplaceAll(parent, `'`, `\u0027`)
	q := "'" + safe + "' in parents and trashed = false"
	call := svc.Files.List().
		Q(q).
		Fields("files(id,name,mimeType,size,modifiedTime)").
		PageSize(100).
		SupportsAllDrives(true).
		IncludeItemsFromAllDrives(true)
	res, err := call.Do()
	if err != nil {
		httpjson.Error(w, http.StatusBadGateway, "drive list failed: "+err.Error())
		return
	}
	out := []liveItemDTO{}
	for _, f := range res.Files {
		kind := "file"
		if f.MimeType == "application/vnd.google-apps.folder" {
			kind = "folder"
		}
		out = append(out, liveItemDTO{
			ID: f.Id, Name: f.Name, Kind: kind, Size: f.Size, Mime: f.MimeType, Modified: f.ModifiedTime,
		})
	}
	httpjson.Write(w, http.StatusOK, map[string]any{"items": out, "parent": parent})
}

func (h *GDriveHandler) DownloadLive(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	fileID := strings.TrimSpace(r.URL.Query().Get("id"))
	if fileID == "" {
		httpjson.Error(w, http.StatusBadRequest, "id required")
		return
	}
	svc, err := h.liveService(r, user.ID)
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	meta, err := svc.Files.Get(fileID).Fields("id,name,mimeType,size").Do()
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "file not found")
		return
	}
	if strings.HasPrefix(meta.MimeType, "application/vnd.google-apps.") {
		httpjson.Error(w, http.StatusUnsupportedMediaType, "google docs export not supported yet")
		return
	}
	resp, err := svc.Files.Get(fileID).Download()
	if err != nil {
		httpjson.Error(w, http.StatusBadGateway, "download failed")
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", meta.MimeType)
	w.Header().Set("Content-Disposition", "attachment; filename=\""+meta.Name+"\"")
	_, _ = io.Copy(w, resp.Body)
}