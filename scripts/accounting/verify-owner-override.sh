#!/usr/bin/env bash
# scripts/accounting/verify-owner-override.sh
# =============================================================================
# Proves migration 0177 (the sole-operator override, slice F6) actually works,
# by stacking it on 0172 + 0173 + 0174 + 0175 in a real, throwaway PostgreSQL
# database and then attacking it.
#
# WHY THIS EXISTS: per AGENTS.md, Supabase migrations are applied MANUALLY by the
# owner in the SQL editor. A migration that fails there is a live problem at 11pm,
# not a red mark in CI. So it is executed here first, and applied THREE times
# (idempotency), before Michael is ever asked to paste it in.
#
# WHAT THIS SLICE ACTUALLY IS: the owner is a sole operator. He writes the
# entries and he is the only person who can approve them, so the textbook
# segregation-of-duties rule cannot be satisfied by adding a second person --
# there is no second person. The override grants him that right explicitly.
#
# WHY THE LOG MATTERS MORE THAN THE PERMISSION: "the override does not work" is a
# bug he would notice in ten seconds. "The override works and quietly leaves no
# trace" is the one he would never notice, and the first person to notice would
# be an examiner asking why a sole operator approved large entries of his own
# with nothing on file. So the suite attacks the RECORD hardest, not the
# permission.
#
# THE HEADLINE TESTS
#   #3  the override actually WORKS -- approved AND posted (they are different
#       doors; proving only the first proves half a feature)
#   #4  EVERY use is logged: who, how much, which threshold, and why, in the
#       approver's own words
#   #5  the log can never be edited or deleted, by anyone, ever
#   #6  the one-time opening-balance exemption works INDEPENDENTLY of the
#       standing override, at the approve door AND the post door
#   #8  nothing material reaches the ledger unapproved, override or not, and it
#       cannot be walked around by updating the table directly
#   #9  switching the override OFF genuinely re-arms the control
#   #10 the exact threshold boundary, tested on both copies of the comparison
#
# Usage:   bash scripts/accounting/verify-owner-override.sh
# Requires: postgresql server binaries (initdb, pg_ctl, psql).
# Touches nothing outside a temporary directory. Never connects to production.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GL_MIGRATION="$REPO_ROOT/supabase/migrations/0172_gl_foundation.sql"
COA_MIGRATION="$REPO_ROOT/supabase/migrations/0173_chart_of_accounts.sql"
POST_MIGRATION="$REPO_ROOT/supabase/migrations/0174_gl_posting_service.sql"
TB_MIGRATION="$REPO_ROOT/supabase/migrations/0175_gl_trial_balance.sql"
OB_MIGRATION="$REPO_ROOT/supabase/migrations/0176_opening_balances.sql"
MIGRATION="$REPO_ROOT/supabase/migrations/0177_owner_override.sql"
HARNESS="$REPO_ROOT/scripts/accounting/gl-schema-harness.sql"
TESTS="${TESTS_OVERRIDE:-$REPO_ROOT/scripts/accounting/owner-override-tests.sql}"

PGBIN="${PGBIN:-/usr/lib/postgresql/15/bin}"
# A DIFFERENT PORT from verify-trial-balance.sh (5437) so the two suites can run
# at the same time without one silently connecting to the other's database.
PGPORT="${PGPORT:-5439}"
PGDATA_DIR="$(mktemp -d /tmp/ovverify.XXXXXX)"
DB="ov_verify"

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA_DIR/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" || true
}
trap cleanup EXIT

echo "=== Greenway owner-override verification (slice F6) ==="
echo "migration: $MIGRATION"

for f in "$GL_MIGRATION" "$COA_MIGRATION" "$POST_MIGRATION" "$TB_MIGRATION" \
         "$OB_MIGRATION" "$MIGRATION" "$HARNESS" "$TESTS"; do
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
# WHY THIS EXISTS: an earlier verify script in this repo said
# `as_pg "$PSQL -f $MIGRATION" && echo ok`. Putting a command on the left of `&&`
# disables `set -e` for it, so migration steps printed their errors, were ignored,
# and the run continued to the test suite anyway. The tests then "passed" against
# a schema that had never finished applying.
#
# A verification script that can print ERROR and still exit 0 is not a
# verification script. Every step goes through here.
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
  if grep -qE '^(psql:.*)?ERROR:' <<<"$out"; then
    echo "$out"
    echo ""
    echo "!!! STEP REPORTED AN ERROR BUT EXITED 0: $label"
    exit 1
  fi
  echo "    ok"
}

echo "--- starting a throwaway PostgreSQL ---"

# WHY THIS BLOCK IS SO DEFENSIVE.
#
# The first version of this script said:
#     as_pg "... pg_ctl ... start" >/dev/null
#     sleep 2
#     as_pg "... createdb ..."
#
# When pg_ctl failed (a port collision with another verify run), the message
# "pg_ctl: could not start server" went to stderr, `>/dev/null` did not suppress
# it but nothing checked the status, and the script CARRIED ON and then EXITED 0
# having verified precisely nothing. It printed a startup error and reported
# success in the same breath.
#
# That is the same class of defect this whole suite exists to catch, sitting in
# the tool doing the catching. So: every step is checked, the server is polled
# until it genuinely answers, and the postmaster log is printed on failure.

if ! as_pg "$PGBIN/initdb --no-sync -D $PGDATA_DIR/data -A trust -U postgres" >/dev/null 2>&1; then
  echo "!!! initdb FAILED — cannot build a test database." >&2
  exit 1
fi

if ! as_pg "$PGBIN/pg_ctl -D $PGDATA_DIR/data -o '-p $PGPORT -k $PGDATA_DIR -F' -l $PGDATA_DIR/log start" >/dev/null 2>&1; then
  echo "!!! pg_ctl FAILED to start PostgreSQL on port $PGPORT." >&2
  echo "!!! Refusing to continue: a verification run that cannot start a database" >&2
  echo "!!! has verified NOTHING, and must never exit 0." >&2
  echo "--- postmaster log ---" >&2
  cat "$PGDATA_DIR/log" >&2 2>/dev/null || true
  echo "" >&2
  echo "HINT: port $PGPORT may already be in use by another verify run." >&2
  echo "      Re-run with a different port:  PGPORT=5451 bash $0" >&2
  exit 1
fi

# Poll until the server actually ANSWERS. `pg_ctl start` returning is not the
# same as the server being ready to accept a connection, and a fixed `sleep 2`
# is a guess that becomes a flaky failure on a loaded machine.
ready=""
for _ in $(seq 1 30); do
  if as_pg "$PGBIN/pg_isready -h $PGDATA_DIR -p $PGPORT -U postgres" >/dev/null 2>&1; then
    ready="yes"; break
  fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "!!! PostgreSQL started but never became ready on port $PGPORT." >&2
  echo "--- postmaster log ---" >&2
  cat "$PGDATA_DIR/log" >&2 2>/dev/null || true
  exit 1
fi

if ! as_pg "$PGBIN/createdb -h $PGDATA_DIR -p $PGPORT -U postgres $DB"; then
  echo "!!! createdb FAILED." >&2
  exit 1
fi

PSQL="$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -U postgres -d $DB -v ON_ERROR_STOP=1"

step "installing the Supabase stand-ins"            "$PSQL -q -f $HARNESS"
step "applying 0172 (the GL foundation)"            "$PSQL -q -f $GL_MIGRATION"
step "applying 0173 (the chart of accounts)"        "$PSQL -q -f $COA_MIGRATION"
step "applying 0174 (the posting service)"          "$PSQL -q -f $POST_MIGRATION"
step "applying 0175 (the trial balance)"            "$PSQL -q -f $TB_MIGRATION"

# ---------------------------------------------------------------------------
# THE SQL-EDITOR CONTEXT IS THE DEFAULT HERE, NOT AN AFTERTHOUGHT.
#
# The harness defaults is_admin() to FALSE and auth.uid() to NULL, which is an
# honest picture of what Michael's Supabase SQL editor actually looks like when
# he pastes a migration in. 0176 is applied under exactly those conditions,
# three times. If it ever calls one of its own admin-guarded functions, it dies
# here instead of dying in his hands -- which is precisely how 0175 got out.
# ---------------------------------------------------------------------------
step "applying 0176 (opening balances)"             "$PSQL -q -f $OB_MIGRATION"
step "applying 0177 as NOBODY (first run)"          "$PSQL -q -f $MIGRATION"
step "applying 0177 as NOBODY again (idempotency)"  "$PSQL -q -f $MIGRATION"
step "applying 0177 as NOBODY a THIRD time"         "$PSQL -q -f $MIGRATION"

echo "--- running the adversarial suite ---"
as_pg "$PSQL -f $TESTS"

echo ""
echo "=== OWNER OVERRIDE VERIFICATION PASSED ==="
