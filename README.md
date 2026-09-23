# Arkive

Self-hosted file sharing and cloud storage. Multi-user, multi-tenant workspaces (personal + teams), segregated storage, and sharing — without the Nextcloud kitchen sink.

Arkive is a single Go binary (API, WebDAV and the web UI) plus Postgres. Nothing needs to be installed on the host beyond Docker Compose.

## Quick start

```bash
docker compose up -d
docker compose logs arkive | grep setup_token
```

The log line looks like this:

```text
{"level":"WARN","msg":"no accounts yet: open the web UI and complete setup with this one-time setup token","url":"http://localhost:3080/","setup_token":"480BMRMGq4L9h8dCB8fnY0tu"}
```

Open [http://localhost:3080](http://localhost:3080), enter the setup token, and create the admin account. That's it: session and encryption secrets are generated on first boot and kept in the data volume (`/data/arkive/.arkive-secrets`).

The setup token stops a stranger from claiming a freshly started, internet-reachable instance before you do. It is only accepted while the instance has no accounts, a new one is printed on every restart until setup is done, and you can choose your own with `ARKIVE_SETUP_TOKEN` in `.env`.

Arkive is licensed under the [MIT License](LICENSE).

### Production

TLS terminates at a reverse proxy; Arkive stays HTTP. Examples: [`deploy/Caddyfile`](deploy/Caddyfile), [`deploy/traefik.yml`](deploy/traefik.yml), [`deploy/nginx-proxy.conf`](deploy/nginx-proxy.conf).

```bash
# .env: POSTGRES_PASSWORD and ARKIVE_PUBLIC_URL are required.
# Secrets are generated unless you set them; placeholders are refused.
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Set `ARKIVE_PUBLIC_URL=https://arkive.example.com` (`ARKIVE_COOKIE_SECURE` defaults to `true` in the overlay). Arkive reads `X-Forwarded-For` / `X-Real-IP` **only** from peers listed in `ARKIVE_TRUSTED_PROXIES` (the prod overlay trusts loopback and Docker's `172.16.0.0/12`); from anyone else they are ignored, so clients cannot spoof their IP past the rate limiter. The outer proxy should cap the request body to match `ARKIVE_MAX_UPLOAD_BYTES` (default 10 GiB).

See [`docs/backup.md`](docs/backup.md) and [`docs/upgrade.md`](docs/upgrade.md).

### First admin

The first account is created through the setup screen (above). Alternatives:

- `ARKIVE_BOOTSTRAP_ADMIN_EMAIL` (optional): that address becomes instance admin when it registers or logs in, as in 1.0.
- CLI inside the container:

  ```bash
  docker compose exec arkive arkive user list
  docker compose exec arkive arkive user promote you@example.com
  docker compose exec arkive arkive user reset-password you@example.com   # prints a new password
  ```

Passwords must be at least 8 characters.

### Signup approval

Arkive is private by default: anyone can create an account, but new signups stay **pending** until an instance admin approves them under **Admin → Users**. Pending and rejected accounts cannot log in or use WebDAV. The bootstrap admin email is auto-approved.

## Stack

| Service / volume | Role |
|------------------|------|
| `arkive` | Single Go binary: API (chi), WebDAV, embedded React SPA, migrations on startup (port **3080** → 8080) |
| `postgres` | Metadata (users, workspaces, nodes, ACLs) |
| `arkive_data` | Default file blobs at `/data/arkive`, plus the generated `.arkive-secrets` |

The image is distroless (static binary, non-root uid 65532, `arkive healthcheck` for the container health probe) and builds for amd64 and arm64.

### CLI

```text
arkive [serve]                          run the server (default)
arkive migrate                          apply migrations and exit
arkive user list
arkive user reset-password <email>      generated password, or --password / --password-stdin
arkive user promote|demote <email>
arkive healthcheck                      exit 0 when /api/ready is OK
arkive version
```

In Compose: `docker compose exec arkive arkive <command>`.

### Metrics

Set `ARKIVE_METRICS_ENABLED=true` to expose Prometheus metrics at `/metrics` (404 otherwise). It is served on the public port, so also set `ARKIVE_METRICS_TOKEN` and scrape with `Authorization: Bearer <token>`. Metrics: `arkive_http_requests_total` / `arkive_http_request_duration_seconds` (by route pattern, method, status), `arkive_upload_bytes_total`, `arkive_active_sessions`, `arkive_storage_bytes_used`, `arkive_build_info`, plus Go runtime and process metrics.

## Environment (API)

| Variable | Default / notes |
|----------|-----------------|
| `ARKIVE_DATABASE_URL` | Postgres DSN |
| `ARKIVE_DATA_DIR` | Default local folder (`/data/arkive`) when no S3 endpoint is set |
| `ARKIVE_S3_*` | Optional — if `ARKIVE_S3_ENDPOINT` is set, seed a remote S3 default instead |
| `ARKIVE_ENV` | `development` (default) or `production` — production refuses placeholder secrets |
| `ARKIVE_SESSION_SECRET` | Optional. Generated on first boot into `<ARKIVE_DATA_DIR>/.arkive-secrets` when unset; env always wins |
| `ARKIVE_SECRETS_KEY` | Optional. Encrypts stored storage/SMTP/OAuth credentials; generated like the session secret (falls back to the session secret when only that is set, as in 1.0) |
| `ARKIVE_SETUP_TOKEN` | Optional. Token the first-run setup requires; unset = one-time token printed to the log |
| `ARKIVE_BOOTSTRAP_ADMIN_EMAIL` | Optional. This email becomes instance admin on register/login |
| `ARKIVE_TRUSTED_PROXIES` | Comma-separated CIDRs/IPs whose `X-Forwarded-For` / `X-Real-IP` are honoured (default: none — the TCP peer is the client) |
| `ARKIVE_METRICS_ENABLED` / `ARKIVE_METRICS_TOKEN` | Enable `/metrics`; optional bearer token |
| `ARKIVE_HTTP_ADDR` | Listen address (default `:8080`) |
| `ARKIVE_COOKIE_SECURE` | `true` behind HTTPS |
| `ARKIVE_MAX_UPLOAD_BYTES` | Max upload size (default `10737418240` = 10 GiB) |
| `ARKIVE_GOOGLE_CLIENT_ID` / `SECRET` | Optional env override for Google Drive OAuth (else Admin UI) |
| `ARKIVE_GOOGLE_REDIRECT_URL` | Optional redirect override |
| `ARKIVE_MIGRATIONS_DIR` | Optional. Migrations are embedded in the binary; set to load them from a directory instead |

## Features

- Email/password auth with httpOnly session cookies (argon2id); optional OIDC/SSO
- Personal workspace on signup + team workspaces with invite tokens
- Browse / upload / download / mkdir / rename / move; OS + internal drag-and-drop; multi-select + zip
- Files views: List / Details / Tiles (persisted), folder glyphs, image/video/audio/PDF/text previews, Office/archive badges
- Right-click context menus; Copy (clipboard) vs Copy to…; storage used (root + total) in Files UI
- Soft-delete trash with restore/purge, empty trash, undo toast
- Filename + Postgres FTS search (text contents indexed on upload; Office extract where supported)
- Internal shares (user email or team, read/write); Shared-with-me browse; Recent activity
- Public share links with optional password + expiry (`/s/:token`)
- File version history on overwrite (last 10) + share/link activity
- WebDAV mount per workspace (`/dav/{workspaceID}/`) — official desktop/mobile sync path
- Instance-admin storage backends: local folder + optional remote S3; per-workspace assignment; background migrate
- Optional Google Drive Connected vault + live Drive browse; Icedrive/Internxt via WebDAV mounts
- Optional storage quotas (per workspace / user) with Admin controls
- Server-generated image thumbnails for Files tiles
- Signup approve/reject email (optional SMTP)
- Brand UI (graphite + industrial orange/amber)
- Optional thin desktop wrapper under [`desktop/`](desktop/) (Tauri + WebDAV)

### WebDAV (official sync/mount path)

Mount a workspace with Basic auth (email + password). This is the supported way to sync from desktop/mobile until a dedicated client ships (see [`desktop/README.md`](desktop/README.md)).

```text
http://localhost:3080/dav/<workspace-id>/
```

Copy mount URLs from **Account → WebDAV mount**, or use the workspace id from `GET /api/workspaces`.

**rclone example:**

```bash
rclone config create arkive webdav \
  url http://localhost:3080/dav/<workspace-id>/ \
  vendor other \
  user admin@arkive.local \
  pass <password>
# obscure password for rclone: rclone obscure 'yourpassword'
rclone ls arkive:
rclone sync ./local-folder arkive:backup
```

**macOS:** Finder → Go → Connect to Server → `http://localhost:3080/dav/<workspace-id>/`

**Windows:** Map Network Drive → `http://localhost:3080/dav/<workspace-id>/` (may need WebDAV redirector / Basic auth enabled).

DELETE via WebDAV soft-deletes into Arkive trash (not permanent purge).

### Optional OIDC

Set all of these on the `arkive` service to show **Continue with SSO** on the login page:

```yaml
ARKIVE_PUBLIC_URL: https://arkive.example.com
ARKIVE_OIDC_ISSUER: https://your-idp.example.com
ARKIVE_OIDC_CLIENT_ID: arkive
ARKIVE_OIDC_CLIENT_SECRET: secret
ARKIVE_OIDC_REDIRECT_URL: https://arkive.example.com/api/auth/oidc/callback  # optional override
ARKIVE_OIDC_PROVIDER_NAME: SSO
```

Redirect URI to register with your IdP: `{ARKIVE_PUBLIC_URL}/api/auth/oidc/callback`

## Storage backends

Instance admins can add backends in the UI:

- **Local folder**: directory visible inside the `arkive` container. Compose mounts a volume at `/data/arkive`. Bind-mount a host path or NFS share over that (or another path) if you want the files on a specific disk.
- **S3**: optional remote endpoint, keys, bucket, region, SSL, path-style — credentials encrypted in Postgres (Garage, SeaweedFS, or any S3-compatible host)

Workspaces resolve their `BlobStore` from `storage_backend_id` (or the default backend).

### Google Drive (per-user)

Users connect Google Drive under **Account**. That adds a **Connected** root in Files (a `mount` workspace) without changing personal storage. Files sidebar roots: **My files** (personal + teams), **Shared with me**, **Connected** (Drive, etc.).

Arkive remains the source of truth for folders, ACLs, shares, versions, and trash; Drive only stores opaque file bytes in an `Arkive` folder (OAuth scope `drive.file`). WebDAV works per workspace, including the Drive mount.

1. In [Google Cloud Console](https://console.cloud.google.com/), create an OAuth **Web** client.
2. Authorized redirect URI: `{ARKIVE_PUBLIC_URL}/api/auth/google/drive/callback` (local default `http://localhost:3080/api/auth/google/drive/callback`).
3. As instance admin, open **Admin → Google Drive OAuth**, paste Client ID + secret, Save.
4. Optionally override via `.env` (`ARKIVE_GOOGLE_CLIENT_ID` / `ARKIVE_GOOGLE_CLIENT_SECRET`) — env wins over DB when set.

User Drive tokens are encrypted at rest with `ARKIVE_SECRETS_KEY`. Assigning a workspace backend changes the pointer only unless migration is requested (`migrate: true` or Account → Advanced copy). Large migrations enqueue a background job (`storage_migrations`); small vaults still run inline. Deletes from the old store are best-effort.

**Live Drive:** Files → Connected → Google Drive (live) lists real Drive files (requires a connected Drive account). Vault mounts remain separate opaque Arkive trees.

### Other cloud vaults

Under **Account**, connect Icedrive/Internxt via their WebDAV URL + credentials. That creates a Connected mount workspace using a WebDAV BlobStore.

### SMTP

Configure under **Admin → SMTP** or `ARKIVE_SMTP_*` env vars. When enabled, approving/rejecting a signup sends a short notification email.

## Project layout

```
api/          Go module (cmd/arkive; the SPA is embedded from api/internal/webui/dist)
web/          React + Vite + Tailwind SPA
docker/       Single multi-stage Dockerfile
deploy/       Caddy / Traefik / nginx TLS examples
docs/         Backup and upgrade runbooks
assets/       Logo / brand source
.github/      Public CI
docker-compose.yml
docker-compose.prod.yml
LICENSE
SECURITY.md
CHANGELOG.md
```

## Development

```bash
# API on :8080 (needs Postgres; see ARKIVE_DATABASE_URL). Without a web build it serves a placeholder page.
cd api && ARKIVE_DATA_DIR=$PWD/.data go run ./cmd/arkive
# UI with hot reload on :5173, proxying /api and /dav to :8080
cd web && npm install && npm run dev

make build   # web build + ./arkive with the UI embedded
make test    # go vet + go test
make image   # docker build -f docker/Dockerfile
```

CI (GitHub Actions, plus optional GitLab) runs `go vet` + `go test ./...` against Postgres, `web` unit tests + production build, the compose smoke, and a build of the single image. Images are not published from CI.

Optional signup-approval integration test (needs a Postgres DSN; set automatically in CI):

```bash
ARKIVE_TEST_DATABASE_URL='postgres://arkive:arkive@localhost:5432/arkive?sslmode=disable' go test ./internal/handlers/ -run TestSignupApprovalFlow
```

Compose smoke (stack already up). Checks the SPA, completes first-run setup, registers a pending user, approves them, uploads, downloads and lists the file over WebDAV:

```bash
ARKIVE_SMOKE_SETUP_TOKEN=<token from the log> ./scripts/smoke.sh
```

Against an instance that is already set up, set `ARKIVE_SMOKE_ADMIN_EMAIL` / `ARKIVE_SMOKE_ADMIN_PASSWORD` instead. CI runs this against a fresh compose stack with `ARKIVE_SETUP_TOKEN=ci-setup-token`.

## Backup and ops

Compose named volumes hold durable state:

| Volume / path | Contents |
|---------------|----------|
| `postgres_data` | Users, workspaces, ACLs, share links, metadata |
| `arkive_data` | File blobs for the default local folder (`/data/arkive`) and `.arkive-secrets` |
| Extra binds | Whatever host/NFS paths you assigned as additional local backends |

Back up Postgres and the data directory together for a consistent restore — see [`docs/backup.md`](docs/backup.md). Set `ARKIVE_ENV=production`; leave the secrets unset to use the generated ones, or set strong values (placeholders are refused). Keep `.arkive-secrets` (or your env values) with your backups: changing the secrets key makes the encrypted storage/SMTP/OAuth credentials in the DB unreadable — re-enter them after rotation. Set `ARKIVE_PUBLIC_URL` to your public origin and `ARKIVE_COOKIE_SECURE=true` behind HTTPS. Login/register are rate-limited (20 attempts / 15 minutes per IP). Soft-deleted trash is auto-purged after the Admin **trash retention** window (default 30 days; `0` disables). Licensed under MIT.

## Out of scope (for now)

Nextcloud-style apps ecosystem, collaborative editing, AV scanning, billing, native mobile apps beyond WebDAV, full selective-sync desktop client with conflict UI.
