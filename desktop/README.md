# Arkive desktop (Tauri thin wrapper)

Arkive’s supported sync path remains **WebDAV** (`/dav/{workspaceID}/`). This app is a thin shell that:

1. Signs in against your Arkive instance
2. Lists workspaces
3. Copies WebDAV mount URLs
4. Launches **`rclone mount`** when `rclone` is on `PATH`

True selective sync and conflict UI are **out of scope**.

## Prerequisites

- Node 22+
- Rust (for Tauri): https://rustup.rs
- System deps for Tauri 2 on your OS: https://v2.tauri.app/start/prerequisites/
- **[rclone](https://rclone.org/install/)** on your `PATH` (required for Mount)
- On Linux: FUSE (`fuse3` / `fusermount3`) for user mounts

## App passwords (recommended)

1. Sign in to the Arkive web UI
2. Open **Account → WebDAV mount → App passwords**
3. Create a token and copy the one-time `ark_…` secret
4. In the desktop app, use **Mount…** and paste that secret (username = your email)

You can still use your login password, but app passwords are safer to revoke.

## Develop

```bash
cd desktop
npm install
npm run tauri:dev
```

Set the API origin when prompted (default `http://localhost:3080`).

## Mount flow

1. Enter instance URL, email, password → **Sign in**
2. Confirm the status line shows `rclone detected on PATH`
3. For a workspace, click **Mount…**
4. Confirm local path (default `~/Arkive/<workspace>`), email, and app password
5. Files appear at the mount path; use **Unmount** when finished

Under the hood (Linux):

```bash
rclone mount :webdav: ~/Arkive/My_files \
  --webdav-url=https://your-host/dav/<workspace-id>/ \
  --webdav-user=you@example.com \
  --webdav-pass="$(rclone obscure 'ark_…')" \
  --vfs-cache-mode writes \
  --daemon
```

macOS/Windows: same desktop UI; unmount uses `umount` / `rclone unmount` as available. Ensure rclone’s FUSE backend works on your OS (macFUSE / WinFsp as required by rclone).

## Build (Linux first)

```bash
cd desktop
npm install
npm run tauri:build
```

Artifacts land under `src-tauri/target/release/bundle/`.

macOS / Windows: same commands on those hosts (code signing not configured here).

## Layout

```
desktop/
  package.json
  index.html
  src/                 # React UI
  src-tauri/           # Tauri / Rust shell (rclone commands)
```
