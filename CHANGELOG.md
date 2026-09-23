# Changelog

All notable changes to Arkive are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Single `arkive` binary and image: the Go server now serves the API, WebDAV and the embedded web UI (go:embed) with the security headers nginx used to add
- SQLite support (pure Go, no CGO) next to PostgreSQL. `ARKIVE_DATABASE_URL` picks the engine (`postgres://…` or `sqlite:///path.db`); unset means SQLite at `$ARKIVE_DATA_DIR/arkive.db`. The stock `docker-compose.yml` is now a single `arkive` container with one `arkive_data` volume; `docker-compose.postgres.yml` is the `arkive` + `postgres` layout (same volumes as 1.0)
- `arkive db copy --from URL --to URL` moves a whole instance between PostgreSQL and SQLite (either direction); `arkive db backup --out FILE` takes an online SQLite snapshot (VACUUM INTO)
- Full-text search on SQLite via FTS5 (PostgreSQL keeps tsvector)
- `arkive gc --force`
- First-run setup screen API (`GET/POST /api/setup`) guarded by a one-time setup token printed to the log (or `ARKIVE_SETUP_TOKEN`), and `GET /api/instance`
- Secrets auto-generation: unset `ARKIVE_SESSION_SECRET` / `ARKIVE_SECRETS_KEY` are generated once into `<ARKIVE_DATA_DIR>/.arkive-secrets`
- CLI subcommands: `serve`, `migrate`, `user list|reset-password|promote|demote`, `healthcheck`, `version`
- Prometheus `/metrics` (`ARKIVE_METRICS_ENABLED`, optional `ARKIVE_METRICS_TOKEN`)
- Version stamped at build time (`--build-arg VERSION=…`) and reported by `/api/instance` and `arkive version`
- Multi-arch (amd64/arm64) distroless image with a built-in `HEALTHCHECK`; `Makefile` for local builds

### Security

- Production refuses to start with the default PostgreSQL password `arkive`
- Startup refuses an empty database when the data directory already holds Arkive files (a 1.0 install started with the new single-container compose file), with instructions; override with `ARKIVE_ALLOW_NONEMPTY_DATA_DIR=true`
- Orphan GC deletes nothing when the database references no files but storage holds blobs, and refuses a run that would delete more than 10% of a backend's blobs (min. 100) unless `arkive gc --force`
- Team shares require the sharer to be a member of the target workspace
- Rate-limit all public-link endpoints (password guesses included)
- Password change invalidates other sessions
- API 500 responses no longer echo internal error text
- Client IP (rate limits, logs) honours `X-Forwarded-For` / `X-Real-IP` only from `ARKIVE_TRUSTED_PROXIES`, taking the right-most untrusted hop
- CSP allows the inline theme script by hash (it was silently blocked before)

### Changed

- `docker/Dockerfile.api`, `docker/Dockerfile.web` and `docker/nginx.conf` are replaced by `docker/Dockerfile`; the `api` and `web` services by `arkive` (volumes unchanged — see `docs/upgrade.md`)
- Migrations are embedded; `ARKIVE_MIGRATIONS_DIR` is optional. SQLite has its own migration set (`api/migrations/sqlite/`); a test keeps both schemas equivalent
- **Upgrading 1.0 installs must use `docker-compose.postgres.yml`** (or set `ARKIVE_DATABASE_URL`); see `docs/upgrade.md`
- `ARKIVE_DATABASE_URL` no longer defaults to `postgres://arkive:arkive@localhost:5432/arkive`
- Go tests run on SQLite with zero setup and on PostgreSQL with `ARKIVE_TEST_DATABASE_URL`; CI runs both, plus the compose smoke on both layouts
- `ARKIVE_BOOTSTRAP_ADMIN_EMAIL` is optional and no longer defaults to `admin@arkive.local` in Compose
- HTTP server sets `IdleTimeout` (no read/write timeouts, so long uploads keep working)
- Default storage is a local folder (`/data/arkive`); MinIO is no longer in Compose
- Admin storage type “NFS” is now “Local folder” (existing `nfs` backends still work)
- GitHub Actions CI on pull requests only (tests + compose smoke; no image publish)

### Fixed

- Someone with a write share could move items out of the shared folder into the owner's workspace root; paste, zip download and undo of a delete inside a folder shared with you were refused
- Moving a folder into its own subfolder was accepted (detaching the tree), and copying a folder into itself never finished
- Copy/paste next to the original failed with a raw database error; copies now get "name (1).ext"
- A move or rename without a name renamed the item to "."
- Video and audio previews ignored byte ranges (no seeking; Safari would not play)
- Public link passwords with non-ASCII characters never unlocked; the link page now shows the file size
- Old versions downloaded as `report.pdf.v3`; now `report.v3.pdf`
- Removing a share or public link now shows in Recent and the item's activity
- Web: Move to… inside a folder shared with you starts at that folder (it listed the owner's root and moved files there)
- Web: a text file over 2 MB opens read-only and truncated instead of failing to load
- Web: after too many wrong 2FA codes the sign-in goes back to the password step instead of retrying a dead challenge
- Web: menus opened right after typing a long search (Admin → Users actions) closed immediately
- Web: thumbnails refresh after a file changes; files received through upload links are labelled in Recent
- Web: on phones, page headers with several actions (Trash with a workspace picker) and a few forms squeezed their titles to one letter
- Web: accessible names for file rows, pending-user Approve/Reject buttons and settings cards

## [1.0.0] - 2026-08-12

First public self-hosted release. TLS terminates at a reverse proxy; Arkive itself stays HTTP.

### Added

- Production Compose overlay (`docker-compose.prod.yml`) that sets `ARKIVE_ENV=production`, pins MinIO, and requires unique secrets
- Reverse-proxy examples for Caddy, Traefik, and nginx (`deploy/`)
- `/api/ready` readiness probe (Postgres + default storage backend)
- MIT license
- Admin user disable, delete, and instance-admin promote/demote
- Invite-only registration toggle
- Folder deep links (`/w/:workspaceId/f/:folderId`)
- Global search across workspaces the user can access
- Shift/Ctrl range selection in Files
- Share and team-invite email when SMTP is configured
- Backup and upgrade runbooks

### Security

- Production boot refuses default session and secrets keys
- SPA security headers (CSP, frame options, nosniff, Referrer-Policy)
- Containers run as non-root
- Rate limiter uses the nginx hop IP (X-Forwarded-For is replaced, not appended)
- Quota enforced on chunked / unknown-length uploads
- Rate limits on WebDAV and public-link downloads
- OIDC binds by IdP subject only (no silent email takeover)
- WebDAV advertises DAV class 1 (no LOCK)

### Changed

- Folder, trash, shared-with-me, and admin user lists are paginated
- SPA redirects to `/login` on 401
- Bootstrap admin email is promoted once, not on every login
