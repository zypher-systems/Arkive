# Arkive

Self-hosted file sharing and cloud storage. Multi-user, multi-tenant workspaces (personal + teams), segregated storage, and sharing — without the Nextcloud kitchen sink.

Everything runs in Docker. Nothing needs to be installed on the host beyond Docker Compose.

## Quick start

```bash
cp .env.example .env
# Set ARKIVE_BOOTSTRAP_ADMIN_EMAIL to your email, then:
docker compose up --build
```

Open [http://localhost:3080](http://localhost:3080).

### Bootstrap admin

Put your email in `.env` as `ARKIVE_BOOTSTRAP_ADMIN_EMAIL` (compose default if unset: `admin@arkive.local`). Register or log in with that address — it becomes the instance admin (Storage + user approvals).

Password must be at least 8 characters.

### Signup approval

Arkive is private by default: anyone can create an account, but new signups stay **pending** until an instance admin approves them under **Admin → Users**. Pending and rejected accounts cannot log in or use WebDAV. The bootstrap admin email is auto-approved.

## Stack

| Service   | Role                                      |
|-----------|-------------------------------------------|
| `web`     | Nginx + React SPA (port **3080**)         |
| `api`     | Go API (chi), migrations on startup       |
| `postgres`| Metadata (users, workspaces, nodes, ACLs) |
| `minio`   | S3-compatible blob storage (dev default)  |
| `nfs_demo`| Demo volume mounted at `/mnt/arkive-nfs`  |

## Environment (API)

| Variable | Default / notes |
|----------|-----------------|
| `ARKIVE_DATABASE_URL` | Postgres DSN |
| `ARKIVE_S3_*` | Seeded default MinIO backend |
| `ARKIVE_SESSION_SECRET` | Cookie/session material — change for production |
| `ARKIVE_SECRETS_KEY` | Encrypts S3 credentials at rest (falls back to session secret) |
| `ARKIVE_BOOTSTRAP_ADMIN_EMAIL` | Instance admin on register/login (set in `.env`) |
| `ARKIVE_COOKIE_SECURE` | `true` behind HTTPS |
| `ARKIVE_MAX_UPLOAD_BYTES` | Max upload size (default `10737418240` = 10 GiB) |
| `ARKIVE_GOOGLE_CLIENT_ID` / `SECRET` | Optional env override for Google Drive OAuth (else Admin UI) |
| `ARKIVE_GOOGLE_REDIRECT_URL` | Optional redirect override |
| `ARKIVE_MIGRATIONS_DIR` | `/app/migrations` in container |

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
- Instance-admin storage backends: remote S3 + NFS/local mount; per-workspace assignment; background migrate
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

Set all of these on the `api` service to show **Continue with SSO** on the login page:

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

- **S3**: endpoint, keys, bucket, region, SSL, path-style — credentials encrypted in Postgres
- **NFS**: filesystem path visible to the API container

Compose mounts a writable demo volume at `/mnt/arkive-nfs`. For a real NFS share, bind-mount it into the `api` service (Docker/host networking required) and point the backend at that path.

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
api/          Go module
web/          React + Vite + Tailwind SPA
docker/       Dockerfiles + nginx.conf
assets/       Logo / brand source
docker-compose.yml
```

## Development

```bash
cd api && go test ./...
cd web && npm install && npm run build
```

CI (GitLab, runner tag `docker-build`) runs `go test ./...`, `web` production build, and Docker image builds for api/web.

Optional signup-approval integration test (needs a Postgres DSN):

```bash
ARKIVE_TEST_DATABASE_URL='postgres://arkive:arkive@localhost:5432/arkive?sslmode=disable' go test ./internal/handlers/ -run TestSignupApprovalFlow
```

## Backup and ops

Compose named volumes hold durable state:

| Volume / path | Contents |
|---------------|----------|
| `postgres_data` | Users, workspaces, ACLs, share links, metadata |
| `minio_data` | File blobs (default S3 backend) |
| NFS / local mounts | Whatever paths you assigned as NFS backends |

Back up Postgres and object storage together for a consistent restore. Rotate `ARKIVE_SESSION_SECRET` and `ARKIVE_SECRETS_KEY` for production (changing the secrets key invalidates encrypted S3 credentials stored in the DB — re-enter them after rotation). Set `ARKIVE_PUBLIC_URL` to your public origin and `ARKIVE_COOKIE_SECURE=true` behind HTTPS. Login/register are rate-limited (20 attempts / 15 minutes per IP). Soft-deleted trash is auto-purged after the Admin **trash retention** window (default 30 days; `0` disables).

## Out of scope (for now)

Nextcloud-style apps ecosystem, collaborative editing, AV scanning, billing, native mobile apps beyond WebDAV, full selective-sync desktop client with conflict UI.
