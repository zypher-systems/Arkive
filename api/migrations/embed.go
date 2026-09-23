// Package migrations embeds the goose SQL migrations into the arkive binary so
// ARKIVE_MIGRATIONS_DIR is optional. New NNN_*.sql files dropped into this
// directory are picked up automatically.
package migrations

import "embed"

// FS holds every *.sql migration at its root.
//
//go:embed *.sql
var FS embed.FS
