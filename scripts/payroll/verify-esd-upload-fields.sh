#!/usr/bin/env bash
# =============================================================================
# scripts/payroll/verify-esd-upload-fields.sh          (books-64)
#
# Proves migration 0207 (the three ESD upload columns) actually works, by
# running it against a real, throwaway PostgreSQL database.
#
# Per AGENTS.md, Supabase migrations are applied MANUALLY by the owner in the
# SQL editor, so a migration that fails does so in his live database. That is
# the entire reason this script exists rather than a code review.
#
# WHY THIS MIGRATION IN PARTICULAR NEEDED EXECUTING
# -------------------------------------------------
# 0207 carries a CHECK constraint with a regular expression:
#
#     check (soc_code is null or soc_code ~ '^[0-9]{2}-?[0-9]{4}$')
#
# A regex in a CHECK is the one thing in this migration that CANNOT be verified
# by reading it. POSIX regex in PostgreSQL is not JavaScript's regex: `~` is
# unanchored by default, brace quantifiers behave differently in the ARE/BRE
# dialects, and a `-` in the wrong place inside a bracket expression is a range
# rather than a literal. Reasoning about that is guessing. So it is executed.
#
# What this proves, in the order it proves it:
#   1. THE PRE-STATE IS THE GAP (rule 39d). Before 0207, selecting the three
#      columns fails with 42703 undefined_column. Without this the rest proves
#      nothing, because a migration nobody needed also applies cleanly.
#   2. AFTER 0207 the exact nine-column select that esd-upload-store.ts issues
#      succeeds. Not a select of the three new columns - the REAL one, copied
#      from EMPLOYEE_COLUMNS, so a typo in either place is caught here.
#   3. THE ACCEPT SET: hyphenated 41-2031 (as printed on Greenway's filed
#      5208B), bare 412031, and NULL are all accepted.
#   4. THE REFUSE SET: five malformed codes are each refused BY NAME. This is
#      the half that a JavaScript-shaped assumption about `~` would fail.
#   5. date_of_birth accepts NULL (so the upload can refuse by name) and
#      rejects a non-date.
#   6. wa_cares_exempt defaults to FALSE on a row that never mentions it, which
#      is the claim 0207's own comment makes.
#   7. 0207 is idempotent: applied three times, the columns exist exactly once.
#
# Usage:    bash scripts/payroll/verify-esd-upload-fields.sh
# Requires: postgresql server binaries (initdb, pg_ctl, psql).
# Runs as root OR as an ordinary user: when root, the server-side commands drop
# to the postgres account, because initdb refuses to run as root (standing rule
# 104 - run the script the way the documentation says to run it).
# Touches nothing outside a temporary directory. Never connects to production.
# =============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

REPO="$(pwd)"
MIG="$REPO/supabase/migrations/0207_employee_esd_upload_fields.sql"

pass=0
fail=0
ok()  { echo "  PASS  $1"; pass=$((pass + 1)); }
bad() { echo "  FAIL  $1"; fail=$((fail + 1)); }

TMP="$(mktemp -d)"
PGDATA="$TMP/data"
SOCK="$TMP/sock"
mkdir -p "$SOCK"

# When root, everything server-side runs as postgres. initdb refuses root.
AS=""
if [ "$(id -u)" = "0" ]; then
  AS="postgres"
  chmod 777 "$TMP"
  chown -R postgres "$TMP"
fi

run() {  # run a command, as postgres when we are root
  if [ -n "$AS" ]; then su "$AS" -c "$1"; else bash -c "$1"; fi
}

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
if [ -z "$PGBIN" ]; then
  echo "FATAL: no postgresql server binaries found under /usr/lib/postgresql"
  exit 1
fi

cleanup() {
  run "$PGBIN/pg_ctl -D '$PGDATA' -m immediate stop" >/dev/null 2>&1
  rm -rf "$TMP"
}
trap cleanup EXIT

echo "═══════════════════════════════════════════════════════════════════════"
echo " 0. A REAL POSTGRESQL, STARTED AND ANSWERING A QUERY"
echo "═══════════════════════════════════════════════════════════════════════"

run "$PGBIN/initdb -D '$PGDATA' -A trust -U postgres" >"$TMP/initdb.log" 2>&1
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "FATAL: initdb failed"; tail -20 "$TMP/initdb.log"; exit 1
fi

run "$PGBIN/pg_ctl -D '$PGDATA' -o \"-k '$SOCK' -h ''\" -l '$TMP/pg.log' start" \
  >/dev/null 2>&1

# POLL for a server that answers a real query. Never sleep-and-hope: that is
# the bug the 0205 verify script shipped with.
up=0
for _ in $(seq 1 40); do
  if run "$PGBIN/psql -h '$SOCK' -U postgres -d postgres -tAc 'select 1'" \
       >/dev/null 2>&1; then
    up=1; break
  fi
  sleep 0.5
done
if [ "$up" != "1" ]; then
  echo "FATAL: server never answered"; tail -30 "$TMP/pg.log"; exit 1
fi
ok "PostgreSQL $(cat "$PGDATA/PG_VERSION") started and answered 'select 1'"

Q() {  # Q <sql>  -> stdout, exit status is psql's
  run "$PGBIN/psql -h '$SOCK' -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc \"$1\"" 2>&1
}
QF() { # QF <file>
  run "$PGBIN/psql -h '$SOCK' -U postgres -d postgres -v ON_ERROR_STOP=1 -f '$1'" 2>&1
}

# ---------------------------------------------------------------------------
# A minimal stand-in for public.employees. Deliberately NOT the real 0037
# table: 0037 pulls in staff_profiles, shifts, RLS and a dozen other objects,
# and this script is about 0207's three columns and one regex. The columns that
# matter are the ones EMPLOYEE_COLUMNS selects.
# ---------------------------------------------------------------------------
Q "create table public.employees (
     id uuid primary key default gen_random_uuid(),
     full_name text not null,
     w2_first_name_and_initial text,
     w2_last_name text,
     w2_name_suffix text,
     ssn_full text
   );" >/dev/null
ok "a stand-in public.employees exists with the pre-0207 columns"

echo
echo "═══════════════════════════════════════════════════════════════════════"
echo " 1. THE PRE-STATE IS THE GAP (rule 39d)"
echo "═══════════════════════════════════════════════════════════════════════"

# This is the select esd-upload-store.ts actually issues. Before 0207 it must
# fail, and fail NAMING a column, or the migration is defending nothing.
PRE="$(Q "select id, full_name, w2_first_name_and_initial, w2_last_name,
                 w2_name_suffix, ssn_full, date_of_birth, wa_cares_exempt,
                 soc_code
          from public.employees;")"
if echo "$PRE" | grep -qi 'column "date_of_birth" does not exist'; then
  ok "BEFORE 0207 the store's own nine-column select fails, naming date_of_birth"
else
  bad "BEFORE 0207 the store's select did NOT fail as expected"
  echo "        got: $PRE"
fi

echo
echo "═══════════════════════════════════════════════════════════════════════"
echo " 2. APPLY 0207 FOR REAL, THEN RUN THE STORE'S OWN SELECT"
echo "═══════════════════════════════════════════════════════════════════════"

APPLY="$(QF "$MIG")"
if [ $? -eq 0 ]; then
  ok "0207 applied with exit 0 against a real PostgreSQL"
else
  bad "0207 FAILED TO APPLY"
  echo "$APPLY"
fi

# Read the column list out of the STORE, not out of this script, so the two
# cannot drift. If someone adds a column to EMPLOYEE_COLUMNS and forgets the
# migration, this line is where it surfaces.
STORE_COLS="$(grep -A2 'const EMPLOYEE_COLUMNS' \
                "$REPO/src/lib/payroll/esd-upload-store.ts" \
              | grep -o '"[^"]*"' | head -1 | tr -d '"')"
if [ -z "$STORE_COLS" ]; then
  bad "could not read EMPLOYEE_COLUMNS out of esd-upload-store.ts"
else
  POST="$(Q "select $STORE_COLS from public.employees;")"
  if [ $? -eq 0 ]; then
    ok "AFTER 0207 the store's real column list selects cleanly: $STORE_COLS"
  else
    bad "the store's real column list STILL does not select"
    echo "        got: $POST"
  fi
fi

echo
echo "═══════════════════════════════════════════════════════════════════════"
echo " 3. soc_code ACCEPT SET"
echo "═══════════════════════════════════════════════════════════════════════"

n=0
for v in "'41-2031'" "'412031'" "NULL"; do
  n=$((n + 1))
  # The label is a counter, NOT the value. Interpolating the value into a second
  # quoted string nests apostrophes and produces a SYNTAX error, which the
  # refuse-set below would then have to distinguish from a real CHECK refusal.
  # (Measured: the first draft of this script did exactly that and reported 8
  # failures that were all its own quoting.)
  OUT="$(Q "insert into public.employees (full_name, soc_code)
            values ('accept $n', $v);")"
  if [ $? -eq 0 ]; then
    ok "soc_code accepts $v"
  else
    bad "soc_code REFUSED a legitimate value $v"
    echo "        got: $OUT"
  fi
done

echo
echo "═══════════════════════════════════════════════════════════════════════"
echo " 4. soc_code REFUSE SET — the half a JS-shaped assumption would fail"
echo "═══════════════════════════════════════════════════════════════════════"

# '4120310' is the one that matters most. PostgreSQL's `~` is UNANCHORED, so a
# pattern written without ^...$ would MATCH the first six digits of a seven
# digit string and accept it. If 0207's anchors were wrong, this is where it
# shows, and the wrong value would reach ESD as a truncated occupation code.
n=0
for v in "'41203'" "'4120310'" "'41-20311'" "'AB-2031'" "'  '" "'41 2031'" "''"; do
  n=$((n + 1))
  OUT="$(Q "insert into public.employees (full_name, soc_code)
            values ('refuse $n', $v);")"
  rc=$?
  # A refusal only counts if it is the CHECK refusing. A syntax error is this
  # script being wrong, and rule 48 says a check that cannot classify must FAIL
  # rather than quietly bank the wrong reason for the right outcome.
  if echo "$OUT" | grep -qi 'syntax error'; then
    bad "HARNESS BUG: $v produced a syntax error, not a CHECK verdict"
    echo "        got: $OUT"
  elif [ $rc -ne 0 ] && echo "$OUT" | grep -qi 'violates check constraint'; then
    ok "soc_code refuses $v by CHECK"
  else
    bad "soc_code ACCEPTED a malformed value $v — it would reach ESD"
    echo "        got: $OUT"
  fi
done

echo
echo "═══════════════════════════════════════════════════════════════════════"
echo " 5. date_of_birth: NULL allowed, nonsense refused"
echo "═══════════════════════════════════════════════════════════════════════"

OUT="$(Q "insert into public.employees (full_name, date_of_birth)
          values ('dob null', NULL);")"
if [ $? -eq 0 ]; then
  ok "date_of_birth accepts NULL, so the upload can refuse BY NAME"
else
  bad "date_of_birth rejected NULL; the store could never report a named gap"
  echo "        got: $OUT"
fi

OUT="$(Q "insert into public.employees (full_name, date_of_birth)
          values ('dob junk', '13/45/1999');")"
if [ $? -ne 0 ]; then
  ok "date_of_birth refuses '13/45/1999' because it is a real date type"
else
  bad "date_of_birth accepted nonsense"
fi

echo
echo "═══════════════════════════════════════════════════════════════════════"
echo " 6. wa_cares_exempt DEFAULTS FALSE — 0207's own claim, tested"
echo "═══════════════════════════════════════════════════════════════════════"

Q "insert into public.employees (full_name) values ('no mention of wa cares');" \
  >/dev/null
GOT="$(Q "select wa_cares_exempt from public.employees
          where full_name = 'no mention of wa cares';")"
if [ "$GOT" = "f" ]; then
  ok "a row that never mentions wa_cares_exempt reads back FALSE, not NULL"
else
  bad "wa_cares_exempt default is not false, it is '$GOT'"
fi

# And it must be NOT NULL, or `e.wa_cares_exempt === true` in the store would
# be quietly reading a third state the comment says does not exist.
OUT="$(Q "insert into public.employees (full_name, wa_cares_exempt)
          values ('explicit null', NULL);")"
if [ $? -ne 0 ]; then
  ok "wa_cares_exempt refuses an explicit NULL: there is no third state"
else
  bad "wa_cares_exempt accepted NULL, so 'unknown' can masquerade as 'no'"
fi

echo
echo "═══════════════════════════════════════════════════════════════════════"
echo " 7. IDEMPOTENT: APPLIED THREE TIMES"
echo "═══════════════════════════════════════════════════════════════════════"

QF "$MIG" >/dev/null 2>&1
QF "$MIG" >/dev/null 2>&1
N="$(Q "select count(*) from information_schema.columns
        where table_schema='public' and table_name='employees'
          and column_name in ('date_of_birth','wa_cares_exempt','soc_code');")"
if [ "$N" = "3" ]; then
  ok "after three applications there are exactly 3 new columns, not 9"
else
  bad "expected 3 new columns after three applications, found '$N'"
fi

# The CHECK must not have been installed three times either. A duplicated CHECK
# is harmless to correctness but it means `add column if not exists` is not
# actually guarding the constraint, which is worth knowing before it matters.
C="$(Q "select count(*) from pg_constraint
        where conrelid = 'public.employees'::regclass
          and pg_get_constraintdef(oid) like '%soc_code%';")"
if [ "$C" = "1" ]; then
  ok "exactly ONE soc_code CHECK exists, not three"
else
  bad "expected 1 soc_code CHECK, found '$C'"
fi

echo
echo "═══════════════════════════════════════════════════════════════════════"
echo " RESULT: $pass passed, $fail failed"
echo "═══════════════════════════════════════════════════════════════════════"
if [ $fail -eq 0 ]; then echo "ALL CHECKS PASSED"; fi
[ $fail -eq 0 ]
