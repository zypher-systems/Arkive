#!/usr/bin/env bash
# Compose smoke: register → admin approve → upload → download.
# Requires a running stack (default http://localhost:3080) and a bootstrap admin.
# BASE must be localhost, an IP, or a hostname with a dot — curl will not store
# cookies for a bare Docker name like "web".
set -euo pipefail
BASE="${ARKIVE_PUBLIC_URL:-http://localhost:3080}"
ADMIN_EMAIL="${ARKIVE_BOOTSTRAP_ADMIN_EMAIL:-admin@arkive.local}"
ADMIN_PASS="${ARKIVE_SMOKE_ADMIN_PASSWORD:-smoketest1}"
USER_EMAIL="${ARKIVE_SMOKE_EMAIL:-smoke-$(date +%s)@arkive.local}"
USER_PASS="${ARKIVE_SMOKE_PASSWORD:-smoketest1}"

admin_cookie=$(mktemp)
user_cookie=$(mktemp)
trap 'rm -f "$admin_cookie" "$user_cookie"' EXIT

json_field() {
  python3 -c 'import json,sys; print(json.load(sys.stdin)'"$1"')'
}

# Bootstrap admin: log in if the account exists, otherwise register it.
login_code=$(curl -sS -o /tmp/arkive-admin-login.json -w '%{http_code}' -c "$admin_cookie" -b "$admin_cookie" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" \
  "$BASE/api/auth/login" || true)
if [[ "$login_code" == "200" ]]; then
  :
else
  code=$(curl -sS -o /tmp/arkive-admin-reg.json -w '%{http_code}' -c "$admin_cookie" -b "$admin_cookie" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\",\"display_name\":\"Smoke Admin\"}" \
    "$BASE/api/auth/register" || true)
  if [[ "$code" != "201" ]]; then
    echo "admin login failed ($login_code) and register failed ($code)." >&2
    echo "Set ARKIVE_SMOKE_ADMIN_PASSWORD to the bootstrap admin password for $ADMIN_EMAIL." >&2
    cat /tmp/arkive-admin-login.json /tmp/arkive-admin-reg.json 2>/dev/null >&2 || true
    exit 1
  fi
fi

code=$(curl -sS -o /tmp/arkive-reg.json -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASS\",\"display_name\":\"Smoke User\"}" \
  "$BASE/api/auth/register" || true)
if [[ "$code" != "201" ]]; then
  echo "register failed: $code $(cat /tmp/arkive-reg.json)" >&2
  exit 1
fi
user_id=$(json_field '["user"]["id"]' </tmp/arkive-reg.json)
status=$(json_field '["status"]' </tmp/arkive-reg.json)
if [[ "$status" != "pending" ]]; then
  echo "expected pending register, got $status" >&2
  exit 1
fi

curl -sS -f -c "$admin_cookie" -b "$admin_cookie" \
  -X POST "$BASE/api/admin/users/$user_id/approve" >/tmp/arkive-approve.json

curl -sS -f -c "$user_cookie" -b "$user_cookie" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$USER_EMAIL\",\"password\":\"$USER_PASS\"}" \
  "$BASE/api/auth/login" >/tmp/arkive-login.json

ws=$(curl -sS -f -b "$user_cookie" "$BASE/api/workspaces" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(next(w["id"] for w in d if w["type"]=="personal"))')

echo 'smoke file' | curl -sS -f -b "$user_cookie" -X PUT \
  -H 'Content-Type: text/plain' \
  --data-binary @- \
  "$BASE/api/workspaces/$ws/upload?name=smoke.txt" >/tmp/arkive-up.json

id=$(python3 -c 'import json; print(json.load(open("/tmp/arkive-up.json"))["id"])')
curl -sS -f -b "$user_cookie" -o /tmp/arkive-dl.txt "$BASE/api/nodes/$id/download"
grep -q 'smoke file' /tmp/arkive-dl.txt
echo "smoke ok workspace=$ws node=$id user=$USER_EMAIL"
