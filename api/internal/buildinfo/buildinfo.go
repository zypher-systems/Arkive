// Package buildinfo carries the version string injected at build time.
// cmd/arkive copies main.version (set by the Dockerfile via
// -ldflags "-X main.version=...") into Version at startup.
package buildinfo

// Version is "dev" for local builds.
var Version = "dev"
