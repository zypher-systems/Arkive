# Arkive desktop (optional)

Arkive’s supported desktop/mobile sync path is **WebDAV** against `/dav/{workspaceID}/` (see root README). Copy mount URLs from **Account → WebDAV mount**.

## Thin wrapper (planned)

A future Tauri (or similar) shell can:

1. Sign in with Arkive session / store credentials in the OS keychain
2. List workspaces and copy WebDAV URLs
3. Open the system WebDAV mount / launch rclone

This folder is reserved for that wrapper. Until it ships, use:

- **rclone** — `rclone sync` / mount
- **macOS Finder** — Connect to Server
- **Windows** — Map network drive to the WebDAV URL

True selective sync with conflict UI is out of scope until WebDAV proves insufficient.
