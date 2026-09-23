# internal/db — one data layer, two engines

Arkive runs on **SQLite** (default: one container, one data folder) or
**PostgreSQL** (bigger installs, several replicas). Application code is written
once against the small interface in `db.go`:

```go
type Querier interface {
    Exec(ctx, sql, args...) (CommandTag, error)
    Query(ctx, sql, args...) (Rows, error)
    QueryRow(ctx, sql, args...) Row
    Dialect() Dialect
}
// DB adds Begin/Ping/Close, Tx adds Commit/Rollback.
// Helpers: BeginFunc, ErrNoRows, IsUniqueViolation, IsNoRows.
```

* **PostgreSQL** (`postgres.go`) is a thin wrapper over pgxpool — SQL goes to
  the server unchanged.
* **SQLite** (`sqlite.go`, pure-Go `modernc.org/sqlite`, no CGO) rewrites a
  handful of PostgreSQL spellings (`rewrite.go`) and converts values at the
  boundary (`convert.go`).

`ARKIVE_DATABASE_URL` picks the engine: `postgres://…` / `postgresql://…` →
PostgreSQL; `sqlite:///abs/path.db` or `file:/abs/path.db` → SQLite; empty →
SQLite at `$ARKIVE_DATA_DIR/arkive.db`.

## Writing portable SQL

Write PostgreSQL-flavoured SQL that follows these rules. Anything else needs
an explicit `switch q.Dialect()` in the caller (see `app/search.go`).

**Allowed as-is (both engines understand it)**

* Placeholders `$1, $2, …` (SQLite binds `$NNN` by position; repeating one is fine).
* `RETURNING`, `ON CONFLICT (…) DO NOTHING / DO UPDATE SET x = EXCLUDED.x`,
  `WITH RECURSIVE`, `EXISTS`, `COALESCE`, `COUNT(*) FILTER (WHERE …)`,
  row values `(a, b) < ($1, $2)`, `TRUE` / `FALSE`, `json_col->>'key'`,
  `CAST(x AS TEXT)`, `||`, `lower()`, `LIMIT/OFFSET`.

**Rewritten automatically for SQLite**

| Write | SQLite gets |
|---|---|
| `now()` | a bound UTC timestamp — constant per statement, and per transaction inside a `Tx` (same as PostgreSQL) |
| `x::type` casts (`$1::jsonb`, `id::text`, `$2::uuid`) | the cast is dropped |
| `ILIKE` | `LIKE` (SQLite's LIKE is case-insensitive for ASCII only) |
| `OFFSET n` without `LIMIT` | `LIMIT -1 OFFSET n` |
| `FOR UPDATE [OF t] [SKIP LOCKED \| NOWAIT]` | removed — every SQLite transaction already holds the database write lock |

**Not portable — do this instead**

* **Time arithmetic** (`now() - interval '1 hour'`, `make_interval`,
  `$1::interval`, `date_trunc`, `extract`): compute the time in Go and bind it:
  `WHERE updated_at < $1` with `time.Now().Add(-time.Hour)`.
* **Timestamp literals** (`'2020-01-01T00:00:00Z'`): bind a `time.Time`.
  SQLite stores timestamps as fixed-width UTC text
  (`2006-01-02 15:04:05.000000`); other spellings would not compare correctly.
* **UUID generation**: rely on the column default or generate with
  `uuid.New()` in Go; never call `gen_random_uuid()` in a query.
* **LIKE with escaped patterns**: always write `ESCAPE '\'` (PostgreSQL has it
  by default, SQLite has no escape character) and build the pattern with
  `app.EscapeLike`.
* **Arrays** (`= ANY($1)`, `array_agg`, `unnest`), `DISTINCT ON`,
  `generate_series`, `GREATEST/LEAST`, regex operators, `LATERAL`: not
  available — restructure the query or branch on `Dialect()`.
* **Advisory locks / `pg_*` functions**: PostgreSQL only; branch on
  `Dialect()` (SQLite transactions are already serialized).
* **Full-text search**: PostgreSQL `nodes.search_vector` (tsvector) vs SQLite
  `nodes_fts` (FTS5); both are kept up to date by triggers on `nodes`, so only
  `app.SearchNodes` needs to know.
* **Sorting text**: SQLite compares with the binary collation (`B` < `a`),
  PostgreSQL with the database locale. Don't depend on the exact order of
  mixed-case names in tests.
* **JSON**: pass `[]byte`, `json.RawMessage` or a map/struct; scan into
  `[]byte`, `json.RawMessage`, `string` or a map/struct. Use only `->>` in SQL.

## Values

| Go | PostgreSQL | SQLite storage |
|---|---|---|
| `uuid.UUID`, `*uuid.UUID` | `uuid` | TEXT, canonical lowercase |
| `time.Time`, `*time.Time` | `timestamptz` | TEXT `YYYY-MM-DD HH:MM:SS.ffffff` UTC |
| `bool` | `boolean` | INTEGER 0/1 |
| `[]byte` / map / struct (JSON) | `jsonb` | TEXT |
| `int64`, `int` | `bigint` / `int` | INTEGER |

## Transactions and concurrency (SQLite)

SQLite has one writer at a time. Arkive opens it in WAL mode (readers never
block the writer), with `foreign_keys=ON`, `synchronous=NORMAL`,
`busy_timeout=10s`, and **every transaction is `BEGIN IMMEDIATE`**: it takes
the write lock at the start, so a transaction never fails half-way with
`SQLITE_BUSY`; concurrent writers queue for up to 10 s. Rules:

* keep transactions short; no blob / network I/O inside them;
* inside a transaction use the `Tx` for every statement — a write through the
  pool (`a.DB`) from inside an open transaction waits for the lock the
  transaction itself holds and fails after 10 s.

## Schema changes

Migrations are embedded from `api/migrations/` (PostgreSQL) and
`api/migrations/sqlite/` (SQLite; `001_schema.sql` is the consolidated
equivalent of PostgreSQL 001–022). Every change needs a new, equally numbered
purpose file in **both** directories. `TestSchemasMatch` fails when the two
sets end up with different tables or columns. Never edit a released
PostgreSQL migration.

## Tests

`dbtest.URL(t)` / `dbtest.FreshURL(t)` give each test a fresh SQLite file by
default, so `go test ./...` needs no setup. Set
`ARKIVE_TEST_DATABASE_URL=postgres://…` to run the same tests on PostgreSQL.
CI runs both.
