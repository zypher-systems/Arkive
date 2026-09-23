package handlers

import (
	"github.com/arkive/arkive/internal/app"
	"github.com/go-chi/chi/v5"
)

// ChiRoutes exposes the route table so tests can walk every registered route.
func ChiRoutes(a *app.App) chi.Routes {
	mux, _ := buildRouter(a)
	return mux
}
