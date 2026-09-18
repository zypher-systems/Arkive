# Backup and restore

Arkive stores metadata in Postgres (`postgres_data`) and file bytes in the default local folder (`arkive_data` at `/data/arkive`, or whatever host/NFS bind you mounted) plus any extra backends you added. **Snapshot metadata and blobs together.** Restoring one without the other leaves orphan blobs or missing files.

## What to back up

| Volume / path | Contents |
|---------------|----------|
| Compose volume `postgres_data` | Users, workspaces, ACLs, share links, node metadata |
| Compose volume `arkive_data` | Blobs for the default local folder |
| Extra binds | Host or NFS paths you assigned as additional local backends |

Do not back up only the database. Node rows point at storage keys that must exist in the blob store.

## Snapshot (Compose)

Stop writes, then copy both volumes. A simple drill:

```bash
docker compose stop api web
docker run --rm \
  -v arkive_postgres_data:/pg \
  -v arkive_arkive_data:/data \
  -v "$PWD/backup:/out" \
  alpine tar czf /out/arkive-$(date +%Y%m%d).tar.gz -C / pg data
docker compose start api web
```

Volume names may be prefixed with the project directory (`arkive_postgres_data`). Check with `docker volume ls`.

For Postgres-only logical dumps (still pair with a data-directory snapshot taken at the same time):

```bash
docker compose exec -T postgres pg_dump -U arkive arkive > arkive.sql
```

## Restore drill

1. Stop the stack: `docker compose down`
2. Recreate empty volumes or extract the tarball into the volume mount points
3. Start Postgres, then API (goose migrations run on API start)
4. Confirm `/api/ready` returns `{"status":"ok"}`
5. Sign in and download a known file

If you restore Postgres onto a newer Arkive image, migrations apply automatically. Do not restore a newer database onto an older API binary.

## Secrets

`ARKIVE_SECRETS_KEY` encrypts S3 credentials in Postgres. Restoring a DB backup with a different secrets key makes stored backend credentials unreadable — re-enter them under Admin → Storage.
