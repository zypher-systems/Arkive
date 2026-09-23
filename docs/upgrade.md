# Upgrades

Arkive runs [goose](https://github.com/pressly/goose) migrations on every start. They are embedded in the binary (set `ARKIVE_MIGRATIONS_DIR` only to load them from a directory instead). You do not run SQL by hand; `arkive migrate` applies them without starting the server.

## 1.0 → 1.1: one container instead of three

1.1 replaces the `web` (nginx + SPA) and `api` services with a single `arkive` service: one Go binary serves the API, WebDAV, `/metrics` and the web UI.

1.1 also adds SQLite, and the stock `docker-compose.yml` now runs **only** the `arkive` container with a SQLite database in the data volume. **Your 1.0 data is in PostgreSQL**, so keep PostgreSQL (you can move to SQLite later, see below):

- **Existing installs MUST use `docker-compose.postgres.yml`** (the `arkive` + `postgres` layout, same `postgres_data` / `arkive_data` volumes and the same `POSTGRES_PASSWORD`), **or** set `ARKIVE_DATABASE_URL=postgres://…` yourself if you run your own compose file or database.
- If you forget and start the single-container file, Arkive finds a new, empty SQLite database next to your existing files and **refuses to start** with a message explaining the options. Nothing is deleted: the orphan cleanup also refuses to run when the database references no files. (`ARKIVE_ALLOW_NONEMPTY_DATA_DIR=true` overrides the startup check — only for data you really want to discard.)

Steps:

1. Back up Postgres and the data directory ([backup.md](backup.md)).
2. Check your `.env` (see below). Add `COMPOSE_FILE=docker-compose.postgres.yml` so that plain `docker compose …` commands keep using PostgreSQL (for production: `COMPOSE_FILE=docker-compose.postgres.yml:docker-compose.prod.yml`).
3. Pull the new release and recreate the stack. `--remove-orphans` removes the old `api` and `web` containers:

   ```bash
   docker compose -f docker-compose.postgres.yml up -d --remove-orphans
   # or, with the production overlay:
   docker compose -f docker-compose.postgres.yml -f docker-compose.prod.yml up -d --remove-orphans
   ```

   (With `COMPOSE_FILE` set in `.env`, `docker compose up -d --remove-orphans` does the same.) Do **not** run `--remove-orphans` with the single-container `docker-compose.yml` on a 1.0 install: it would remove your `postgres` container (the volume survives, but Arkive would then refuse to start as described above).

4. Check `docker compose logs arkive` for migration errors, then open the UI and hard-refresh.

### Optional: move a 1.0 / PostgreSQL install to SQLite

SQLite is enough for a person, a family or a small team (see "Choosing a database" in the README). `arkive db copy` copies every row (ids and timestamps preserved) into a new SQLite file and rebuilds the search index; the files themselves stay where they are.

```bash
# 0. Back up first (backup.md). Then stop Arkive, keep PostgreSQL running.
docker compose -f docker-compose.postgres.yml stop arkive

# 1. Copy PostgreSQL into /data/arkive/arkive.db inside the arkive_data volume.
docker compose -f docker-compose.postgres.yml run --rm --no-deps arkive db copy \
  --from "postgres://arkive:${POSTGRES_PASSWORD:-arkive}@postgres:5432/arkive?sslmode=disable" \
  --to sqlite:///data/arkive/arkive.db

# 2. Switch layouts: remove COMPOSE_FILE from .env, stop the old stack
#    (volumes are kept) and start the single container.
docker compose -f docker-compose.postgres.yml down
docker compose up -d
```

Sign in and check a few files. The `postgres_data` volume is untouched, so going back is just `docker compose -f docker-compose.postgres.yml up -d` (changes made on SQLite in the meantime would not be there). Once you are happy, remove it with `docker volume rm <project>_postgres_data`. The copy refuses to write into a non-empty database, so re-running it after a partial attempt means deleting `arkive.db` (and `arkive.db-wal`/`-shm`) first. The same command works in the other direction (`--from sqlite:///data/arkive/arkive.db --to postgres://…`) when you outgrow SQLite.

What carries over and what changes:

- **Volumes.** `postgres_data` and `arkive_data` keep their names (in `docker-compose.postgres.yml`), so Compose reuses them. The new image runs as uid 65532, the same uid the 1.0 `api` image used, so file ownership inside `arkive_data` is unchanged. If you bind-mounted a host directory over `/data/arkive`, keep the mount on the `arkive` service.
- **Port.** The UI is still on host port **3080**, now served by the `arkive` container's port 8080. Your outer reverse proxy config does not change. `ARKIVE_PORT` changes the host port (for example `127.0.0.1:3080` to accept only a local proxy).
- **Service names.** Anything that referred to `api` or `web` needs to use `arkive`: `docker compose exec`, Traefik labels, monitoring, and custom override files. The in-network alias `web.local` is now `arkive.local`.
- **Secrets.** `ARKIVE_SESSION_SECRET` and `ARKIVE_SECRETS_KEY` are now optional. Values you set in `.env` still win; keep them. When they are unset, Arkive generates strong values once and stores them in `/data/arkive/.arkive-secrets` (mode 0600). Back that file up with the volume.
  - The dev compose file no longer sets the `change-me-in-production-…` placeholder. If your 1.0 install ran on that placeholder, 1.1 detects it on the first boot by decrypting a stored credential, keeps it as the secrets key so S3/SMTP/Drive credentials still work, and logs a warning. To rotate it, set a strong `ARKIVE_SECRETS_KEY` and re-enter those credentials.
  - If stored credentials exist but no known key opens them (for example you removed a custom `ARKIVE_SECRETS_KEY` from `.env`), Arkive refuses to start rather than silently lose them. Put the old value back.
  - Production still refuses the placeholder strings. It accepts generated secrets.
- **Admin bootstrap.** `ARKIVE_BOOTSTRAP_ADMIN_EMAIL` still works but is optional, and the compose default `admin@arkive.local` is gone. Existing accounts are untouched. On a new instance, the first visitor creates the admin in the setup screen using the one-time token from `docker compose logs arkive | grep setup_token` (or `ARKIVE_SETUP_TOKEN`).
- **Client IPs behind a proxy.** 1.0 trusted `X-Forwarded-For` because its own nginx overwrote it. 1.1 is reachable directly, so it honours forwarding headers only from `ARKIVE_TRUSTED_PROXIES`. The prod overlay defaults to `127.0.0.1/32,172.16.0.0/12` (a proxy on the host or in a Docker network). If your proxy is elsewhere, add its address. Otherwise every request looks like it comes from the proxy and shares one rate-limit bucket.
- **Security headers** (CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`) are now sent by Arkive itself, with the same values nginx used. Hashed `/assets/*` are cached as immutable; `index.html` is revalidated.
- **Health checks.** The image has no shell or `wget`. Use `arkive healthcheck` (the image's built-in `HEALTHCHECK`), or probe `GET /api/ready` over HTTP.
- **Removed files.** `docker/Dockerfile.api`, `docker/Dockerfile.web` and `docker/nginx.conf` are replaced by `docker/Dockerfile`. `ARKIVE_MIGRATIONS_DIR=/app/migrations` is no longer needed. If you still set it, it must point at a directory that exists in the new image, so remove it.
- **Admin CLI.** `docker compose exec arkive arkive user list | reset-password | promote | demote` handles lockouts without SQL.

## 1.0 notes

- Recreate with:

  ```bash
  docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
  ```

- **MinIO removed.** Fresh installs seed a local folder at `/data/arkive`. If this instance still has a “Default MinIO” (or other S3) default pointing at the old Compose MinIO, `/api/ready` will fail after the upgrade. Add a **Local folder** backend under Admin, migrate workspaces onto it, and make it default — or wipe Compose volumes for a fresh install. Keep `minio_data` until the migrate finishes if you still need those blobs.
- Folder list, trash, shared-with-me, and admin users are paginated. Old clients that expected a bare JSON array for trash/shared/admin users need to read `{ items, has_more, next_offset }`.
- WebDAV advertises DAV class 1 (no LOCK). Since 1.1 it advertises class 2 with exclusive locks; see [webdav.md](webdav.md).
- User status may be `disabled` in addition to `pending` / `active` / `rejected`.

## Version-to-version

1. Back up the database (SQLite or Postgres) and the data directory together ([backup.md](backup.md)).
2. Pull or build the new image.
3. `docker compose up -d --remove-orphans` (add `-f docker-compose.postgres.yml` for PostgreSQL, and the prod overlay if you use it).
4. Watch `docker compose logs arkive` for `migration` errors. A failed migration aborts startup.
5. Hit `/api/ready` and hard-refresh the SPA.

Never skip a major version without reading that release’s CHANGELOG. Goose applies every pending `NNN_*.sql` in order; it does not roll back a half-applied file automatically.

## Rollback

Restore the previous images **and** the matching database + blob snapshot. Mixing a new database with old binaries (or the reverse) is unsupported. Rolling back to 1.0 also means restoring the 1.0 compose file. If 1.1 generated secrets, copy the values from `/data/arkive/.arkive-secrets` into `.env` first, because 1.0 does not read that file.
