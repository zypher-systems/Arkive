# Backup and restore

Arkive stores metadata in a database and file bytes in the default local folder (`arkive_data` at `/data/arkive`, or whatever host/NFS bind you mounted) plus any extra backends you added. **Snapshot metadata and blobs together.** Restoring one without the other leaves orphan blobs or missing files.

| Layout | Database |
|--------|----------|
| `docker-compose.yml` (default) | SQLite file `/data/arkive/arkive.db` in the `arkive_data` volume (plus `arkive.db-wal` / `arkive.db-shm` while running) |
| `docker-compose.postgres.yml` | PostgreSQL in the `postgres_data` volume |

## What to back up

| Volume / path | Contents |
|---------------|----------|
| Compose volume `arkive_data` | Blobs for the default local folder, `.arkive-secrets`, and with SQLite the database `arkive.db` |
| Compose volume `postgres_data` | PostgreSQL layout only: users, workspaces, ACLs, share links, node metadata |
| Extra binds | Host or NFS paths you assigned as additional local backends |

Do not back up only the database. Node rows point at storage keys that must exist in the blob store.

## SQLite (default layout)

Everything is in one volume, which makes the simplest backup "stop, copy the folder, start":

```bash
docker compose stop arkive
docker run --rm -v arkive_arkive_data:/data -v "$PWD/backup:/out" \
  alpine tar czf /out/arkive-$(date +%Y%m%d).tar.gz -C / data
docker compose start arkive
```

Never copy `arkive.db` alone while Arkive is running: a plain file copy can catch the database mid-write, and recent changes may still be in `arkive.db-wal`. For a backup **without downtime**, take a consistent snapshot of the database first, then back up the folder:

```bash
# Online snapshot (uses SQLite's VACUUM INTO; safe while Arkive runs).
docker compose exec arkive arkive db backup --out /data/arkive/backup-$(date +%Y%m%d).db
```

Then copy that snapshot together with the blob folders (rsync/restic/borg of the volume, skipping the live `arkive.db*` files). The snapshot is an ordinary SQLite database: `sqlite3 arkive.db ".backup snapshot.db"` or `sqlite3 arkive.db "VACUUM INTO 'snapshot.db'"` produce the same thing if you have the `sqlite3` tool on the host. Snapshot the database first and the blobs right after: blobs written in between are only unreferenced leftovers, never missing files.

To restore, stop Arkive, put the snapshot back as `/data/arkive/arkive.db` (delete any `arkive.db-wal` / `arkive.db-shm` next to it), restore the blob folders and `.arkive-secrets`, and start.

## PostgreSQL layout

Stop writes, then copy both volumes. A simple drill:

```bash
docker compose -f docker-compose.postgres.yml stop arkive
docker run --rm \
  -v arkive_postgres_data:/pg \
  -v arkive_arkive_data:/data \
  -v "$PWD/backup:/out" \
  alpine tar czf /out/arkive-$(date +%Y%m%d).tar.gz -C / pg data
docker compose -f docker-compose.postgres.yml start arkive
```

Volume names may be prefixed with the project directory (`arkive_postgres_data`). Check with `docker volume ls`.

For Postgres logical dumps (still pair with a data-directory snapshot taken at the same time):

```bash
docker compose -f docker-compose.postgres.yml exec -T postgres pg_dump -U arkive arkive > arkive.sql
```

## Restore drill

1. Stop the stack: `docker compose down` (add `-f docker-compose.postgres.yml` for PostgreSQL)
2. Recreate empty volumes or extract the tarball into the volume mount points
3. Start the stack (goose migrations run on start)
4. Confirm `/api/ready` returns `{"status":"ok"}`
5. Sign in and download a known file

If you restore a database onto a newer Arkive image, migrations apply automatically. Do not restore a newer database onto an older binary.

## Changing databases

`arkive db copy --from URL --to URL` copies a whole instance between PostgreSQL and SQLite (either direction) into a new, empty database — see [upgrade.md](upgrade.md#optional-move-a-10--postgresql-install-to-sqlite). It is also a way to turn a PostgreSQL backup into a portable single file.

## Secrets

`ARKIVE_SECRETS_KEY` encrypts stored storage, SMTP and Google Drive credentials in the database. When it is not set in the environment, it lives in `/data/arkive/.arkive-secrets` inside the `arkive_data` volume, so the snapshots above already include it. Restoring a DB backup with a different secrets key makes stored credentials unreadable — re-enter them under Admin → Storage / SMTP.
