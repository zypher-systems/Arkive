package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/db"
)

// dbCommands is the `arkive db ...` registry.
var dbCommands = map[string]command{
	"copy":   {name: "copy", usage: "--from URL --to URL", summary: "Copy all data into a new, empty database (PostgreSQL <-> SQLite)", run: runDBCopy},
	"backup": {name: "backup", usage: "--out FILE", summary: "Write a consistent SQLite snapshot (VACUUM INTO); safe while running", run: runDBBackup},
}

func dbUsage() {
	fmt.Fprintln(os.Stderr, "Usage: arkive db <command> [arguments]\n\nCommands:")
	for _, name := range sortedNames(dbCommands) {
		c := dbCommands[name]
		fmt.Fprintf(os.Stderr, "  %-8s %-22s %s\n", c.name, c.usage, c.summary)
	}
	fmt.Fprintln(os.Stderr, "\nURLs: postgres://user:pass@host:5432/db?sslmode=disable or sqlite:///path/to/arkive.db")
}

func runDB(args []string) int {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
		dbUsage()
		if len(args) == 0 {
			return 2
		}
		return 0
	}
	c, ok := dbCommands[args[0]]
	if !ok {
		fmt.Fprintf(os.Stderr, "arkive db: unknown command %q\n\n", args[0])
		dbUsage()
		return 2
	}
	return c.run(args[1:])
}

func runDBCopy(args []string) int {
	fs := newFlagSet("db copy", "--from URL --to URL")
	from := fs.String("from", "", "source database URL (required)")
	to := fs.String("to", "", "target database URL; must be new or empty (required)")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return 2
	}
	if *from == "" || *to == "" || len(pos) != 0 {
		fs.Usage()
		return 2
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	rep, err := dbCopy(ctx, *from, *to, config.Load().MigrationsDir, func(t db.CopyTableReport) {
		fmt.Printf("  %-22s %8d rows\n", t.Table, t.Rows)
	})
	if err != nil {
		return cliErr("db copy", err)
	}
	fmt.Printf("copied %d rows from %s to %s in %s; search index rebuilt\n",
		rep.Rows, rep.From, rep.To, rep.Duration.Round(1e6))
	return 0
}

// dbCopy migrates the target, then copies src into it.
func dbCopy(ctx context.Context, from, to, migrationsDir string, progress func(db.CopyTableReport)) (db.CopyReport, error) {
	src, err := db.ParseURL(from)
	if err != nil {
		return db.CopyReport{}, fmt.Errorf("--from: %w", err)
	}
	dst, err := db.ParseURL(to)
	if err != nil {
		return db.CopyReport{}, fmt.Errorf("--to: %w", err)
	}
	if src.Dialect == dst.Dialect && sameTarget(src, dst) {
		return db.CopyReport{}, errors.New("--from and --to are the same database")
	}
	source, err := db.OpenWith(ctx, from, db.Options{MustExist: true})
	if err != nil {
		return db.CopyReport{}, fmt.Errorf("open source: %w", err)
	}
	defer source.Close()
	if err := db.Migrate(to, migrationsDir); err != nil {
		return db.CopyReport{}, fmt.Errorf("prepare target: %w", err)
	}
	target, err := db.Open(ctx, to)
	if err != nil {
		return db.CopyReport{}, fmt.Errorf("open target: %w", err)
	}
	defer target.Close()
	fmt.Printf("copying %s -> %s\n", db.Redact(from), db.Redact(to))
	return db.Copy(ctx, source, target, progress)
}

func sameTarget(a, b db.Target) bool {
	if a.Dialect == db.SQLite {
		pa, _ := filepath.Abs(a.DSN)
		pb, _ := filepath.Abs(b.DSN)
		return pa == pb
	}
	return a.DSN == b.DSN
}

func runDBBackup(args []string) int {
	fs := newFlagSet("db backup", "--out FILE")
	out := fs.String("out", "", "file to write (must not exist)")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return 2
	}
	if *out == "" || len(pos) != 0 {
		fs.Usage()
		return 2
	}
	pool, ctx, cancel, err := openDB()
	if err != nil {
		return cliErr("db backup", err)
	}
	defer cancel()
	defer pool.Close()
	if err := db.Backup(ctx, pool, *out); err != nil {
		return cliErr("db backup", err)
	}
	fmt.Printf("wrote %s\n", *out)
	return 0
}
