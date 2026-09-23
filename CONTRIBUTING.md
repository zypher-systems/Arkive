# Contributing to Arkive

Thanks for helping. Arkive is a small, self-hosted file store: upload, organise, share and sync files, run as one container. Changes that keep it small and easy to run are the most welcome.

## Before you start

- **Bugs:** open an issue with steps to reproduce, your version (user menu or `arkive version`), database (SQLite or PostgreSQL) and storage backend.
- **Features:** open an issue first for anything bigger than a small fix, so we can agree on scope before you spend time on it.
- **Security problems:** never in a public issue. Use a [private advisory](https://github.com/zypher-systems/arkive/security/advisories/new) — see [SECURITY.md](SECURITY.md).

## Project layout

| Path | What lives there |
|------|------------------|
| `api/cmd/arkive` | The `arkive` binary: `serve` and the admin CLI |
| `api/internal/handlers` | HTTP API, WebDAV, public links |
| `api/internal/app` | Business logic: uploads, versions, trash, quotas, GC, export, search |
| `api/internal/db` | SQLite + PostgreSQL behind one small interface ([portable SQL rules](api/internal/db/README.md)) |
| `api/internal/storage` | Blob backends: local folder, S3, WebDAV, Google Drive |
| `api/migrations/`, `api/migrations/sqlite/` | Schema migrations for each engine (a test keeps them equivalent) |
| `web/` | React + Vite + Tailwind SPA, embedded into the binary at build time |
| `e2e/` | Playwright end-to-end tests against a running stack |
| `docs/` | Operator docs: WebDAV clients, backup, upgrade, translating |

## Development setup

You need Go (see `api/go.mod`), Node 22 and Docker.

```bash
# API on :8080 with SQLite in ./api/.data
cd api && ARKIVE_DATA_DIR=$PWD/.data go run ./cmd/arkive
# In another terminal: the UI with hot reload on :5173 (proxies /api and /dav to :8080)
cd web && npm install && npm run dev
```

The first start prints a one-time **setup token** in the API log; open http://localhost:5173 and use it to create the admin account.

## Tests

```bash
make test            # go vet + Go tests on SQLite — no database setup needed
make test-postgres   # the same suite on PostgreSQL (see the Makefile for the docker one-liner)
cd web && npm test   # web unit tests
make e2e             # Playwright suite against a local stack (see e2e/README.md)
```

CI runs all of these on every pull request, on both databases.

## Guidelines

- **Both databases.** Write SQL that runs on SQLite and PostgreSQL ([rules](api/internal/db/README.md)). A schema change needs a migration in `api/migrations/` *and* `api/migrations/sqlite/`.
- **Tests with fixes.** A bug fix should come with a test that fails without it.
- **UI text** goes through `t()` with the English source in `web/src/i18n/en.ts`, so it can be translated ([guide](docs/translating.md)).
- **Accessibility.** Icon-only buttons need an `aria-label`; dialogs and menus must work from the keyboard.
- **Dependencies.** Prefer the standard library and small, focused packages. Explain any new dependency in the PR.
- **Match the surrounding code** — naming, comment density and error handling.
- **Changelog.** Add user-facing changes under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).

## Translations

See [docs/translating.md](docs/translating.md). Adding a locale needs no Go changes.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
