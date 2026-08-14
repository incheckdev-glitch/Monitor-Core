#!/usr/bin/env bash
set -euo pipefail

: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL to the current/reference Supabase Postgres connection string}"
: "${TARGET_DATABASE_URL:?Set TARGET_DATABASE_URL to the NEW client Supabase Postgres connection string}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_SCHEMA="$(mktemp -t incheck360_schema_XXXXXX.sql)"
trap 'rm -f "$TMP_SCHEMA"' EXIT

command -v pg_dump >/dev/null || { echo "pg_dump is required." >&2; exit 1; }
command -v psql >/dev/null || { echo "psql is required." >&2; exit 1; }

if [[ "$SOURCE_DATABASE_URL" == "$TARGET_DATABASE_URL" ]]; then
  echo "SOURCE_DATABASE_URL and TARGET_DATABASE_URL must be different." >&2
  exit 1
fi

target_table_count="$(psql "$TARGET_DATABASE_URL" -Atqc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
if [[ "$target_table_count" != "0" && "${ALLOW_NONEMPTY_TARGET:-0}" != "1" ]]; then
  echo "Target public schema is not empty ($target_table_count base table(s)). Aborting to protect an existing database." >&2
  echo "Use a fresh Supabase project. Only set ALLOW_NONEMPTY_TARGET=1 when you have intentionally reviewed the target." >&2
  exit 1
fi

echo "1/5 Exporting PUBLIC schema only (no business data)..."
pg_dump "$SOURCE_DATABASE_URL" \
  --schema=public \
  --schema-only \
  --no-owner \
  --file="$TMP_SCHEMA"

echo "2/5 Restoring schema into target Supabase database..."
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$TMP_SCHEMA"

echo "3/5 Removing retired AI/e-sign schema objects from target..."
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/bootstrap/00_remove_retired_features.sql"

echo "4/5 Creating required private storage buckets/policies..."
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/bootstrap/01_storage_buckets.sql"

echo "5/5 Seeding baseline roles and permissions..."
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/database/seeds/01_roles_and_permissions.sql"

echo "Schema clone complete. No source business rows or Auth users were copied. Public-schema grants were preserved for Supabase/PostgREST access."
echo "Next: create the target Auth users, configure role/profile rows, deploy Edge Functions, then configure runtime-config.js and Vercel server variables."
