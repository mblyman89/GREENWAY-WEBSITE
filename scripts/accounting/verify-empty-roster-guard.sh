#!/usr/bin/env bash
# scripts/accounting/verify-empty-roster-guard.sh
# =============================================================================
# Proves migration 0206 (the empty-roster guard) actually works, by running it
# against a real, throwaway PostgreSQL database.
#
# Per AGENTS.md, Supabase migrations are applied MANUALLY by the owner in the
# SQL editor, so a migration that fails does so in his live database.
#
# This script executes 0172 -> 0205 -> 0206 for real, then:
#
#   1. proves the PRE-STATE is genuinely broken (standing rule 39d): BEFORE
#      0206, deleting every shareholder is ACCEPTED in silence. Without this
#      the rest proves nothing, because a guard that was never needed also
#      passes every test you can write for it.
#   2. proves that AFTER 0206 the same delete is REFUSED, the transaction rolls
#      back, and the rows are still there.
#   3. proves the SOFT version is refused too (update active = false), because
#      a guard that only watches DELETE is a guard with a doorway next to it.
#   4. proves TRUNCATE is refused, and reports WHICH mechanism refused it -
#      0206's own trigger or the pre-existing foreign key - rather than taking
#      credit for someone else's work.
#   5. proves 0206 does NOT break migration 0205, whose delete-then-insert
#      passes through a legitimately empty moment. This is the check that
#      failed for the naive statement-level design, which is why the shipped
#      design is a DEFERRED constraint trigger.
#   6. proves 0206 is idempotent by applying it three times.
#   7. proves the three NON-S-corp entities are unaffected: they have zero
#      shareholders legitimately and must never trip this alarm.
#   8. proves 0206 REFUSES TO INSTALL against data that is already empty,
#      rather than installing a guard that instantly contradicts the table.
#   9. proves the guard is not fooled by an inactive-but-present roster.
#
# Usage:    bash scripts/accounting/verify-empty-roster-guard.sh
# Requires: postgresql server binaries (initdb, pg_ctl, psql).
# Runs as root OR as an ordinary user: when root, the server-side commands drop
# to the postgres account, because initdb refuses to run as root (standing rule
# 104 - run the script the way the documentation says to run it).
# Touches nothing outside a temporary directory. Never connects to production.
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M0172="$REPO_ROOT/supabase/migrations/0172_gl_foundation.sql"
M0205="$REPO_ROOT/supabase/migrations/0205_shareholder_roster_correction.sql"
M0206="$REPO_ROOT/supabase/migrations/0206_ownership_requires_a_roster.sql"
HARNESS="$REPO_ROOT/scripts/accounting/gl-schema-harness.sql"

PGBIN="${PGBIN:-/usr/lib/postgresql/15/bin}"
PGPORT="${PGPORT:-5451}"
PGDATA_DIR="$(mktemp -d /tmp/emptyroster.XXXXXX)"
DB="empty_roster_verify"

# initdb refuses to run as root and this repository's containers run as root.
# Same pattern as every other verify script in this directory (rule 73 - do not
# invent a second yardstick).
if [ "$(id -u)" -eq 0 ]; then
  id postgres >/dev/null 2>&1 || { echo "running as root but there is no postgres user to drop to" >&2; exit 1; }
  chown -R postgres "$PGDATA_DIR"
  RUN=(su postgres -c)
else
  RUN=(bash -c)
fi
as_pg() { "${RUN[@]}" "$1"; }

PASS=0
FAIL=0
ok()   { PASS=$((PASS+1)); printf '  PASS  %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$1"; }
chk()  { if [ "$2" = "$3" ]; then ok "$1  ($2)"; else bad "$1  (got '$2', want '$3')"; fi; }

cleanup() {
  as_pg "$PGBIN/pg_ctl -D $PGDATA_DIR -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$PGDATA_DIR"
}
trap cleanup EXIT

echo "=== standing up PostgreSQL in $PGDATA_DIR (port $PGPORT) ==="
as_pg "$PGBIN/initdb -D $PGDATA_DIR -A trust" >/dev/null
as_pg "$PGBIN/pg_ctl -D $PGDATA_DIR -o '-p $PGPORT -k $PGDATA_DIR' -l $PGDATA_DIR/pg.log start" >/dev/null

ready=no
for _ in $(seq 1 30); do
  if as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -d postgres -Atc 'select 1'" >/dev/null 2>&1; then
    ready=yes; break
  fi
  sleep 1
done
if [ "$ready" != yes ]; then
  echo "the server never answered; log follows" >&2
  cat "$PGDATA_DIR/pg.log" >&2 || true
  exit 1
fi
as_pg "$PGBIN/createdb -h $PGDATA_DIR -p $PGPORT $DB" >/dev/null

SQLTMP="$PGDATA_DIR/stmt.sql"
OUT=""; RC=0
# Every statement goes through a file with ON_ERROR_STOP so the exit code is the
# STATEMENT's, never a pipeline's (rule 104).
sql() {
  printf '%s\n' "$1" > "$SQLTMP"; chmod 644 "$SQLTMP"
  set +e
  OUT="$(as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -d $DB -v ON_ERROR_STOP=1 -Atq -f $SQLTMP" 2>&1)"
  RC=$?
  set -e
}
val() {
  printf 'select %s;\n' "$1" > "$SQLTMP"; chmod 644 "$SQLTMP"
  as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -d $DB -Atq -f $SQLTMP" 2>/dev/null
}
apply() {
  set +e
  as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -d $DB -v ON_ERROR_STOP=1 -q -f '$1'" >/dev/null 2>&1
  local rc=$?
  set -e
  return $rc
}
saw() { echo "$OUT" | grep -qi "$1" && echo YES || echo NO; }

echo
echo "=== applying 0172 (foundation) and 0205 (the four-holder roster) ==="
as_pg "$PGBIN/psql -h $PGDATA_DIR -p $PGPORT -d $DB -q -f '$HARNESS'" >/dev/null 2>&1 || true
apply "$M0172" || { echo "0172 failed to apply" >&2; exit 1; }
apply "$M0205" || { echo "0205 failed to apply" >&2; exit 1; }
chk "greenway starts with the four filed shareholders" "$(val "count(*) from gl_shareholders s join gl_entities e on e.id=s.entity_id where e.code='greenway' and s.active")" "4"

echo
echo "--- CHECK 1: the PRE-STATE really is broken (rule 39d) ---"
echo "    Before 0206, emptying the roster must be ACCEPTED. If this fails, the"
echo "    gap does not exist and 0206 is solving an imaginary problem."
sql "delete from gl_shareholders;"
chk "BEFORE 0206, deleting every shareholder is accepted" "$RC" "0"
chk "and the roster really is empty" "$(val "count(*) from gl_shareholders")" "0"
echo "    ^^ that is the hole: GROUP BY over zero rows yields zero groups, and"
echo "       HAVING cannot reject a group that does not exist."

echo
echo "--- rebuild the roster, then install 0206 ---"
apply "$M0205" || { echo "0205 could not rebuild the roster" >&2; exit 1; }
chk "roster rebuilt" "$(val "count(*) from gl_shareholders where active")" "4"
apply "$M0206" || { echo "0206 failed to apply" >&2; exit 1; }
chk "0206 installed its row-level constraint trigger" \
    "$(val "count(*) from pg_trigger where tgrelid='public.gl_shareholders'::regclass and tgname='trg_gl_shareholders_not_empty'")" "1"
chk "0206 installed its truncate trigger" \
    "$(val "count(*) from pg_trigger where tgrelid='public.gl_shareholders'::regclass and tgname='trg_gl_shareholders_not_empty_truncate'")" "1"

echo
echo "--- CHECK 2: AFTER 0206 the same delete must be REFUSED ---"
sql "delete from gl_shareholders;"
chk "hard delete of every shareholder is refused" "$RC" "3"
chk "and it refused with GL_ROSTER_EMPTY" "$(saw GL_ROSTER_EMPTY)" "YES"
chk "and the transaction rolled back - the holders are still there" "$(val "count(*) from gl_shareholders where active")" "4"

echo
echo "--- CHECK 3: the SOFT version must be refused too ---"
echo "    A guard that only watches DELETE has a doorway next to it: set every"
echo "    row active=false and the roster is empty by every query that matters."
sql "update gl_shareholders set active = false;"
chk "soft-deleting every shareholder is refused" "$RC" "3"
chk "and it refused with GL_ROSTER_EMPTY" "$(saw GL_ROSTER_EMPTY)" "YES"
chk "and all four are still active" "$(val "count(*) from gl_shareholders where active")" "4"

echo
echo "--- CHECK 4: TRUNCATE, and WHICH mechanism refuses it ---"
sql "truncate gl_shareholders;"
chk "truncate is refused" "$RC" "3"
if [ "$(saw GL_ROSTER_EMPTY)" = YES ]; then
  ok "refused by 0206's own truncate trigger"
else
  ok "refused by the pre-existing foreign key from gl_journal_lines, NOT by 0206"
  echo "      ^^ stated honestly: on this table a plain TRUNCATE never reaches"
  echo "         0206's trigger, because PostgreSQL rejects it first. The"
  echo "         truncate trigger exists for TRUNCATE ... CASCADE, tested next."
fi
sql "truncate gl_shareholders cascade;"
chk "truncate cascade is refused" "$RC" "3"
chk "and THAT one is 0206's truncate trigger" "$(saw GL_ROSTER_EMPTY)" "YES"
chk "and the holders survived" "$(val "count(*) from gl_shareholders where active")" "4"

echo
echo "--- CHECK 5: 0206 must NOT break 0205 (the design question) ---"
echo "    0205 does DELETE-then-INSERT in one transaction, so it is legitimately"
echo "    empty for a moment. A naive statement-level check breaks it. This is"
echo "    the whole reason the shipped guard is DEFERRED to commit."
if apply "$M0205"; then
  ok "0205 still applies cleanly under the guard"
else
  bad "0205 BROKE under the guard - the deferred design is not working"
fi
chk "and it landed the four filed shareholders" "$(val "count(*) from gl_shareholders where active")" "4"
chk "totalling exactly 100000 milli-percent" "$(val "coalesce(sum(ownership_milli_pct),0) from gl_shareholders where active")" "100000"

echo
echo "--- CHECK 6: 0206 is idempotent ---"
for n in 1 2 3; do
  if apply "$M0206"; then ok "0206 apply #$n clean"; else bad "0206 apply #$n failed"; fi
done
chk "still exactly one row-level guard trigger" \
    "$(val "count(*) from pg_trigger where tgrelid='public.gl_shareholders'::regclass and tgname='trg_gl_shareholders_not_empty'")" "1"
chk "roster untouched by re-application" "$(val "count(*) from gl_shareholders where active")" "4"

echo
echo "--- CHECK 7: the three non-S-corp entities must be unaffected ---"
echo "    They have zero shareholders CORRECTLY - a Schedule C business has an"
echo "    owner, not a roster. A false alarm here teaches Michael to ignore the"
echo "    alarm, which is worse than no alarm."
chk "atm/landholding/personal hold zero shareholders" \
    "$(val "count(*) from gl_shareholders s join gl_entities e on e.id=s.entity_id where e.code in ('atm','landholding','personal')")" "0"
sql "update gl_entities set description = description || ' ' where code = 'atm';"
chk "touching a non-S-corp entity raises nothing" "$RC" "0"
sql "insert into gl_shareholders(entity_id,name,ownership_milli_pct) select id,'Temp',100000 from gl_entities where code='atm';"
chk "and adding a holder to a Sch C entity is still governed by the SUM rule only" "$RC" "0"
sql "delete from gl_shareholders s using gl_entities e where s.entity_id=e.id and e.code='atm';"
chk "removing it again is permitted - no roster is required there" "$RC" "0"
chk "greenway is still intact throughout" "$(val "count(*) from gl_shareholders s join gl_entities e on e.id=s.entity_id where e.code='greenway' and s.active")" "4"

echo
echo "--- CHECK 8: 0206 must REFUSE TO INSTALL against already-empty data ---"
echo "    Installing a guard that the current data already violates just moves"
echo "    the discovery to the owner's live database."
sql "alter table gl_shareholders disable trigger trg_gl_shareholders_not_empty;
     alter table gl_shareholders disable trigger trg_gl_shareholders_sum;
     delete from gl_shareholders;"
chk "roster force-emptied with the guards disabled" "$RC" "0"
chk "it really is empty" "$(val "count(*) from gl_shareholders")" "0"
sql "drop trigger if exists trg_gl_shareholders_not_empty on gl_shareholders;
     drop trigger if exists trg_gl_shareholders_not_empty_truncate on gl_shareholders;"
chk "both guard triggers removed, so the install is starting from nothing" \
    "$(val "count(*) from pg_trigger where tgrelid='public.gl_shareholders'::regclass and tgname like 'trg_gl_shareholders_not_empty%'")" "0"
if apply "$M0206"; then
  bad "0206 installed itself over an empty roster - it should have refused"
else
  ok "0206 refuses to install when an S-corp roster is already empty"
fi
# THE QUESTION THAT FOUND A REAL BUG (rule 39a - the post-state is evidence too).
# It is not enough that the migration REFUSED. Ask what it LEFT BEHIND.
#
# The first draft of 0206 created its triggers and validated afterwards. Because
# each statement in a migration auto-commits, a refusal still left both triggers
# installed - the migration said "no" and did it anyway. This assertion is the
# one that caught it, and it is why 0206 now validates first and wraps the whole
# file in a single transaction.
chk "AND IT LEFT NOTHING BEHIND: zero guard triggers after a refused install" \
    "$(val "count(*) from pg_trigger where tgrelid='public.gl_shareholders'::regclass and tgname like 'trg_gl_shareholders_not_empty%'")" "0"
sql "alter table gl_shareholders enable trigger trg_gl_shareholders_sum;"

echo
echo "--- CHECK 9: an INACTIVE-only roster must not satisfy the guard ---"
echo "    Rows present but all active=false is emptiness wearing a disguise."
echo
echo "    WHY THIS SETUP DISABLES THE SUM TRIGGER FIRST. The first version of"
echo "    this check inserted one inactive 100% row and asserted rc=0. It got"
echo "    rc=3, and the honest reading was that MY CHECK was wrong, not the"
echo "    migration (rule 22a - a test is a suspect). Two reasons it failed:"
echo "    the pre-existing SUM trigger is statement-level and still armed, and"
echo "    at that moment 0206's own guard was still installed - because the"
echo "    refused install in check 8 had left it behind. That second reason was"
echo "    a genuine bug in 0206, now fixed. This setup states its assumptions."
sql "alter table gl_shareholders disable trigger trg_gl_shareholders_sum;"
chk "sum trigger parked so an inactive-only state can be constructed at all" "$RC" "0"
chk "no 0206 guard is installed right now" \
    "$(val "count(*) from pg_trigger where tgrelid='public.gl_shareholders'::regclass and tgname like 'trg_gl_shareholders_not_empty%'")" "0"
sql "insert into gl_shareholders(entity_id,name,ownership_milli_pct,active)
     select id,'Ghost Holder',100000,false from gl_entities where code='greenway';"
chk "an inactive-only row can be seeded while both guards are absent" "$RC" "0"
chk "greenway has a row but no ACTIVE row" "$(val "count(*) from gl_shareholders s join gl_entities e on e.id=s.entity_id where e.code='greenway'")" "1"
chk "and zero active" "$(val "count(*) from gl_shareholders s join gl_entities e on e.id=s.entity_id where e.code='greenway' and s.active")" "0"
if apply "$M0206"; then
  bad "0206 accepted a roster of inactive rows - it counts rows, not people"
else
  ok "0206 still refuses: inactive rows do not count as a roster"
fi
chk "and again it left nothing behind" \
    "$(val "count(*) from pg_trigger where tgrelid='public.gl_shareholders'::regclass and tgname like 'trg_gl_shareholders_not_empty%'")" "0"

echo
echo "--- restore to a good state and confirm the guard rides again ---"
sql "delete from gl_shareholders;
     alter table gl_shareholders enable trigger trg_gl_shareholders_sum;"
apply "$M0205" || true
apply "$M0206" || true
chk "final roster is the four filed shareholders" "$(val "count(*) from gl_shareholders where active")" "4"
sql "delete from gl_shareholders;"
chk "and emptying is refused once more" "$RC" "3"

echo
echo "=============================================="
printf 'checks passed: %s   failed: %s\n' "$PASS" "$FAIL"
if [ "$FAIL" -ne 0 ]; then
  echo "=== THERE ARE FAILURES ==="
  exit 1
fi
echo "=== ALL CHECKS PASSED ==="
