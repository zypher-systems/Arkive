# Upgrades

The API runs [goose](https://github.com/pressly/goose) migrations from `api/migrations` on every start (`ARKIVE_MIGRATIONS_DIR`). You do not run SQL by hand.

## 1.0 notes

- Recreate with:

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
  ```

- **MinIO removed.** Fresh installs seed a local folder at `/data/arkive`. If this instance still has a “Default MinIO” (or other S3) default pointing at the old Compose MinIO, `/api/ready` will fail after the upgrade. Add a **Local folder** backend under Admin, migrate workspaces onto it, and make it default — or wipe Compose volumes for a fresh install. Keep `minio_data` until the migrate finishes if you still need those blobs.

- Set `ARKIVE_ENV=production` and unique `ARKIVE_SESSION_SECRET` / `ARKIVE_SECRETS_KEY`. The API refuses to boot on placeholders.
- Inner nginx listens on **8080** (mapped to host **3080**). Outer reverse-proxy examples live in `deploy/`.
- Folder list, trash, shared-with-me, and admin users are paginated. Old clients that expected a bare JSON array for trash/shared/admin users need to read `{ items, has_more, next_offset }`.
- WebDAV advertises DAV class 1 (no LOCK). Since 1.1 it advertises class 2 with exclusive locks; see [webdav.md](webdav.md).
- User status may be `disabled` in addition to `pending` / `active` / `rejected`.

## Version-to-version

1. Back up Postgres and the data directory together ([backup.md](backup.md)).
2. Pull or build the new images.
3. `docker compose up -d --build api web` (or the prod overlay).
4. Watch API logs for `migration` errors. A failed migration aborts startup.
5. Hit `/api/ready` and hard-refresh the SPA.

Never skip a major version without reading that release’s CHANGELOG. Goose applies every pending `NNN_*.sql` in order; it does not roll back a half-applied file automatically.

## Rollback

Restore the previous images **and** the matching database + blob snapshot. Mixing a new database with old binaries (or the reverse) is unsupported.
