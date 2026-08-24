#!/usr/bin/env bash
# scripts/accounting/verify-shareholder-roster-fix.sh
# =============================================================================
# Proves migration 0205 (the shareholder roster correction) actually works, by
# running it against a real, throwaway PostgreSQL database.
#
# Per AGENTS.md, Supabase migrations are applied MANUALLY by the owner in the
# SQL editor, so a migration that fails does so in his live database. This
# script executes 0172 -> 0205 for real, then:
#
#   1. proves the PRE-STATE is the wrong three-person roster (standing rule 39d
#      - build the pre-state, not just a clean database; without this the test
#      proves nothing, because a correct roster inserted into an empty table
#      would also pass),
#   2. proves 0205 corrects it to the four filed shareholders,
#   3. applies 0205 TWICE to prove idempotency (standing rule 39a / 62a),
#   4. ATTACKS it: re-introduces the 85/10/5 roster and proves the identity
#      check refuses it even though it totals exactly 100%,
#   5. records a SECOND blind spot in the same trigger, found while writing
#      check 6: an EMPTY roster raises nothing either, because GROUP BY over
#      zero rows yields zero groups for HAVING to reject - and proves 0205
#      rebuilds from that state,
#   6. proves 0205's own entity-missing guard can actually fire, by deleting
#      the greenway entity for real (it cannot be renamed - see the note at
#      that block) and confirming the migration refuses and writes nothing.
#
# Usage:    bash scripts/accounting/verify-shareholder-roster-fix.sh
# Requires: postgresql server binaries (initdb, pg_ctl, psql).
# Runs as root OR as an ordinary user: when root, the server-side commands drop
# to the postgres account, because initdb refuses to run as root. Every one of
# the other verify scripts in this directory does the same.
# Touches nothing outside a temporary directory. Never connects to production.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M0172="$REPO_ROOT/supabase/migrations/0172_gl_foundation.sql"
M0205="$REPO_ROOT/supabase/migrations/0205_shareholder_roster_correction.sql"
HARNESS="$REPO_ROOT/scripts/accounting/gl-schema-harness.sql"

PGBIN="${PGBIN:-/usr/lib/postgresql/15/bin}"
PGPORT="${PGPORT:-5439}"
PGDATA_DIR="$(mktemp -d /tmp/rosterverify.XXXXXX)"
DB="roster_verify"

# WHO RUNS THE SERVER, AND WHY IT IS NOT WHOEVER RUNS THIS SCRIPT.
#
# initdb REFUSES to run as root ("cannot be run as root"), and this repository's
# containers run as root. The first draft of this script ignored that: it called
# initdb directly, which meant it could only ever have been run by hand as an
# unprivileged user, and running it the documented way - `bash
# scripts/accounting/verify-shareholder-roster-fix.sh` - died on line one. Worse,
# it died INSIDE a pipeline (`... | tail`), where the pipeline's exit status is
# tail's, so the failure could read as success to a careless eye.
#
# The other eleven verify scripts in this directory already solved this, so the
# fix is to use THEIR pattern rather than invent a twelfth (standing rule 73 -
# do not invent a second yardstick): drop to the postgres account for the
# SERVER-side commands only.
#
# Only initdb/pg_ctl/createdb need to drop privileges. psql is an ordinary
# client, so it keeps running as the invoking user and connects over TCP with
# trust auth. That keeps the array-form PSQL and the SQL heredocs below exactly
# as they are, instead of smuggling nested quotes through `su -c`, which is its
# own species of bug.
if [ "$(id -u)" -eq 0 ]; then
  id postgres >/dev/null 2>&1 || {
    echo "running as root but there is no postgres user to drop to" >&2
    exit 1
  }
  chown -R postgres "$PGDATA_DIR"
  RUN=(su postgres -c)
else
  RUN=(bash -c)
fi
as_pg() { "${RUN[@]}" "$1"; }

cleanup() {
  as_pg "$PGBIN/pg_ctl -D $PGDATA_DIR/data stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR" || true
}
trap cleanup EXIT

FAILURES=0
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "  PASS  $1  ($3)"
  else
    echo "  FAIL  $1  expected [$2] got [$3]"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "=== Greenway shareholder-roster correction verification ==="
for f in "$M0172" "$M0205" "$HARNESS"; do
  [ -f "$f" ] || { echo "MISSING: $f" >&2; exit 1; }
done

echo "--- starting throwaway PostgreSQL on port $PGPORT ---"
as_pg "$PGBIN/initdb -D $PGDATA_DIR/data -U postgres --auth=trust" >/dev/null
as_pg "$PGBIN/pg_ctl -D $PGDATA_DIR/data -o '-p $PGPORT -c listen_addresses=localhost' -l $PGDATA_DIR/pg.log start" >/dev/null

PSQL=("$PGBIN/psql" -h localhost -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q)

# DO NOT `sleep 2` AND HOPE. A fixed sleep is a guess about a machine's speed,
# and on the day it is wrong every check below reports a connection error that
# nobody reads as "the server never came up". Poll for a server that actually
# answers a query, and if it never does, print the server log and stop.
echo "--- waiting for the server to answer a real query ---"
UP=0
for _ in $(seq 1 30); do
  if "${PSQL[@]}" -d postgres -c "select 1" >/dev/null 2>&1; then UP=1; break; fi
  sleep 1
done
if [ "$UP" -ne 1 ]; then
  echo "!!! the throwaway server never accepted a connection on port $PGPORT" >&2
  echo "--- server log ---" >&2
  cat "$PGDATA_DIR/pg.log" >&2 2>/dev/null || true
  exit 1
fi
echo "      ok"

"${PSQL[@]}" -d postgres -c "create database $DB;" >/dev/null

q() { "${PSQL[@]}" -d "$DB" -t -A -c "$1"; }

# Reuse the EXISTING harness rather than hand-rolling a weaker set of stubs: it
# is the same auth schema, roles and helpers that verify-gl-schema.sh proves
# 0172 against, so this script cannot pass on a more forgiving environment than
# the one already in use (standing rule 73 - do not invent a second yardstick).
"${PSQL[@]}" -d "$DB" -f "$HARNESS" >/dev/null

echo
echo "--- applying 0172 (creates the WRONG pre-state) ---"
"${PSQL[@]}" -d "$DB" -f "$M0172" >/dev/null 2>&1 || {
  echo "0172 failed to apply; see below" >&2
  "${PSQL[@]}" -d "$DB" -f "$M0172" 2>&1 | tail -20 >&2
  exit 1
}

# ---------------------------------------------------------------------------
# 1) THE PRE-STATE. Without this, the test is vacuous (standing rule 39d).
# ---------------------------------------------------------------------------
echo
echo "--- PRE-STATE: the roster 0172 seeded ---"
q "select name || ' ' || ownership_milli_pct from public.gl_shareholders order by ownership_milli_pct desc, name;" | sed 's/^/      /'
check "pre-state row count is 3 (the bug)" "3" "$(q "select count(*) from public.gl_shareholders;")"
check "pre-state has a 10% holder (the bug)" "1" "$(q "select count(*) from public.gl_shareholders where ownership_milli_pct = 10000;")"
check "pre-state has a row literally named 'Mother'" "1" "$(q "select count(*) from public.gl_shareholders where name = 'Mother';")"
check "pre-state has NO step-father" "0" "$(q "select count(*) from public.gl_shareholders where name = 'James H Becker';")"
# THE FINDING: the wrong roster balances.
check "pre-state nevertheless totals exactly 100000" "100000" "$(q "select sum(ownership_milli_pct) from public.gl_shareholders;")"

# ---------------------------------------------------------------------------
# 2) APPLY THE CORRECTION.
# ---------------------------------------------------------------------------
echo
echo "--- applying 0205 (pass 1) ---"
"${PSQL[@]}" -d "$DB" -f "$M0205" 2>&1 | grep -i notice | sed 's/^/      /' || true

echo
echo "--- POST-STATE ---"
q "select name || ' | ' || relationship || ' | ' || ownership_milli_pct || ' | paid=' || receives_distributions from public.gl_shareholders order by ownership_milli_pct desc, name;" | sed 's/^/      /'

check "row count is now 4" "4" "$(q "select count(*) from public.gl_shareholders;")"
check "total is exactly 100000" "100000" "$(q "select sum(ownership_milli_pct) from public.gl_shareholders where active is true;")"
check "nobody is at 10%" "0" "$(q "select count(*) from public.gl_shareholders where ownership_milli_pct = 10000;")"
check "exactly three 5% holders" "3" "$(q "select count(*) from public.gl_shareholders where ownership_milli_pct = 5000;")"
check "Michael B Lyman at 85000" "85000" "$(q "select ownership_milli_pct from public.gl_shareholders where name = 'Michael B Lyman';")"
check "Nicholas C Mullan at 5000" "5000" "$(q "select ownership_milli_pct from public.gl_shareholders where name = 'Nicholas C Mullan';")"
check "James H Becker at 5000" "5000" "$(q "select ownership_milli_pct from public.gl_shareholders where name = 'James H Becker';")"
check "Theresa L Becker at 5000" "5000" "$(q "select ownership_milli_pct from public.gl_shareholders where name = 'Theresa L Becker';")"
check "no row named 'Mother' survives" "0" "$(q "select count(*) from public.gl_shareholders where name = 'Mother';")"
check "no spouse added as a fifth holder" "0" "$(q "select count(*) from public.gl_shareholders where name ilike '%Alyssa%';")"
check "the K-1 count question answers 4" "4" "$(q "select count(*) from public.gl_shareholders where entity_id = (select id from public.gl_entities where code='greenway');")"

# ---------------------------------------------------------------------------
# 3) IDEMPOTENCY (standing rule 39a: apply TWICE).
# ---------------------------------------------------------------------------
echo
echo "--- applying 0205 (pass 2 - idempotency) ---"
"${PSQL[@]}" -d "$DB" -f "$M0205" 2>&1 | grep -i notice | sed 's/^/      /' || true
check "still 4 rows after a second apply" "4" "$(q "select count(*) from public.gl_shareholders;")"
check "still totals 100000" "100000" "$(q "select sum(ownership_milli_pct) from public.gl_shareholders where active is true;")"
check "no duplicate names" "4" "$(q "select count(distinct name) from public.gl_shareholders;")"

echo "--- applying 0205 (pass 3 - because twice can hide an alternating bug) ---"
"${PSQL[@]}" -d "$DB" -f "$M0205" >/dev/null 2>&1
check "still 4 rows after a third apply" "4" "$(q "select count(*) from public.gl_shareholders;")"

# ---------------------------------------------------------------------------
# 4) ATTACK IT (standing rule 39b). The migration's own identity check must
#    refuse the historical wrong roster - which TOTALS 100%, so the existing
#    trigger cannot.
# ---------------------------------------------------------------------------
echo
echo "--- ATTACK: re-introduce the 85/10/5 roster and re-run 0205 ---"
"${PSQL[@]}" -d "$DB" >/dev/null <<'SQL'
do $$
declare v_id uuid;
begin
  select id into v_id from public.gl_entities where code = 'greenway';
  delete from public.gl_shareholders where entity_id = v_id;
  insert into public.gl_shareholders (entity_id, name, relationship, ownership_milli_pct, receives_distributions)
  values (v_id, 'Michael Lyman', 'owner', 85000, true),
         (v_id, 'Mother', 'mother', 10000, false),
         (v_id, 'Nicholas Mullan', 'grandfather', 5000, true);
end $$;
SQL
check "attack pre-state is 3 rows" "3" "$(q "select count(*) from public.gl_shareholders;")"
check "attack pre-state PASSES the 100% trigger" "100000" "$(q "select sum(ownership_milli_pct) from public.gl_shareholders where active is true;")"
echo "      ^^ the wrong roster balances, which is why the total check never caught it"
"${PSQL[@]}" -d "$DB" -f "$M0205" >/dev/null 2>&1
check "0205 re-corrects it to 4" "4" "$(q "select count(*) from public.gl_shareholders;")"
check "and the 10% holder is gone" "0" "$(q "select count(*) from public.gl_shareholders where ownership_milli_pct = 10000;")"

# ---------------------------------------------------------------------------
# 5) A SECOND BLIND SPOT IN THE SAME TRIGGER, found while building attack 6.
#
#    gl_assert_ownership_sums() reads:
#        select e.code, sum(s.ownership_milli_pct) ... group by e.code
#        having sum(s.ownership_milli_pct) <> 100000
#
#    GROUP BY over zero rows produces zero groups, so HAVING has nothing to
#    reject and the trigger raises nothing. Deleting every shareholder of an
#    entity is therefore ALLOWED. That is the same shape of hole as the 85/10/5
#    roster: the trigger polices the total of the rows that exist, and is blind
#    both to WHO they are and to THERE BEING NONE.
#
#    This is asserted here, not assumed. If a future migration tightens the
#    trigger to reject an empty roster, this check fails loudly and tells the
#    next reader the hole was closed - which is the point (standing rule 87:
#    assert absence AS absence, and 66d: assert what IS there beside it).
# ---------------------------------------------------------------------------
echo
echo "--- PROBE: can the ownership trigger even see an EMPTY roster? ---"
set +e
DEL_OUT="$("${PSQL[@]}" -d "$DB" -c "delete from public.gl_shareholders where entity_id = (select id from public.gl_entities where code='greenway');" 2>&1)"
DEL_RC=$?
set -e
check "deleting ALL 4 holders is permitted (rc=0) - the trigger is blind to zero rows" "0" "$DEL_RC"
check "and the roster really is empty now" "0" "$(q "select count(*) from public.gl_shareholders;")"
check "while the other three entities are untouched" "3" "$(q "select count(*) from public.gl_entities where code <> 'greenway';")"
if [ -n "$DEL_OUT" ]; then echo "      (delete said: $DEL_OUT)"; fi
echo "      ^^ zero rows => zero groups => HAVING rejects nothing. Recorded, not fixed"
echo "         here: widening that trigger is a schema change and a separate slice"
echo "         (standing rule 4, one feature per PR)."

# 0205 must repair even a completely emptied roster, since that state is now
# proven reachable without any error being raised.
echo "--- and 0205 must rebuild the roster from EMPTY ---"
"${PSQL[@]}" -d "$DB" -f "$M0205" >/dev/null 2>&1
check "0205 rebuilt all 4 holders from an empty table" "4" "$(q "select count(*) from public.gl_shareholders;")"
check "totalling 100000 again" "100000" "$(q "select sum(ownership_milli_pct) from public.gl_shareholders where active is true;")"

# ---------------------------------------------------------------------------
# 6) Prove the migration's OWN guard can fail (standing rule 15: a check that
#    has never been seen to fail is not known to work).
#
#    NOTE ON METHOD. The obvious way to remove the greenway entity is to rename
#    it - and that is IMPOSSIBLE, not merely awkward: gl_entities.code carries
#      check (code in ('greenway','atm','landholding','personal'))
#    so 'greenway_renamed' is rejected by gl_entities_code_check before 0205 is
#    ever reached. The row must actually be DELETED, and every FK into
#    gl_entities is `on delete restrict`, so its dependents must go first. After
#    0172 the greenway entity is referenced by 12 gl_periods rows and 1
#    gl_journal_sequences row (enumerated from pg_constraint, not guessed).
# ---------------------------------------------------------------------------
echo
echo "--- ATTACK: run 0205 with no greenway entity; it must REFUSE ---"

# Show that RESTRICT is real, so the delete order below is justified rather
# than superstitious.
set +e
RESTRICT_OUT="$("${PSQL[@]}" -d "$DB" -c "delete from public.gl_entities where code='greenway';" 2>&1)"
RESTRICT_RC=$?
set -e
if [ "$RESTRICT_RC" -ne 0 ] && echo "$RESTRICT_OUT" | grep -q "violates foreign key constraint"; then
  echo "  PASS  deleting the entity outright is blocked by RESTRICT, as expected"
else
  echo "  FAIL  expected a foreign-key RESTRICT; rc=$RESTRICT_RC out=$(echo "$RESTRICT_OUT" | tail -1)"
  FAILURES=$((FAILURES + 1))
fi

"${PSQL[@]}" -d "$DB" >/dev/null <<'SQL'
begin;
delete from public.gl_shareholders      where entity_id = (select id from public.gl_entities where code = 'greenway');
delete from public.gl_periods           where entity_id = (select id from public.gl_entities where code = 'greenway');
delete from public.gl_journal_sequences where entity_id = (select id from public.gl_entities where code = 'greenway');
delete from public.gl_entities          where code = 'greenway';
commit;
SQL
check "the greenway entity is really gone" "0" "$(q "select count(*) from public.gl_entities where code = 'greenway';")"

set +e
OUT="$("$PGBIN/psql" -h localhost -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -d "$DB" -f "$M0205" 2>&1)"
RC=$?
set -e
if [ "$RC" -ne 0 ] && echo "$OUT" | grep -q "GL_ROSTER_FIX: no entity with code"; then
  echo "  PASS  refused with the entity-missing GL_ROSTER_FIX and a non-zero exit ($RC)"
else
  echo "  FAIL  expected a GL_ROSTER_FIX entity-missing refusal; rc=$RC out=$(echo "$OUT" | tail -2)"
  FAILURES=$((FAILURES + 1))
fi
# It must refuse by REFUSING, not by writing something and then complaining.
check "and it wrote nothing while refusing" "0" "$(q "select count(*) from public.gl_shareholders;")"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "=== ALL CHECKS PASSED ==="
  exit 0
fi
echo "=== $FAILURES CHECK(S) FAILED ==="
exit 1
