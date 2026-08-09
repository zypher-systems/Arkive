package handlers

import (
	"net/http"
	"strings"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/httpjson"
)

type SettingsHandler struct {
	App *app.App
}

func (h *SettingsHandler) GetGoogle(w http.ResponseWriter, r *http.Request) {
	httpjson.Write(w, http.StatusOK, h.App.GoogleOAuthSettingsPublic(r.Context()))
}

type putGoogleSettingsRequest struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	RedirectURL  string `json:"redirect_url"`
	Clear        bool   `json:"clear"`
}

func (h *SettingsHandler) PutGoogle(w http.ResponseWriter, r *http.Request) {
	var req putGoogleSettingsRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Clear {
		if err := h.App.SaveGoogleOAuthSettings(r.Context(), "", "", "", true); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "could not clear settings")
			return
		}
		httpjson.Write(w, http.StatusOK, h.App.GoogleOAuthSettingsPublic(r.Context()))
		return
	}
	if strings.TrimSpace(req.ClientID) == "" {
		httpjson.Error(w, http.StatusBadRequest, "client_id required")
		return
	}
	if strings.TrimSpace(req.ClientSecret) == "" && !h.App.DBGoogleSecretPresent(r.Context()) {
		httpjson.Error(w, http.StatusBadRequest, "client_secret required")
		return
	}
	if err := h.App.SaveGoogleOAuthSettings(r.Context(), req.ClientID, req.ClientSecret, req.RedirectURL, false); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not save settings")
		return
	}
	httpjson.Write(w, http.StatusOK, h.App.GoogleOAuthSettingsPublic(r.Context()))
}

func (h *SettingsHandler) GetSMTP(w http.ResponseWriter, r *http.Request) {
	httpjson.Write(w, http.StatusOK, h.App.SMTPSettingsPublic(r.Context()))
}

type putSMTPSettingsRequest struct {
	Host     string `json:"host"`
	Port     string `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
	From     string `json:"from"`
	Clear    bool   `json:"clear"`
}

func (h *SettingsHandler) PutSMTP(w http.ResponseWriter, r *http.Request) {
	var req putSMTPSettingsRequest
	if err := httpjson.Decode(r, &req); err != nil {
		httpjson.Error(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Clear {
		if err := h.App.SaveSMTPSettings(r.Context(), "", "", "", "", "", true); err != nil {
			httpjson.Error(w, http.StatusInternalServerError, "could not clear settings")
			return
		}
		httpjson.Write(w, http.StatusOK, h.App.SMTPSettingsPublic(r.Context()))
		return
	}
	if strings.TrimSpace(req.Host) == "" || strings.TrimSpace(req.From) == "" {
		httpjson.Error(w, http.StatusBadRequest, "host and from required")
		return
	}
	if err := h.App.SaveSMTPSettings(r.Context(), req.Host, req.Port, req.User, req.Password, req.From, false); err != nil {
		httpjson.Error(w, http.StatusInternalServerError, "could not save settings")
		return
	}
	httpjson.Write(w, http.StatusOK, h.App.SMTPSettingsPublic(r.Context()))
}
