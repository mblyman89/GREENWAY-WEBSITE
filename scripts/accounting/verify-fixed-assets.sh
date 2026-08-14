#!/usr/bin/env bash
# scripts/accounting/verify-fixed-assets.sh
# =============================================================================
# Proves migration 0178 (fixed assets and depreciation, slice F5-L) actually
# works, by stacking it on 0172 + 0173 + 0174 + 0175 + 0176 + 0177 in a real,
# throwaway PostgreSQL database and then attacking it.
#
# WHY THIS EXISTS: per AGENTS.md, Supabase migrations are applied MANUALLY by the
# owner in the SQL editor. A migration that fails there is a live problem at 11pm,
# not a red mark in CI. So it is executed here first, and applied THREE times
# (idempotency), before Michael is ever asked to paste it in.
#
# WHY THIS SLICE NEEDED THE ATTACKS
#   Two real defects were found by running this suite, not by reading the code:
#
#   1. A PRE-EXISTING BUG IN 0173. Accounts 10200 (Bank -- Operating) and 10300
#      (Bank -- ATM Vault) were seeded with is_contra = true, because `true` was
#      passed in the 4th positional slot when is_control was meant. Both bank
#      accounts were therefore CREDIT-normal. The abnormal-balance alarm reads
#      normal_balance, so a genuine overdraft read as NORMAL -- on the very
#      account that had already drifted to -45,230.00 in the old books. The
#      existing normal-balance guard could not catch it, because it checks that
#      normal_balance AGREES with type + contra, and it agreed perfectly with a
#      wrong input. A consistency check cannot detect a consistent lie.
#
#   2. A BUG IN THIS SLICE'S OWN GUARD. The first version of
#      gl_guard_no_land_depreciation() refused any journal where land appeared
#      next to accumulated depreciation. A property SALE necessarily debits
#      accumulated depreciation to unwind it -- so the guard blocked a completely
#      legal transaction. The Geiger cabin has already been sold; this was not
#      hypothetical. The guard now tests the DIRECTION of the entry, not the mere
#      presence of an account.
#
#   A guard that blocks a legal transaction is not a safety feature. It teaches
#   the owner to work around the system, and the workaround is what does the
#   damage.
#
# THE HEADLINE TESTS
#   #10     pins the COMPLETE set of credit-normal asset accounts, so a future
#           miskeyed flag cannot slip in unnoticed
#   #22a-d  inventory is STILL untypeable after 0178 narrowed the inventory
#           guard's range (loosening a guard is dangerous, so it is re-proved)
#   #24-26  land and construction-in-progress can NEVER be depreciated
#   #28a-b  a LEGITIMATE property sale is ALLOWED (the false-positive attack)
#   #28c    the same entry with the sign flipped is still REFUSED, so the
#           direction test cannot rot into dead code
#   #28d    the refusal TELLS MICHAEL WHAT TO DO instead of just saying no
#   #29a    anti-vacuous guard: fails loudly if the ledger is empty, because an
#           earlier version of this suite passed against nothing at all
#
# Usage:   bash scripts/accounting/verify-fixed-assets.sh
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
OV_MIGRATION="$REPO_ROOT/supabase/migrations/0177_owner_override.sql"
MIGRATION="$REPO_ROOT/supabase/migrations/0178_fixed_assets.sql"
HARNESS="$REPO_ROOT/scripts/accounting/gl-schema-harness.sql"
TESTS="${TESTS_OVERRIDE:-$REPO_ROOT/scripts/accounting/fixed-assets-tests.sql}"

PGBIN="${PGBIN:-/usr/lib/postgresql/15/bin}"
# A DIFFERENT PORT from the other verify scripts (5437, 5438) so the suites can
# run at the same time without one silently connecting to another's database.
PGPORT="${PGPORT:-5439}"
PGDATA_DIR="$(mktemp -d /tmp/faverify.XXXXXX)"
DB="fa_verify"

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA_DIR/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" || true
}
trap cleanup EXIT

echo "=== Greenway fixed-asset verification (slice F5-L) ==="
echo "migration: $MIGRATION"

for f in "$GL_MIGRATION" "$COA_MIGRATION" "$POST_MIGRATION" "$TB_MIGRATION" \
         "$OB_MIGRATION" "$OV_MIGRATION" "$MIGRATION" "$HARNESS" "$TESTS"; do
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

# Run a step and STOP THE WORLD if it fails. Putting a command on the left of
# `&&` disables `set -e` for it, so a failed migration step can print its error,
# be ignored, and let the run continue to the test suite -- which then "passes"
# against a schema that never finished applying. Every step goes through here.
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
  echo "      Re-run with a different port:  PGPORT=5452 bash $0" >&2
  exit 1
fi

# Poll until the server actually ANSWERS. `pg_ctl start` returning is not the
# same as the server being ready, and a fixed sleep is a guess that becomes a
# flaky failure on a loaded machine.
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
step "applying 0176 (opening balances)"             "$PSQL -q -f $OB_MIGRATION"
step "applying 0177 (owner override)"               "$PSQL -q -f $OV_MIGRATION"

# ---------------------------------------------------------------------------
# THE SQL-EDITOR CONTEXT IS THE DEFAULT HERE, NOT AN AFTERTHOUGHT.
#
# The harness defaults is_admin() to FALSE and auth.uid() to NULL, which is an
# honest picture of what Michael's Supabase SQL editor actually looks like when
# he pastes a migration in. 0178 is applied under exactly those conditions,
# three times. If it ever calls one of its own admin-guarded functions, it dies
# here instead of dying in his hands.
# ---------------------------------------------------------------------------
step "applying 0178 as NOBODY (first run)"          "$PSQL -q -f $MIGRATION"
step "applying 0178 as NOBODY again (idempotency)"  "$PSQL -q -f $MIGRATION"
step "applying 0178 as NOBODY a THIRD time"         "$PSQL -q -f $MIGRATION"

# 0178 CORRECTS two accounts that 0173 seeded wrongly. If 0173 were ever re-run
# after 0178 -- which happens the moment someone re-pastes the chart of accounts
# -- the bug would come straight back. Prove the ordering is recoverable: re-apply
# 0173, then 0178, and let the suite confirm the correction still holds.
step "re-applying 0173 (re-introduces the contra bug)" "$PSQL -q -f $COA_MIGRATION"
step "re-applying 0178 (must correct it again)"        "$PSQL -q -f $MIGRATION"

echo "--- running the adversarial suite ---"
as_pg "$PSQL -f $TESTS"

echo ""
echo "=== FIXED ASSET VERIFICATION PASSED ==="
