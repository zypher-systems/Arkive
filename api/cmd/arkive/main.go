// Command arkive is the single Arkive binary: HTTP server (API + WebDAV +
// embedded web UI) plus admin subcommands.
//
//	arkive [serve]                         run the server (default)
//	arkive migrate                         apply database migrations and exit
//	arkive user list                       list accounts
//	arkive user reset-password <email>     set a new password (generated, --password or --password-stdin)
//	arkive user promote|demote <email>     grant / revoke instance admin
//	arkive db copy --from URL --to URL     copy all data into a new database (PostgreSQL <-> SQLite)
//	arkive db backup --out FILE            consistent SQLite snapshot (VACUUM INTO)
//	arkive healthcheck                     probe /api/ready (for container HEALTHCHECK)
//	arkive version                         print the version
//
// Adding a subcommand is one entry in the commands table below.
package main

import (
	"flag"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"github.com/arkive/arkive/internal/buildinfo"
)

// version is injected at build time: -ldflags "-X main.version=1.1.0".
var version = "dev"

type command struct {
	name    string
	usage   string // argument synopsis
	summary string
	run     func(args []string) int
	hidden  bool
}

// commands is the top-level subcommand registry.
var commands = []command{
	{name: "serve", summary: "Run the HTTP server (default when no command is given)", run: runServe},
	{name: "migrate", summary: "Apply pending database migrations and exit", run: runMigrate},
	{name: "user", usage: "<list|reset-password|promote|demote|reset-2fa> ...", summary: "Manage user accounts", run: runUser},
	{name: "export", usage: "--out DIR [--workspace ID] [--include-trash]", summary: "Rebuild the real folder tree from the database and blobs", run: runExport},
	{name: "gc", usage: "[--dry-run] [--force]", summary: "Delete orphaned blobs and abandoned uploads", run: runGC},
	{name: "db", usage: "<copy|backup> ...", summary: "Copy between PostgreSQL and SQLite; back up SQLite", run: runDB},
	{name: "healthcheck", summary: "Exit 0 when the local server reports ready (container HEALTHCHECK)", run: runHealthcheck},
	{name: "version", summary: "Print the version", run: runVersion},
}

func main() {
	buildinfo.Version = version
	os.Exit(dispatch(os.Args[1:]))
}

func dispatch(args []string) int {
	if len(args) == 0 {
		return runServe(nil)
	}
	name := args[0]
	switch name {
	case "-h", "-help", "--help", "help":
		usage(os.Stdout)
		return 0
	case "-v", "--version":
		return runVersion(nil)
	}
	// "arkive --some-flag" (no command) means serve with flags.
	if strings.HasPrefix(name, "-") {
		return runServe(args)
	}
	for _, c := range commands {
		if c.name == name {
			return c.run(args[1:])
		}
	}
	fmt.Fprintf(os.Stderr, "arkive: unknown command %q\n\n", name)
	usage(os.Stderr)
	return 2
}

func usage(w io.Writer) {
	fmt.Fprintf(w, "Arkive %s\n\nUsage: arkive <command> [arguments]\n\nCommands:\n", version)
	for _, c := range commands {
		if c.hidden {
			continue
		}
		fmt.Fprintf(w, "  %-12s %s\n", c.name, c.summary)
	}
	fmt.Fprintln(w, "\nConfiguration comes from ARKIVE_* environment variables (see .env.example).")
}

func runVersion([]string) int {
	fmt.Println(version)
	return 0
}

// newFlagSet returns a FlagSet that prints a consistent usage line.
func newFlagSet(name, synopsis string) *flag.FlagSet {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.Usage = func() {
		fmt.Fprintf(fs.Output(), "Usage: arkive %s %s\n", name, synopsis)
		fs.PrintDefaults()
	}
	return fs
}

// parseInterspersed lets flags appear before or after positional arguments
// ("reset-password a@b.c --password x" and "reset-password --password x a@b.c").
func parseInterspersed(fs *flag.FlagSet, args []string) ([]string, error) {
	var pos []string
	for {
		if err := fs.Parse(args); err != nil {
			return nil, err
		}
		args = fs.Args()
		if len(args) == 0 {
			return pos, nil
		}
		pos = append(pos, args[0])
		args = args[1:]
	}
}

func sortedNames(m map[string]command) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
