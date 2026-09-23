# Changelog

All notable changes to Arkive are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Single `arkive` binary and image: the Go server now serves the API, WebDAV and the embedded web UI (go:embed) with the security headers nginx used to add. Compose shrinks to `arkive` + `postgres`; `docker compose up -d` is the whole install
- First-run setup screen API (`GET/POST /api/setup`) guarded by a one-time setup token printed to the log (or `ARKIVE_SETUP_TOKEN`), and `GET /api/instance`
- Secrets auto-generation: unset `ARKIVE_SESSION_SECRET` / `ARKIVE_SECRETS_KEY` are generated once into `<ARKIVE_DATA_DIR>/.arkive-secrets`
- CLI subcommands: `serve`, `migrate`, `user list|reset-password|promote|demote`, `healthcheck`, `version`
- Prometheus `/metrics` (`ARKIVE_METRICS_ENABLED`, optional `ARKIVE_METRICS_TOKEN`)
- Version stamped at build time (`--build-arg VERSION=…`) and reported by `/api/instance` and `arkive version`
- Multi-arch (amd64/arm64) distroless image with a built-in `HEALTHCHECK`; `Makefile` for local builds

### Security

- Team shares require the sharer to be a member of the target workspace
- Rate-limit all public-link endpoints (password guesses included)
- Password change invalidates other sessions
- API 500 responses no longer echo internal error text
- Client IP (rate limits, logs) honours `X-Forwarded-For` / `X-Real-IP` only from `ARKIVE_TRUSTED_PROXIES`, taking the right-most untrusted hop
- CSP allows the inline theme script by hash (it was silently blocked before)

### Changed

- `docker/Dockerfile.api`, `docker/Dockerfile.web` and `docker/nginx.conf` are replaced by `docker/Dockerfile`; the `api` and `web` services by `arkive` (volumes unchanged — see `docs/upgrade.md`)
- Migrations are embedded; `ARKIVE_MIGRATIONS_DIR` is optional
- `ARKIVE_BOOTSTRAP_ADMIN_EMAIL` is optional and no longer defaults to `admin@arkive.local` in Compose
- HTTP server sets `IdleTimeout` (no read/write timeouts, so long uploads keep working)
- Default storage is a local folder (`/data/arkive`); MinIO is no longer in Compose
- Admin storage type “NFS” is now “Local folder” (existing `nfs` backends still work)
- GitHub Actions CI on pull requests only (tests + compose smoke; no image publish)

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
