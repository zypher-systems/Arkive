# Arkive desktop (Tauri thin wrapper)

Arkive’s supported sync path remains **WebDAV** (`/dav/{workspaceID}/`). This app is a thin shell that:

1. Signs in against your Arkive instance
2. Lists workspaces
3. Copies WebDAV mount URLs / opens mount instructions
4. Optionally launches `rclone mount` when `rclone` is on `PATH`

True selective sync and conflict UI are **out of scope**.

## Prerequisites

- Node 22+
- Rust (for Tauri): https://rustup.rs
- System deps for Tauri 2 on your OS: https://v2.tauri.app/start/prerequisites/

## Develop

```bash
cd desktop
npm install
npm run tauri dev
```

Set the API origin when prompted (default `http://localhost:3080`).

## Build (Linux first)

```bash
cd desktop
npm install
npm run tauri build
```

Artifacts land under `src-tauri/target/release/bundle/`.

macOS / Windows: same commands on those hosts (code signing not configured here).

## Layout

```
desktop/
  package.json
  index.html
  src/                 # React UI
  src-tauri/           # Tauri / Rust shell
```
