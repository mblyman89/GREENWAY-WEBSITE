#!/usr/bin/env python3
"""
mutate-slice-books-90.py  --  can the books-90 tests actually fail?

Standing rule 13c: a test that cannot fail is worse than no test.
Standing rule 133(g): the probe MUST include severing the door.

This slice sends Michael an email about large entries waiting in the books. The
failure that matters is not "the email looks wrong" — it is "the email never
arrives and nothing says so". Several mutations below are exactly that shape:
the code still compiles, the run still reports success, and the warning simply
stops. Those are the ones worth catching.

Usage:  python3 scripts/compliance/mutate-slice-books-90.py
Exit 0 only if EVERY mutation is caught.
"""
import io
import re
import subprocess
import sys

TESTS = [
    "tests/compliance/large-draft-notice.test.ts",
]

# The pure core is covered by the self-test sweep, not vitest, so the probe
# runs that too — otherwise mutations to the planner's arithmetic would look
# uncaught when they are in fact caught by a different gate.
SELFTEST = ["npx", "tsx", "scripts/compliance/run-pure-selftests.ts"]

CORE = "src/lib/accounting/large-draft-notice-core.ts"
STORE = "src/lib/accounting/large-draft-notice-store.ts"
ENGINE = "src/lib/notifications/compliance-reminders.ts"
ACTIONS = "src/app/admin/compliance/calendar/actions.ts"
PAGE = "src/app/admin/compliance/calendar/page.tsx"
PANEL = "src/components/admin/compliance/SendRemindersNowPanel.tsx"

MUTATIONS = [
    # ---- RULE 133(g): SEVER THE DOOR ----------------------------------------
    (
        "the engine never calls the planner -- the email silently stops forever",
        ENGINE,
        "      const notice = planLargeDraftNotice(todayIso, draftRead.drafts);",
        "      const notice = null;",
    ),
    (
        "the panel is removed from the page, so the button is on no screen",
        PAGE,
        "          <SendRemindersNowPanel />",
        "          <span />",
    ),
    (
        "the button no longer calls the action",
        PANEL,
        "              setResult(await sendRemindersNowAction());",
        "              setResult(null);",
    ),
    (
        "the action no longer runs the engine, so pressing the button does nothing",
        ACTIONS,
        "  const result = await runComplianceReminders();",
        "  const result = { ran: false, planned: 0, sent: 0, deduped: 0, unsent: 0, notes: [] };",
    ),
    # ---- the gate ------------------------------------------------------------
    (
        "the permission gate is dropped from the send action",
        ACTIONS,
        '  const session = await requirePermission("compliance.calendar");\n\n  const result = await runComplianceReminders();',
        "  const session = await requirePermission(\"reports.view\");\n\n  const result = await runComplianceReminders();",
    ),
    # ---- rule 46: silence must never mean "all clear" -----------------------
    (
        "a failed books read is swallowed, so 'no email' looks like 'nothing waiting'",
        ENGINE,
        "    if (!draftRead.ok) {",
        "    if (false) {",
    ),
    (
        "the store returns an empty list instead of an error when the query fails",
        STORE,
        "  return { ok: false, message, drafts: [], unreadable: 0 };",
        "  return { ok: true, message, drafts: [], unreadable: 0 };",
    ),
    # ---- the threshold rule --------------------------------------------------
    (
        "an entry exactly AT $5,000 stops being flagged (>= becomes >)",
        CORE,
        "  return f.totalCents >= f.thresholdCents;",
        "  return f.totalCents > f.thresholdCents;",
    ),
    (
        "the exempt source kinds are ignored, so every POS sale is flagged as large",
        CORE,
        "  if (isApprovalExempt(f.sourceKind)) return false;",
        "  if (false) return false;",
    ),
    (
        "an unreadable total is treated as small rather than reported",
        CORE,
        "    if (!Number.isSafeInteger(d.totalCents) || !Number.isSafeInteger(d.thresholdCents)) {\n      unreadable += 1;\n      continue;\n    }",
        "    if (false) {\n      unreadable += 1;\n      continue;\n    }",
    ),
    (
        "a missing policy row defaults the threshold to zero, flagging everything",
        STORE,
        "const FALLBACK_THRESHOLD_CENTS = 500_000;",
        "const FALLBACK_THRESHOLD_CENTS = 0;",
    ),
    # ---- dedupe / cadence ----------------------------------------------------
    (
        "the dedupe key stops changing daily, so it emails once and never again",
        CORE,
        "    dedupeKey: `gl-large-drafts:${todayKey}`,",
        '    dedupeKey: "gl-large-drafts:fixed",',
    ),
    # ---- isolation -----------------------------------------------------------
    (
        "the books planner is no longer isolated, so it can kill the CCRS deadlines",
        ENGINE,
        "  } catch (e) {\n    result.notes.push(\n      `Large-entry planner failed: ${e instanceof Error ? e.message : \"unknown error\"}`,\n    );\n  }",
        "  } catch (e) {\n    throw e;\n  }",
    ),
    # ---- the message ---------------------------------------------------------
    (
        "the email stops naming the amount, so he cannot triage from his phone",
        CORE,
        "      : n === 1\n        ? `Books: a ${formatCents(sorted[0].totalCents)} entry is waiting for you`\n        : `Books: ${n} large entries waiting (${formatCents(combined)})`;",
        '      : n === 1 ? "Books: an entry is waiting" : "Books: entries are waiting";',
    ),
    (
        "the email drops the deep link to the drafts screen",
        CORE,
        "    linkPath: DRAFTS_PATH,",
        '    linkPath: "/admin",',
    ),
]


def run_tests():
    p = subprocess.run(["npx", "vitest", "run", *TESTS], capture_output=True, text=True)
    out = p.stdout + p.stderr
    if p.returncode != 0:
        m = re.search(r"Tests\s+(.*)", out)
        return p.returncode, (m.group(1).strip() if m else "vitest failed")

    # vitest was happy; the pure sweep is the other half of this slice's cover.
    q = subprocess.run(SELFTEST, capture_output=True, text=True)
    if q.returncode != 0:
        return q.returncode, "pure self-tests failed"
    return 0, "green"


def main():
    print("=" * 72)
    print("books-90 mutation probe")
    print("=" * 72)

    code, summary = run_tests()
    if code != 0:
        print(f"BASELINE IS RED ({summary}). Fix the suite before probing it.")
        return 1
    print(f"baseline green: {summary}\n")

    survivors = []
    for i, (label, path, old, new) in enumerate(MUTATIONS, 1):
        src = io.open(path, encoding="utf-8").read()
        n = src.count(old)
        if n != 1:
            print(f"[{i:2}/{len(MUTATIONS)}] ANCHOR MISS ({n}x) in {path}")
            print(f"          {label}")
            survivors.append(f"{label} (anchor {n}x)")
            continue

        io.open(path, "w", encoding="utf-8").write(src.replace(old, new))
        try:
            code, summary = run_tests()
        finally:
            io.open(path, "w", encoding="utf-8").write(src)

        if code == 0:
            print(f"[{i:2}/{len(MUTATIONS)}] SURVIVED  {label}")
            survivors.append(label)
        else:
            print(f"[{i:2}/{len(MUTATIONS)}] caught    {label}")

    print("=" * 72)
    caught = len(MUTATIONS) - len(survivors)
    print(f"{caught}/{len(MUTATIONS)} caught")
    if survivors:
        print("\nSURVIVORS - the suite cannot tell these apart from correct code:")
        for s in survivors:
            print(f"  - {s}")
        return 1
    print("every mutation was caught.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
