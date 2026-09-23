// Package migrations embeds the goose SQL migrations into the arkive binary so
// ARKIVE_MIGRATIONS_DIR is optional.
//
// The root holds the PostgreSQL set (never edit a released file: existing
// installs have applied it). sqlite/ holds the SQLite set, whose 001 is the
// consolidated equivalent of PostgreSQL 001-022. Every schema change needs a
// new file in BOTH sets; db.TestSchemasMatch fails when they drift.
package migrations

import "embed"

// FS holds the PostgreSQL migrations at its root and the SQLite ones under
// sqlite/.
//
//go:embed *.sql sqlite/*.sql
var FS embed.FS
