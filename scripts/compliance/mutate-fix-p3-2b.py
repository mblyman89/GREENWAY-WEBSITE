"""
scripts/compliance/mutate-fix-p3-2b.py

Fix Phase 3.2b (F-04-11, F-04-3): a line that did not save at staging is
seen, and Finalize cannot pass over it silently; the undecided lines are
named. Owner, verbatim (owner message 7):
  "I want this table to receive every manifest, no exceptions. If there are
   other things you feel as the expert you are, add in these things as you
   go."

Rule 13c: a test that cannot fail is worse than no test. Rule 137: every
anchor must match EXACTLY once or the harness fails.

Usage:  python3 scripts/compliance/mutate-fix-p3-2b.py
"""
import io
import subprocess
import sys

CORE = "src/lib/inventory/intake-staging-core.ts"
STORE = "src/lib/inventory/intake-store.ts"
PLAN = "src/lib/inventory/finalize-label-core.ts"
ACT = "src/app/admin/inventory/intake/actions.ts"
PAGE = "src/app/admin/inventory/intake/[id]/page.tsx"
INB = "src/lib/inbound-email/inbound-store.ts"
LABELS = "src/lib/inventory/manifest-event-labels-core.ts"

TESTS = [
    "tests/compliance/fix-p3-2b-intake-visibility.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # --- staging
    ("store: a failed lot insert is not collected", STORE,
     "      lineFailures.push({\n        lineNo: lineIndex + 1,", "      void ({\n        lineNo: lineIndex + 1,"),
    ("store: no timeline event for the failures", STORE,
     "    await logManifestEvent(manifestId, LOT_INSERT_FAILED_EVENT, note, actorId);", "    void note;"),
    ("store: lineFailures not returned", STORE,
     "  return failureReport ? { ok: true, manifestId, lineFailures: failureReport } : { ok: true, manifestId };", "  return { ok: true, manifestId };"),
    ("store: the 0234 retry error is dropped", STORE,
     "      lotErr = retryErr;\n", "      lotErr = null;\n"),
    ("store: line numbers off by one", STORE,
     "        lineNo: lineIndex + 1,", "        lineNo: lineIndex,"),
    # --- finalize
    ("store: the missing-lines gate never refuses", STORE,
     "  if (!missingGate.ok) return { ok: false, error: missingGate.error };", "  if (false) return { ok: false, error: \"\" };"),
    ("store: an unreadable timeline is read as nothing missing", STORE,
     "  if (failRead.error) {\n    return { ok: false, error: `The delivery's timeline", "  if (false) {\n    return { ok: false, error: `The delivery's timeline"),
    ("store: the tick is ignored (always confirmed)", STORE,
     "missingLinesGate(missingLines, opts?.missingLinesConfirmed === true)", "missingLinesGate(missingLines, true)"),
    ("store: missing lines do not make the finalize partial", STORE,
     "      shortGoingIn.length + missingLines,\n    );\n    const noteCheck", "      shortGoingIn.length,\n    );\n    const noteCheck"),
    ("store: the timeline does not say the missing lines went back", STORE,
     "${finalizeShortSummary(shortGoingIn)}${missingGate.note}", "${finalizeShortSummary(shortGoingIn)}"),
    ("store: the undecided count is not on the timeline", STORE,
     "${undecidedFinalizeNote(undecidedAccepted)}", ""),
    ("store: undecided counts the accepted lines too", STORE,
     "r.disposition !== \"rejected_at_dock\" && r.disposition !== \"accepted\").length;", "r.disposition !== \"rejected_at_dock\").length;"),
    # --- core
    ("core: the count is not read back", CORE,
     "  const m = /^(\\d+) of \\d+ lines? did not save when this manifest was staged/.exec(note ?? \"\");", "  const m = null as RegExpExecArray | null; void note;"),
    ("core: an unreadable note counts as nothing missing", CORE,
     "    lines += Math.max(1, stagingFailureCount(e.note));", "    lines += stagingFailureCount(e.note);"),
    ("core: the gate passes without the tick", CORE,
     "  if (!confirmed) {\n    return {\n      ok: false,", "  if (false) {\n    return {\n      ok: false,"),
    # --- sticky bar
    ("plan: no undecided sentence", PLAN,
     "  if (undecided > 0 && undecided < total) {", "  if (false) {"),
    ("plan: missing lines do not require the note", PLAN,
     "deriveManifestStatus(willActivate, reject, held), short + missing)", "deriveManifestStatus(willActivate, reject, held), short)"),
    # --- wiring
    ("action: the tick is not passed", ACT,
     "{ partialNote, missingLinesConfirmed })", "{ partialNote })"),
    ("action: the refusal is not mapped to ?error=missing_lines", ACT,
     "    if (result.error.includes(MISSING_LINES_REFUSAL)) {", "    if (false) {"),
    ("page: no banner", PAGE,
     "        {stagingFailures.lines > 0 && (\n", "        {false && (\n"),
    ("page: no tick box", PAGE,
     "                {finalizePlan.missing > 0 && (\n", "                {false && (\n"),
    ("page: the plan does not get the missing lines", PAGE,
     "    { missingLines: stagingFailures.lines },\n", ""),
    ("email: the JSON path does not note the failure", INB,
     "      result.manifestIds.push(staged.manifestId);\n      // Fix Phase 3.2b (F-04-11): a line that did not save is said on the email row too.\n      if (staged.lineFailures)", "      result.manifestIds.push(staged.manifestId);\n      // Fix Phase 3.2b (F-04-11): a line that did not save is said on the email row too.\n      if (false)"),
    ("labels: lot_insert_failed not a problem", LABELS,
     "group: \"delivery\", problem: true },\n  // Menu", "group: \"delivery\", problem: false },\n  // Menu"),
]


def run_tests() -> bool:
    proc = subprocess.run(
        ["./node_modules/.bin/vitest", "run", *TESTS],
        capture_output=True,
        text=True,
    )
    return proc.returncode == 0


def main() -> int:
    caught, survived = 0, []

    for label, path, find, repl in MUTATIONS:
        original = io.open(path, encoding="utf-8").read()
        hits = original.count(find)
        # Rule 137: exactly one, or this is not a probe.
        if hits != 1:
            print(f"  ERROR  {label}")
            print(f"         anchor matched {hits} times in {path}; expected exactly 1")
            print("         FAILING rather than skipping (rules 48, 137).")
            return 2

        io.open(path, "w", encoding="utf-8").write(original.replace(find, repl, 1))
        try:
            if run_tests():
                survived.append(label)
                print(f"  SURVIVED  {label}", flush=True)
            else:
                caught += 1
                print(f"  caught    {label}", flush=True)
        finally:
            io.open(path, "w", encoding="utf-8").write(original)

    total = len(MUTATIONS)
    print(f"\n{caught}/{total} mutations caught")
    if survived:
        print("\nSURVIVORS (these are holes in the tests):")
        for s in survived:
            print(f"  - {s}")
        return 1
    print("Every deliberate break was noticed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
