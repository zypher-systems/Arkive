# WebDAV

Each Arkive workspace is exposed as a WebDAV collection:

```text
https://<your-host>/dav/<workspace-id>/
```

`https://<your-host>/dav/` itself is a read-only collection listing every
workspace you belong to (PROPFIND only), so you can point a client there and
pick a workspace. Copy exact mount URLs from **Account → WebDAV mount**.

**Authentication** is HTTP Basic with your account email and either your
password or an **app password** (`ark_…`, created under **Account**). Prefer
app passwords: they can be revoked per device, and once two-factor
authentication is enabled on an account, only app passwords work for WebDAV.

Always use HTTPS in production. Several clients (Windows, iOS) refuse or
complain about Basic auth over plain HTTP.

## What the server supports

| Feature | Behaviour |
| --- | --- |
| DAV class | `DAV: 1, 2` (OPTIONS also sends `MS-Author-Via: DAV`) |
| Methods | OPTIONS, GET, HEAD, PUT, DELETE, MKCOL, COPY, MOVE, PROPFIND, PROPPATCH, LOCK, UNLOCK |
| PROPFIND depth | `0` and `1`. A missing `Depth` is treated as `1`. `Depth: infinity` is refused with `403` + `<propfind-finite-depth/>` (RFC 4918 §9.1). |
| Live properties | `displayname`, `getlastmodified`, `creationdate`, `resourcetype`, `getcontentlength` / `getcontenttype` (files), `getetag`, `supportedlock`, `lockdiscovery`, `quota-used-bytes` / `quota-available-bytes` (collections) |
| hrefs | Every path segment is percent-encoded (spaces, `#`, `?`, `%`, `;`, non-ASCII as UTF-8). Collections always end in `/`. |
| ETags | Strong ETags on files (`ETag` header on GET/HEAD/PUT, `getetag` in PROPFIND). They change exactly when the content changes and survive renames/moves/mtime updates. |
| Conditional requests | `If-Match`, `If-None-Match`, `If-Modified-Since`, `If-Unmodified-Since` on GET/HEAD/PUT/DELETE/MOVE/COPY/PROPPATCH/LOCK (412 on mismatch, 304 for GET/HEAD). `If-None-Match: *` on PUT fails when the file exists. `If-Range` and single byte ranges on GET. |
| WebDAV `If` header | Parsed per RFC 4918 §10.4: untagged and tagged lists, lock tokens, entity tags, `Not`. A false `If` header answers 412. |
| Locks | Exclusive write locks, depth 0 or infinity, `Timeout` honoured up to 1 hour (default 1 hour). Writes to a locked resource without its token answer `423 Locked`. `LOCK` on an unmapped URL creates an empty file (201). Refresh with an empty-body LOCK plus `If: (<token>)`. |
| Modification time | Settable via `PROPPATCH` of `{DAV:}getlastmodified`, `{DAV:}lastmodified` (unix seconds, rclone) or `{urn:schemas-microsoft-com:}Win32LastModifiedTime`, and via the `X-OC-Mtime` header on PUT (answered with `X-OC-Mtime: accepted`). MOVE keeps the modification time. |
| Quota | Workspace-wide values from the Arkive quota (workspace → personal-owner → instance default). `quota-available-bytes` is omitted (404) when the workspace is unlimited. Exceeding the quota answers `507 Insufficient Storage`. |
| DELETE | Soft-deletes into the workspace trash (restorable), never a purge. |

### Design decisions

- **Overwrite on MOVE / COPY.** `Overwrite` defaults to `T`. With `F`, an
  existing destination answers 412. With `T`, the response is `204` when a
  destination was replaced and `201` when it was created.
  - *File onto file* (the "write a temp file, then rename it over the original"
    save pattern used by Office, LibreOffice, many editors and rclone): the
    destination file keeps its identity and the incoming bytes become its new
    current version. The previous content is kept as a version (restorable in
    the web UI), and the temp file's own version history is appended. Shares,
    public links and history on the document therefore survive every save.
  - *Anything involving a collection*: the old destination is moved to the
    trash (exactly like DELETE), then the source is moved/copied into place.
  - Nothing is destroyed outright in either case.
- **Unknown PROPPATCH properties are answered `200` but not stored.** Windows
  Explorer sets `Win32CreationTime`, `Win32LastAccessTime` and
  `Win32FileAttributes` after every upload and reports a copy failure when any
  of them is rejected; nothing ever reads them back. Protected live properties
  (`resourcetype`, `getetag`, …) are rejected with `403`, and then the whole
  request fails atomically (other properties answer `424 Failed Dependency`).
- **Locks are in memory.** They disappear on API restart and are not shared
  between API replicas. Clients simply re-lock. Run a single API instance if
  you depend on locking across clients.
- **Shared locks** are granted as exclusive locks (strictly safer for the
  requester); only `exclusive` is advertised in `supportedlock`.
- **Collection ETags** reflect the folder's own metadata, not its children.
  Clients use per-file ETags for change detection.

## Client setup

### rclone

Use `vendor = owncloud`. rclone then sends `X-OC-Mtime` on upload and sets
modification times with PROPPATCH, so `rclone sync` compares size + modtime
instead of re-uploading everything. (Do not use `vendor = nextcloud`: it
enables Nextcloud's chunked-upload endpoint, which Arkive does not implement.)

```bash
rclone config create arkive webdav \
  url https://<your-host>/dav/<workspace-id>/ \
  vendor owncloud \
  user you@example.com \
  pass "$(rclone obscure 'ark_xxxxxxxx_yyyyyyyy')"

rclone lsd arkive:
rclone sync ./local-folder arkive:backup --progress
rclone about arkive:      # uses quota-used/available-bytes
```

rclone will note that the server returned no checksums; that is expected
(Arkive does not expose content hashes over WebDAV yet), and syncing falls back
to size + modification time.

### macOS Finder

**Go → Connect to Server…** (⌘K) → `https://<your-host>/dav/<workspace-id>/` →
enter email and app password. Because the server advertises class 2 and grants
locks, Finder mounts the volume **read-write**. Finder creates `._*` and
`.DS_Store` files; they are stored like any other file (delete them from the
web UI if they bother you, or run `defaults write com.apple.desktopservices
DSDontWriteNetworkStores -bool true`).

### Windows Explorer (WebClient / Mini-Redirector)

1. Make sure the **WebClient** service is running (`services.msc`, set to
   Automatic).
2. **This PC → Map network drive** → Folder:
   `https://<your-host>/dav/<workspace-id>/` → tick *Connect using different
   credentials* → email + app password.
   From a terminal: `net use Z: https://<your-host>/dav/<workspace-id>/ /user:you@example.com *`
3. Registry tweaks under
   `HKLM\SYSTEM\CurrentControlSet\Services\WebClient\Parameters` (restart
   WebClient afterwards):
   - `FileSizeLimitInBytes` (DWORD) — default is 50 MB; set to `0xFFFFFFFF`
     (4 GB, the maximum) to transfer larger files.
   - `BasicAuthLevel` — `2` only if you must use plain HTTP (not recommended).

Office documents can be opened and saved in place (LOCK / temp-file rename).

### iOS / iPadOS Files

**Files → ⋯ → Connect to Server** → `https://<your-host>/dav/<workspace-id>/`
→ *Registered User* → email + app password. The server then appears under
*Shared* in the sidebar.

### Android — DAVx⁵

DAVx⁵ (4.x and later) can mount WebDAV folders into Android's file picker:
**☰ → WebDAV mounts → +** → URL `https://<your-host>/dav/<workspace-id>/`,
username and app password. The mount then appears in the system Files app /
document picker. (DAVx⁵'s CalDAV/CardDAV sync is not related to Arkive.)

### Linux

- **GNOME Files (Nautilus)**: *Other Locations* → *Connect to Server* →
  `davs://<your-host>/dav/<workspace-id>/`
- **KDE Dolphin**: address bar →
  `webdavs://<your-host>/dav/<workspace-id>/`
- **davfs2**:

  ```bash
  sudo mount -t davfs https://<your-host>/dav/<workspace-id>/ /mnt/arkive
  ```

  Locking works, so the default `use_locks 1` in `/etc/davfs2/davfs2.conf` is
  fine. Put credentials in `/etc/davfs2/secrets`
  (`https://<your-host>/dav/<workspace-id>/ you@example.com ark_…`).

## Compatibility

"Verified" means covered by automated tests in
`api/internal/handlers/webdav_*_test.go` that replay the request patterns the
client uses (headers, bodies, and expected status codes) against the real
router and Postgres. No real client binaries (and neither rclone nor litmus)
were available in the build environment, so every client below is still
**expected** to work, not observed working; please report results.

| Client | Pattern / feature | Status |
| --- | --- | --- |
| rclone (`vendor=owncloud`) | PROPFIND depth 1 listing, PUT with `X-OC-Mtime`, PROPPATCH `<lastmodified xmlns="DAV:">unix</lastmodified>`, MOVE/COPY with overwrite, quota props for `rclone about` | Verified by tests; expected to work |
| rclone | Hash-based `--checksum` | Not supported (no checksums exposed) |
| macOS Finder | OPTIONS class 2, LOCK/UNLOCK (incl. LOCK on unmapped URL → 201), If lock tokens, quota props, depth 0/1 | Verified by tests; expected to mount read-write |
| Windows Explorer | OPTIONS class 2, `MS-Author-Via`, PROPPATCH Win32* props → 200, LOCK/UNLOCK, 423 without token | Verified by tests; expected to work (needs registry tweaks above) |
| Microsoft Office on Windows/macOS | LOCK → PUT with token → temp-file MOVE over locked original with tagged If → UNLOCK | Verified by tests; expected to work |
| iOS Files | PROPFIND depth 0/1, percent-encoded unicode hrefs, GET with Range | Verified by tests; expected to work |
| DAVx⁵ WebDAV mounts | PROPFIND, GET with Range, PUT, ETags / `If-Match` | Verified by tests; expected to work |
| GNOME gvfs / KDE KIO | allprop PROPFIND, quota in allprop, MOVE/COPY | Verified by tests; expected to work |
| davfs2 | LOCK/UNLOCK with `use_locks 1`, If headers, ETags | Verified by tests; expected to work |
| litmus | basic, copymove, props, locks suites | Not run; `Depth: infinity` PROPFIND and shared locks deliberately differ |

## Known limitations

- `/dav/` sits behind a per-IP rate limit (120 requests/minute, configured in
  `api/internal/handlers/router.go`). Finder and Windows Explorer can burst
  well past that while browsing large folders or copying many small files;
  raise the limit if you see `429 Too Many Requests`.
- Each Basic-auth request verifies the password hash, which costs CPU on busy
  mounts. App passwords have the same cost.
- The top-level `/dav/` listing only works with the trailing slash (`/dav`
  without it is not routed to WebDAV).
- Locks are per API process (see above).
- Cross-workspace MOVE/COPY is refused with `502 Bad Gateway`; use the web UI
  to move data between workspaces.
