# Arkive

Self-hosted file sharing and cloud storage. Multi-user, multi-tenant workspaces (personal + teams), segregated storage, and sharing — without the Nextcloud kitchen sink.

Arkive is a single Go binary (API, WebDAV and the web UI). By default it keeps everything — database (SQLite), files and generated secrets — in one data folder, so the smallest install is **one container and one volume**. PostgreSQL is supported for bigger installs. Nothing needs to be installed on the host beyond Docker.

| Files (light) | Files (dark) | Phone |
| --- | --- | --- |
| ![Files in list view](docs/screenshots/light-04-files-list.png) | ![Photo gallery in dark mode](docs/screenshots/dark-07-files-gallery.png) | ![Files on a phone](docs/screenshots/mobile-04-files-list.png) |
| ![Details panel with sharing](docs/screenshots/light-10-share-upload-link.png) | ![Markdown editor](docs/screenshots/dark-11-editor-markdown.png) | ![Upload queue on a phone](docs/screenshots/mobile-12-upload-queue.png) |

More screens (sign-in with two-factor, first-run setup, public links and file requests, account and admin) are in [`docs/screenshots/`](docs/screenshots/). The UI can be translated — see [docs/translating.md](docs/translating.md).

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

Without Compose, the same single container (build the image once; it is not published to a registry yet):

```bash
docker build -f docker/Dockerfile -t arkive .
docker run -d --name arkive -p 3080:8080 -v arkive_data:/data/arkive --restart unless-stopped arkive
docker logs arkive 2>&1 | grep setup_token
```

The setup token stops a stranger from claiming a freshly started, internet-reachable instance before you do. It is only accepted while the instance has no accounts, a new one is printed on every restart until setup is done, and you can choose your own with `ARKIVE_SETUP_TOKEN` in `.env`.

Arkive is licensed under the [MIT License](LICENSE).

> **Upgrading from 1.0?** 1.0 always used PostgreSQL. Do **not** switch to the new single-container `docker-compose.yml` as-is: use `docker-compose.postgres.yml` (or set `ARKIVE_DATABASE_URL`), or move your data to SQLite with `arkive db copy`. See [`docs/upgrade.md`](docs/upgrade.md). Arkive refuses to start on an empty database when the data folder already holds files, so a mix-up cannot delete anything.

### Choosing a database

| | SQLite (default) | PostgreSQL |
|---|---|---|
| Setup | nothing — `arkive.db` in the data folder | a `postgres` container (`docker-compose.postgres.yml`) or your own server |
| Good for | one person, a family, a small team (tens of users) | larger teams, heavy concurrent writes, several Arkive replicas |
| Replicas | one Arkive container per database file | many containers can share one database |
| Backups | one folder (`arkive db backup` for a live snapshot) | `pg_dump` + the data folder |

`ARKIVE_DATABASE_URL` picks the engine: unset (or empty) means SQLite at `$ARKIVE_DATA_DIR/arkive.db`; `sqlite:///path/to/arkive.db` chooses another file; `postgres://user:pass@host:5432/arkive?sslmode=disable` uses PostgreSQL. Both engines run the same code, migrations and test suite. SQLite writes are serialized (one writer at a time, WAL mode, readers never wait), which is plenty for uploads from a handful of people; if you outgrow it, `arkive db copy --from sqlite:///data/arkive/arkive.db --to postgres://…` moves everything over. Keep an SQLite data folder on local disk — not NFS/SMB.

```bash
docker compose -f docker-compose.postgres.yml up -d      # arkive + postgres
```

### Production

TLS terminates at a reverse proxy; Arkive stays HTTP. Examples: [`deploy/Caddyfile`](deploy/Caddyfile), [`deploy/traefik.yml`](deploy/traefik.yml), [`deploy/nginx-proxy.conf`](deploy/nginx-proxy.conf).

```bash
# .env: ARKIVE_PUBLIC_URL is required (and POSTGRES_PASSWORD with PostgreSQL).
# Secrets are generated unless you set them; placeholders are refused.
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build            # SQLite
docker compose -f docker-compose.postgres.yml -f docker-compose.prod.yml up -d --build   # PostgreSQL
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
| `arkive_data` | `/data/arkive`: the SQLite database `arkive.db` (default), file blobs of the default local folder, and the generated `.arkive-secrets` |
| `postgres` / `postgres_data` | Only with `docker-compose.postgres.yml`: metadata (users, workspaces, nodes, ACLs) in PostgreSQL |

The image is distroless (static binary, non-root uid 65532, `arkive healthcheck` for the container health probe) and builds for amd64 and arm64.

### CLI

```text
arkive [serve]                          run the server (default)
arkive migrate                          apply migrations and exit
arkive user list
arkive user reset-password <email>      generated password, or --password / --password-stdin
arkive user promote|demote <email>
arkive user reset-2fa <email>           disable two-factor auth (lost authenticator)
arkive export --out DIR [--workspace ID] [--include-trash]
                                        rebuild the real folder tree from DB + blobs
arkive gc [--dry-run] [--force]         delete orphaned blobs and abandoned uploads (also runs daily;
                                        refuses mass deletions unless --force)
arkive db copy --from URL --to URL      copy all data into a new, empty database (PostgreSQL <-> SQLite)
arkive db backup --out FILE             consistent snapshot of the SQLite database (safe while running)
arkive healthcheck                      exit 0 when /api/ready is OK
arkive version
```

In Compose: `docker compose exec arkive arkive <command>`.

### Metrics

Set `ARKIVE_METRICS_ENABLED=true` to expose Prometheus metrics at `/metrics` (404 otherwise). It is served on the public port, so also set `ARKIVE_METRICS_TOKEN` and scrape with `Authorization: Bearer <token>`. Metrics: `arkive_http_requests_total` / `arkive_http_request_duration_seconds` (by route pattern, method, status), `arkive_upload_bytes_total`, `arkive_active_sessions`, `arkive_storage_bytes_used`, `arkive_build_info`, plus Go runtime and process metrics.

## Environment (API)

| Variable | Default / notes |
|----------|-----------------|
| `ARKIVE_DATABASE_URL` | Unset = SQLite at `<ARKIVE_DATA_DIR>/arkive.db`. `sqlite:///path.db` (or `file:/path.db`) for another SQLite file, `postgres://…` for PostgreSQL |
| `ARKIVE_ALLOW_NONEMPTY_DATA_DIR` | `false`. Arkive refuses to start on an empty database when `ARKIVE_DATA_DIR` already holds Arkive files (protects upgrades); `true` skips that check |
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
- Filename + full-text search (PostgreSQL tsvector or SQLite FTS5; text contents indexed on upload; Office extract where supported)
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

### WebDAV (official sync/mount path)

Mount a workspace with Basic auth (email + password). This is the supported way to sync from desktop/mobile.

```text
http://localhost:3080/dav/<workspace-id>/
```

Copy mount URLs from **Account → WebDAV mount**, or use the workspace id from `GET /api/workspaces`.

**rclone example:**

```bash
rclone config create arkive webdav \
  url http://localhost:3080/dav/<workspace-id>/ \
  vendor owncloud \
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
- **S3**: optional remote endpoint, keys, bucket, region, SSL, path-style — credentials encrypted in the database (Garage, SeaweedFS, or any S3-compatible host)

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
docker-compose.yml           single container, SQLite (default)
docker-compose.postgres.yml  arkive + PostgreSQL
docker-compose.prod.yml      production overlay for either
LICENSE
SECURITY.md
CHANGELOG.md
```

## Development

```bash
# API on :8080 with SQLite in ./.data (set ARKIVE_DATABASE_URL=postgres://… for PostgreSQL).
# Without a web build it serves a placeholder page.
cd api && ARKIVE_DATA_DIR=$PWD/.data go run ./cmd/arkive
# UI with hot reload on :5173, proxying /api and /dav to :8080
cd web && npm install && npm run dev

make build   # web build + ./arkive with the UI embedded
make test           # go vet + go test on SQLite (fresh database per test, zero setup)
make test-postgres  # the same suite on PostgreSQL (TEST_POSTGRES_URL=postgres://…)
make image          # docker build -f docker/Dockerfile
```

`go test ./...` needs no database: every test gets a fresh SQLite file. With `ARKIVE_TEST_DATABASE_URL=postgres://…` the same tests run against PostgreSQL. Write SQL that works on both — the rules are in [`api/internal/db/README.md`](api/internal/db/README.md); schema changes need a migration in both `api/migrations/` and `api/migrations/sqlite/` (a test checks they match).

CI (GitHub Actions, plus optional GitLab) runs `go vet` + `go test ./...` on SQLite (also with `-race`) and on PostgreSQL, `web` unit tests + production build, the compose smoke against both compose layouts (including a restart), and a build of the single image. Images are not published from CI.

Compose smoke (stack already up). Checks the SPA, completes first-run setup, registers a pending user, approves them, uploads, downloads and lists the file over WebDAV:

```bash
ARKIVE_SMOKE_SETUP_TOKEN=<token from the log> ./scripts/smoke.sh
```

Against an instance that is already set up, set `ARKIVE_SMOKE_ADMIN_EMAIL` / `ARKIVE_SMOKE_ADMIN_PASSWORD` instead. CI runs this against fresh stacks of both layouts with `ARKIVE_SETUP_TOKEN=ci-setup-token` (`COMPOSE_FILE=docker-compose.postgres.yml` selects the PostgreSQL one).

## Backup and ops

Compose named volumes hold durable state:

| Volume / path | Contents |
|---------------|----------|
| `arkive_data` | `/data/arkive`: SQLite database `arkive.db` (default layout), file blobs of the default local folder, `.arkive-secrets` |
| `postgres_data` | PostgreSQL layout only: users, workspaces, ACLs, share links, metadata |
| Extra binds | Whatever host/NFS paths you assigned as additional local backends |

Back up the database (SQLite: `arkive db backup`; PostgreSQL: `pg_dump`) and the data directory together for a consistent restore — see [`docs/backup.md`](docs/backup.md). Set `ARKIVE_ENV=production`; leave the secrets unset to use the generated ones, or set strong values (placeholders are refused). Keep `.arkive-secrets` (or your env values) with your backups: changing the secrets key makes the encrypted storage/SMTP/OAuth credentials in the DB unreadable — re-enter them after rotation. Set `ARKIVE_PUBLIC_URL` to your public origin and `ARKIVE_COOKIE_SECURE=true` behind HTTPS. Login/register are rate-limited (20 attempts / 15 minutes per IP). Soft-deleted trash is auto-purged after the Admin **trash retention** window (default 30 days; `0` disables). Licensed under MIT.

## Out of scope (for now)

Nextcloud-style apps ecosystem, collaborative editing, AV scanning, billing, native mobile apps beyond WebDAV, full selective-sync desktop client with conflict UI.
