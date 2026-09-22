#!/usr/bin/env python3
"""
scripts/compliance/mutate-leafly-l17-deadline.py

Rule 13c: a test that cannot fail is worse than no test. This breaks slice
L-17 on purpose, one edit at a time, and demands that the suite NOTICE. A
surviving mutation is a hole in the tests, not a win.

WHY THIS SLICE NEEDS ITS OWN PROBE
----------------------------------
The owner's report was: "i can click the acknowledge button, confirm the
action, then it sits waiting forever stuck."

The defect had a property that makes it unusually hard to test for: THE CODE
WAS CORRECT. Every Leafly request was well-formed, correctly authenticated,
sent to the right host, and handled properly on return. It simply had no
deadline, so on the one occasion the network did not answer, the whole
operation waited forever. Nothing threw. Nothing logged. No assertion
anywhere in the repository had an opinion.

That is the shape this probe has to defend against, and it comes in four
families:

  * THE DEADLINE GOING AWAY. If any Leafly fetch loses its timeout, the
    original bug is back in full and every existing test still passes,
    because every existing test uses a fetch that answers immediately. This
    is the family the "no raw fetch()" assertion exists for.

  * THE DEADLINE BEING PRESENT BUT USELESS. A budget of ten minutes, or an
    "unlimited" escape hatch, or a timer that is never attached to the
    request. All of these look like a fix in review and behave like the bug
    in production.

  * LYING ABOUT WHAT A TIMEOUT MEANS. This is the expensive one, and it is
    not a UI concern. When we stop listening we do NOT learn that nothing
    arrived. If a timed-out acknowledge is reported as "safe to retry", an
    operator presses the button again and may acknowledge the same order
    twice. Leafly's spec: acknowledgement permanently revokes access to the
    order's media. There is no undo, and the customer's ID images are gone.

  * THE BUTTON LOOKING DEAD AGAIN. Fixing the server and leaving the button
    visually inert would leave the owner with the identical complaint. The
    repo has already had this exact bug once (AnnouncerPanel.tsx:175).

Rule 133g: at least one mutation must SEVER THE DOOR. The door here is the
wiring itself -- the budget can be perfect and the classification flawless
while the call site quietly goes around the helper. Mutations 14-17 cut
there.

Rule 137: an ambiguous anchor is not a probe. The harness requires EXACTLY
ONE match for every anchor and FAILS otherwise.

THE CONTROL (rule: prove the probe can say "no")
------------------------------------------------
The last entry is a deliberate NO-OP: a comment reworded. It MUST survive.
If the control is reported as caught, the suite is failing for a reason that
has nothing to do with the mutation -- a flaky test, a stale build, a
polluted global -- and every "caught" above it is meaningless.

Usage:  python3 scripts/compliance/mutate-leafly-l17-deadline.py
"""
import io
import subprocess
import sys

CORE = "src/lib/leafly/deadline-core.ts"
FETCH = "src/lib/leafly/deadline-fetch.ts"
ACK_CORE = "src/lib/leafly/order-ack-core.ts"
ACK_SRV = "src/lib/leafly/order-ack-server.ts"
TOKEN = "src/lib/leafly/token.ts"
PUSH = "src/lib/leafly/push.ts"
UI = "src/components/admin/orders/LeaflyOrderActions.tsx"

TESTS = [
    "tests/compliance/leafly-deadline.test.ts",
]

# The pure self-test sweep is part of the harness for this slice: the budget
# invariants and the 8x5 verdict matrix live there behind an assertion floor,
# and several mutations below are aimed squarely at them.
SELFTESTS = ["npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]

# (label, file, find, replace)
MUTATIONS = [
    # ── THE DEADLINE GOING AWAY: the original bug, restored ────────────────
    ("1  the budget becomes effectively infinite (the bug, verbatim)",
     CORE,
     "  acknowledge: 12_000,",
     "  acknowledge: 86_400_000,"),

    ("2  the signal is never attached, so the timer aborts nothing",
     FETCH,
     "    const response = await fetch(url, { ...init, signal: controller.signal });",
     "    const response = await fetch(url, { ...init });"),

    ("3  the abort fires but we forget we caused it",
     FETCH,
     "  const timer = setTimeout(() => {\n    weAborted = true;\n    controller.abort();\n  }, budgetMs);",
     "  const timer = setTimeout(() => {\n    controller.abort();\n  }, budgetMs);"),

    ("4  the timer is never started at all",
     FETCH,
     "  }, budgetMs);",
     "  }, 2_147_483_647);"),

    ("5  the timer leaks: no clearTimeout",
     FETCH,
     "  } finally {\n    clearTimeout(timer);\n  }",
     "  } finally {\n    void timer;\n  }"),

    # ── THE DEADLINE PRESENT BUT USELESS ───────────────────────────────────
    ("6  an unknown operation gets no budget instead of the tightest one",
     CORE,
     "  return LEAFLY_TIMEOUT_MS.token_mint;",
     "  return Number.MAX_SAFE_INTEGER;"),

    ("7  the mint is slower than the operation it precedes",
     CORE,
     "  token_mint: 8_000,",
     "  token_mint: 120_000,"),

    ("8  the worst case forgets that every retry re-mints a token",
     CORE,
     "  return attempts * (per + LEAFLY_TIMEOUT_MS.token_mint);",
     "  return attempts * per;"),

    ("9  the attended operations inherit the menu's six retries",
     CORE,
     "  acknowledge: 2,\n  status_push: 2,",
     "  acknowledge: 6,\n  status_push: 6,"),

    ("10 the status check's real 3 attempts are rounded to 2",
     CORE,
     "  integration_status: 3,",
     "  integration_status: 2,"),

    # ── LYING ABOUT WHAT A TIMEOUT MEANS (the customer-safety family) ──────
    ("11 SAFETY: a timeout claims the request certainly never arrived",
     CORE,
     '  const certainlyNotDelivered = fault !== "timeout" && fault !== "unknown";',
     "  const certainlyNotDelivered = true;"),

    ("12 SAFETY: a timed-out acknowledge is offered as safe to repeat",
     CORE,
     "    safeToRetry: certainlyNotDelivered || !irreversible,",
     "    safeToRetry: true,"),

    ("13 SAFETY: acknowledge stops counting as irreversible",
     CORE,
     '  return operation === "acknowledge";',
     "  return false;"),

    ("13b an unrecognised network error is GUESSED as offline",
     CORE,
     '  const certainlyNotDelivered = fault !== "timeout" && fault !== "unknown";',
     '  const certainlyNotDelivered = fault !== "timeout";'),

    # ── THE DOOR (rule 133g): the helper is perfect and never reached ──────
    ("14 DOOR: the token mint goes around the helper (untimed again)",
     TOKEN,
     '  const attempt = await leaflyFetchWithDeadline("token_mint", tokenUrl, {',
     '  const attempt = await leaflyFetchWithDeadlineBYPASS("token_mint", tokenUrl, {'),

    ("15 DOOR: the acknowledge POST goes around the helper",
     ACK_SRV,
     "      const attempt = await leaflyFetchWithDeadline(operation, url, {",
     "      const attempt = await leaflyFetchWithDeadlineBYPASS(operation, url, {"),

    ("16 DOOR: the menu wrapper swallows a failure it used to propagate",
     PUSH,
     "    if (!call.ok) {\n      throw new Error(call.verdict.message);\n    }",
     "    if (!call.ok) {\n      return { ok: true, status: 200, body: null };\n    }"),

    ("17 DOOR: the status check inherits the menu push budget",
     PUSH,
     'await authedFetch(statusUrl(), "GET", "integration_status");',
     'await authedFetch(statusUrl(), "GET", "menu_push");'),

    # ── THE BUTTON LOOKING DEAD AGAIN ─────────────────────────────────────
    ("18 UI: the pending flag is read but never used to disable",
     UI,
     "        disabled={pending}\n        aria-busy={pending}",
     "        disabled={false}\n        aria-busy={pending}"),

    ("19 UI: the label no longer changes while the request is in flight",
     UI,
     "  const label = pending ? action.busyLabel : action.label;",
     "  const label = action.label;"),

    ("20 UI: the spinner is removed",
     UI,
     'className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent align-[-1px]"',
     'className="mr-1.5 inline-block h-3 w-3 rounded-full"'),

    ("21 WORDING: the busy label claims the acknowledgement already happened",
     ACK_CORE,
     'export const LEAFLY_ACK_ACTION_BUSY_LABEL = "Sending to Leafly\u2026";',
     'export const LEAFLY_ACK_ACTION_BUSY_LABEL = "Acknowledged\u2026";'),

    ("22 WORDING: a status action falls back to its own idle label",
     ACK_CORE,
     '    const busyLabel = wording ? wording.busyLabel : "Sending to Leafly\u2026";',
     "    const busyLabel = label;"),

    # ── CONTROL: must SURVIVE ─────────────────────────────────────────────
    ("CONTROL (must survive) - reword a comment, change no behaviour",
     FETCH,
     "  // Set BEFORE the abort call, read after the throw. This is the fact that",
     "  // Set before the abort call and read after the throw -- this is the fact that"),
]


def run_suite() -> bool:
    """True when EVERYTHING passes: the targeted tests and the pure sweep."""
    tests = subprocess.run(
        ["./node_modules/.bin/vitest", "run", *TESTS],
        capture_output=True,
        text=True,
    )
    if tests.returncode != 0:
        return False
    pure = subprocess.run(SELFTESTS, capture_output=True, text=True)
    return pure.returncode == 0


def preflight() -> int:
    """
    Refuse to start against a tree that is already broken or already mutated.

    Learned the hard way. The first run of this probe was started twice by
    accident (a foreground invocation that appeared to time out, plus a
    background one). Two processes edited the same files in lockstep, so each
    restored the OTHER's mutation as if it were the original, and the run
    ended with a mutation committed into the working tree and an anchor that
    matched zero times.

    Two defences, both here rather than in a comment:
      1. Every anchor must be present before anything is touched. A stale or
         already-mutated anchor stops the run at zero cost instead of after
         fifteen minutes of edits.
      2. The suite must be GREEN to begin with. A probe that starts red will
         report every mutation as "caught" while proving nothing at all --
         the same failure mode the CONTROL exists to catch, but earlier.
    """
    stale = []
    for label, path, find, _repl in MUTATIONS:
        body = io.open(path, encoding="utf-8").read()
        hits = body.count(find)
        if hits != 1:
            stale.append(f"  {label}\n    {path}: matched {hits}, expected 1")
    if stale:
        print("PREFLIGHT FAILED - anchors are not where this probe expects them.")
        print("If a previous run was interrupted, check `git diff` before rerunning:\n")
        print("\n".join(stale))
        return 2

    print("preflight: all anchors present; checking the suite is green to start...")
    if not run_suite():
        print(
            "PREFLIGHT FAILED - the suite is RED before any mutation was applied.\n"
            "Every mutation would be reported as 'caught' and none of it would\n"
            "mean anything. Fix the suite first."
        )
        return 2
    print("preflight: green.\n")
    return 0


def main() -> int:
    pre = preflight()
    if pre != 0:
        return pre

    # A snapshot of every file this probe may touch, taken once, before
    # anything is edited. The per-mutation `finally` restores the file it just
    # changed; this restores EVERYTHING no matter how the run ends -- including
    # a Ctrl-C, a kill, or an early `return` added by a future edit. Leaving a
    # deliberate defect in the working tree is the one outcome a mutation probe
    # must never produce, because it is indistinguishable from a real bug.
    snapshot = {path: io.open(path, encoding="utf-8").read() for _l, path, _f, _r in MUTATIONS}

    try:
        return _run(snapshot)
    finally:
        for path, body in snapshot.items():
            if io.open(path, encoding="utf-8").read() != body:
                io.open(path, "w", encoding="utf-8").write(body)
                print(f"  (restored {path})")


def _run(snapshot: dict) -> int:
    caught, survived = 0, []
    control_label = None
    control_survived = False

    for label, path, find, repl in MUTATIONS:
        original = io.open(path, encoding="utf-8").read()
        hits = original.count(find)
        # Rule 137: exactly one, or this is not a probe. Zero means the anchor
        # went stale; more than one means the probe may be cutting somewhere
        # other than where its label claims.
        #
        # Preflight already checked all of these, so reaching this branch means
        # something changed the file MID-RUN -- a second copy of this script, a
        # watcher, an editor. Restoring first is not optional: returning here
        # without it is what left a mutation in the working tree once already.
        if hits != 1:
            print(f"  ERROR  {label}")
            print(f"         anchor matched {hits} times in {path}; expected exactly 1")
            print("         The file changed after preflight. Check `git diff`.")
            print("         FAILING rather than skipping (rules 48, 137).")
            return 2

        is_control = label.startswith("CONTROL")
        io.open(path, "w", encoding="utf-8").write(original.replace(find, repl, 1))
        try:
            passed = run_suite()
            if is_control:
                control_label = label
                control_survived = passed
                print(f"  {'SURVIVED  ' if passed else 'caught    '}{label}")
            elif passed:
                survived.append(label)
                print(f"  SURVIVED  {label}")
            else:
                caught += 1
                print(f"  caught    {label}")
        finally:
            io.open(path, "w", encoding="utf-8").write(original)

    real = len(MUTATIONS) - 1
    print(f"\n{caught}/{real} real mutations caught")

    failed = False
    if survived:
        print("\nSURVIVORS (these are holes in the tests):")
        for s in survived:
            print(f"  - {s}")
        failed = True

    # The control is not scored with the others. It is the probe's own
    # calibration: a suite that goes red when nothing changed is not
    # detecting mutations, it is just red.
    if control_label is not None and not control_survived:
        print(
            "\nCONTROL WAS CAUGHT. The suite fails on a no-op edit, so every\n"
            "'caught' above proves nothing. Fix the flakiness before trusting\n"
            "this probe."
        )
        failed = True

    if failed:
        return 1
    print("Every deliberate break was noticed, and the control survived.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
