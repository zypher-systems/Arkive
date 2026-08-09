package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/httpjson"
	"github.com/arkive/arkive/internal/middleware"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
)

func NewRouter(a *app.App) http.Handler {
	authH := &AuthHandler{App: a}
	oidcH := NewAuthOIDC(authH)
	wsH := &WorkspaceHandler{App: a}
	fileH := &FileHandler{App: a}
	shareH := &ShareHandler{App: a}
	backendH := &BackendHandler{App: a}
	publicH := &PublicHandler{App: a}
	davH := &WebDAVHandler{App: a}
	verH := &VersionsHandler{App: a}
	actH := &ActivityHandler{App: a}
	adminUsersH := &AdminUsersHandler{App: a}
	gdriveH := &GDriveHandler{App: a}
	settingsH := &SettingsHandler{App: a}

	r := chi.NewRouter()
	r.Use(chimw.RequestID)
	r.Use(chimw.RealIP)
	r.Use(chimw.Recoverer)
	r.Use(chimw.Logger)

	r.Get("/api/health", func(w http.ResponseWriter, r *http.Request) {
		httpjson.Write(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Get("/api/public/{token}", publicH.Meta)
	r.Get("/api/public/{token}/download", publicH.Download)
	r.Get("/api/storage/google/enabled", gdriveH.Enabled)
	r.Get("/api/auth/google/drive/callback", gdriveH.Callback)

	authLimit := middleware.NewIPRateLimiter(20, 15*time.Minute)

	r.Route("/api/auth", func(r chi.Router) {
		r.With(middleware.RateLimit(authLimit)).Post("/register", authH.Register)
		r.With(middleware.RateLimit(authLimit)).Post("/login", authH.Login)
		r.Get("/oidc/enabled", oidcH.Enabled)
		r.Get("/oidc/start", oidcH.Start)
		r.Get("/oidc/callback", oidcH.Callback)
		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireAuth(authH.SessionLookup()))
			r.Post("/logout", authH.Logout)
			r.Get("/me", authH.Me)
			r.Patch("/me", authH.UpdateProfile)
		})
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequireAuth(authH.SessionLookup()))

		r.Get("/api/workspaces", wsH.List)
		r.Post("/api/workspaces", wsH.CreateTeam)
		r.Post("/api/workspaces/join", wsH.Join)
		r.Get("/api/storage/usage", wsH.StorageUsage)
		r.Get("/api/workspaces/{workspaceID}/usage", wsH.Usage)
		r.Get("/api/workspaces/{workspaceID}/members", wsH.Members)
		r.Patch("/api/workspaces/{workspaceID}/members/{userID}", wsH.UpdateMember)
		r.Delete("/api/workspaces/{workspaceID}/members/{userID}", wsH.RemoveMember)
		r.Post("/api/workspaces/{workspaceID}/invite", wsH.RotateInvite)
		r.Patch("/api/workspaces/{workspaceID}/storage", gdriveH.AssignWorkspaceStorage)
		r.Post("/api/workspaces/{workspaceID}/migrate", wsH.Migrate)
		r.Get("/api/migrations/{jobID}", wsH.GetMigration)

		r.Get("/api/storage/google/start", gdriveH.Start)
		r.Get("/api/storage/connections", gdriveH.ListConnections)
		r.Delete("/api/storage/connections/{connectionID}", gdriveH.DeleteConnection)
		r.Post("/api/storage/webdav", gdriveH.ConnectWebDAV)
		r.Get("/api/storage/google/live", gdriveH.ListLive)
		r.Get("/api/storage/google/live/download", gdriveH.DownloadLive)
		r.Put("/api/storage/google/live/upload", gdriveH.UploadLive)
		r.Post("/api/storage/google/live/move", gdriveH.MoveLive)

		r.Get("/api/workspaces/{workspaceID}/nodes", fileH.List)
		r.Post("/api/workspaces/{workspaceID}/folders", fileH.Mkdir)
		r.Put("/api/workspaces/{workspaceID}/upload", fileH.Upload)
		r.Get("/api/workspaces/{workspaceID}/trash", fileH.Trash)
		r.Delete("/api/workspaces/{workspaceID}/trash", fileH.EmptyTrash)
		r.Get("/api/workspaces/{workspaceID}/search", fileH.Search)
		r.Post("/api/workspaces/{workspaceID}/download-zip", fileH.DownloadZip)
		r.Get("/api/nodes/{nodeID}/download", fileH.Download)
		r.Get("/api/nodes/{nodeID}/content", fileH.Content)
		r.Get("/api/nodes/{nodeID}/thumb", fileH.Thumb)
		r.Patch("/api/nodes/{nodeID}", fileH.RenameOrMove)
		r.Delete("/api/nodes/{nodeID}", fileH.Delete)
		r.Post("/api/nodes/{nodeID}/restore", fileH.Restore)
		r.Delete("/api/nodes/{nodeID}/purge", fileH.Purge)
		r.Post("/api/nodes/copy", fileH.CopyNodes)
		r.Get("/api/shared", fileH.GetSharedWithMe)
		r.Get("/api/activity/recent", actH.Recent)

		r.Get("/api/nodes/{nodeID}/shares", shareH.List)
		r.Post("/api/nodes/{nodeID}/shares", shareH.Create)
		r.Delete("/api/shares/{shareID}", shareH.Delete)

		r.Get("/api/nodes/{nodeID}/links", publicH.List)
		r.Post("/api/nodes/{nodeID}/links", publicH.Create)
		r.Delete("/api/links/{linkID}", publicH.Delete)

		r.Get("/api/nodes/{nodeID}/versions", verH.List)
		r.Post("/api/nodes/{nodeID}/versions/{version}/restore", verH.Restore)
		r.Get("/api/nodes/{nodeID}/versions/{version}/download", verH.Download)
		r.Get("/api/nodes/{nodeID}/activity", actH.ListForNode)

		r.Group(func(r chi.Router) {
			r.Use(middleware.RequireAdmin)
			r.Get("/api/admin/backends", backendH.List)
			r.Post("/api/admin/backends", backendH.Create)
			r.Patch("/api/admin/backends/{backendID}", backendH.Update)
			r.Delete("/api/admin/backends/{backendID}", backendH.Delete)
			r.Post("/api/admin/backends/{backendID}/default", backendH.SetDefault)
			r.Post("/api/admin/backends/{backendID}/test", backendH.Test)
			r.Patch("/api/admin/workspaces/{workspaceID}/backend", backendH.AssignWorkspace)
			r.Get("/api/admin/users", adminUsersH.List)
			r.Post("/api/admin/users/{userID}/approve", adminUsersH.Approve)
			r.Post("/api/admin/users/{userID}/reject", adminUsersH.Reject)
			r.Patch("/api/admin/users/{userID}/quota", adminUsersH.PatchQuota)
			r.Patch("/api/admin/workspaces/{workspaceID}/quota", backendH.PatchWorkspaceQuota)
			r.Get("/api/admin/settings/google", settingsH.GetGoogle)
			r.Put("/api/admin/settings/google", settingsH.PutGoogle)
			r.Get("/api/admin/settings/smtp", settingsH.GetSMTP)
			r.Put("/api/admin/settings/smtp", settingsH.PutSMTP)
			r.Get("/api/admin/settings/quota", settingsH.GetQuotaDefaults)
			r.Put("/api/admin/settings/quota", settingsH.PutQuotaDefaults)
			r.Post("/api/admin/search/reindex", settingsH.ReindexSearch)
		})
	})

	// WebDAV verbs (PROPFIND/MKCOL/…) are not in chi's method map — route outside chi.
	davAuth := middleware.RequireAuthOrBasic(authH.SessionLookup(), davH.BasicLookup())(davH)
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if strings.HasPrefix(req.URL.Path, "/dav/") {
			davAuth.ServeHTTP(w, req)
			return
		}
		r.ServeHTTP(w, req)
	})
}
