#!/usr/bin/env bash
set -euo pipefail

: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to the NEW client Supabase Postgres connection string}"
: "${ADMIN_EMAIL:?Set ADMIN_EMAIL to the Auth user that should become the first app administrator}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v psql >/dev/null || { echo "psql is required." >&2; exit 1; }

if [[ ! "$ADMIN_EMAIL" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "ADMIN_EMAIL is not a valid email address." >&2
  exit 1
fi

count="$(psql "$TARGET_DATABASE_URL" -Atqc "select count(*) from auth.users where lower(email)=lower('$ADMIN_EMAIL')")"
if [[ "$count" != "1" ]]; then
  echo "Expected exactly one Supabase Auth user with email: $ADMIN_EMAIL. Create/confirm that Auth user first." >&2
  exit 1
fi

psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -v admin_email="$ADMIN_EMAIL" -f "$ROOT/database/seeds/02_bootstrap_admin_profile.sql"
echo "Admin profile created/updated for $ADMIN_EMAIL."
