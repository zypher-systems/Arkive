package handlers

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// tus 1.0.0 resumable uploads (extensions: creation, termination, expiration).
// Partial data is staged on local disk and finalized through app.StoreFile, the
// same path as PUT /api/workspaces/{id}/upload.

const (
	tusVersion    = "1.0.0"
	tusExtensions = "creation,termination,expiration"
	tusChunkType  = "application/offset+octet-stream"
)

type TusHandler struct {
	App *app.App
}

// Middleware stamps Tus-Resumable on every response and rejects requests
// that do not speak tus 1.0.0 (OPTIONS is exempt, per the protocol).
func (h *TusHandler) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Tus-Resumable", tusVersion)
		if r.Method != http.MethodOptions && r.Header.Get("Tus-Resumable") != tusVersion {
			w.Header().Set("Tus-Version", tusVersion)
			httpjson.Error(w, http.StatusPreconditionFailed, "unsupported tus version")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (h *TusHandler) Options(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Tus-Version", tusVersion)
	w.Header().Set("Tus-Extension", tusExtensions)
	if max := h.App.Cfg.MaxUploadBytes; max > 0 {
		w.Header().Set("Tus-Max-Size", strconv.FormatInt(max, 10))
	}
	w.WriteHeader(http.StatusNoContent)
}

// parseTusMetadata decodes "key base64value,key2 base64value2".
func parseTusMetadata(raw string) (map[string]string, error) {
	out := map[string]string{}
	if strings.TrimSpace(raw) == "" {
		return out, nil
	}
	for _, pair := range strings.Split(raw, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		parts := strings.Fields(pair)
		if len(parts) == 0 || len(parts) > 2 {
			return nil, errors.New("malformed Upload-Metadata")
		}
		key := parts[0]
		if _, dup := out[key]; dup {
			return nil, errors.New("duplicate Upload-Metadata key")
		}
		val := ""
		if len(parts) == 2 {
			b, err := base64.StdEncoding.DecodeString(parts[1])
			if err != nil {
				return nil, errors.New("Upload-Metadata value is not base64")
			}
			val = string(b)
		}
		out[key] = val
	}
	return out, nil
}

func (h *TusHandler) Create(w http.ResponseWriter, r *http.Request) {
	user := middleware.UserFromContext(r.Context())
	if r.Header.Get("Upload-Defer-Length") != "" {
		httpjson.Error(w, http.StatusBadRequest, "Upload-Defer-Length is not supported")
		return
	}
	length, err := strconv.ParseInt(strings.TrimSpace(r.Header.Get("Upload-Length")), 10, 64)
	if err != nil || length < 0 {
		httpjson.Error(w, http.StatusBadRequest, "valid Upload-Length required")
		return
	}
	if max := h.App.Cfg.MaxUploadBytes; max > 0 && length > max {
		httpjson.Error(w, http.StatusRequestEntityTooLarge, "payload too large")
		return
	}
	meta, err := parseTusMetadata(r.Header.Get("Upload-Metadata"))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, err.Error())
		return
	}
	wsID, err := uuid.Parse(strings.TrimSpace(meta["workspace_id"]))
	if err != nil {
		httpjson.Error(w, http.StatusBadRequest, "workspace_id metadata required")
		return
	}
	var parentID *uuid.UUID
	if p := strings.TrimSpace(meta["parent_id"]); p != "" {
		id, err := uuid.Parse(p)
		if err != nil {
			httpjson.Error(w, http.StatusBadRequest, "invalid parent_id")
			return
		}
		parentID = &id
	}
	if app.SanitizeName(meta["filename"]) == "" {
		httpjson.Error(w, http.StatusBadRequest, "filename metadata required")
		return
	}

	s, err := h.App.CreateUploadSession(r.Context(), app.CreateUploadSessionParams{
		UserID:      user.ID,
		WorkspaceID: wsID,
		ParentID:    parentID,
		Filename:    meta["filename"],
		ContentType: meta["content_type"],
		Length:      length,
	})
	if err != nil {
		status, msg := tusHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	w.Header().Set("Location", "/api/uploads/"+s.ID.String())
	w.Header().Set("Upload-Expires", s.ExpiresAt.UTC().Format(http.TimeFormat))
	w.Header().Set("Upload-Offset", "0")

	if length == 0 {
		// Nothing will be PATCHed: finalize the empty file right away.
		unlock, ok := h.App.LockUpload(s.ID)
		if !ok {
			httpjson.Error(w, http.StatusLocked, "upload is locked")
			return
		}
		res, err := h.App.FinalizeUploadSession(r.Context(), s)
		unlock()
		if err != nil {
			status, msg := tusHTTPError(err)
			httpjson.Error(w, status, msg)
			return
		}
		w.Header().Set("Arkive-Node-Id", res.Node.ID.String())
	}
	w.WriteHeader(http.StatusCreated)
}

// loadUpload resolves {uploadID} for the current user (404 for anyone else).
func (h *TusHandler) loadUpload(w http.ResponseWriter, r *http.Request) (*app.UploadSession, bool) {
	user := middleware.UserFromContext(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "uploadID"))
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "upload not found")
		return nil, false
	}
	s, err := h.App.GetUploadSession(r.Context(), id, user.ID)
	if err != nil {
		status, msg := tusHTTPError(err)
		httpjson.Error(w, status, msg)
		return nil, false
	}
	return s, true
}

func (h *TusHandler) Head(w http.ResponseWriter, r *http.Request) {
	s, ok := h.loadUpload(w, r)
	if !ok {
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Upload-Offset", strconv.FormatInt(s.Offset, 10))
	w.Header().Set("Upload-Length", strconv.FormatInt(s.Length, 10))
	w.Header().Set("Upload-Expires", s.ExpiresAt.UTC().Format(http.TimeFormat))
	w.WriteHeader(http.StatusOK)
}

func (h *TusHandler) Patch(w http.ResponseWriter, r *http.Request) {
	if ct := r.Header.Get("Content-Type"); !strings.EqualFold(strings.TrimSpace(strings.Split(ct, ";")[0]), tusChunkType) {
		httpjson.Error(w, http.StatusUnsupportedMediaType, "Content-Type must be "+tusChunkType)
		return
	}
	offset, err := strconv.ParseInt(strings.TrimSpace(r.Header.Get("Upload-Offset")), 10, 64)
	if err != nil || offset < 0 {
		httpjson.Error(w, http.StatusBadRequest, "valid Upload-Offset required")
		return
	}
	user := middleware.UserFromContext(r.Context())
	id, err := uuid.Parse(chi.URLParam(r, "uploadID"))
	if err != nil {
		httpjson.Error(w, http.StatusNotFound, "upload not found")
		return
	}
	// Ownership check before taking the lock so other users learn nothing.
	if _, err := h.App.GetUploadSession(r.Context(), id, user.ID); err != nil {
		status, msg := tusHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	unlock, ok := h.App.LockUpload(id)
	if !ok {
		httpjson.Error(w, http.StatusLocked, "upload is locked by another request")
		return
	}
	defer unlock()
	// Re-read under the lock: the offset may have moved.
	s, err := h.App.GetUploadSession(r.Context(), id, user.ID)
	if err != nil {
		status, msg := tusHTTPError(err)
		httpjson.Error(w, status, msg)
		return
	}
	if offset != s.Offset {
		w.Header().Set("Upload-Offset", strconv.FormatInt(s.Offset, 10))
		httpjson.Error(w, http.StatusConflict, "Upload-Offset does not match current offset")
		return
	}
	newOffset, err := h.App.WriteUploadChunk(r.Context(), s, offset, r.Body)
	w.Header().Set("Upload-Offset", strconv.FormatInt(newOffset, 10))
	if err != nil {
		if isUploadTooLarge(err) {
			httpjson.Error(w, http.StatusRequestEntityTooLarge, "payload too large")
			return
		}
		status, msg := tusHTTPError(err)
		if status == http.StatusInternalServerError {
			h.App.Log().Warn("tus patch failed", "upload_id", id, "err", err)
		}
		httpjson.Error(w, status, msg)
		return
	}
	w.Header().Set("Upload-Expires", s.ExpiresAt.UTC().Format(http.TimeFormat))
	if newOffset == s.Length {
		res, err := h.App.FinalizeUploadSession(r.Context(), s)
		if err != nil {
			status, msg := tusHTTPError(err)
			if status == http.StatusInternalServerError {
				h.App.Log().Warn("tus finalize failed", "upload_id", id, "err", err)
			}
			httpjson.Error(w, status, msg)
			return
		}
		w.Header().Set("Arkive-Node-Id", res.Node.ID.String())
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *TusHandler) Delete(w http.ResponseWriter, r *http.Request) {
	s, ok := h.loadUpload(w, r)
	if !ok {
		return
	}
	unlock, locked := h.App.LockUpload(s.ID)
	if !locked {
		httpjson.Error(w, http.StatusLocked, "upload is locked by another request")
		return
	}
	defer unlock()
	if err := h.App.DeleteUploadSession(r.Context(), s); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not delete upload")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func tusHTTPError(err error) (int, string) {
	switch {
	case errors.Is(err, app.ErrUploadNotFound):
		return http.StatusNotFound, "upload not found"
	case errors.Is(err, app.ErrUploadOffsetMismatch):
		return http.StatusConflict, "Upload-Offset does not match current offset"
	case errors.Is(err, app.ErrUploadLocked):
		return http.StatusLocked, "upload is locked by another request"
	case errors.Is(err, app.ErrUploadTooLarge), errors.Is(err, app.ErrUploadExceedsLength):
		return http.StatusRequestEntityTooLarge, "payload too large"
	default:
		return storeFileHTTPError(err)
	}
}
