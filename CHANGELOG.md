# Changelog

All notable changes to Arkive are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-09-23

Arkive now runs as **one container with one data folder**: a single binary serves the API, WebDAV and the web UI, and SQLite is the default database. The web UI is redesigned, uploads resume, WebDAV works with desktop and phone clients, and there is two-factor sign-in, upload-only links and an audit log. Images are published to `ghcr.io/zypher-systems/arkive`.

**Upgrading from 1.0:** 1.0 always used PostgreSQL — keep it with `docker-compose.postgres.yml` (or set `ARKIVE_DATABASE_URL`), or move to SQLite with `arkive db copy`. Read [`docs/upgrade.md`](docs/upgrade.md) first.

### Added

- **Redesigned web UI:** one app shell with sidebar, Ctrl/⌘+K search, upload menu and user menu; dense sortable file list with hover actions and a selection toolbar; List, Details, Tiles and Gallery views; details panel (info, sharing, versions, activity); full-screen image viewer; Markdown/text editor with preview; keyboard shortcuts (`?`); drop-anywhere uploads and friendly empty states; phone layout with drawer, bottom navigation and upload button; System/Light/Dark theme; tabbed Admin (Users, Storage, Sign-in, Email, Integrations, Maintenance, Audit log) and Account pages
- **Upload queue:** three uploads at a time with per-file progress, speed/ETA, cancel and retry; folder upload by picker or drag-and-drop; one failed file no longer stops the batch
- **Resumable uploads** (tus 1.0.0 at `/api/uploads`) for files over 8 MiB; interrupted uploads resume from the queue
- **Two-factor sign-in** (TOTP) with QR setup and 10 single-use recovery codes; admin and `arkive user reset-2fa` resets; with 2FA on, WebDAV accepts app passwords only
- **Upload-only links** ("file requests"): anyone with the link can add files to a folder without seeing it; optional password and expiry; name collisions are renamed, never overwritten
- **Audit log** of sign-ins, admin actions, settings, shares and links (Admin → Audit log; kept 180 days)
- **First-run setup** screen protected by a one-time token printed to the log (or `ARKIVE_SETUP_TOKEN`), so a stranger cannot claim a fresh instance
- **SQLite** (pure Go, no CGO) next to PostgreSQL. `ARKIVE_DATABASE_URL` picks the engine; unset means SQLite at `$ARKIVE_DATA_DIR/arkive.db`. Full-text search uses FTS5 on SQLite
- **Single `arkive` binary and image**: the server embeds the web UI with the security headers nginx used to add; multi-arch (amd64/arm64) distroless image with a built-in `HEALTHCHECK`
- **Published images and binaries:** `ghcr.io/zypher-systems/arkive` (`X.Y.Z`, `X.Y`, `X`, `latest`) with SBOM and provenance; standalone Linux and macOS binaries on each GitHub release
- **CLI:** `arkive user list|reset-password|promote|demote|reset-2fa`, `arkive export` (rebuild the real folder tree from the database and blobs), `arkive gc [--dry-run|--force]`, `arkive db copy --from URL --to URL` (PostgreSQL ⇄ SQLite), `arkive db backup`, `arkive migrate`, `arkive healthcheck`, `arkive version`
- **Configurable version retention** (Admin → Maintenance; default 10)
- **Daily cleanup** of orphaned blobs, stale temp files and abandoned uploads
- **WebDAV:** class 2 locking (Finder mounts read-write; Office on Windows can save), ETags with `If-Match`/`If-None-Match`, PROPPATCH and `X-OC-Mtime` for modification times, quota properties, byte ranges on GET, `/dav/` lists your workspaces; client setup guide in [`docs/webdav.md`](docs/webdav.md)
- Secrets are generated on first boot into `<ARKIVE_DATA_DIR>/.arkive-secrets` when `ARKIVE_SESSION_SECRET` / `ARKIVE_SECRETS_KEY` are unset
- Prometheus `/metrics` (opt-in: `ARKIVE_METRICS_ENABLED`, optional `ARKIVE_METRICS_TOKEN`)
- Translatable UI: all strings in `web/src/i18n/en.ts`; guide in [`docs/translating.md`](docs/translating.md)
- `GET /api/instance` (version and enabled features)
- Contributor guide, issue and pull request templates

### Security

- Someone with a write share could move items out of the shared folder into the owner's workspace root
- Client IP (rate limits, audit log) honours `X-Forwarded-For` / `X-Real-IP` only from `ARKIVE_TRUSTED_PROXIES`, taking the right-most untrusted hop
- Production refuses to start with the default PostgreSQL password `arkive`
- Startup refuses an empty database when the data folder already holds Arkive files (for example a 1.0 install started with the new single-container compose file); override with `ARKIVE_ALLOW_NONEMPTY_DATA_DIR=true`
- Orphan GC deletes nothing when the database references no files but storage holds blobs, and refuses a run that would delete more than 10% of a backend's blobs (min. 100) unless `arkive gc --force`
- WebDAV GET sends `nosniff` and a sandbox CSP so uploaded HTML/SVG cannot run in Arkive's origin
- Team shares require the sharer to be a member of the target workspace
- Rate limits on all public-link endpoints (password guesses included)
- Password change invalidates other sessions; enabling 2FA signs out other sessions
- API 500 responses no longer echo internal error text
- The CSP no longer blocks the theme script (moved to a same-origin file)

### Changed

- Compose: `docker-compose.yml` is a single `arkive` container (SQLite) that pulls the published image; `docker-compose.postgres.yml` is `arkive` + `postgres` with the same volumes as 1.0; `docker-compose.build.yml` builds from a checkout; `docker-compose.prod.yml` overlays either
- `docker/Dockerfile` replaces `Dockerfile.api`, `Dockerfile.web` and `nginx.conf`; the `api` and `web` services become `arkive`
- Default storage is a local folder at `/data/arkive`; MinIO is no longer in Compose; the Admin storage type "NFS" is now "Local folder" (existing `nfs` backends keep working)
- Migrations are embedded (`ARKIVE_MIGRATIONS_DIR` is optional); SQLite has its own set and a test keeps both schemas equivalent
- `ARKIVE_DATABASE_URL` no longer defaults to a local PostgreSQL; `ARKIVE_BOOTSTRAP_ADMIN_EMAIL` is optional and has no Compose default
- WebDAV MOVE/COPY honour `Overwrite:` (replacing a file keeps its id, shares and history, with the old content as a version); over-quota writes return 507; the per-IP WebDAV limit is 1200 requests/minute for file-manager bursts
- Uploads record a SHA-256 checksum; thumbnails and search indexing run on a bounded background queue
- HTTP server sets `IdleTimeout` but no read/write timeouts, so long uploads keep working
- CI runs Go tests on SQLite (also `-race`) and PostgreSQL, web tests, and the compose smoke plus a Playwright end-to-end suite on both layouts

### Fixed

- WebDAV: MOVE onto an existing file always failed with 412, breaking "save to temp file, then rename" in editors and rclone; paths were percent-decoded twice, so a name containing `%` could resolve to the workspace root
- Restoring an old version with low retention could delete the version being restored
- Moving a folder into its own subfolder was accepted (detaching the tree), and copying a folder into itself never finished
- Paste, zip download and undo of a delete inside a folder shared with you were refused
- Copy/paste next to the original failed with a database error; copies are now named "name (1).ext"
- A move or rename without a name renamed the item to "."
- Video and audio previews ignored byte ranges (no seeking; Safari would not play)
- Public link passwords with non-ASCII characters never unlocked; the link page shows the file size
- Old versions downloaded as `report.pdf.v3`; now `report.v3.pdf`
- Removing a share or public link now shows in Recent and the item's activity
- Web: Move to… inside a folder shared with you listed the owner's root
- Web: text files over 2 MB open read-only instead of failing to load
- Web: accessible names for file rows, Approve/Reject buttons and settings cards

### Removed

- The Tauri desktop wrapper (`desktop/`). WebDAV clients are the supported sync path — see [`docs/webdav.md`](docs/webdav.md)
- The separate nginx web container and the bundled MinIO

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
