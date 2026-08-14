#!/usr/bin/env bash
# scripts/accounting/verify-trial-balance.sh
# =============================================================================
# Proves migration 0175 (the trial balance, slice F4) actually works, by
# stacking it on 0172 + 0173 + 0174 in a real, throwaway PostgreSQL database and
# then attacking it.
#
# WHY THIS EXISTS: per AGENTS.md, Supabase migrations are applied MANUALLY by the
# owner in the SQL editor. A migration that fails there is a live problem at
# 11pm, not a red mark in CI. So it is executed here first, and applied THREE
# times (idempotency), before Michael is ever asked to paste it in.
#
# THE HEADLINE TEST: post a sale, post a second sale, reverse the second, and
# prove the trial balance reports the TRUTH — while separately proving that the
# obvious `status = 'posted'` filter reports a balanced but FICTIONAL answer
# (-1,500.00 of cash that does not exist).
#
# Usage:   bash scripts/accounting/verify-trial-balance.sh
# Requires: postgresql server binaries (initdb, pg_ctl, psql).
# Touches nothing outside a temporary directory. Never connects to production.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GL_MIGRATION="$REPO_ROOT/supabase/migrations/0172_gl_foundation.sql"
COA_MIGRATION="$REPO_ROOT/supabase/migrations/0173_chart_of_accounts.sql"
POST_MIGRATION="$REPO_ROOT/supabase/migrations/0174_gl_posting_service.sql"
MIGRATION="$REPO_ROOT/supabase/migrations/0175_gl_trial_balance.sql"
HARNESS="$REPO_ROOT/scripts/accounting/gl-schema-harness.sql"
TESTS="${TESTS_OVERRIDE:-$REPO_ROOT/scripts/accounting/trial-balance-tests.sql}"

PGBIN="${PGBIN:-/usr/lib/postgresql/15/bin}"
PGPORT="${PGPORT:-5437}"
PGDATA_DIR="$(mktemp -d /tmp/tbverify.XXXXXX)"
DB="tb_verify"

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA_DIR/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" || true
}
trap cleanup EXIT

echo "=== Greenway trial-balance verification (slice F4) ==="
echo "migration: $MIGRATION"

for f in "$GL_MIGRATION" "$COA_MIGRATION" "$POST_MIGRATION" "$MIGRATION" "$HARNESS" "$TESTS"; do
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

# Run a step and STOP THE WORLD if it fails.
#
# WHY THIS EXISTS: this script used to say `as_pg "$PSQL -f $MIGRATION" && echo ok`.
# Putting a command on the left of `&&` disables `set -e` for it, so the three
# migration steps printed their errors, were ignored, and the run continued to
# the test suite anyway. A real access-control defect in 0175 was reported three
# times in the output as `ERROR: role "authenticated" does not exist` and the
# script sailed past it and started asserting things about a schema that had
# never finished applying. The tests then "passed" against a half-built database.
#
# A verification script that can print ERROR and still exit 0 is not a
# verification script. Every step now goes through here.
step() {
  local label="$1" cmd="$2" out
  echo "--- $label ---"
  if ! out="$(as_pg "$cmd" 2>&1)"; then
    echo "$out"
    echo ""
    echo "!!! STEP FAILED: $label"
    echo "!!! Refusing to continue. Test results from a partially applied schema are worthless."
    exit 1
  fi
  # Surface anything that looks like a real error even on a zero exit status.
  if grep -qE '^(psql:.*)?ERROR:' <<<"$out"; then
    echo "$out"
    echo ""
    echo "!!! STEP REPORTED AN ERROR BUT EXITED 0: $label"
    exit 1
  fi
  echo "    ok"
}

echo "--- starting a throwaway PostgreSQL ---"
as_pg "$PGBIN/initdb -D $PGDATA_DIR/data -A trust -U postgres" >/dev/null
as_pg "$PGBIN/pg_ctl -D $PGDATA_DIR/data -o '-p $PGPORT -k $PGDATA_DIR' -l $PGDATA_DIR/log start" >/dev/null
sleep 2
as_pg "$PGBIN/createdb -h $PGDATA_DIR -p $PGPORT -U postgres $DB"

PSQL="$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -U postgres -d $DB -v ON_ERROR_STOP=1"

step "installing the Supabase stand-ins"          "$PSQL -q -f $HARNESS"
step "applying 0172 (the GL foundation)"          "$PSQL -q -f $GL_MIGRATION"
step "applying 0173 (the chart of accounts)"      "$PSQL -q -f $COA_MIGRATION"
step "applying 0174 (the posting service)"        "$PSQL -q -f $POST_MIGRATION"
step "applying 0175 (first run)"                  "$PSQL -q -f $MIGRATION"
step "applying 0175 again (idempotency)"          "$PSQL -q -f $MIGRATION"
step "applying 0175 a THIRD time (idempotency)"   "$PSQL -q -f $MIGRATION"

echo "--- running the adversarial suite ---"
as_pg "$PSQL -f $TESTS"

echo ""
echo "=== TRIAL BALANCE VERIFICATION PASSED ==="
