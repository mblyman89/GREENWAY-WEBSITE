"""
scripts/compliance/mutate-fix-p2-6b.py

Fix Phase 2.6b (G-15 end-of-day deposit sheet; F-03-5, F-03-6, F-03-7,
F-03-8, F-00-8). Rule 13c: a test that cannot fail is worse than no test.
This breaks the end-of-day sheet on purpose, one edit at a time, and demands
that the suite NOTICE.

Rule 133g: several mutations SEVER THE DOOR (the page stops rendering a
section, the export route stops refusing, the store stops reporting a read).
Rule 137: every anchor must match EXACTLY once or the harness fails.

Usage:  python3 scripts/compliance/mutate-fix-p2-6b.py
"""
import io
import subprocess
import sys

CORE = "src/lib/registers/eod-sheet-core.ts"
STORE = "src/lib/registers/eod-store.ts"
PAGE = "src/app/admin/registers/eod/page.tsx"
ROUTE = "src/app/admin/registers/eod/export/route.ts"

TESTS = [
    "tests/compliance/fix-p2-6b-eod-sheet.test.ts",
    "tests/compliance/eod-core.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # ── the pure sheet ─────────────────────────────────────────────────────
    ("1  a non-cash tender is counted as cash",
     CORE, '    } else if (p.paymentMethod === "employee_tab") {\n      out.employeeTabCount += 1;',
     '    } else if (p.paymentMethod === "employee_tab") {\n      out.cashSalesMinor += int(p.totalMinor);\n      out.employeeTabCount += 1;'),
    ("2  pending sales are counted as cash",
     CORE, '    if (e.eventType !== "sale" || e.status !== "processed") continue;',
     '    if (e.eventType !== "sale" || e.status === "exception") continue;'),
    ("3  rounding dropped from cash sales",
     CORE, "      out.cashSalesMinor += saleCashMinor(p);", "      out.cashSalesMinor += int(p.totalMinor);"),
    ("4  refunds paid from the safe come off the drawer cash",
     CORE, '    if (r.paidFrom === "drawer") fromDrawersMinor += m;', '    if (r.paidFrom === "drawer" || r.paidFrom === "safe") fromDrawersMinor += m;'),
    ("5  an untied refund is treated as paid from a drawer",
     CORE, "      unattributedCount += 1;\n      unattributedMinor += m;", "      fromDrawersMinor += m;"),
    ("6  net cash is guessed even with an untied refund",
     CORE, "  if (refunds.unattributedCount > 0) {", "  if (false) {"),
    ("7  net cash is shown even after a failed read",
     CORE, "  } else if (readProblems.length > 0) {", "  } else if (false) {"),
    ("8  refunds no longer come off net cash",
     CORE, "    netCashMinor = cash.cashSalesMinor - refunds.fromDrawersMinor;", "    netCashMinor = cash.cashSalesMinor;"),
    ("9  difference sign flipped",
     CORE, "deposit.expectedMinor - netCashMinor : null;", "netCashMinor - deposit.expectedMinor : null;"),
    ("10 BLIND: the night count shows before the recount",
     CORE, "      nightCountMinor: nightShown ? b.nightCountMinor : null,", "      nightCountMinor: b.nightCountMinor,"),
    ("11 BLIND: the night denominations show before the recount",
     CORE, "      nightDenoms: nightShown ? b.nightDenoms : null,", "      nightDenoms: b.nightDenoms,"),
    ("12 BLIND: the comparison leaks the night count",
     CORE, "            : nightShown && b.nightCountMinor !== null", "            : b.nightCountMinor !== null"),
    ("13 bag compared with the night count when the morning count exists",
     CORE, "          : b.morningCountMinor !== null\n            ? b.morningCountMinor - deposit.expectedMinor",
     "          : false\n            ? b.morningCountMinor! - deposit.expectedMinor"),
    ("14 a bag read error says 'no bag yet'",
     CORE, '  } else if (!readProblems.some((p) => p.startsWith("Deposit bag"))) {', "  } else if (true) {"),
    ("15 0316 missing says 'no bag yet'",
     CORE, "  } else if (input.bagMissingSchema) {", "  } else if (false) {"),
    ("16 negative denomination counts accepted",
     CORE, 'out[f.key] = typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 0;', 'out[f.key] = typeof n === "number" ? n : 0;'),
    ("17 export: the morning counter's name dropped from the signature sheet",
     CORE, '          { role: "Morning recount (a DIFFERENT employee)", name: bag?.morningCountedByName ?? "", sign: "", time: "" },\n', ""),
    ("18 export: the deposit total row shows takings only",
     CORE, "          toBag: d.expectedMinor,\n        },", "          toBag: d.totalTakingsMinor,\n        },"),
    # ── the store (F-03-7) ────────────────────────────────────────────────
    ("19 STORE: a failed sessions read is swallowed",
     STORE, "  if (sessionErr) readProblems.push(`Drawer sessions could not be read: ${sessionErr.message}`);\n", ""),
    ("20 STORE: a failed registers read is swallowed",
     STORE, "  if (regErr) readProblems.push(`Registers could not be read: ${regErr.message}`);\n", ""),
    ("21 STORE: a failed drops read is swallowed",
     STORE, "    if (dropErr) readProblems.push(`Drops could not be read: ${dropErr.message}`);\n", ""),
    ("22 STORE: a failed sales read is swallowed",
     STORE, "  if (!eventRead.verdict.complete) readProblems.push(`Sales could not all be read: ${eventRead.verdict.message}`);\n", ""),
    ("23 STORE: a failed safe count read becomes 'Not done' again",
     STORE, "    else readProblems.push(`Safe counts could not be read: ${countErr.message}`);\n", ""),
    ("24 STORE: a failed swaps read is swallowed",
     STORE, "      else readProblems.push(`Change swaps could not be read: ${swapErr.message}`);\n", ""),
    ("25 STORE: incomplete refunds are swallowed",
     STORE, '  if (!refundRead.complete) readProblems.push(`Refunds could not all be read: ${refundRead.problem ?? "unknown"}`);\n', ""),
    ("26 STORE: a bag read error is swallowed",
     STORE, "  if (!bagRead.ok && !bagRead.missingSchema) readProblems.push(`Deposit bag could not be read: ${bagRead.error}`);\n", ""),
    ("27 STORE: refunds lose where they were paid",
     STORE, "refundMinor: r.refundMinor, paidFrom: r.paidFrom }))", 'refundMinor: r.refundMinor, paidFrom: "drawer" as const }))'),
    ("28 STORE: drops not passed to the sheet",
     STORE, "    drops: sessionDrops,\n", "    drops: [],\n"),
    ("29 STORE: back to one unpaged sales read",
     STORE, "      .range(from, to);\n    if (error) return { rows: [], ok: false };\n    return { rows: (data as EventRow[] | null) ?? [], ok: true };",
     "      ;\n    if (error) return { rows: [], ok: false };\n    return { rows: (data as EventRow[] | null) ?? [], ok: true };"),
    # ── the page (doors) ─────────────────────────────────────────────────
    ("30 DOOR: a bad ?day= shows today again",
     PAGE, "  if (!dayCheck.ok) {", "  if (false && !dayCheck.ok) {"),
    ("31 DOOR: the date picker removed from the report",
     PAGE, "          <DayPicker value={businessDay} />\n", ""),
    ("32 DOOR: the deposit table stops rendering",
     PAGE, "              {dep.lines.map((l) => (", "              {[].map((l: (typeof dep.lines)[number]) => ("),
    ("33 DOOR: the refunds no longer shown as taken off",
     PAGE, "-{formatCents(sheet.refunds.fromDrawersMinor)}", "{formatCents(0)}"),
    ("34 DOOR: the denomination grid stops rendering",
     PAGE, "                {grid.map((g) => (", "                {[].map((g: (typeof grid)[number]) => ("),
    ("35 DOOR: the morning verifier signature line removed",
     PAGE, '          <SignLine label="Morning recount and verify, a different employee (signature)" name={bag?.morningCountedByName} />\n', ""),
    ("36 DOOR: the read-problem banner never shows",
     PAGE, "        {readProblems.length > 0 ? (", "        {false ? ("),
    ("37 DOOR: export links stay on after a failed read",
     PAGE, "          {readProblems.length === 0 ? (", "          {true ? ("),
    # ── the export route ─────────────────────────────────────────────────
    ("38 ROUTE: exports an incomplete sheet",
     ROUTE, "  if (data.readProblems.length > 0) {", "  if (false) {"),
    ("39 ROUTE: a bad day becomes today",
     ROUTE, "  if (!day.ok) return bad(day.error);", "  if (!day.ok) return bad(\"\", 200);"),
    ("40 ROUTE: permission check removed",
     ROUTE, '  await requirePermission("inventory.manage");\n', ""),
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
