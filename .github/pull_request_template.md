## What and why

<!-- What does this change, and what problem does it solve? Link the issue if there is one. -->

## How it was tested

<!-- Commands you ran and what you checked by hand. -->

## Checklist

- [ ] `make test` passes (SQLite), and `make test-postgres` if SQL changed
- [ ] Schema changes have a migration in both `api/migrations/` and `api/migrations/sqlite/`
- [ ] New UI strings go through `t()` and are added to `web/src/i18n/en.ts`
- [ ] User-facing changes are listed under `## [Unreleased]` in `CHANGELOG.md`
