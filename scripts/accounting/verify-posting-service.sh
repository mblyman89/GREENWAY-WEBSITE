#!/usr/bin/env bash
# scripts/accounting/verify-posting-service.sh
# =============================================================================
# Proves migration 0174 (the posting service, slice F3) actually works, by
# stacking it on 0172 + 0173 in a real, throwaway PostgreSQL database and then
# attacking it.
#
# WHY THIS EXISTS: per AGENTS.md, Supabase migrations are applied MANUALLY by the
# owner in the SQL editor. A migration that fails there is a live problem in the
# real database at 11pm, not a red mark in CI. So it is executed here first, and
# executed TWICE (idempotency), before Michael is ever asked to paste it in.
#
# THE HEADLINE TESTS: post the same sale ten times and prove exactly one journal
# exists; submit the same invoice number with a different amount and prove it is
# refused by the SPECIFIC code GL_POST_CONFLICT; and replay the $4,624,697.31
# "LAZY INVENTORY ENTRY" through an approved template and prove the ceiling
# stops it.
#
# Usage:   bash scripts/accounting/verify-posting-service.sh
# Requires: postgresql server binaries (initdb, pg_ctl, psql).
# Touches nothing outside a temporary directory. Never connects to production.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GL_MIGRATION="$REPO_ROOT/supabase/migrations/0172_gl_foundation.sql"
COA_MIGRATION="$REPO_ROOT/supabase/migrations/0173_chart_of_accounts.sql"
MIGRATION="$REPO_ROOT/supabase/migrations/0174_gl_posting_service.sql"
HARNESS="$REPO_ROOT/scripts/accounting/gl-schema-harness.sql"
TESTS="${TESTS_OVERRIDE:-$REPO_ROOT/scripts/accounting/posting-service-tests.sql}"

PGBIN="${PGBIN:-/usr/lib/postgresql/15/bin}"
PGPORT="${PGPORT:-5436}"
PGDATA_DIR="$(mktemp -d /tmp/postverify.XXXXXX)"
DB="posting_verify"

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA_DIR/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" || true
}
trap cleanup EXIT

echo "=== Greenway posting-service verification (slice F3) ==="
echo "migration: $MIGRATION"

for f in "$GL_MIGRATION" "$COA_MIGRATION" "$MIGRATION" "$HARNESS" "$TESTS"; do
  [ -f "$f" ] || { echo "MISSING: $f" >&2; exit 1; }
done

if [ "$(id -u)" -eq 0 ]; then
  id postgres >/dev/null 2>&1 || { echo "running as root but there is no postgres user" >&2; exit 1; }
  chown -R postgres "$PGDATA_DIR"
  RUN=(su postgres -c)
else
  RUN=(bash -c)
fi

as_pg() { "${RUN[@]}" "$1"; }

echo "--- starting a throwaway PostgreSQL ---"
mkdir -p "$PGDATA_DIR/data"
chmod 777 "$PGDATA_DIR"
[ "$(id -u)" -eq 0 ] && chown -R postgres "$PGDATA_DIR"
as_pg "$PGBIN/initdb -D $PGDATA_DIR/data -A trust" >/dev/null
as_pg "$PGBIN/pg_ctl -D $PGDATA_DIR/data -l $PGDATA_DIR/log -o '-p $PGPORT -k $PGDATA_DIR' start" >/dev/null
sleep 2

as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -q -v ON_ERROR_STOP=1 -d postgres -c 'create database $DB;'" >/dev/null

PSQL="$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -q -v ON_ERROR_STOP=1 -d $DB"
QUIET() { grep -v "already exists, skipping" | grep -v "does not exist, skipping" || true; }

echo "--- installing the Supabase stand-ins ---"
as_pg "$PSQL -f $HARNESS" 2>&1 | QUIET

echo "--- applying 0172 (the GL foundation) ---"
as_pg "$PSQL -f $GL_MIGRATION" 2>&1 | QUIET
echo "    ok"

echo "--- applying 0173 (the chart of accounts) ---"
as_pg "$PSQL -f $COA_MIGRATION" 2>&1 | QUIET
echo "    ok"

echo "--- applying 0174 (first run) ---"
as_pg "$PSQL -f $MIGRATION" 2>&1 | QUIET
echo "    ok"

echo "--- applying 0174 again (idempotency) ---"
as_pg "$PSQL -f $MIGRATION" 2>&1 | QUIET
echo "    ok"

echo "--- applying 0174 a THIRD time (idempotency under repetition) ---"
as_pg "$PSQL -f $MIGRATION" 2>&1 | QUIET
echo "    ok"

echo "--- running the adversarial suite ---"
if ! as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -d $DB -v ON_ERROR_STOP=1 -f $TESTS" 2>&1 \
     | sed 's/^psql:[^ ]* NOTICE:  //' | grep -v '^DO$'; then
  echo "POSTING SERVICE VERIFICATION FAILED" >&2
  exit 1
fi

echo
echo "=== POSTING SERVICE VERIFICATION PASSED ==="
