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
- **Production** must use `docker-compose.prod.yml` (or equivalent). Leave `ARKIVE_SESSION_SECRET` / `ARKIVE_SECRETS_KEY` unset to use strong generated values (stored in `<ARKIVE_DATA_DIR>/.arkive-secrets`, mode 0600) or set your own; the server refuses the old placeholder values when `ARKIVE_ENV=production`.
- **TLS** belongs on an outer reverse proxy. Set `ARKIVE_PUBLIC_URL` to the public HTTPS origin and `ARKIVE_COOKIE_SECURE=true`.
- **`X-Forwarded-For` / `X-Real-IP`** are honoured only when the connecting peer is listed in `ARKIVE_TRUSTED_PROXIES` (default: none). Arkive then takes the right-most address that is not a trusted proxy, so client-supplied values to the left are ignored. Keep that list limited to your own proxies.
- **Registration** is open by default; new accounts stay pending until an instance admin approves them. Close registration under Admin if you do not want public signups.
- **First-run setup** (`POST /api/setup`) creates the first admin and works only while there are no accounts. It requires a setup token: `ARKIVE_SETUP_TOKEN`, or a one-time token printed to the server log on boot, so a stranger cannot claim a freshly exposed instance.
- **Bootstrap admin** (optional) is whoever first registers or logs in as `ARKIVE_BOOTSTRAP_ADMIN_EMAIL`. If you use it, set it to your own address before the instance is reachable.
- **`/metrics`** is off by default. When enabled it is served on the public port; set `ARKIVE_METRICS_TOKEN`.

See [`docs/backup.md`](docs/backup.md) and [`docs/upgrade.md`](docs/upgrade.md) for operational notes.
