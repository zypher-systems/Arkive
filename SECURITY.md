# Security policy

## Supported versions

The latest tagged release on `main` is the supported line. Older tags do not receive backports unless a release note says otherwise.

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Use GitHub's private [security advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) flow on this repository. Include:

- Affected version or commit
- Reproduction steps or a minimal proof of concept
- Impact (who can exploit it, and what they get)

We will acknowledge the report and work on a fix before any public disclosure.

## Operator assumptions

Arkive is self-hosted. A few things are trusted by design:

- **Instance admins** can add local-folder, S3, and WebDAV backends and reach those URLs from the API container. Treat admin as a high-privilege role.
- **Production** must use `docker-compose.prod.yml` (or equivalent). The base compose file is for local development and uses weak default secrets. The API refuses those defaults when `ARKIVE_ENV=production`.
- **TLS** belongs on an outer reverse proxy. Set `ARKIVE_PUBLIC_URL` to the public HTTPS origin and `ARKIVE_COOKIE_SECURE=true`.
- **`X-Forwarded-For`** must be **replaced** (not appended) by the proxy in front of Arkive. The default nginx container already does this. Do not publish the API port directly to the internet.
- **Registration** is open by default; new accounts stay pending until an instance admin approves them. Close registration under Admin if you do not want public signups.
- **Bootstrap admin** is whoever first registers or logs in as `ARKIVE_BOOTSTRAP_ADMIN_EMAIL`. Set that to your own address before the instance is reachable.

See [`docs/backup.md`](docs/backup.md) and [`docs/upgrade.md`](docs/upgrade.md) for operational notes.
