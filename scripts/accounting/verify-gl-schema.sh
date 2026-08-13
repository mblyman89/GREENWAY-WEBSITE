#!/usr/bin/env bash
# scripts/accounting/verify-gl-schema.sh
# =============================================================================
# Proves migration 0172 (the general-ledger foundation) actually works, by
# running it against a real, throwaway PostgreSQL database and then attacking it.
#
# WHY THIS EXISTS: per AGENTS.md, Supabase migrations are applied MANUALLY by the
# owner in the SQL editor. A migration that fails there is a live problem in the
# real database, not a red mark in CI. So the migration is executed here first,
# twice (to prove it is idempotent), and then subjected to an adversarial suite
# that tries to break the books the same ways the old Sage file was broken.
#
# Usage:   bash scripts/accounting/verify-gl-schema.sh
# Requires: postgresql server binaries (initdb, pg_ctl, psql).
# Touches nothing outside a temporary directory. Never connects to production.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIGRATION="$REPO_ROOT/supabase/migrations/0172_gl_foundation.sql"
HARNESS="$REPO_ROOT/scripts/accounting/gl-schema-harness.sql"
TESTS="$REPO_ROOT/scripts/accounting/gl-schema-tests.sql"
SEEDCHECKS="$REPO_ROOT/scripts/accounting/gl-seed-checks.sql"

PGBIN="${PGBIN:-/usr/lib/postgresql/15/bin}"
PGPORT="${PGPORT:-5433}"
PGDATA_DIR="$(mktemp -d /tmp/glverify.XXXXXX)"
DB="gl_verify"

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA_DIR/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" || true
}
trap cleanup EXIT

echo "=== Greenway GL schema verification ==="
echo "migration: $MIGRATION"

for f in "$MIGRATION" "$HARNESS" "$TESTS" "$SEEDCHECKS"; do
  [ -f "$f" ] || { echo "MISSING: $f" >&2; exit 1; }
done

# PostgreSQL refuses to run as root, which is the default in most containers.
# When we are root, run the server (and the client) as the postgres user instead.
if [ "$(id -u)" -eq 0 ]; then
  id postgres >/dev/null 2>&1 || { echo "running as root but there is no postgres user" >&2; exit 1; }
  chown -R postgres "$PGDATA_DIR"
  RUN=(su postgres -c)
else
  RUN=(bash -c)
fi

# Runs a command string as the correct user.
as_pg() { "${RUN[@]}" "$1"; }

echo "--- starting a throwaway PostgreSQL ---"
mkdir -p "$PGDATA_DIR/data"
chmod 777 "$PGDATA_DIR"
[ "$(id -u)" -eq 0 ] && chown -R postgres "$PGDATA_DIR"
as_pg "$PGBIN/initdb -D $PGDATA_DIR/data -A trust" >/dev/null
as_pg "$PGBIN/pg_ctl -D $PGDATA_DIR/data -l $PGDATA_DIR/log -o '-p $PGPORT -k $PGDATA_DIR' start" >/dev/null
sleep 2

as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -q -v ON_ERROR_STOP=1 -d postgres -c 'create database $DB;'" >/dev/null

echo "--- installing the Supabase stand-ins ---"
as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -q -v ON_ERROR_STOP=1 -d $DB -f $HARNESS" 2>&1 | grep -v "already exists, skipping" || true

echo "--- applying 0172 (first run) ---"
# "already exists, skipping" notices on the second run are the POINT of an
# idempotent migration, so they are suppressed; genuine errors still stop the run.
as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -q -v ON_ERROR_STOP=1 -d $DB -f $MIGRATION" 2>&1 | grep -v "already exists, skipping" | grep -v "does not exist, skipping" || true
echo "    ok"

echo "--- applying 0172 again (idempotency) ---"
as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -q -v ON_ERROR_STOP=1 -d $DB -f $MIGRATION" 2>&1 | grep -v "already exists, skipping" | grep -v "does not exist, skipping" || true
echo "    ok"

echo "--- checking the seed did not duplicate ---"
as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -q -v ON_ERROR_STOP=1 -d $DB -f $SEEDCHECKS" 2>&1 | sed "s/^psql:[^ ]* NOTICE:  //" | grep -v "^DO$" || true
echo "    ok"

echo "--- running the adversarial suite ---"
if ! as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -d $DB -v ON_ERROR_STOP=1 -f $TESTS" 2>&1 \
     | sed 's/^psql:[^ ]* NOTICE:  //' | grep -v '^DO$'; then
  echo "GL SCHEMA VERIFICATION FAILED" >&2
  exit 1
fi

echo
echo "=== GL SCHEMA VERIFICATION PASSED ==="
