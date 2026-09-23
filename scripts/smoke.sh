#!/usr/bin/env bash
# Compose smoke: SPA + first-run setup → register → admin approve → upload →
# download → WebDAV PROPFIND.
#
# Requires a running stack (default http://localhost:3080).
#   - Fresh instance: pass the setup token (ARKIVE_SMOKE_SETUP_TOKEN, falling
#     back to ARKIVE_SETUP_TOKEN) — it is printed in `docker compose logs arkive`
#     unless ARKIVE_SETUP_TOKEN was set on the server.
#   - Existing instance: set ARKIVE_SMOKE_ADMIN_EMAIL / ARKIVE_SMOKE_ADMIN_PASSWORD.
# BASE must be localhost, an IP, or a hostname with a dot — curl will not store
# cookies for a bare Docker name like "arkive".
set -euo pipefail
BASE="${ARKIVE_PUBLIC_URL:-http://localhost:3080}"
ADMIN_EMAIL="${ARKIVE_SMOKE_ADMIN_EMAIL:-${ARKIVE_BOOTSTRAP_ADMIN_EMAIL:-admin@arkive.local}}"
ADMIN_PASS="${ARKIVE_SMOKE_ADMIN_PASSWORD:-smoketest1}"
SETUP_TOKEN="${ARKIVE_SMOKE_SETUP_TOKEN:-${ARKIVE_SETUP_TOKEN:-}}"
USER_EMAIL="${ARKIVE_SMOKE_EMAIL:-smoke-$(date +%s)@arkive.local}"
USER_PASS="${ARKIVE_SMOKE_PASSWORD:-smoketest1}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
admin_cookie="$tmp/admin.cookie"
user_cookie="$tmp/user.cookie"

json_field() {
  python3 -c 'import json,sys; print(json.load(sys.stdin)'"$1"')'
}
fail() {
  echo "smoke: $*" >&2
  exit 1
}

# 1. The binary serves the SPA with security headers, and the API.
curl -sS -f -D "$tmp/index.h" -o "$tmp/index.html" "$BASE/some/client/route"
grep -qi '<div id="root">' "$tmp/index.html" || fail "SPA index.html not served for client route"
grep -qi '^content-security-policy:' "$tmp/index.h" || fail "SPA response lacks CSP"
curl -sS -f "$BASE/api/instance" >"$tmp/instance.json"
echo "instance: $(cat "$tmp/instance.json")"

# 2. First-run setup, or log in as the existing admin.
needed=$(curl -sS -f "$BASE/api/setup" | json_field '["needed"]')
if [[ "$needed" == "True" ]]; then
  [[ -n "$SETUP_TOKEN" ]] || fail "instance needs setup: set ARKIVE_SMOKE_SETUP_TOKEN (see 'docker compose logs arkive | grep setup_token')"
  code=$(curl -sS -o "$tmp/setup.json" -w '%{http_code}' -c "$admin_cookie" -b "$admin_cookie" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\",\"display_name\":\"Smoke Admin\",\"setup_token\":\"$SETUP_TOKEN\"}" \
    "$BASE/api/setup" || true)
  [[ "$code" == "201" ]] || fail "setup failed: $code $(cat "$tmp/setup.json")"
  echo "setup ok: admin $ADMIN_EMAIL"
else
  code=$(curl -sS -o "$tmp/admin-login.json" -w '%{http_code}' -c "$admin_cookie" -b "$admin_cookie" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" \
    "$BASE/api/auth/login" || true)
  [[ "$code" == "200" ]] || fail "admin login failed ($code): set ARKIVE_SMOKE_ADMIN_EMAIL / ARKIVE_SMOKE_ADMIN_PASSWORD. $(cat "$tmp/admin-login.json")"
fi

# 3. Signup → pending → approve → login.
code=$(curl -sS -o "$tmp/reg.json" -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASS\",\"display_name\":\"Smoke User\"}" \
  "$BASE/api/auth/register" || true)
[[ "$code" == "201" ]] || fail "register failed: $code $(cat "$tmp/reg.json")"
user_id=$(json_field '["user"]["id"]' <"$tmp/reg.json")
status=$(json_field '["status"]' <"$tmp/reg.json")
[[ "$status" == "pending" ]] || fail "expected pending register, got $status"

curl -sS -f -c "$admin_cookie" -b "$admin_cookie" \
  -X POST "$BASE/api/admin/users/$user_id/approve" >"$tmp/approve.json"

curl -sS -f -c "$user_cookie" -b "$user_cookie" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASS\"}" \
  "$BASE/api/auth/login" >"$tmp/login.json"

# 4. Upload + download.
ws=$(curl -sS -f -b "$user_cookie" "$BASE/api/workspaces" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(w["id"] for w in d if w["type"]=="personal"))')

echo 'smoke file' | curl -sS -f -b "$user_cookie" -X PUT \
  -H 'Content-Type: text/plain' \
  --data-binary @- \
  "$BASE/api/workspaces/$ws/upload?name=smoke.txt" >"$tmp/up.json"

id=$(json_field '["id"]' <"$tmp/up.json")
curl -sS -f -b "$user_cookie" -o "$tmp/dl.txt" "$BASE/api/nodes/$id/download"
grep -q 'smoke file' "$tmp/dl.txt" || fail "download mismatch"

# 5. WebDAV through the same binary.
dav=$(curl -sS -o "$tmp/dav.xml" -w '%{http_code}' -u "$USER_EMAIL:$USER_PASS" -X PROPFIND -H 'Depth: 1' "$BASE/dav/$ws/" || true)
[[ "$dav" == "207" ]] || fail "WebDAV PROPFIND returned $dav"
grep -q 'smoke.txt' "$tmp/dav.xml" || fail "WebDAV listing lacks smoke.txt"

echo "smoke ok workspace=$ws node=$id user=$USER_EMAIL"
