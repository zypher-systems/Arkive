# Changelog

All notable changes to Arkive are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- Team shares require the sharer to be a member of the target workspace
- Rate-limit all public-link endpoints (password guesses included)
- Password change invalidates other sessions
- API 500 responses no longer echo internal error text

### Changed

- MinIO images pull from quay.io with pinned release tags
- GitHub Actions CI (tests + compose smoke; no image publish)

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
