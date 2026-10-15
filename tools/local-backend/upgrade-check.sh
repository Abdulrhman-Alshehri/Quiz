#!/usr/bin/env bash
# Checks that the newest migration can be applied while a session is open, and
# that the session carries on afterwards (see upgrade_check.py). Builds its own
# database (quiz_upgrade) from every migration except the newest, serves
# it on its own port, and removes both at the end. Local only.
#
#   BANK_FILE      required: a question bank the older database accepts, for example
#                  one downloaded from the live console (keep it out of the repository)
#   PG_ADMIN_URL   server to use (default postgres://postgres@localhost:54322/postgres)
#   UPGRADE_PORT   port for the extra Data API stand-in (default 54331)
set -euo pipefail
cd "$(dirname "$0")/../.."

PG_ADMIN_URL=${PG_ADMIN_URL:-postgres://postgres@localhost:54322/postgres}
BANK_FILE=${BANK_FILE:?Set BANK_FILE to a question bank the older database accepts}
UPGRADE_PORT=${UPGRADE_PORT:-54331}
DB_NAME=quiz_upgrade
DB_URL="${PG_ADMIN_URL%/*}/${DB_NAME}"
ADMIN_PASSCODE=local-dev-passcode

case "$PG_ADMIN_URL" in
  *localhost*|*127.0.0.1*) ;;
  *) echo "Refusing a database that is not on localhost: $PG_ADMIN_URL" >&2; exit 1 ;;
esac

migrations=( $(ls supabase/migrations/*.sql | sort) )
newest=${migrations[${#migrations[@]}-1]}
export PGOPTIONS='-c client_min_messages=error'
psql "$PG_ADMIN_URL" -q -v ON_ERROR_STOP=1 -c "drop database if exists ${DB_NAME} with (force)" -c "create database ${DB_NAME}"
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f tools/local-backend/bootstrap.sql
for f in "${migrations[@]:0:${#migrations[@]}-1}"; do
  psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$f"
done
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -v passcode="$ADMIN_PASSCODE" <<'SQL'
insert into app_private.admin_config (id, passcode_hash)
values (1, extensions.crypt(:'passcode', extensions.gen_salt('bf', 6)))
on conflict (id) do update set passcode_hash = excluded.passcode_hash, updated_at = now();
SQL
echo "select app_private.import_bank(:'bank'::jsonb);" |
  psql "$DB_URL" -q -At -v ON_ERROR_STOP=1 -v bank="$(cat "$BANK_FILE")" > /dev/null

PORT=$UPGRADE_PORT DATABASE_URL=$DB_URL node tools/local-backend/server.mjs > /dev/null 2>&1 &
server=$!
cleanup() {
  kill "$server" 2> /dev/null || true
  psql "$PG_ADMIN_URL" -q -c "drop database if exists ${DB_NAME} with (force)" || true
}
trap cleanup EXIT
for _ in $(seq 1 20); do curl -sf "http://localhost:${UPGRADE_PORT}/health" > /dev/null && break; sleep 0.25; done

echo "before: ${#migrations[@]} migrations minus $(basename "$newest"); bank: $BANK_FILE"
API="http://localhost:${UPGRADE_PORT}" DB_URL="$DB_URL" MIGRATION="$newest" ADMIN_PASSCODE="$ADMIN_PASSCODE" \
  python3 tools/local-backend/upgrade_check.py
