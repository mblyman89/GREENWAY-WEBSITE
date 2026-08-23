#!/usr/bin/env bash
#
# scripts/prove-learning-path-gate.sh   (books-44, slice C)
#
# MUTATION CAMPAIGN FOR THE LEARNING PATH GATE.
#
# Standing rule 39: a check that cannot fail is not a check. Standing rule 15/16:
# proving a gate EXISTS is not proving it FIRES.
#
# WHAT IS BEING DEFENDED, AND WHY IT MATTERS MORE THAN USUAL
# ──────────────────────────────────────────────────────────────────────────────
# Slice C exists because of a genuinely embarrassing finding: six mentor modules
# in this system contained 82 finished, tested, cited lessons, and NOT ONE of
# them was reachable from any screen. They were written, reviewed, gated, and
# then buried. The tests were green the entire time. That is standing rule 50 -
# dead code wearing a green check - and it went unnoticed for weeks.
#
# `/admin/books/learn` is the fix. `tests/compliance/learning-path.test.ts` is
# the promise that the fix STAYS fixed. The specific promises are:
#
#   1. Every lesson that exists is placed in the course exactly once.
#   2. The counts on screen are DERIVED, never typed.
#   3. The screen is reachable - it is in the navigation and behind the gate.
#   4. Colour means one thing, everywhere, forever.
#   5. Every citation resolves to a real authority.
#
# Those promises are worth exactly as much as this script's kill rate. Michael
# asked to be "empowered to use these lessons... to help make me the best
# possible accountant i can be." A curriculum that quietly drops a third of
# itself would still LOOK like a course. That is the failure mode being hunted.
#
# ──────────────────────────────────────────────────────────────────────────────
# THREE CONTROLS, AND WHY A CAMPAIGN WITHOUT THEM IS WORTHLESS
# ──────────────────────────────────────────────────────────────────────────────
#
# Standing rule 55: refusal must DISCRIMINATE. A suite that goes red on any edit
# whatsoever would score a perfect kill rate here and mean nothing at all - it
# would be measuring its own brittleness and calling it rigour. So before the
# attacks, three SILENT CONTROLS run: edits that genuinely change nothing the
# gate claims. All three MUST stay GREEN.
#
#   Control 1 - add an ordinary comment to the curriculum. Not a claim.
#   Control 2 - reword a unit's prose explanation. Judgement, not fact.
#   Control 3 - reorder two lessons WITHIN a unit. The gate promises every
#               lesson appears once, and that units run in a defended order;
#               it deliberately does NOT freeze the order inside a unit, or
#               no one could ever improve the teaching sequence again.
#
# If a control goes red, the gate is over-fitted and the kill rate is noise.
# That is a failure of THIS script's subject and it is reported as loudly as an
# uncaught mutation.
#
# ──────────────────────────────────────────────────────────────────────────────
# RESTORATION
# ──────────────────────────────────────────────────────────────────────────────
#
# Standing rule 70d: compare against the BACKUP, not against HEAD. The files
# under attack are deliberately uncommitted while this slice is in flight, so
# `git diff` would report my own in-progress work as "not restored" and train me
# to ignore the one signal that matters. Every file is restored from a byte-exact
# copy and verified with `cmp`.
#
# Standing rule 72: a mutation that did not LAND is not a surviving mutant. Every
# attack is cmp-checked before the verdict is believed, and NO-OPs are counted
# as their own category rather than being silently scored as kills.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

CORE="src/lib/accounting/learning-path-core.ts"
UI="src/lib/accounting/learning-path-ui-core.ts"
PAGE="src/app/admin/books/learn/page.tsx"
NAV="src/components/admin/admin-nav-data.ts"
TEST="tests/compliance/learning-path.test.ts"

BACKUP_DIR="$(mktemp -d)"
cp "$CORE" "$BACKUP_DIR/core.bak"
cp "$UI"   "$BACKUP_DIR/ui.bak"
cp "$PAGE" "$BACKUP_DIR/page.bak"
cp "$NAV"  "$BACKUP_DIR/nav.bak"

restore() {
  cp "$BACKUP_DIR/core.bak" "$CORE"
  cp "$BACKUP_DIR/ui.bak"   "$UI"
  cp "$BACKUP_DIR/page.bak" "$PAGE"
  cp "$BACKUP_DIR/nav.bak"  "$NAV"
}

cleanup() {
  restore
  local bad=0
  cmp -s "$BACKUP_DIR/core.bak" "$CORE" || { echo "!! $CORE NOT RESTORED"; bad=1; }
  cmp -s "$BACKUP_DIR/ui.bak"   "$UI"   || { echo "!! $UI NOT RESTORED";   bad=1; }
  cmp -s "$BACKUP_DIR/page.bak" "$PAGE" || { echo "!! $PAGE NOT RESTORED"; bad=1; }
  cmp -s "$BACKUP_DIR/nav.bak"  "$NAV"  || { echo "!! $NAV NOT RESTORED";  bad=1; }
  [ "$bad" -eq 0 ] && echo "all four files restored byte-exact (cmp)"
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT

run_suite() {
  if npx vitest run "$TEST" >/tmp/prove-learning-path.log 2>&1; then
    echo "GREEN"
  else
    echo "RED"
  fi
}

# Did ANY of the four files change?
changed() {
  cmp -s "$BACKUP_DIR/core.bak" "$CORE" \
    && cmp -s "$BACKUP_DIR/ui.bak" "$UI" \
    && cmp -s "$BACKUP_DIR/page.bak" "$PAGE" \
    && cmp -s "$BACKUP_DIR/nav.bak" "$NAV" \
    && return 1
  return 0
}

CAUGHT=0
NOOPS=0
MISSED=0
CONTROLS_OK=0
CONTROLS_BROKEN=0

attack() {
  local name="$1"; shift
  restore
  "$@"

  if ! changed; then
    echo "  NO-OP       | $name  <-- MUTATION NEVER APPLIED, this line proves nothing"
    NOOPS=$((NOOPS + 1))
    restore
    return
  fi

  if [ "$(run_suite)" = "RED" ]; then
    echo "  CAUGHT      | $name"
    CAUGHT=$((CAUGHT + 1))
  else
    echo "  NOT CAUGHT  | $name"
    MISSED=$((MISSED + 1))
  fi
  restore
}

control() {
  local name="$1"; shift
  restore
  "$@"

  if ! changed; then
    echo "  NO-OP       | control never applied - $name  <-- proves nothing"
    NOOPS=$((NOOPS + 1))
    restore
    return
  fi

  if [ "$(run_suite)" = "GREEN" ]; then
    echo "  CORRECT     | control stayed GREEN - $name"
    CONTROLS_OK=$((CONTROLS_OK + 1))
  else
    echo "  BROKEN      | control went RED   - $name  <-- gate fails on anything"
    CONTROLS_BROKEN=$((CONTROLS_BROKEN + 1))
  fi
  restore
}

# ── Controls ──────────────────────────────────────────────────────────────────

# An ordinary comment. Changes no claim whatsoever.
c_comment() {
  printf '\n// An editorial note added by the control. No claim changes.\n' >> "$CORE"
}

# A unit's `whyHere` is an ARGUMENT, not a fact (rule 66c). Rewording it must not
# break the build, or nobody will ever improve the teaching.
c_prose() {
  perl -0pi -e 's/whyHere:\s*\n?\s*"/whyHere:\n      "Reworded by the control. /' "$UI" "$CORE"
}

# Swapping two lessons INSIDE one unit. The gate promises each lesson appears
# exactly once and that UNITS are ordered deliberately; it must not freeze the
# order within a unit.
c_swap_within_unit() {
  perl -0pi -e 's/(\["s-corp-year", "aaaMustOpenAtZero"\],\n)(\s*\["s-corp-year", "openingBalancesMustBeCarriedForward"\],\n)/$2$1/' "$CORE"
}

# ── Attacks on the CURRICULUM (coverage: the original sin of slice C) ─────────

# 1. Drop a lesson from the course. THE defect slice C exists to prevent: a
#    finished lesson that no screen shows. The course would still look complete.
t_drop_lesson() {
  perl -0pi -e 's{\s*\["reconciliation", "filedFigure"\],\n}{\n}' "$CORE"
}

# 2. Drop an ENTIRE unit. 17 lessons vanish; the tab strip still looks tidy.
t_drop_unit() {
  perl -0pi -e 's{\n\s*\{\n\s*key: "when-late",[\s\S]*?\n\s*\},\n}{\n}' "$CORE"
}

# 3. Teach a lesson TWICE. Coverage still reports "all lessons placed" if the
#    check counts total placements rather than distinct lessons.
t_duplicate() {
  perl -0pi -e 's/(\["reconciliation", "filedFigure"\],\n)/$1      ["reconciliation", "filedFigure"],\n/' "$CORE"
}

# 4. Point the curriculum at a function that does not exist. This is the EXACT
#    defect that actually happened in this slice: 37 of 42 entries were invented
#    names that looked entirely plausible (`validateW4`, `closePeriod`).
t_invented_name() {
  perl -0pi -e 's/\["period-close", "periodLabel"\]/["period-close", "closePeriod"]/' "$CORE"
}

# 5. Point a lesson at the WRONG MODULE. `daysBetween` exists in BOTH penalties
#    and interest, so a key on the function name alone would silently accept
#    this and teach the wrong lesson under the right name.
t_wrong_module() {
  perl -0pi -e 's/\["interest", "daysBetween"\]/["penalties", "daysBetween"]/' "$CORE"
}

# 6. Empty a unit out. A tab that opens onto nothing.
t_empty_unit() {
  perl -0pi -e 's/(key: "pay-run",[\s\S]*?lessons: \[)[\s\S]*?(\],)/$1$2/' "$CORE"
}

# ── Attacks on DERIVED COUNTS (the "computed, never typed" promise) ───────────

# 7. Hard-code the total into the subtitle. Correct on the day it is typed and
#    wrong forever after, without ever going red. This is the mutation the
#    single most important test in the file exists to catch.
t_hardcode_total() {
  perl -0pi -e 's/\$\{total\}/82/' "$UI"
  perl -0pi -e 's/allLessons\(\)\.length/82/' "$UI"
}

# 8. Make the coverage banner claim green unconditionally. The banner is the one
#    thing standing between Michael and a course that silently shrank.
#
#    NOTE: the first version of this mutation guessed at a `coverage.isComplete`
#    ternary that does not exist - `coverageBanner` uses two early returns, one
#    per failure mode. The campaign reported NO-OP rather than scoring a kill,
#    which is the whole reason rule 72 requires the cmp check. The real shape is
#    attacked here: neutralise both guard conditions so the function always
#    falls through to its green return.
t_banner_always_green() {
  perl -0pi -e 's/if \(coverage\.dangling\.length > 0\) \{/if (false) {/' "$UI"
  perl -0pi -e 's/if \(coverage\.unplaced\.length > 0\) \{/if (false) {/' "$UI"
}

# ── Attacks on the LESSON CARD (colour, order, and the mentor's real words) ───

# 9. Swap two field TONES. Colour is Michael's primary channel - he said the
#    verbatim panels were "hard to digest as there is a wall of words and
#    colour". If orange stops meaning "the trap", the whole screen lies quietly.
t_swap_tones() {
  perl -0pi -e 's/\{ label: FIELD_LABELS\.theTrap, body: lesson\.theTrap, tone: "orange" \}/{ label: FIELD_LABELS.theTrap, body: lesson.theTrap, tone: "green" }/' "$UI"
}

# 10. Reorder the four teaching blocks so the fix appears before the trap.
t_reorder_fields() {
  perl -0pi -e 's/(\{ label: FIELD_LABELS\.theTrap[^\n]*\n)(\s*\{ label: FIELD_LABELS\.whatIWouldDo[^\n]*\n)/$2$1/' "$UI"
}

# 11. Silently drop a whole teaching block from every card. `whyItExists` is the
#     one that answers "why does this rule exist at all" - the part Michael
#     specifically asked for.
t_drop_field() {
  perl -0pi -e 's/\s*\{ label: FIELD_LABELS\.whyItExists[^\n]*\n//' "$UI"
}

# 12. Truncate the mentor's words instead of showing them. A card that shows the
#     first 60 characters LOOKS populated and teaches nothing.
t_truncate_body() {
  perl -0pi -e 's/body: lesson\.plainEnglish,/body: lesson.plainEnglish.slice(0, 60),/' "$UI"
}

# 13. Cite an authority that does not exist. An amber panel with a citation that
#     resolves to nothing is worse than no citation - it manufactures confidence.
t_bad_citation() {
  perl -0pi -e 's/authorityIds: lesson\.authorityIds,/authorityIds: [...lesson.authorityIds, "rcw-00-000-nonexistent"],/' "$UI"
}

# 14. Drop the "no citation for this one" note, leaving a blank space where a
#     reader cannot tell absence from breakage (rule 12: never silently plug).
t_drop_no_authority_note() {
  perl -0pi -e 's/lesson\.authorityIds\.length === 0 \? NO_AUTHORITY_NOTE : null/null/' "$UI"
}

# ── Attacks on NAVIGATION and REACHABILITY (the original sin, again) ─────────

# 15. Remove the screen from the navigation. The page still exists, still passes
#     its own tests, and nobody can reach it. This is books-44 undone.
t_remove_from_nav() {
  perl -0pi -e 's{[^\n]*/admin/books/learn[^\n]*\n}{}' "$NAV"
}

# 16. Remove the access gate. Payroll teaching is not public.
#
#     THIS ONE FOUND A REAL HOLE. The assertion read
#     `expect(page).toContain("requireBooksAccess")`, which the IMPORT LINE
#     satisfies all by itself - so deleting the call left an unused import, an
#     ungated accounting screen, and a green suite. The test now requires the
#     awaited call. Kept here permanently as the regression witness.
t_remove_access_gate() {
  perl -0pi -e 's/await requireBooksAccess\(\);//' "$PAGE"
}

# 16b. Subtler version of the same attack: keep the call but stop awaiting it.
#      A floating promise does not block the render, so the page paints for a
#      user who was never authorised. This is why the assertion matches `await`.
t_unawaited_gate() {
  perl -0pi -e 's/await requireBooksAccess\(\);/requireBooksAccess();/' "$PAGE"
}

# 17. Break the previous/next chain so the course dead-ends halfway. Michael
#     could walk the units and never learn the last three existed.
#
#     NOTE: another guessed pattern that never landed. `buildUnitView` reads
#     `const next = CURRICULUM[index + 1];` and then null-checks it, so the real
#     way to sever the chain is to make the lookup fail past unit four.
t_break_chain() {
  perl -0pi -e 's/const next = CURRICULUM\[index \+ 1\];/const next = index < 3 ? CURRICULUM[index + 1] : undefined;/' "$UI"
}

# 18. Build a Tailwind class by concatenation. Compiles fine, type-checks fine,
#     renders COLOURLESS - Tailwind only emits classes it can literally see.
t_tailwind_concat() {
  perl -0pi -e 's/border-emerald-400\/35/border-" + "emerald-400\/35/' "$PAGE"
}

# ── Attacks on SEARCH ────────────────────────────────────────────────────────

# 19. Let a one-character query through, returning nearly every lesson and
#     looking exactly like a search that worked.
t_allow_short_query() {
  perl -0pi -e 's/MIN_QUERY_LENGTH = 2/MIN_QUERY_LENGTH = 1/' "$UI"
}

# 20. Search names only, not the teaching. Michael would search "I-9" and be
#     told the system does not cover it, which is false.
t_search_names_only() {
  perl -0pi -e 's/matchedIn: "the teaching"/matchedIn: "the name"/' "$UI"
  perl -0pi -e 's/(plainEnglish|whyItExists|theTrap|whatIWouldDo)\.toLowerCase\(\)\.includes\(q\)/false/g' "$UI"
}

# 21. Return a silent empty list for a miss instead of saying so. "Nothing found"
#     with no explanation reads as "this system has nothing on that", when the
#     truth may be a typo.
t_silent_miss() {
  perl -0pi -e 's/does not cover it yet/matched/' "$UI"
}

# ── Attacks on the REFUSALS (rule 27: refuse rather than default) ─────────────

# 22. Default an unknown accent to grey instead of throwing. A new unit would
#     silently render colourless and nobody would know it was unfinished.
t_accent_default() {
  perl -0pi -e 's/throw new Error\(\s*\n?\s*`NO ACCENT/return "slate"; throw new Error(\n      `NO ACCENT/' "$UI"
  perl -0pi -e 's/(export function accentFor\([^)]*\)[^{]*\{)/$1\n  return "slate";/' "$UI"
}

# 23. Fall back to the first unit on an unknown key WITHOUT saying so. The URL
#     says one thing, the screen shows another, and nothing mentions it.
#
#     NOTE: the guessed pattern targeted the object property `unknownUnitRequested:
#     unknownUnitRequested,` but the code uses shorthand, so nothing matched. The
#     real assignment is the ternary that computes it.
t_silent_fallback() {
  perl -0pi -e 's/const unknownUnitRequested = requested && !found \? requested : null;/const unknownUnitRequested = null;/' "$UI"
}

# 24. Turn the well-formedness assertion into a no-op. Every structural promise
#     above rests on it; switching it off is the single cheapest way to make a
#     broken curriculum look healthy.
#     THIS ONE FOUND THE SECOND REAL HOLE, and the worst of the two. The whole
#     body became `return;` and the suite stayed GREEN, because every assertion
#     about this function was "it does not throw on a correct curriculum" - a
#     no-op passes that perfectly. The function now takes the units it inspects
#     so the suite can feed it broken ones and require each complaint.
t_gate_noop() {
  perl -0pi -e 's/(export function assertCurriculumIsWellFormed\([\s\S]*?\): void \{)/$1\n  return;/' "$CORE"
}

# 24b. Switch off ONE branch of the gate rather than all of it. Wholesale
#      deletion is easy to spot in review; a single condition flipped to `false`
#      during debugging and never restored is the realistic version.
t_gate_one_branch() {
  perl -0pi -e 's/if \(dupes\.length > 0\) \{/if (false) {/' "$CORE"
}

# 24c. The UI gate, silenced the same way. It is the only thing asserting that
#      two units never share a colour.
t_ui_gate_noop() {
  perl -0pi -e 's/(export function assertLearningUiIsWellFormed\([\s\S]*?\): void \{)/$1\n  return;/' "$UI"
}

# ── Run ──────────────────────────────────────────────────────────────────────

echo ""
echo "══════════════════════════════════════════════════════════════════════════"
echo " MUTATION CAMPAIGN: the learning path gate (books-44)"
echo " subject: $TEST"
echo "══════════════════════════════════════════════════════════════════════════"
echo ""
echo "CONTROLS (must stay GREEN - rule 55, refusal must discriminate)"
control "an ordinary comment added to the curriculum"      c_comment
control "a unit's prose explanation reworded"              c_prose
control "two lessons swapped WITHIN one unit"              c_swap_within_unit

echo ""
echo "ATTACKS ON COVERAGE (the buried-lesson defect itself)"
attack "a finished lesson dropped from the course"         t_drop_lesson
attack "an entire unit deleted, 17 lessons with it"        t_drop_unit
attack "one lesson taught twice"                           t_duplicate
attack "curriculum names a function that does not exist"   t_invented_name
attack "daysBetween pointed at the wrong module"           t_wrong_module
attack "a unit emptied out, tab opens onto nothing"        t_empty_unit

echo ""
echo "ATTACKS ON DERIVED COUNTS (computed, never typed)"
attack "the lesson total hard-coded into the subtitle"     t_hardcode_total
attack "coverage banner reports green unconditionally"     t_banner_always_green

echo ""
echo "ATTACKS ON THE LESSON CARD (colour, order, real words)"
attack "the trap's colour changed to the fix's colour"     t_swap_tones
attack "the fix shown before the trap"                     t_reorder_fields
attack "the 'why this exists' block dropped from cards"    t_drop_field
attack "the mentor's words truncated to 60 characters"     t_truncate_body
attack "a citation added that resolves to nothing"         t_bad_citation
attack "the 'no citation here' note removed"               t_drop_no_authority_note

echo ""
echo "ATTACKS ON REACHABILITY (books-44, undone)"
attack "the screen removed from the navigation"            t_remove_from_nav
attack "the books access gate removed from the page"       t_remove_access_gate
attack "the gate called but never awaited"                 t_unawaited_gate
attack "prev/next chain dead-ends after four units"        t_break_chain
attack "a Tailwind class built by concatenation"           t_tailwind_concat

echo ""
echo "ATTACKS ON SEARCH"
attack "one-character queries allowed through"             t_allow_short_query
attack "search stops reading the teaching, names only"     t_search_names_only
attack "a miss no longer explains itself"                  t_silent_miss

echo ""
echo "ATTACKS ON THE REFUSALS (rule 27)"
attack "unknown accent defaults to grey instead of throwing" t_accent_default
attack "unknown unit falls back with no notice"            t_silent_fallback
attack "the well-formedness assertion turned into a no-op" t_gate_noop
attack "one branch of the curriculum gate switched off"    t_gate_one_branch
attack "the UI well-formedness assertion turned into a no-op" t_ui_gate_noop

TOTAL=$((CAUGHT + MISSED))
echo ""
echo "══════════════════════════════════════════════════════════════════════════"
echo " RESULT"
echo "══════════════════════════════════════════════════════════════════════════"
echo "  attacks landed and caught : $CAUGHT / $TOTAL"
echo "  attacks landed and MISSED : $MISSED"
echo "  mutations that never applied (prove nothing) : $NOOPS"
echo "  controls correct (stayed green) : $CONTROLS_OK"
echo "  controls BROKEN (gate over-fitted) : $CONTROLS_BROKEN"
echo ""

if [ "$NOOPS" -gt 0 ]; then
  echo "  ! $NOOPS mutation(s) never landed. Those lines are a defect in THIS"
  echo "    script, not evidence about the gate (rule 72). Fix the patterns."
fi
if [ "$CONTROLS_BROKEN" -gt 0 ]; then
  echo "  ! A control went red. The gate refuses harmless edits, which means the"
  echo "    kill rate above is measuring brittleness, not rigour (rule 55)."
fi
if [ "$MISSED" -gt 0 ]; then
  echo "  ! $MISSED attack(s) survived. Each one is a way the course could"
  echo "    silently shrink or lie while the suite stayed green (rule 50)."
fi

if [ "$MISSED" -eq 0 ] && [ "$CONTROLS_BROKEN" -eq 0 ] && [ "$NOOPS" -eq 0 ]; then
  echo "  Every landed attack was caught, and every harmless edit was allowed."
  exit 0
fi
exit 1
