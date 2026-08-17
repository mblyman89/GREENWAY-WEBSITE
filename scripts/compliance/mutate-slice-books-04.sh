#!/usr/bin/env bash
#
# scripts/compliance/mutate-slice-books-04.sh   (slice books-04)
#
# MUTATION TESTING FOR PAYROLL AND THE EMPLOYEE-AS-COGS QUESTION.
#
# A green suite proves the tests RAN. It does not prove they would have NOTICED
# anything. This script deliberately breaks `payroll-cogs-core.ts` in the ways a
# real mistake would break it, and demands the gate fail every single time. A
# mutant that SURVIVES is a hole in the test suite, not a curiosity.
#
# WHY THIS SLICE GETS THE HARSHEST CAMPAIGN OF ALL FOUR:
#
# Michael asked, in his own words, for "the ability to assign employees as cogs
# so I can write them off". The verified answer is that a RESELLER mostly cannot
# — Reg. §1.471-3(b) has no direct-labor clause, and §1.471-3(c), which does
# allow "expenditures for direct labor", applies only to merchandise "produced
# by the taxpayer" and excludes "any cost of selling" even then. So this module
# is built around ONE narrow lawful door (receiving / acquiring possession) and
# a wall of locks around it.
#
# Every lock in that wall is a place where a single flipped boolean turns a
# defensible tax return into an indefensible one — WITHOUT producing any visible
# error. The journal still balances. The reports still render. The books look
# perfect and the position is dead. That is the failure mode this campaign
# exists to hunt.
#
# So the mutants below are not abstract operator swaps. Each one is a mistake a
# real developer could plausibly ship, and each carries a note about what it
# would cost in real tax dollars if it shipped.
#
# THREE NEUTRAL CONTROLS run at the end — changes that alter the source without
# altering behaviour. Those MUST survive. If a control dies, the suite is
# asserting on something cosmetic (comment wording, a variable name) and would
# break on any harmless edit, which is its own kind of bug.
#
# ---------------------------------------------------------------------------
# WHY THE RESTORE IS DONE WITH BYTES AND NOT WITH GIT
# ---------------------------------------------------------------------------
# The first version of the slice-01 harness restored with `git checkout -- FILE`.
# That was actively dangerous: it silently reverted REAL uncommitted work on
# tracked files, and did nothing at all for untracked new files, so mutants
# accumulated on top of each other. `payroll-cogs-core.ts` is UNTRACKED while
# this slice is in flight, which makes the git approach not merely risky but
# useless. This version snapshots the exact bytes to a temp directory, restores
# from there, and VERIFIES byte-identity after every single mutation before
# continuing.
#
# Usage:  bash scripts/compliance/mutate-slice-books-04.sh
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1

CORE="src/lib/accounting/payroll-cogs-core.ts"
TEST="tests/compliance/payroll-cogs-core.test.ts"

SNAP="$(mktemp -d)"
trap 'cp -p "$SNAP/$(basename "$CORE")" "$CORE" 2>/dev/null; rm -rf "$SNAP"' EXIT

cp -p "$CORE" "$SNAP/$(basename "$CORE")"

PASSED=0
FAILED=0
NOOPS=0

restore() {
  cp -p "$SNAP/$(basename "$CORE")" "$CORE"
}

verify_restored() {
  if ! cmp -s "$CORE" "$SNAP/$(basename "$CORE")"; then
    echo "FATAL: $CORE was not restored byte-identically. Aborting before more damage."
    exit 2
  fi
}

# run_gate: the vitest file PLUS the embedded self-test runner. Both must be
# clean for a mutant to count as SURVIVED, because a mutant caught only by the
# in-module self-tests is still caught.
run_gate() {
  # DRY=1 checks only that every pattern actually MATCHES. It is a harness
  # self-check, not a campaign: it answers "are my regexes right?" in seconds
  # instead of half an hour, so a no-op is found before the slow run starts.
  # In dry mode every mutant is reported as killed, which is meaningless by
  # design -- the only number that matters in a dry run is the no-op count.
  if [ "${DRY:-0}" = "1" ]; then return 1; fi
  npx vitest run "$TEST" >/dev/null 2>&1 || return 1
  npx tsx scripts/compliance/run-pure-selftests.ts >/dev/null 2>&1 || return 1
  return 0
}

# mutate <label> <expectation: die|survive> <perl-expression>
mutate() {
  local label="$1" expect="$2" expr="$3"

  restore
  perl -0pi -e "$expr" "$CORE"

  if cmp -s "$CORE" "$SNAP/$(basename "$CORE")"; then
    echo "  !! NO-OP  $label  (the pattern did not match — fix the harness)"
    NOOPS=$((NOOPS + 1))
    restore
    verify_restored
    return
  fi

  if run_gate; then
    if [ "$expect" = "survive" ]; then
      echo "  ok  (control survived)  $label"
      PASSED=$((PASSED + 1))
    else
      echo "  XX  SURVIVED            $label   <-- TEST SUITE HOLE"
      FAILED=$((FAILED + 1))
    fi
  else
    if [ "$expect" = "die" ]; then
      echo "  ok  (killed)            $label"
      PASSED=$((PASSED + 1))
    else
      echo "  XX  CONTROL DIED        $label   <-- suite asserts on something cosmetic"
      FAILED=$((FAILED + 1))
    fi
  fi

  restore
  verify_restored
}

echo "=============================================================="
echo " MUTATION CAMPAIGN — slice books-04 (payroll & employee-as-COGS)"
echo "=============================================================="
echo

echo "-- THE TAXONOMY: which hour can become inventory -------------"

# THE headline mutant. A budtender's hour reclassified as "acquisition" walks
# straight through the narrow door and lands in 61000. Reg. §1.471-3(c) excludes
# "any cost of selling" even for a producer; a reseller has no clause at all.
# This is the single most expensive line in the file.
mutate "budtender relabelled as acquisition labor (THE §280E trap)" die \
  's/    code: "budtender",\n    label: "Budtender \/ sales associate",\n    treatment: "selling",/    code: "budtender",\n    label: "Budtender \/ sales associate",\n    treatment: "acquisition",/'

# Same crime, different door: leave the treatment honest but point the account
# at COGS. The dollars land in 61000 regardless of what the label says.
mutate "budtender wages pointed at the 61000 COGS payroll account" die \
  's/    code: "budtender",\n    label: "Budtender \/ sales associate",\n    treatment: "selling",\n    accountCode: WAGE_EXPENSE_ACCOUNT,\n    costClass: "nondeductible_280e",/    code: "budtender",\n    label: "Budtender \/ sales associate",\n    treatment: "selling",\n    accountCode: PAYROLL_COGS_ACCOUNT,\n    costClass: "cogs_allocable",/'

# The cost_class is what the §280E reports actually read. Flip it and the
# account is still 71010 but the tax report counts the wage as recoverable.
# This is Defect 13's twin, at the taxonomy level.
mutate "budtender cost class flipped to cogs_allocable (report lies, account doesn't)" die \
  's/    code: "budtender",\n    label: "Budtender \/ sales associate",\n    treatment: "selling",\n    accountCode: WAGE_EXPENSE_ACCOUNT,\n    costClass: "nondeductible_280e",\n    neverInventoriable: true,/    code: "budtender",\n    label: "Budtender \/ sales associate",\n    treatment: "selling",\n    accountCode: WAGE_EXPENSE_ACCOUNT,\n    costClass: "cogs_allocable",\n    neverInventoriable: true,/'

# Drop the never-inventoriable flag and the structural guard stops firing.
mutate "budtender loses its neverInventoriable flag" die \
  's/    code: "budtender",\n    label: "Budtender \/ sales associate",\n    treatment: "selling",\n    accountCode: WAGE_EXPENSE_ACCOUNT,\n    costClass: "nondeductible_280e",\n    neverInventoriable: true,/    code: "budtender",\n    label: "Budtender \/ sales associate",\n    treatment: "selling",\n    accountCode: WAGE_EXPENSE_ACCOUNT,\n    costClass: "nondeductible_280e",\n    neverInventoriable: false,/'

# The opposite error: closing the ONE lawful door. Receiving really is
# "acquiring possession of the goods" under §1.471-3(b). Losing it costs Michael
# money he is legitimately entitled to.
mutate "receiving demoted to admin (the one lawful door is closed)" die \
  's/    code: "receiving",\n    label: "Receiving \/ intake — meeting deliveries, checking manifests, vaulting product",\n    treatment: "acquisition",/    code: "receiving",\n    label: "Receiving \/ intake — meeting deliveries, checking manifests, vaulting product",\n    treatment: "admin",/'

# cogs_direct is the PRODUCER class. A reseller claiming it is claiming
# §1.471-3(c) without producing anything — the position that lost Patients
# Mutual, Richmond and Alternative Health Care.
mutate "receiving reclassified as cogs_direct (a producer-only class)" die \
  's/    code: "receiving",\n    label: "Receiving \/ intake — meeting deliveries, checking manifests, vaulting product",\n    treatment: "acquisition",\n    accountCode: PAYROLL_COGS_ACCOUNT,\n    costClass: "cogs_allocable",/    code: "receiving",\n    label: "Receiving \/ intake — meeting deliveries, checking manifests, vaulting product",\n    treatment: "acquisition",\n    accountCode: PAYROLL_COGS_ACCOUNT,\n    costClass: "cogs_direct",/'

# Counting stock you already own is not acquiring it. This is the most seductive
# wrong answer in the whole taxonomy, because it FEELS inventory-related.
mutate "inventory_count promoted to acquisition (feels right, is wrong)" die \
  's/    code: "inventory_count",\n    label: "Physical inventory counts and CCRS reconciliation",\n    treatment: "admin",/    code: "inventory_count",\n    label: "Physical inventory counts and CCRS reconciliation",\n    treatment: "acquisition",/'

# WA law compels the guard; §280E disallows him anyway. "Inventory protection"
# is the phrase every promoter uses and it has never worked.
mutate "security relabelled as inventory protection (acquisition)" die \
  's/    code: "security",\n    label: "Security \/ door staff",\n    treatment: "admin",/    code: "security",\n    label: "Security \/ door staff",\n    treatment: "acquisition",/'

# Management IS "management expenses" — but only §1.471-3(c) admits those, and
# only for producers.
mutate "management capitalised as acquisition labor" die \
  's/    code: "management",\n    label: "Store manager \/ assistant manager",\n    treatment: "admin",/    code: "management",\n    label: "Store manager \/ assistant manager",\n    treatment: "acquisition",/'

# Marketing is selling by another name.
mutate "marketing reclassified out of selling" die \
  's/    code: "marketing",\n    label: "Marketing, menus and promotions",\n    treatment: "selling",/    code: "marketing",\n    label: "Marketing, menus and promotions",\n    treatment: "admin",/'

# The ATM and the landholding company are SEPARATE trades under CHAMP. Folding
# their wages into Greenway's §280E bucket destroys the separation — and that
# separation is worth more than any allocation.
mutate "ATM labor folded into the cannabis trade (CHAMP separation lost)" die \
  's/    code: "atm_operation",\n    label: "Work on the ATM business",\n    treatment: "separate",\n    accountCode: WAGE_EXPENSE_ACCOUNT,\n    costClass: "separate_business",/    code: "atm_operation",\n    label: "Work on the ATM business",\n    treatment: "separate",\n    accountCode: WAGE_EXPENSE_ACCOUNT,\n    costClass: "nondeductible_280e",/'

mutate "owner_officer wages become inventoriable" die \
  's/    code: "owner_officer",\n    label: "Owner \/ officer compensation",\n    treatment: "owner",\n    accountCode: WAGE_EXPENSE_ACCOUNT,\n    costClass: "nondeductible_280e",\n    neverInventoriable: true,/    code: "owner_officer",\n    label: "Owner \/ officer compensation",\n    treatment: "owner",\n    accountCode: PAYROLL_COGS_ACCOUNT,\n    costClass: "cogs_allocable",\n    neverInventoriable: false,/'

echo
echo "-- RESELLER vs PRODUCER: the determination it all hangs off ---"

# Richmond Patients Group trimmed and dried product and was STILL held a
# reseller. If trimming flips the character, a retailer becomes a "producer" in
# software and claims direct labor it has no licence to earn.
mutate "trimming/drying makes you a producer (Richmond says otherwise)" die \
  's/    code: "trim_dry",\n    label: "Trimming or drying product",\n    makesYouAProducer: false,/    code: "trim_dry",\n    label: "Trimming or drying product",\n    makesYouAProducer: true,/'

# "Reinspection, packaging and labeling" are things resellers "do without losing
# their character as resellers" — Patients Mutual, verbatim.
mutate "repackaging makes you a producer (Patients Mutual says otherwise)" die \
  's/    code: "repackage",\n    label: "Repackaging or relabelling",\n    makesYouAProducer: false,/    code: "repackage",\n    label: "Repackaging or relabelling",\n    makesYouAProducer: true,/'

mutate "selling to customers reclassified as production" die \
  's/    code: "display_sell",\n    label: "Displaying, advising customers and selling",\n    makesYouAProducer: false,/    code: "display_sell",\n    label: "Displaying, advising customers and selling",\n    makesYouAProducer: true,/'

mutate "everyone is a producer (directLaborCapitalisable always true)" die \
  's/  const isProducer = producer.length > 0;/  const isProducer = true;/'

mutate "nobody is ever a producer (the fork disappears)" die \
  's/  const isProducer = producer.length > 0;/  const isProducer = false;/'

# An activity the system does not understand is a hole in the reasoning. Silently
# dropping it makes a wrong answer look confident.
mutate "unrecognised activities silently dropped instead of reported" die \
  's/    if \(!activity\) \{\n      unknown.push\(code\);\n      continue;\n    \}/    if (!activity) {\n      continue;\n    }/'

echo
echo "-- SUBSTANTIATION: §6001 puts the burden on Michael -----------"

# Each of these six gaps is a piece of proof. Disabling one means an allocation
# with a hole in it posts clean — the Harborside fact pattern exactly.
mutate "reconstructed-from-memory time records accepted" die \
  's/  if \(!sub.contemporaneous\) \{/  if (false) {/'

mutate "shift-level punches accepted as task-level proof" die \
  's/  if \(!sub.taskLevelDetail\) \{/  if (false) {/'

mutate "receiving time no longer needs to tie to a delivery" die \
  's/  if \(!sub.tiedToManifests\) \{/  if (false) {/'

mutate "a three-day sample accepted as a study" die \
  's/  if \(!Number.isFinite\(sub.daysOfRecords\) \|\| sub.daysOfRecords < MIN_SUBSTANTIATION_DAYS\) \{/  if (false) {/'

mutate "allocation accepted with no written study behind it" die \
  's/  if \(!sub.documentRef \|\| sub.documentRef.trim\(\).length < 3\) \{/  if (false) {/'

mutate "allocation accepted with no basis note explaining the number" die \
  's/  if \(!sub.basisNote \|\| sub.basisNote.trim\(\).length < 3\) \{/  if (false) {/'

mutate "substantiation window cut from 30 days to 3" die \
  's/export const MIN_SUBSTANTIATION_DAYS = 30;/export const MIN_SUBSTANTIATION_DAYS = 3;/'

# The gaps are computed but never turned into a block: the classic "we checked
# and then ignored the answer" bug.
mutate "substantiation gaps computed but never enforced" die \
  's/    if \(gaps.length > 0\) \{\n      findings.push\(\{\n        code: "PAY_ACQUISITION_UNSUBSTANTIATED",/    if (false) {\n      findings.push({\n        code: "PAY_ACQUISITION_UNSUBSTANTIATED",/'

mutate "unsubstantiated allocation downgraded from block to advice" die \
  's/        code: "PAY_ACQUISITION_UNSUBSTANTIATED",\n        severity: "block",/        code: "PAY_ACQUISITION_UNSUBSTANTIATED",\n        severity: "advise",/'

# Missing substantiation defaults to "assume it is all fine" instead of "assume
# nothing is proved". Absence of evidence becoming evidence of compliance.
mutate "missing substantiation defaults to fully proved" die \
  's/      run.substantiation \?\? \{\n        daysOfRecords: 0,\n        contemporaneous: false,\n        taskLevelDetail: false,\n        tiedToManifests: false,/      run.substantiation ?? {\n        daysOfRecords: 9999,\n        contemporaneous: true,\n        taskLevelDetail: true,\n        tiedToManifests: true,/'

echo
echo "-- THE CEILING: a number too big to defend --------------------"

mutate "acquisition ceiling raised from 25% to 90%" die \
  's/export const ACQUISITION_LABOR_CEILING_MILLI_PCT = 25000;/export const ACQUISITION_LABOR_CEILING_MILLI_PCT = 90000;/'

mutate "scrutiny threshold raised so nothing is ever flagged" die \
  's/export const ACQUISITION_LABOR_SCRUTINY_MILLI_PCT = 10000;/export const ACQUISITION_LABOR_SCRUTINY_MILLI_PCT = 99000;/'

mutate "ceiling check never fires" die \
  's/    if \(runAcquisitionShare >= ACQUISITION_LABOR_CEILING_MILLI_PCT\) \{/    if (false) {/'

mutate "ceiling boundary shifts (exactly 25% now passes)" die \
  's/    if \(runAcquisitionShare >= ACQUISITION_LABOR_CEILING_MILLI_PCT\) \{/    if (runAcquisitionShare > ACQUISITION_LABOR_CEILING_MILLI_PCT) {/'

# The Simpson's-paradox regression this code was specifically written to avoid:
# weighting by headcount instead of by dollars lets a part-time receiver at 100%
# hide behind four full-time budtenders at 0%.
mutate "ceiling weighted by headcount again (Simpson's paradox returns)" die \
  's/  const runAcquisitionShare =\n    totalGross <= 0 \? 0 : Math.round\(\(acquisitionCents \* 100000\) \/ totalGross\);/  const runAcquisitionShare = 0;/'

echo
echo "-- THE HARD BLOCKS: locks that must stay locked ---------------"

# ---------------------------------------------------------------------------
# TWO EQUIVALENT MUTANTS LIVE HERE, AND THEY ARE DELIBERATELY NOT RUN.
# ---------------------------------------------------------------------------
# The first campaign tried these two:
#
#   "selling-labor-to-COGS structural guard disabled"
#     s/if (role.neverInventoriable && role.accountCode === PAYROLL_COGS_ACCOUNT) {/if (false) {/
#   "selling labor in COGS downgraded from block to confirm"
#     s/code: "PAY_SELLING_LABOR_TO_COGS", severity: "block",/... "confirm",/
#
# Both SURVIVED, and it would have been easy to record that as two holes and
# write two tests. That would have been wrong. The guard fires only for a role
# that is BOTH `neverInventoriable: true` AND pointed at account 61000, and no
# seeded role is shaped that way -- verified by walking all thirteen roles. It
# is a defence-in-depth branch against a taxonomy that does not exist yet.
#
# So the branch is UNREACHABLE with the seeded data, which means no input can
# distinguish the mutant from the original. These are EQUIVALENT MUTANTS, and
# no test can kill them. The honest response is to say so here rather than to
# invent a test that asserts nothing, or to delete a guard that costs nothing
# and would matter enormously the day someone adds a fourteenth role.
#
# What DOES protect against that day is a test, in the vitest file, asserting
# that no role may ever be given that shape -- "never lets a never-inventoriable
# role carry an inventory cost class". That test attacks the cause instead of
# the symptom, and it is killable, which is how you can tell it is real.

mutate "a reseller may claim production labor after all" die \
  's/      if \(role.treatment === "production" \&\& character.character === "reseller"\) \{/      if (false) {/'

# The licence governs, not the self-reported activity list. Without this branch,
# typing "cultivate" into a text field is enough to capitalise production labor
# on a RETAIL licensee's books.
mutate "retail-licence backstop removed (typing 'cultivate' is enough)" die \
  's/      \} else if \(role.treatment === "production" \&\& run.entityCode === "greenway"\) \{/      } else if (false) {/'

mutate "cannabis acquisition labor allowed in the ATM/rental books" die \
  's/  if \(run.entityCode !== "greenway" \&\& acquisitionCents > 0\) \{/  if (false) {/'

mutate "net pay no longer has to reconcile to gross less deductions" die \
  's/    if \(expectedNet !== net\) \{/    if (false) {/'

mutate "negative and fractional payroll amounts accepted" die \
  's/      if \(!Number.isInteger\(value\) \|\| value < 0\) \{/      if (false) {/'

mutate "time split no longer has to add to 100%" die \
  's/    if \(emp.allocations.length === 0 \|\| totalShare !== 100000\) \{/    if (false) {/'

mutate "unknown labor roles guessed instead of refused" die \
  's/      if \(!role\) \{\n        findings.push\(\{\n          code: "PAY_UNKNOWN_ROLE",/      if (false) {\n        findings.push({\n          code: "PAY_UNKNOWN_ROLE",/'

mutate "posting into a CLOSED period allowed" die \
  's/  if \(ctx.periodClosed === true\) \{/  if (false) {/'

mutate "an impossible date (2026-02-30) accepted" die \
  's/    if \(!isValidIsoDate\(field\[1\]\)\) \{/    if (false) {/'

mutate "a backwards pay period accepted" die \
  's/    run.periodEnd < run.periodStart\n  \) \{/    false\n  ) {/'

mutate "an empty payroll run posts a journal describing nothing" die \
  's/  if \(run.employees.length === 0\) \{/  if (false) {/'

mutate "blocks stop making a run unpostable" die \
  's/  const blocked = findings.some\(\(f\) => f.severity === "block"\);/  const blocked = false;/'

mutate "confirmations no longer need acknowledging" die \
  's/    needsAcknowledgement: findings.some\(\(f\) => f.severity === "confirm"\),/    needsAcknowledgement: false,/'

echo
echo "-- THE JOURNAL: money must be conserved -----------------------"

mutate "a refused payroll run can still build a journal" die \
  's/  if \(!verdict.postable\) return null;/  if (false) return null;/'

mutate "ordinary wages posted to the COGS payroll account" die \
  's/  if \(ordinaryTotal > 0\) \{\n    lines.push\(\{\n      accountCode: WAGE_EXPENSE_ACCOUNT,/  if (ordinaryTotal > 0) {\n    lines.push({\n      accountCode: PAYROLL_COGS_ACCOUNT,/'

mutate "ordinary wages tagged cogs_allocable in the ledger" die \
  's/  if \(ordinaryTotal > 0\) \{\n    lines.push\(\{\n      accountCode: WAGE_EXPENSE_ACCOUNT,\n      amountCents: ordinaryTotal,\n      costClass: "nondeductible_280e",/  if (ordinaryTotal > 0) {\n    lines.push({\n      accountCode: WAGE_EXPENSE_ACCOUNT,\n      amountCents: ordinaryTotal,\n      costClass: "cogs_allocable",/'

# §7501 trust money credited with the wrong sign turns a liability into a debit
# and the journal stops balancing — or worse, balances against something else.
mutate "withheld trust money credited with the WRONG SIGN" die \
  's/      accountCode: WITHHELD_TAX_ACCOUNT,\n      amountCents: -withheldTotal,/      accountCode: WITHHELD_TAX_ACCOUNT,\n      amountCents: withheldTotal,/'

# An advance repayment is a RECEIVABLE coming back, not income and not a wage.
mutate "employee advance repayment treated as an expense line" die \
  's/      accountCode: EMPLOYEE_ADVANCE_ACCOUNT,\n      amountCents: -advanceTotal,\n      costClass: "none",/      accountCode: WAGE_EXPENSE_ACCOUNT,\n      amountCents: -advanceTotal,\n      costClass: "nondeductible_280e",/'

mutate "separate-business wages lose their CHAMP class" die \
  's/      accountCode: WAGE_EXPENSE_ACCOUNT,\n      amountCents: separateTotal,\n      costClass: "separate_business",/      accountCode: WAGE_EXPENSE_ACCOUNT,\n      amountCents: separateTotal,\n      costClass: "nondeductible_280e",/'

mutate "balance check gains a one-cent tolerance" die \
  's/  for \(const l of journal.lines\) sum \+= l.amountCents;\n  return sum === 0;/  for (const l of journal.lines) sum += l.amountCents;\n  return Math.abs(sum) <= 1;/'

# Collapsing accrual and cash into one entry is how accrual-basis books quietly
# become cash-basis without anyone deciding to change method.
mutate "payment journal posts to wages instead of clearing the accrual" die \
  's/        accountCode: ACCRUED_PAYROLL_ACCOUNT,\n        amountCents: net,\n        costClass: "none",\n        description: "Clearing net pay previously accrued",/        accountCode: WAGE_EXPENSE_ACCOUNT,\n        amountCents: net,\n        costClass: "nondeductible_280e",\n        description: "Clearing net pay previously accrued",/'

mutate "payment journal accepts an invalid payment date" die \
  's/  if \(!isValidIsoDate\(paymentDate\)\) return null;//'

echo
echo "-- IDEMPOTENCY: paying the same payroll twice ----------------"

mutate "source ref drops the pay date (two runs collide)" die \
  's/  return `payroll:\$\{entity\}:\$\{run.periodStart\}:\$\{run.periodEnd\}:\$\{run.payDate\}`;/  return `payroll:\${entity}:\${run.periodStart}:\${run.periodEnd}`;/'

# If the fingerprint ignores the money, a CORRECTED run looks identical to the
# original, idempotency treats it as a duplicate, and the correction is silently
# lost — the original wrong numbers stay in the ledger forever.
mutate "content fingerprint ignores the amounts (corrections lost silently)" die \
  's/      return \[\n        e.employeeId,\n        e.grossWagesCents,/      return [\n        e.employeeId,/'

mutate "content fingerprint ignores the allocations" die \
  's/        e.netPayCents,\n        allocs,\n      \].join\("\|"\);/        e.netPayCents,\n      ].join("|");/'

mutate "fingerprint stops sorting employees (re-ordering looks like a change)" die \
  's/    \}\)\n    .slice\(\)\n    .sort\(\);\n\n  const text = parts.concat\(rows\).join\(";"\);/    })\n    .slice();\n\n  const text = parts.concat(rows).join(";");/'

echo
echo "-- ARITHMETIC: integers, or nothing --------------------------"

# Largest-remainder is what makes the parts sum EXACTLY to gross. Naive rounding
# loses a cent, and a lost cent is an unbalanced journal the ledger refuses.
mutate "largest-remainder split abandoned (pennies vanish)" die \
  's/  let remainder = totalCents - base.reduce\(\(a, b\) => a \+ b, 0\);/  let remainder = 0;/'

# A THIRD EQUIVALENT MUTANT, also deliberately not run:
#
#   "split tie-break becomes unstable"
#     s/.sort((a, b) => b.r - a.r || a.i - b.i);/.sort((a, b) => b.r - a.r);/
#
# It survived, and again the survival is correct rather than a hole.
# Array.prototype.sort has been REQUIRED to be stable since ES2019, so two equal
# remainders already keep their insertion order -- which is index order -- and
# the explicit `|| a.i - b.i` is therefore a no-op at runtime. Verified over
# 18,006 total/share combinations with zero differences between the two forms.
#
# The explicit tie-break stays in the source anyway: relying on an implicit
# language guarantee to decide which employee receives an odd cent is a bad
# trade for one clause of code. But it cannot be killed by any test, and
# writing one that pretends otherwise would be theatre.
#
# The mutant immediately below looks similar and is NOT equivalent: ranking by
# the SMALLEST remainder is a genuinely different allocation method that changes
# the answer in 600 of 1,206 sampled cases. That one is a real hole, and it is
# now closed by a test pinning which index receives the odd cent.
mutate "split ranks by smallest remainder instead of largest" die \
  's/    .sort\(\(a, b\) => b.r - a.r \|\| a.i - b.i\);/    .sort((a, b) => a.r - b.r || a.i - b.i);/'

mutate "NaN shares poison the split instead of being zeroed" die \
  's/  const clean = shares.map\(\(s\) => \(Number.isFinite\(s\) \&\& s > 0 \? s : 0\)\);/  const clean = shares.slice();/'

# The comment above formatMilliPct explains this exact bug: Math.trunc(-500/1000)
# is -0, which renders as "0", so MINUS half a percent prints as "0.5%".
mutate "formatMilliPct drops the minus sign (-0.5% prints as 0.5%)" die \
  's/  const sign = milli < 0 \? "-" : "";\n  const abs = Math.abs\(milli\);\n  const whole = Math.trunc\(abs \/ 1000\);/  const sign = "";\n  const abs = Math.abs(milli);\n  const whole = Math.trunc(abs \/ 1000);/'

mutate "formatCents rounds instead of truncating dollars" die \
  's/  const dollars = Math.floor\(abs \/ 100\);/  const dollars = Math.round(abs \/ 100);/'

mutate "cents no longer zero-padded (\$10.05 renders as \$10.5)" die \
  's/\.\$\{String\(rest\).padStart\(2, "0"\)\}`;/.\${String(rest)}`;/'

mutate "leap-year rule drops the 400-year exception" die \
  's/  const isLeap = \(y % 4 === 0 \&\& y % 100 !== 0\) \|\| y % 400 === 0;/  const isLeap = y % 4 === 0 \&\& y % 100 !== 0;/'

mutate "acquisition share ignores the treatment (counts every role)" die \
  's/    if \(role \&\& role.treatment === "acquisition"\) share \+= a.shareMilliPct;/    if (role) share += a.shareMilliPct;/'

echo
echo "-- THE AUTHORITIES: verbatim law, or nothing -----------------"

mutate "the §280E quote is paraphrased" die \
  's/No deduction or credit shall be allowed for any amount paid or incurred/No deduction shall be allowed for any amount paid or incurred/'

mutate "the §1.471-3(b) possession clause is truncated" die \
  's/transportation or other necessary charges incurred in \" \+\n      \"acquiring possession/transportation charges incurred in " +\n      "acquiring possession/'

mutate "the §1.471-3(c) selling exclusion is dropped from the quote" die \
  's/but not including any cost of selling or return on capital/including any cost of selling or return on capital/'

mutate "the §1.263A-1(e)(2)(ii) reseller sentence is softened" die \
  's/Resellers. Resellers must capitalize the acquisition costs of property acquired for resale/Resellers may capitalize the acquisition costs of property acquired for resale/'

mutate "the §7501 trust-fund language is paraphrased" die \
  's/held to be a special fund in trust for the United States/held in trust for the United States/'

mutate "citePayrollAuthorities silently drops unknown ids" die \
  's/    parts.push\(a \? a.cite : `\[unknown authority: \$\{id\}\]`\);/    if (a) parts.push(a.cite);/'

echo
echo "-- NEUTRAL CONTROLS (these MUST survive) --------------------"

mutate "CONTROL: reword a doc comment" survive \
  's/\/\*\* Role codes whose wages can never reach inventory, whatever the evidence. \*\//\/** Role codes whose wages can never reach inventory cost, no matter what evidence exists. *\//'

mutate "CONTROL: rename a local variable in payrollJournalIsBalanced" survive \
  's/  let sum = 0;\n  for \(const l of journal.lines\) sum \+= l.amountCents;\n  return sum === 0;/  let running = 0;\n  for (const l of journal.lines) running += l.amountCents;\n  return running === 0;/'

mutate "CONTROL: add a blank comment line to a section banner" survive \
  's/\/\/ 7\) SMALL PURE HELPERS/\/\/ 7) SMALL PURE HELPERS\n\/\//'

echo
echo "=============================================================="
echo " RESULT:  $PASSED as expected,  $FAILED unexpected,  $NOOPS no-ops"
echo "=============================================================="

verify_restored
echo "verified: $CORE restored byte-identically."

if [ "$FAILED" -gt 0 ] || [ "$NOOPS" -gt 0 ]; then
  exit 1
fi
exit 0
