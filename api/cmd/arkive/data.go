package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/arkive/arkive/internal/app"
	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/db"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// openApp builds an App for offline commands (export, gc) that read blobs:
// storage credentials are encrypted, so secrets must resolve exactly as in serve.
func openApp(logger *slog.Logger) (*app.App, context.Context, func(), error) {
	cfg := config.Load()
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		cancel()
		return nil, nil, nil, err
	}
	if err := resolveSecrets(ctx, logger, &cfg, pool); err != nil {
		pool.Close()
		cancel()
		return nil, nil, nil, err
	}
	a := &app.App{DB: pool, Stores: app.NewStoreRegistry(), Cfg: cfg, Logger: logger}
	return a, ctx, func() { pool.Close(); cancel() }, nil
}

func printJSON(v any) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func runExport(args []string) int {
	fs := newFlagSet("export", "--out DIR [--workspace ID] [--include-trash] [--json]")
	out := fs.String("out", "", "directory to write the folder tree into (required; created if missing)")
	ws := fs.String("workspace", "", "export only this workspace id (default: all workspaces)")
	trash := fs.Bool("include-trash", false, "also export items that are in the trash")
	asJSON := fs.Bool("json", false, "print the report as JSON")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return 2
	}
	if *out == "" || len(pos) != 0 {
		fs.Usage()
		return 2
	}
	if *ws != "" {
		if _, err := uuid.Parse(*ws); err != nil {
			return cliErr("export", fmt.Errorf("invalid workspace id %q", *ws))
		}
	}
	a, ctx, done, err := openApp(newLogger())
	if err != nil {
		return cliErr("export", err)
	}
	defer done()

	rep, err := a.Export(ctx, *ws, *out, app.ExportOptions{IncludeTrash: *trash})
	if *asJSON {
		printJSON(rep)
	} else {
		fmt.Printf("Exported %d workspace(s), %d folder(s), %d file(s), %d bytes to %s\n",
			rep.Workspaces, rep.Folders, rep.Files, rep.Bytes, rep.OutDir)
		if rep.Renamed > 0 {
			fmt.Printf("%d item(s) were written under a de-duplicated name\n", rep.Renamed)
		}
		for _, is := range rep.Issues {
			fmt.Fprintf(os.Stderr, "  problem: %s: %s\n", is.Path, is.Error)
		}
	}
	if err != nil {
		return cliErr("export", err)
	}
	if len(rep.Issues) > 0 {
		return 1
	}
	return 0
}

func runGC(args []string) int {
	fs := newFlagSet("gc", "[--dry-run] [--json]")
	dry := fs.Bool("dry-run", false, "only report what would be deleted")
	asJSON := fs.Bool("json", false, "print the report as JSON")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return 2
	}
	if len(pos) != 0 {
		fs.Usage()
		return 2
	}
	a, ctx, done, err := openApp(newLogger())
	if err != nil {
		return cliErr("gc", err)
	}
	defer done()

	rep, err := a.GarbageCollect(ctx, *dry)
	if *asJSON {
		printJSON(rep)
	} else {
		for _, b := range rep.Backends {
			line := fmt.Sprintf("%-24s scanned %d, orphans %d (%d bytes), stale tmp %d, deleted %d (%d bytes)",
				b.Name, b.Scanned, b.Orphans, b.OrphanBytes, b.StaleTmp, b.Deleted, b.DeletedBytes)
			if b.Skipped != "" {
				line = fmt.Sprintf("%-24s skipped: %s", b.Name, b.Skipped)
			}
			fmt.Println(line)
		}
		fmt.Printf("uploads: %d expired session(s), %d orphan partial file(s), %d bytes\n",
			rep.Uploads.ExpiredSessions, rep.Uploads.OrphanFiles, rep.Uploads.Bytes)
		if rep.DryRun {
			fmt.Printf("dry run: %d orphan blob(s), %d bytes would be deleted\n", rep.Orphans, rep.OrphanBytes)
		} else {
			fmt.Printf("deleted %d item(s), %d bytes\n", rep.Deleted, rep.DeletedBytes)
		}
	}
	if err != nil {
		return cliErr("gc", err)
	}
	return 0
}

func runUserReset2FA(args []string) int {
	fs := newFlagSet("user reset-2fa", "<email>")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return 2
	}
	if len(pos) != 1 {
		fs.Usage()
		return 2
	}
	email := strings.ToLower(strings.TrimSpace(pos[0]))
	pool, ctx, cancel, err := openDB()
	if err != nil {
		return cliErr("user reset-2fa", err)
	}
	defer cancel()
	defer pool.Close()

	a := &app.App{DB: pool, Logger: newLogger()}
	var id uuid.UUID
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, email).Scan(&id); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("no account with email %q", email)
			}
			return err
		}
		if err := a.ResetTwoFactor(ctx, tx, id); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1`, id)
		return err
	})
	if err != nil {
		return cliErr("user reset-2fa", err)
	}
	a.Audit(ctx, nil, "", "user.2fa_reset", "user", id.String(), map[string]any{"via": "cli"})
	fmt.Printf("Two-factor authentication disabled for %s; all sessions were signed out.\n", email)
	return 0
}
