package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/arkive/arkive/internal/auth"
	"github.com/arkive/arkive/internal/config"
	"github.com/arkive/arkive/internal/db"
)

// userCommands is the `arkive user ...` registry.
var userCommands = map[string]command{
	"list":           {name: "list", summary: "List accounts", run: runUserList},
	"reset-password": {name: "reset-password", usage: "<email> [--password PW | --password-stdin]", summary: "Set a new password (prints a generated one by default) and sign out all sessions", run: runUserResetPassword},
	"promote":        {name: "promote", usage: "<email>", summary: "Make an account instance admin (approves it if pending)", run: func(a []string) int { return runUserSetAdmin(a, true) }},
	"demote":         {name: "demote", usage: "<email> [--force]", summary: "Revoke instance admin", run: func(a []string) int { return runUserSetAdmin(a, false) }},
	"reset-2fa":      {name: "reset-2fa", usage: "<email>", summary: "Disable two-factor auth and sign out all sessions", run: runUserReset2FA},
}

func userUsage() {
	fmt.Fprintln(os.Stderr, "Usage: arkive user <command> [arguments]\n\nCommands:")
	for _, name := range sortedNames(userCommands) {
		c := userCommands[name]
		fmt.Fprintf(os.Stderr, "  %-15s %-44s %s\n", c.name, c.usage, c.summary)
	}
}

func runUser(args []string) int {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" || args[0] == "help" {
		userUsage()
		if len(args) == 0 {
			return 2
		}
		return 0
	}
	c, ok := userCommands[args[0]]
	if !ok {
		fmt.Fprintf(os.Stderr, "arkive user: unknown command %q\n\n", args[0])
		userUsage()
		return 2
	}
	return c.run(args[1:])
}

func openDB() (db.DB, context.Context, context.CancelFunc, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	pool, err := db.OpenWith(ctx, config.Load().DatabaseURL, db.Options{MustExist: true})
	if err != nil {
		cancel()
		return nil, nil, nil, err
	}
	return pool, ctx, cancel, nil
}

func cliErr(cmd string, err error) int {
	fmt.Fprintf(os.Stderr, "arkive %s: %v\n", cmd, err)
	return 1
}

func runUserList(args []string) int {
	fs := newFlagSet("user list", "")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	pool, ctx, cancel, err := openDB()
	if err != nil {
		return cliErr("user list", err)
	}
	defer cancel()
	defer pool.Close()

	rows, err := pool.Query(ctx, `
		SELECT email, display_name, status, is_instance_admin, created_at
		FROM users ORDER BY created_at
	`)
	if err != nil {
		return cliErr("user list", err)
	}
	defer rows.Close()
	tw := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
	fmt.Fprintln(tw, "EMAIL\tNAME\tSTATUS\tADMIN\tCREATED")
	n := 0
	for rows.Next() {
		var email, name, status string
		var admin bool
		var created time.Time
		if err := rows.Scan(&email, &name, &status, &admin, &created); err != nil {
			return cliErr("user list", err)
		}
		adm := ""
		if admin {
			adm = "yes"
		}
		fmt.Fprintf(tw, "%s\t%s\t%s\t%s\t%s\n", email, name, status, adm, created.Format("2006-01-02"))
		n++
	}
	if err := rows.Err(); err != nil {
		return cliErr("user list", err)
	}
	tw.Flush()
	if n == 0 {
		fmt.Fprintln(os.Stderr, "no accounts yet: open the web UI to complete first-run setup")
	}
	return 0
}

const passwordAlphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"

func generatePassword(n int) (string, error) {
	var b strings.Builder
	max := big.NewInt(int64(len(passwordAlphabet)))
	for i := 0; i < n; i++ {
		j, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		b.WriteByte(passwordAlphabet[j.Int64()])
	}
	return b.String(), nil
}

func runUserResetPassword(args []string) int {
	fs := newFlagSet("user reset-password", "<email> [--password PW | --password-stdin]")
	pw := fs.String("password", "", "new password (min 8 characters); visible in shell history, prefer --password-stdin")
	fromStdin := fs.Bool("password-stdin", false, "read the new password from the first line of stdin")
	pos, err := parseInterspersed(fs, args)
	if err != nil {
		return 2
	}
	if len(pos) != 1 {
		fs.Usage()
		return 2
	}
	email := strings.ToLower(strings.TrimSpace(pos[0]))

	password := *pw
	generated := false
	switch {
	case *fromStdin && password != "":
		return cliErr("user reset-password", errors.New("use either --password or --password-stdin"))
	case *fromStdin:
		line, err := bufio.NewReader(os.Stdin).ReadString('\n')
		if err != nil && line == "" {
			return cliErr("user reset-password", fmt.Errorf("read stdin: %w", err))
		}
		password = strings.TrimRight(line, "\r\n")
	case password == "":
		password, err = generatePassword(20)
		if err != nil {
			return cliErr("user reset-password", err)
		}
		generated = true
	}
	if len(password) < 8 {
		return cliErr("user reset-password", errors.New("password must be at least 8 characters"))
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return cliErr("user reset-password", err)
	}

	pool, ctx, cancel, err := openDB()
	if err != nil {
		return cliErr("user reset-password", err)
	}
	defer cancel()
	defer pool.Close()

	err = db.BeginFunc(ctx, pool, func(tx db.Tx) error {
		var id string
		if err := tx.QueryRow(ctx, `UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id::text`, hash, email).Scan(&id); err != nil {
			if errors.Is(err, db.ErrNoRows) {
				return fmt.Errorf("no account with email %q", email)
			}
			return err
		}
		_, err := tx.Exec(ctx, `DELETE FROM sessions WHERE user_id = $1::uuid`, id)
		return err
	})
	if err != nil {
		return cliErr("user reset-password", err)
	}
	if generated {
		fmt.Printf("New password for %s: %s\n", email, password)
	} else {
		fmt.Printf("Password updated for %s\n", email)
	}
	fmt.Fprintln(os.Stderr, "All existing sessions for this account were signed out.")
	return 0
}

func runUserSetAdmin(args []string, admin bool) int {
	name := "user promote"
	if !admin {
		name = "user demote"
	}
	fs := newFlagSet(name, "<email>")
	force := fs.Bool("force", false, "allow demoting the last active instance admin")
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
		return cliErr(name, err)
	}
	defer cancel()
	defer pool.Close()

	var status string
	err = db.BeginFunc(ctx, pool, func(tx db.Tx) error {
		if !admin && !*force {
			var others int
			if err := tx.QueryRow(ctx, `
				SELECT COUNT(*) FROM users
				WHERE is_instance_admin AND status = 'active' AND email <> $1
			`, email).Scan(&others); err != nil {
				return err
			}
			if others == 0 {
				return errors.New("refusing to demote the last active instance admin (use --force)")
			}
		}
		q := `UPDATE users SET is_instance_admin = $1 WHERE email = $2 RETURNING status`
		if admin {
			// Promoting a pending signup approves it; disabled/rejected stay as they are.
			q = `UPDATE users SET is_instance_admin = $1,
				status = CASE WHEN status = 'pending' THEN 'active' ELSE status END
				WHERE email = $2 RETURNING status`
		}
		if err := tx.QueryRow(ctx, q, admin, email).Scan(&status); err != nil {
			if errors.Is(err, db.ErrNoRows) {
				return fmt.Errorf("no account with email %q", email)
			}
			return err
		}
		return nil
	})
	if err != nil {
		return cliErr(name, err)
	}
	if admin {
		fmt.Printf("%s is now an instance admin (status: %s)\n", email, status)
		if status != "active" {
			fmt.Fprintf(os.Stderr, "note: the account is %s and cannot sign in until re-enabled\n", status)
		}
	} else {
		fmt.Printf("%s is no longer an instance admin\n", email)
	}
	return 0
}
