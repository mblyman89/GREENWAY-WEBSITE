#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# TEST THE TEST: do the migration proofs actually tell an ENVIRONMENT problem
# apart from a MIGRATION defect, or do they just contain text that says they
# would?
#
# WHY THIS SCRIPT EXISTS
# ----------------------
# Slice A changed one thing in prove-0223..0229-executes.sh: the drop/create/
# teardown calls now pass `-d postgres`, and a refusal gate stops the run if
# the scratch database is not actually there.
#
# That was not a hypothetical repair. After a sandbox restart, the Postgres
# role named after the invoking user disappeared. `psql -c "create database X"`
# with no `-d` connects to a database named after the invoking user, so the
# create never happened -- and the proof then ran its entire checklist against
# a database that did not exist and reported "0 passed, 43 failed". It blamed
# the migration for a problem the migration cannot cause. Five of the six
# sibling scripts were worse: they printed FAILED and still exited 0.
#
# A safety net nobody has watched catch anything is decoration. So this script
# breaks the ENVIRONMENT on purpose -- never the migration, never the SQL --
# and asserts the proofs respond correctly.
#
# THE THREE THINGS BEING ASSERTED, AND WHY EACH ONE IS A SEPARATE TEST
# --------------------------------------------------------------------
#
#   1. IMMUNITY (sabotage: PGDATABASE=<a database that does not exist>)
#      This is the EXACT historical trigger, reproduced. PGDATABASE is what
#      psql falls back to when a command has no `-d`. A patched script passes
#      `-d postgres` explicitly, which overrides PGDATABASE, so it must be
#      completely UNAFFECTED: exit 0, full verdict, no failures. An unpatched
#      script has no `-d`, inherits the ghost database, and produces a false
#      verdict about the migration.
#      Expected: exit 0, verdict rendered, zero failures.
#
#   2. REFUSAL (sabotage: PGPORT=1 -- there is no server on port 1)
#      Immunity is not enough. When the environment is genuinely unusable, the
#      proof must REFUSE rather than soldier on. `-d postgres` cannot save a
#      run when nothing is reachable at all, and that is precisely when the
#      gate has to fire.
#      Expected: exit 2, the words "ENVIRONMENT" and "nothing about ... proven",
#      and CRUCIALLY no migration verdict of any kind.
#
#   3. NO FALSE ALARM (no sabotage at all)
#      A gate that refuses everything would "pass" tests 1 and 2 while
#      silently switching every proof in the repo off. That failure is quieter
#      and more dangerous than the bug being fixed, so it gets its own check.
#      Expected: exit 0, verdict rendered, zero failures.
#
# WHY EXIT 2
# ----------
# 0 = proved. 1 = a real failure. 2 = NOT PROVEN. Three genuinely different
# outcomes deserve three different codes; collapsing "not proven" into either
# neighbour is how the original bug read as a migration defect.
#
# AN EXIT-CODE COLLISION WORTH KNOWING ABOUT
# ------------------------------------------
# `psql` ALSO exits 2 when it cannot connect (verified: `PGPORT=1 psql -d
# postgres -c "select 1"` returns 2). Five of these seven scripts -- 0223,
# 0224, 0225, 0226 and 0227 -- end without an explicit `exit`, so their exit
# status is whatever their LAST command returned. A broken environment can
# therefore make one of them exit 2 BY ACCIDENT, with no gate involved and no
# explanation printed.
#
# That is why TEST 2 below never trusts the exit code on its own. It also
# demands the script SAID it was an environment problem, SAID nothing was
# proven, and rendered NO verdict. Verified during development: a 0226 with
# its gate stripped out exits 2 in a healthy environment purely by accident,
# and this harness correctly rejects it with "exited 2 but never said it was
# an environment problem". An assertion on the number alone would have passed
# that broken script.
#
# The missing `exit` accounting in 0223-0227 is a REAL, SEPARATE defect, and
# it is deliberately NOT fixed in this slice. The owner asked for the bare
# `psql -c` defect to be brought back into scope; quietly expanding that into
# a rewrite of five migration harnesses would be its own dishonesty, and an
# unreviewed change to the thing that JUDGES migrations is not a favour.
#
# It is pinned, with the exact file list, in:
#   tests/compliance/proof-env-gate.test.ts
#     -> "the known, deliberately unfixed defect stays visible"
# so it cannot quietly drop out of view. 0228 and 0229 (`exit "$FAIL"`) are
# the model to copy whenever that work is scheduled.
#
# THIS SCRIPT'S OWN HONESTY CHECKS
# --------------------------------
# v1 of this file reported 8 failures that were all defects in ITSELF: it
# sabotaged by overriding DB= with an 80-character name, assuming PostgreSQL
# would refuse it. PostgreSQL silently TRUNCATES over-long identifiers to 63
# bytes and creates the database anyway, so the "sabotage" sabotaged nothing
# and the gate was never exercised. A test that cannot prove its own sabotage
# landed is worth less than no test, because it manufactures confidence.
#
# So before asserting anything, this script proves each sabotage actually
# bites (SELF-CHECK below), and it runs the pre-fix script from git as a
# control to prove the sabotage can still fail something. If the control
# passes, the sabotage has gone toothless and this script says so loudly
# instead of printing green.
#
# Usage:  bash scripts/compliance/sabotage-proof-env-gate.sh
# Requires: a working local PostgreSQL (the same one the proofs need).
# ---------------------------------------------------------------------------
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

PROOFS=(0223 0224 0225 0226 0227 0228 0229)
PASS=0
FAIL=0

# A database name that must not exist. Deliberately ugly so it cannot collide
# with anything real, and asserted absent below rather than assumed absent.
GHOST="zzz_no_such_db_for_sabotage"

say() { printf '%s\n' "$*"; }
ok()   { say "  ok   $*"; PASS=$((PASS + 1)); }
bad()  { say "  *** FAIL $* ***"; FAIL=$((FAIL + 1)); }

# How long a single proof may take. Each takes ~8s on an idle box; the ceiling
# is for a loaded one.
PROOF_TIMEOUT=300

# `timeout` reports 124 when it kills the command. That is NOT the proof
# failing -- it is this machine being too busy to run it, which is an
# environment problem with THIS HARNESS.
#
# This is not hypothetical. During development a run reported "37 passed, 1
# failed" purely because a 16,431-test vitest sweep was running on the same
# two cores; three consecutive runs afterwards were clean. A harness built to
# stop false verdicts must not emit one about itself, so a timeout is reported
# as NOT PROVEN and counted separately from a real failure.
TIMEDOUT=0
timed_out() {
  say "  note ${1}: timed out after ${PROOF_TIMEOUT}s, so nothing is claimed"
  say "       about it. This machine was too busy, which is an environment"
  say "       problem with this harness -- re-run when it is idle."
  TIMEDOUT=$((TIMEDOUT + 1))
}

# A migration verdict of ANY kind. Every proof prints "applied N, failed M"
# after it applies the migration set; 0228/0229 add a "PROOF: N passed" line
# and 0225 ends with "proof complete". Matching all of them means "this script
# reached a conclusion about the migration".
VERDICT_RE='^applied [0-9]+, failed|PROOF: [0-9]+ passed|proof complete|APPLIES, RE-APPLIES'
# A CLEAN verdict: applied everything, failed nothing. Common to all seven.
CLEAN_RE='^applied [0-9]+, failed 0'

say "========================================================================"
say "  SABOTAGING THE ENVIRONMENT, NOT THE MIGRATION"
say "  A proof that cannot tell a broken environment from a broken"
say "  migration is not a proof."
say "========================================================================"
say

# ---------------------------------------------------------------------------
# SELF-CHECK: prove the sabotage mechanisms actually bite.
# v1 shipped a sabotage that did nothing. Never again without evidence.
# ---------------------------------------------------------------------------
say "--- SELF-CHECK: does the sabotage actually sabotage? -------------------"

if ! psql -d postgres -tAc "select 1" >/dev/null 2>&1; then
  say "  FATAL: no usable PostgreSQL on the default connection."
  say "  This script cannot test anything. That is an environment problem"
  say "  with THIS SCRIPT, and nothing has been proven or disproven."
  exit 2
fi
ok "baseline: a healthy psql connection exists to compare against"

if [ "$(psql -d postgres -tAc "select count(*) from pg_database where datname = '$GHOST';")" != "0" ]; then
  say "  FATAL: '$GHOST' unexpectedly EXISTS, so sabotage 1 would be vacuous."
  exit 2
fi
ok "sabotage 1 precondition: '$GHOST' genuinely does not exist"

# The heart of the matter, asserted rather than believed: with PGDATABASE set
# to a ghost, a bare psql FAILS and a psql WITH `-d postgres` SUCCEEDS. That
# difference is the entire fix, demonstrated in two lines.
if PGDATABASE="$GHOST" psql -tAc "select 1" >/dev/null 2>&1; then
  bad "sabotage 1 is toothless: a bare psql still connected under PGDATABASE=$GHOST"
else
  ok "sabotage 1 bites: a bare psql cannot connect (this WAS the bug)"
fi

if PGDATABASE="$GHOST" psql -d postgres -tAc "select 1" >/dev/null 2>&1; then
  ok "and '-d postgres' is the antidote: it connects anyway (this IS the fix)"
else
  bad "'-d postgres' did not survive PGDATABASE -- the premise of the fix is wrong"
fi

if PGPORT=1 psql -d postgres -tAc "select 1" >/dev/null 2>&1; then
  bad "sabotage 2 is toothless: something answered on port 1"
else
  ok "sabotage 2 bites: nothing is reachable on port 1, not even with -d"
fi

# Record the originals so we can prove this script never edited them.
declare -A SHA_BEFORE
for tag in "${PROOFS[@]}"; do
  f="scripts/compliance/prove-${tag}-executes.sh"
  if [ ! -f "$f" ]; then
    bad "${f} does not exist"
    continue
  fi
  SHA_BEFORE["$tag"]="$(sha256sum "$f" | awk '{print $1}')"
done

# Static precondition: the gate must be PRESENT before we test that it fires.
# Without this, a script that lost its gate could "pass" the refusal test by
# crashing for some unrelated reason and happening to exit 2.
for tag in "${PROOFS[@]}"; do
  f="scripts/compliance/prove-${tag}-executes.sh"
  [ -f "$f" ] || continue
  if grep -q 'ENVIRONMENT' "$f" && grep -qi 'nothing about' "$f" && grep -q 'exit 2' "$f"; then
    ok "${tag}: the refusal gate is present in the source"
  else
    bad "${tag}: no refusal gate found in ${f} -- the runtime tests below would be vacuous"
  fi
done

say
# ---------------------------------------------------------------------------
# TEST 1 -- IMMUNITY. The historical trigger, reproduced exactly.
# ---------------------------------------------------------------------------
say "--- TEST 1: IMMUNE to PGDATABASE=$GHOST (the original bug) -------------"
say "    A patched proof passes '-d postgres', so this must not affect it."

for tag in "${PROOFS[@]}"; do
  script="scripts/compliance/prove-${tag}-executes.sh"
  [ -f "$script" ] || continue

  out="$(PGDATABASE="$GHOST" timeout "$PROOF_TIMEOUT" bash "$script" 2>&1)"
  rc=$?

  if [ "$rc" -eq 124 ]; then
    timed_out "${tag}"
    continue
  fi
  if [ "$rc" -ne 0 ]; then
    bad "${tag}: expected exit 0 (unaffected), got ${rc}"
    printf '%s\n' "$out" | tail -4 | sed 's/^/        /'
    continue
  fi
  if ! printf '%s\n' "$out" | grep -qE "$CLEAN_RE"; then
    bad "${tag}: exited 0 but never rendered a clean verdict"
    continue
  fi
  if printf '%s\n' "$out" | grep -q '\*\*\* FAIL'; then
    bad "${tag}: exited 0 but printed failures"
    printf '%s\n' "$out" | grep '\*\*\* FAIL' | head -3 | sed 's/^/        /'
    continue
  fi
  ok "${tag}: completely unaffected by the ghost database"
done

say
# ---------------------------------------------------------------------------
# TEST 2 -- REFUSAL. Environment genuinely unusable.
# ---------------------------------------------------------------------------
say "--- TEST 2: REFUSES when nothing is reachable (PGPORT=1) ---------------"
say "    Must exit 2, say it is an environment problem, and judge NOTHING."

for tag in "${PROOFS[@]}"; do
  script="scripts/compliance/prove-${tag}-executes.sh"
  [ -f "$script" ] || continue

  out="$(PGPORT=1 timeout "$PROOF_TIMEOUT" bash "$script" 2>&1)"
  rc=$?

  if [ "$rc" -eq 124 ]; then
    timed_out "${tag}"
    continue
  fi
  if [ "$rc" -ne 2 ]; then
    bad "${tag}: expected exit 2 (not proven), got ${rc}"
    printf '%s\n' "$out" | tail -4 | sed 's/^/        /'
    continue
  fi
  # 0223-0228 print "This is an ENVIRONMENT problem" on one line; 0229 wraps
  # it across two. Matching the single word survives both wordings.
  if ! printf '%s\n' "$out" | grep -q 'ENVIRONMENT'; then
    bad "${tag}: exited 2 but never said it was an environment problem"
    continue
  fi
  if ! printf '%s\n' "$out" | grep -qi 'nothing about'; then
    bad "${tag}: exited 2 but never said nothing had been proven"
    continue
  fi
  # The whole point. The old behaviour was a confident, wrong verdict.
  if printf '%s\n' "$out" | grep -qE "$VERDICT_RE"; then
    bad "${tag}: rendered a migration verdict despite a dead environment"
    printf '%s\n' "$out" | grep -E "$VERDICT_RE" | head -2 | sed 's/^/        /'
    continue
  fi
  ok "${tag}: refused, named it an environment problem, judged nothing, exit 2"
done

say
# ---------------------------------------------------------------------------
# TEST 3 -- NO FALSE ALARM. Nothing sabotaged.
# ---------------------------------------------------------------------------
say "--- TEST 3: still PROVES things when the environment is fine -----------"
say "    Guards the opposite failure: a gate that refuses everything."

for tag in "${PROOFS[@]}"; do
  script="scripts/compliance/prove-${tag}-executes.sh"
  [ -f "$script" ] || continue

  out="$(timeout "$PROOF_TIMEOUT" bash "$script" 2>&1)"
  rc=$?

  if [ "$rc" -eq 124 ]; then
    timed_out "${tag}"
    continue
  fi
  if [ "$rc" -ne 0 ]; then
    bad "${tag}: healthy environment, expected exit 0, got ${rc}"
    printf '%s\n' "$out" | tail -4 | sed 's/^/        /'
    continue
  fi
  if ! printf '%s\n' "$out" | grep -qE "$CLEAN_RE"; then
    bad "${tag}: healthy environment but no clean verdict -- gate may be over-firing"
    continue
  fi
  if printf '%s\n' "$out" | grep -q 'ENVIRONMENT'; then
    bad "${tag}: healthy environment but the refusal gate fired anyway"
    continue
  fi
  ok "${tag}: proved the migration normally"
done

say
# ---------------------------------------------------------------------------
# CONTROL -- does TEST 1 still have teeth?
# ---------------------------------------------------------------------------
say "--- CONTROL: the PRE-FIX code must still produce the FALSE VERDICT -----"
say "    If the old code passed too, TEST 1 would prove nothing about the"
say "    fix. This rebuilds the bug and confirms it is still catchable."

CONTROL="$(mktemp /tmp/control-prefix-XXXXXX.sh)"
STRIPPER="$(mktemp /tmp/control-strip-XXXXXX.awk)"

# Rebuild the pre-fix harness by un-doing EXACTLY what Slice A added, and
# nothing else:
#   (a) delete the refusal gate block, and
#   (b) take `-d postgres` back off the drop/create lines.
# awk is used rather than a multi-line sed so the block boundaries are
# explicit and the deletion cannot silently run away to the end of the file.
cat > "$STRIPPER" <<'AWK'
/^if ! psql -d "\$DB" -tAc "select 1"/ { skip=1; next }
skip && /^fi$/                         { skip=0; next }
skip                                   { next }
                                       { print }
AWK
awk -f "$STRIPPER" scripts/compliance/prove-0228-executes.sh > "$CONTROL"
sed -E -i 's/^psql -q -d postgres -c "(drop|create) database/psql -q -c "\1 database/' "$CONTROL"

# Prove the reconstruction actually reconstructed the bug before trusting it.
if grep -q '^if ! psql -d "\$DB" -tAc "select 1"' "$CONTROL"; then
  bad "control still contains the refusal gate -- reconstruction failed"
elif ! grep -q '^psql -q -c "create database' "$CONTROL"; then
  bad "control still passes -d on create -- reconstruction failed"
elif ! bash -n "$CONTROL" 2>/dev/null; then
  bad "control is not valid bash -- reconstruction mangled the script"
else
  ok "control rebuilt: refusal gate removed, '-d postgres' removed"

  out="$(PGDATABASE="$GHOST" timeout "$PROOF_TIMEOUT" bash "$CONTROL" 2>&1)"
  rc=$?

  if [ "$rc" -eq 0 ]; then
    bad "the PRE-FIX code survived sabotage 1 -- TEST 1 is toothless, not passing"
  else
    ok "pre-fix code broke under sabotage 1 (exit ${rc}) -- TEST 1 has teeth"
  fi

  # The real indictment, and the reason this whole slice exists. The old code
  # did not merely fail; it announced a CONFIDENT, WRONG conclusion about the
  # migration. Asserting the false verdict is present in the control is what
  # proves the patched scripts' silence in TEST 2 is meaningful.
  if printf '%s\n' "$out" | grep -qE "$VERDICT_RE"; then
    ok "pre-fix code rendered a FALSE migration verdict: $(printf '%s\n' "$out" | grep -E '^ +0228 PROOF' | head -1 | sed 's/^ *//')"
  else
    bad "pre-fix code did not render a false verdict -- the bug is not reproduced"
  fi
fi
rm -f "$CONTROL" "$STRIPPER"

say
# ---------------------------------------------------------------------------
# CONTROL 2 -- exit 2 alone must NOT be accepted as a refusal.
# ---------------------------------------------------------------------------
say "--- CONTROL 2: an ACCIDENTAL exit 2 must not count as a refusal --------"
say "    psql also exits 2 when it cannot connect, and 0223-0227 end with no"
say "    explicit exit. So a gate-less script can exit 2 by pure accident."
say "    TEST 2 must reject that, or it would be passing on a coincidence."

C2="scripts/compliance/_tmp-control2-0226.sh"
S2="$(mktemp /tmp/control2-strip-XXXXXX.awk)"
cat > "$S2" <<'AWK'
/^if ! psql -d "\$DB" -tAc "select 1"/ { skip=1; next }
skip && /^fi$/                         { skip=0; next }
skip                                   { next }
                                       { print }
AWK
# Built INSIDE scripts/compliance, not /tmp: these harnesses resolve the
# migrations directory relative to their own location, and a copy in /tmp
# silently finds no migrations and proves nothing.
awk -f "$S2" scripts/compliance/prove-0226-executes.sh > "$C2"
sed -E -i 's/^psql -q -d postgres -c "(drop|create) database/psql -q -c "\1 database/' "$C2"

if grep -q '^if ! psql -d "\$DB" -tAc "select 1"' "$C2"; then
  bad "control 2 still contains the refusal gate -- reconstruction failed"
else
  out="$(timeout "$PROOF_TIMEOUT" bash "$C2" 2>&1)"
  rc=$?
  if [ "$rc" -ne 2 ]; then
    # Not a failure of the proofs -- just this control not reproducing the
    # coincidence on this machine. Say so rather than claim a pass.
    say "  note gate-less 0226 exited ${rc}, not 2, so the collision did not"
    say "       arise here; nothing is claimed either way by this control"
  elif printf '%s\n' "$out" | grep -q 'ENVIRONMENT' && printf '%s\n' "$out" | grep -qi 'nothing about'; then
    bad "control 2 printed a real refusal though its gate was removed"
  else
    ok "gate-less 0226 exits 2 by accident and says nothing -- TEST 2's extra"
    say "       message assertions are what make it sound, not the exit code"
  fi
fi
rm -f "$C2" "$S2"

say
# ---------------------------------------------------------------------------
# INTEGRITY -- this script must not have edited the things it tests.
# ---------------------------------------------------------------------------
say "--- INTEGRITY: the proofs themselves are byte-for-byte untouched -------"
say "    Hashed directly, not 'git diff' -- git would also flag legitimate"
say "    uncommitted work and give a false alarm."

DRIFT=0
for tag in "${PROOFS[@]}"; do
  f="scripts/compliance/prove-${tag}-executes.sh"
  [ -f "$f" ] || continue
  after="$(sha256sum "$f" | awk '{print $1}')"
  if [ "${SHA_BEFORE[$tag]:-}" != "$after" ]; then
    bad "${tag}: ${f} CHANGED while this script ran"
    DRIFT=1
  fi
done
[ "$DRIFT" -eq 0 ] && ok "all ${#PROOFS[@]} proof scripts are unchanged"

# Leave no scratch databases behind. 0223/0224/0225 have no teardown of their
# own, so this script cleans up after itself rather than littering.
for db in greenway_migtest greenway_migtest_0224 greenway_migtest_0225 \
          greenway_migtest_0226 greenway_migtest_0227 greenway_migtest_0228 \
          greenway_migtest_0229; do
  psql -q -d postgres -c "drop database if exists $db;" >/dev/null 2>&1
done

say
say "========================================================================"
say "  ENV-GATE SABOTAGE: ${PASS} passed, ${FAIL} failed, ${TIMEDOUT} not proven"
if [ "$FAIL" -ne 0 ]; then
  say "  RESULT: *** THE GATE DOES NOT HOLD - SEE ABOVE ***"
elif [ "$TIMEDOUT" -ne 0 ]; then
  # Not green and not red. Saying "all passed" while ${TIMEDOUT} checks never
  # finished would be the same false confidence this slice exists to remove.
  say "  RESULT: no failures, but ${TIMEDOUT} check(s) never finished, so the"
  say "          gate is NOT fully proven. Re-run on an idle machine."
else
  say "  RESULT: every proof is IMMUNE to the original bug, REFUSES a dead"
  say "          environment with exit 2 instead of blaming the migration,"
  say "          and still PROVES the migration when the environment is fine."
fi
say "========================================================================"

# Three outcomes, three codes -- the same discipline this harness enforces on
# the proofs it tests:
#   0 = the gate is proven to hold
#   1 = a real failure
#   2 = not proven (something never finished; try again when idle)
[ "$FAIL" -ne 0 ] && exit 1
[ "$TIMEDOUT" -ne 0 ] && exit 2
exit 0
