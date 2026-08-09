package handlers

import (
	"errors"
	"net/http"
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
	if errors.Is(err, errUploadTooLarge) {
		return true
	}
	var maxBytesErr *http.MaxBytesError
	return errors.As(err, &maxBytesErr)
}
