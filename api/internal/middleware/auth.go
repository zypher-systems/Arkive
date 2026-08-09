package middleware

import (
	"context"
	"encoding/base64"
	"net/http"
	"strings"

	"github.com/arkive/arkive/internal/models"
	"github.com/google/uuid"
)

type ctxKey string

const userKey ctxKey = "user"

func WithUser(ctx context.Context, u *models.User) context.Context {
	return context.WithValue(ctx, userKey, u)
}

func UserFromContext(ctx context.Context) *models.User {
	u, _ := ctx.Value(userKey).(*models.User)
	return u
}

type SessionLookup func(r *http.Request, token string) (*models.User, error)

func RequireAuth(lookup SessionLookup) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			c, err := r.Cookie("arkive_session")
			if err != nil || c.Value == "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			user, err := lookup(r, c.Value)
			if err != nil || user == nil {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), user)))
		})
	}
}

func OptionalUserID(r *http.Request) (uuid.UUID, bool) {
	u := UserFromContext(r.Context())
	if u == nil {
		return uuid.Nil, false
	}
	return u.ID, true
}

func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := UserFromContext(r.Context())
		if u == nil || !u.IsInstanceAdmin {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type BasicAuthLookup func(r *http.Request, email, password string) (*models.User, error)

// RequireAuthOrBasic accepts session cookie or HTTP Basic (email:password).
func RequireAuthOrBasic(session SessionLookup, basic BasicAuthLookup) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if c, err := r.Cookie("arkive_session"); err == nil && c.Value != "" {
				user, err := session(r, c.Value)
				if err == nil && user != nil {
					next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), user)))
					return
				}
			}
			authz := r.Header.Get("Authorization")
			if strings.HasPrefix(strings.ToLower(authz), "basic ") {
				raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(authz[6:]))
				if err == nil {
					parts := strings.SplitN(string(raw), ":", 2)
					if len(parts) == 2 {
						user, err := basic(r, parts[0], parts[1])
						if err == nil && user != nil {
							next.ServeHTTP(w, r.WithContext(WithUser(r.Context(), user)))
							return
						}
					}
				}
			}
			w.Header().Set("WWW-Authenticate", `Basic realm="Arkive"`)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
		})
	}
}
