#!/usr/bin/env bash
# scripts/accounting/verify-inventory-audit-post.sh
# =============================================================================
# Proves migration 0192 (posting an approved inventory audit, slice books-11)
# actually works, by applying it to a real, throwaway PostgreSQL and then
# attacking it fifteen different ways.
#
# WHY THIS EXISTS
# Per AGENTS.md, Supabase migrations are applied MANUALLY by the owner in the
# SQL editor. A migration that fails there is a live problem in the real
# database at 11pm, not a red mark in CI. So it is executed here first, and
# executed FOUR TIMES (idempotency), before Michael is ever asked to paste it in.
#
# THE HEADLINE TEST
# Replay THE DOUBLE-POST. Before this slice, applying a cycle count twice took a
# lot from 100 to 90 to 80 on a real PostgreSQL — inventing a ten-unit shortage
# nobody counted, from nothing more exotic than clicking a button twice. This
# suite proves the shelf now stops at 90, that a second call is refused BY NAME
# (ALREADY_POSTED, not merely "something threw"), and that exactly one
# adjustment row exists afterwards.
#
# WHAT ELSE IS PROVEN HERE THAT NO TYPESCRIPT TEST CAN REACH
#   • ATOMICITY. A session that fails on its fifth lot rolls back the four that
#     already succeeded — no orphan adjustment, no false coverage stamp, and the
#     session is NOT marked posted.
#   • THE OWNER GATE, in the database, against a real budtender row and against
#     an anonymous caller.
#   • THE CUTOFF RACE. A sale that lands between the snapshot and the count must
#     not be laundered into the variance.
#
# A NOTE ON EXIT CODES (a trap this repo has fallen into before)
#   `psql ... | grep -v NOTICE; echo $?`  reports GREP's exit code, not psql's.
#   grep exits 1 when it filters everything out, which reads as a failure that
#   never happened; worse, a psql failure hidden behind a matching grep reads as
#   SUCCESS. Every psql invocation below captures its OWN status before any
#   pipe touches it.
#
# Usage:   bash scripts/accounting/verify-inventory-audit-post.sh
# Requires: postgresql server binaries (initdb, pg_ctl, psql).
# Touches nothing outside a temporary directory. Never connects to production.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG_0191="$REPO_ROOT/supabase/migrations/0191_inventory_audit.sql"
MIG_0192="$REPO_ROOT/supabase/migrations/0192_inventory_audit_post.sql"
HARNESS="$REPO_ROOT/scripts/accounting/inventory-audit-post-harness.sql"
TESTS="$REPO_ROOT/scripts/accounting/inventory-audit-post-tests.sql"

PGBIN="${PGBIN:-/usr/lib/postgresql/15/bin}"
PGDATA_DIR="$(mktemp -d /tmp/auditpost.XXXXXX)"
DB="audit_post_verify"

# ---------------------------------------------------------------------------
# A HARD-CODED PORT IS A LIE GENERATOR, AND IT LIED HERE.
#
# This script used a fixed port. When a previous run was still shutting down —
# or when a mutation campaign invokes it repeatedly — the port was still held,
# `pg_ctl` failed, and the script exited NON-ZERO before running a single test.
#
# A non-zero exit from a verification script reads as "the code is broken". It
# is the same family as the grep-exit-code trap this file already warns about:
# an exit status is not evidence unless you know WHAT produced it. Worse, during
# a mutation campaign it reads as "the mutant was caught" — awarding the test
# suite credit for a kill it never made.
#
# So: find a port nobody is listening on, and fail LOUDLY and DISTINCTLY (exit
# 2, not 1) if the database cannot be started at all.
# ---------------------------------------------------------------------------
pick_free_port() {
  local p
  for p in $(seq 5437 5499); do
    if ! (ss -lnt 2>/dev/null || netstat -lnt 2>/dev/null) | grep -q ":$p "; then
      echo "$p"; return 0
    fi
  done
  echo "no free TCP port in 5437-5499" >&2
  exit 2
}
PGPORT="${PGPORT:-$(pick_free_port)}"

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA_DIR/data" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" || true
}
trap cleanup EXIT

echo "=== Greenway inventory-audit POSTING verification (slice books-11) ==="
echo "migration: $MIG_0192"

for f in "$MIG_0191" "$MIG_0192" "$HARNESS" "$TESTS"; do
  [ -f "$f" ] || { echo "MISSING: $f" >&2; exit 1; }
done

# PostgreSQL refuses to run as root, which is the default in most containers.
if [ "$(id -u)" -eq 0 ]; then
  id postgres >/dev/null 2>&1 || { echo "running as root but there is no postgres user" >&2; exit 1; }
  RUN=(su postgres -c)
else
  RUN=(bash -c)
fi
as_pg() { "${RUN[@]}" "$1"; }

echo "--- starting a throwaway PostgreSQL ---"
mkdir -p "$PGDATA_DIR/data"
chmod 777 "$PGDATA_DIR"
[ "$(id -u)" -eq 0 ] && chown -R postgres "$PGDATA_DIR"
# Exit code 2 throughout this block means SETUP BROKE — the tests never ran.
# Only a later exit 1 means the code under test actually failed a check.
as_pg "$PGBIN/initdb -D $PGDATA_DIR/data -A trust" >/dev/null 2>&1 \
  || { echo "SETUP FAILED: initdb could not create a test database" >&2; exit 2; }

if ! as_pg "$PGBIN/pg_ctl -D $PGDATA_DIR/data -l $PGDATA_DIR/log -o '-p $PGPORT -k $PGDATA_DIR' start" >/dev/null 2>&1; then
  echo "SETUP FAILED: PostgreSQL would not start on port $PGPORT" >&2
  echo "--- postgres log ---" >&2
  tail -20 "$PGDATA_DIR/log" >&2 2>/dev/null || true
  echo "NOTE: nothing was tested. This is NOT a test failure." >&2
  exit 2
fi
sleep 2
as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -q -v ON_ERROR_STOP=1 -d postgres -c 'create database $DB;'" >/dev/null 2>&1 \
  || { echo "SETUP FAILED: could not create database $DB" >&2; exit 2; }

PSQL="$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -q -v ON_ERROR_STOP=1 -d $DB"

# The migrations must be readable by the postgres user, which is not root.
STAGE="$PGDATA_DIR/sql"
mkdir -p "$STAGE"
cp "$MIG_0191" "$STAGE/0191.sql"
cp "$MIG_0192" "$STAGE/0192.sql"
cp "$HARNESS"  "$STAGE/harness.sql"
cp "$TESTS"    "$STAGE/tests.sql"
chmod 644 "$STAGE"/*.sql
chmod 755 "$STAGE"

# ---------------------------------------------------------------------------
# step(): run one SQL file and report HONESTLY.
#
# Two failure modes are handled, because this repo has been burned by both:
#   1. psql's exit status is captured BEFORE anything is piped, so grep's exit
#      code can never be mistaken for psql's.
#   2. a non-zero exit is not the only way SQL fails. A file can print "ERROR:"
#      and still exit 0 depending on how it is invoked, so the output is scanned
#      for ERROR/FAIL as well. Either one fails the step.
# ---------------------------------------------------------------------------
step() {
  local label="$1" file="$2" out status
  echo "--- $label ---"
  set +e
  out="$(as_pg "$PSQL -f $STAGE/$file" 2>&1)"
  status=$?
  set -e

  if [ $status -ne 0 ]; then
    echo "$out" | sed 's/^/    /'
    echo "FAILED: $label (psql exit $status)" >&2
    exit 1
  fi
  if echo "$out" | grep -qE '^(psql:.*)?(ERROR|FATAL|FAIL):'; then
    echo "$out" | sed 's/^/    /'
    echo "FAILED: $label (psql exited 0 but printed an error)" >&2
    exit 1
  fi

  # "already exists, skipping" on a re-run is the POINT of an idempotent
  # migration, so it is filtered from the display only — never from the check.
  echo "$out" \
    | grep -v "already exists, skipping" \
    | grep -v "does not exist, skipping" \
    | sed 's/^psql:[^ ]* NOTICE:  //' \
    | grep -v '^DO$' \
    | sed 's/^/    /' || true
  echo "    ok"
}

step "installing the Supabase stand-ins" harness.sql
step "applying 0191 (the auditor this posting layer sits on)" 0191.sql
step "applying 0192 (first run)" 0192.sql

# Applied repeatedly because Michael pastes these by hand and WILL paste one
# twice. An idempotent migration is not a nicety here, it is the difference
# between a shrug and a broken production database.
step "applying 0192 again (idempotency, run 2)" 0192.sql
step "applying 0192 again (idempotency, run 3)" 0192.sql
step "applying 0192 again (idempotency, run 4)" 0192.sql

step "running the adversarial suite (15 attacks)" tests.sql

# ---------------------------------------------------------------------------
# THE GATE CHECKS. An EMPTY result is the PASSING result — these functions
# return one row per PROBLEM, so silence means there is nothing wrong. That is
# the opposite of the usual reading, so it is asserted explicitly here rather
# than left to whoever runs this to interpret.
# ---------------------------------------------------------------------------
echo "--- gate checks (EMPTY = PASS) ---"
set +e
GATE="$(as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -t -A -d $DB -c \
  'select * from public.inventory_audit_gate_check() union all select * from public.inventory_audit_post_gate_check();'" 2>&1)"
GATE_STATUS=$?
set -e
if [ $GATE_STATUS -ne 0 ]; then
  echo "$GATE" | sed 's/^/    /'
  echo "FAILED: the gate checks could not be run (psql exit $GATE_STATUS)" >&2
  exit 1
fi
if [ -n "$(echo "$GATE" | tr -d '[:space:]')" ]; then
  echo "$GATE" | sed 's/^/    /'
  echo "GATE CHECK REPORTED PROBLEMS — see the rows above" >&2
  exit 1
fi
echo "    both gate checks returned NOTHING, which is the passing result"

echo
echo "=== INVENTORY AUDIT POSTING VERIFICATION PASSED ==="
echo
echo "Michael: apply 0191 FIRST, then 0192, in the Supabase SQL editor."
echo "Then run, and expect NO ROWS BACK from either:"
echo "    select * from public.inventory_audit_gate_check();"
echo "    select * from public.inventory_audit_post_gate_check();"
echo "An empty result means everything is installed correctly."
