package handlers

import (
	"errors"
	"io"
	"net/http"

	"github.com/arkive/arkive/internal/app"
	"github.com/google/uuid"
)

var errUploadTooLarge = errors.New("upload too large")

func (h *FileHandler) limitUpload(w http.ResponseWriter, r *http.Request) error {
	return limitRequestBody(w, r, h.App.Cfg.MaxUploadBytes)
}

func (h *WebDAVHandler) limitUpload(w http.ResponseWriter, r *http.Request) error {
	return limitRequestBody(w, r, h.App.Cfg.MaxUploadBytes)
}

func limitRequestBody(w http.ResponseWriter, r *http.Request, max int64) error {
	if max <= 0 {
		return nil
	}
	if r.ContentLength > max {
		return errUploadTooLarge
	}
	r.Body = http.MaxBytesReader(w, r.Body, max)
	return nil
}

func isUploadTooLarge(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errUploadTooLarge) || errors.Is(err, app.ErrQuotaExceeded) {
		return true
	}
	var maxBytesErr *http.MaxBytesError
	return errors.As(err, &maxBytesErr)
}

func wrapQuotaBody(a *app.App, r *http.Request, wsID uuid.UUID, replaceExisting int64) (*app.CountingReader, int64, error) {
	size := r.ContentLength
	counted := &app.CountingReader{R: r.Body, Limit: -1}
	if size > 0 {
		if err := a.EnsureQuota(r.Context(), wsID, size, replaceExisting); err != nil {
			return nil, 0, err
		}
		return counted, size, nil
	}
	remaining, unlimited, err := a.QuotaHeadroom(r.Context(), wsID, replaceExisting)
	if err != nil {
		return nil, 0, err
	}
	if !unlimited {
		counted.Limit = remaining
	}
	return counted, -1, nil
}

func storedSize(counted *app.CountingReader, sizeHint int64) int64 {
	if counted != nil && counted.N > 0 {
		return counted.N
	}
	if sizeHint > 0 {
		return sizeHint
	}
	return 0
}

var _ io.Reader = (*app.CountingReader)(nil)
