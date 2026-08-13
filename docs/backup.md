# Backup and restore

Arkive stores metadata in Postgres (`postgres_data`) and file bytes in object storage (`minio_data` by default, or whatever S3/NFS backends you assigned). **Snapshot both together.** Restoring one without the other leaves orphan blobs or missing files.

## What to back up

| Volume / path | Contents |
|---------------|----------|
| Compose volume `postgres_data` | Users, workspaces, ACLs, share links, node metadata |
| Compose volume `minio_data` | Blobs for the default MinIO backend |
| NFS / local mounts | Paths you assigned as NFS backends |

Do not back up only the database. Node rows point at storage keys that must exist in the blob store.

## Snapshot (Compose)

Stop writes, then copy both volumes. A simple drill:

```bash
docker compose stop api web
docker run --rm \
  -v arkive_postgres_data:/pg \
  -v arkive_minio_data:/s3 \
  -v "$PWD/backup:/out" \
  alpine tar czf /out/arkive-$(date +%Y%m%d).tar.gz -C / pg s3
docker compose start api web
```

Volume names may be prefixed with the project directory (`arkive_postgres_data`). Check with `docker volume ls`.

For Postgres-only logical dumps (still pair with an object-store snapshot taken at the same time):

```bash
docker compose exec -T postgres pg_dump -U arkive arkive > arkive.sql
```

## Restore drill

1. Stop the stack: `docker compose down`
2. Recreate empty volumes or extract the tarball into the volume mount points
3. Start Postgres and MinIO first, then API (goose migrations run on API start)
4. Confirm `/api/ready` returns `{"status":"ok"}`
5. Sign in and download a known file

If you restore Postgres onto a newer Arkive image, migrations apply automatically. Do not restore a newer database onto an older API binary.

## Secrets

`ARKIVE_SECRETS_KEY` encrypts S3 credentials in Postgres. Restoring a DB backup with a different secrets key makes stored backend credentials unreadable — re-enter them under Admin → Storage.
