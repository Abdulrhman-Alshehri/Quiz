#!/usr/bin/env bash
# Rebuilds the local test database from scratch: Supabase-like roles, every
# migration in supabase/migrations (in order), a presenter passcode and a
# question bank. Never point this at the live project.
#
#   PG_ADMIN_URL   server to use (default postgres://postgres@localhost:54322/postgres)
#   DB_NAME        database to (re)create (default quiz)
#   ADMIN_PASSCODE presenter passcode to set (default local-dev-passcode)
#   BANK_FILE      question bank JSON to import (default: the repository template)
set -euo pipefail
cd "$(dirname "$0")/../.."

PG_ADMIN_URL=${PG_ADMIN_URL:-postgres://postgres@localhost:54322/postgres}
DB_NAME=${DB_NAME:-quiz}
ADMIN_PASSCODE=${ADMIN_PASSCODE:-local-dev-passcode}
BANK_FILE=${BANK_FILE:-question-bank/question-bank.template.json}
DB_URL="${PG_ADMIN_URL%/*}/${DB_NAME}"

case "$PG_ADMIN_URL" in
  *localhost*|*127.0.0.1*) ;;
  *) echo "Refusing to reset a database that is not on localhost: $PG_ADMIN_URL" >&2; exit 1 ;;
esac

psql "$PG_ADMIN_URL" -q -v ON_ERROR_STOP=1 \
  -c "drop database if exists ${DB_NAME} with (force)" \
  -c "create database ${DB_NAME}"
# Notices and the "wal_level is insufficient" warning for the empty publication are expected; errors still stop the script.
export PGOPTIONS='-c client_min_messages=error'
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f tools/local-backend/bootstrap.sql
for f in supabase/migrations/*.sql; do
  echo "migration: $(basename "$f")"
  psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$f"
done
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -v passcode="$ADMIN_PASSCODE" <<'SQL'
insert into app_private.admin_config (id, passcode_hash)
values (1, extensions.crypt(:'passcode', extensions.gen_salt('bf', 6)))
on conflict (id) do update set passcode_hash = excluded.passcode_hash, updated_at = now();
SQL
# psql only expands :'bank' in statements read from a file or stdin, not in -c.
echo "select app_private.import_bank(:'bank'::jsonb) as imported;" |
  psql "$DB_URL" -q -v ON_ERROR_STOP=1 -v bank="$(cat "$BANK_FILE")"
echo "ready: $DB_URL (bank: $BANK_FILE)"
