"""
scripts/compliance/mutate-fix-p2-7a.py

Fix Phase 2.7a (G-08 master till mix standard, G-09 printable sheet and
export, G-13 any employee counts with a PIN; F-02-3, F-02-4, F-02-5, F-02-7,
F-02-10, F-02-13, F-00-8). Rule 13c: a test that cannot fail is worse than
no test. This breaks the master till work on purpose, one edit at a time,
and demands that the suite NOTICE.

Rule 133g: several mutations SEVER THE DOOR (the page stops gating, the
action stops checking the PIN, the export stops refusing a failed read).
Rule 137: every anchor must match EXACTLY once or the harness fails.

Usage:  python3 scripts/compliance/mutate-fix-p2-7a.py
"""
import io
import subprocess
import sys

SAFE_CORE = "src/lib/registers/safe-core.ts"
SPECIMEN = "src/lib/accounting/register-cash-specimen-core.ts"
CORE = "src/lib/registers/master-till-core.ts"
STORE = "src/lib/registers/safe-store.ts"
ACTIONS = "src/app/admin/registers/safe/actions.ts"
PAGE = "src/app/admin/registers/safe/page.tsx"
SHEET = "src/app/admin/registers/safe/sheet/page.tsx"
ROUTE = "src/app/admin/registers/safe/export/route.ts"
GRID = "src/components/admin/registers/CountGrid.tsx"
EOD_STORE = "src/lib/registers/eod-store.ts"
EOD_PAGE = "src/app/admin/registers/eod/page.tsx"

TESTS = [
    "tests/compliance/fix-p2-7a-master-till.test.ts",
    "tests/compliance/fix-p2-3-over-short-warnings.test.ts",
    "tests/compliance/safe-core.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # D11 standard
    ("D11: tens 32 -> 31", SAFE_CORE, "ones: 318, twos: 0, fives: 64, tens: 32,", "ones: 318, twos: 0, fives: 64, tens: 31,"),
    ("rule 25: specimen keeps its own copy", SPECIMEN,
     "export const SPECIMEN_MASTER_COUNTS: Partial<DenomCounts> = MASTER_TILL_STANDARD;",
     "export const SPECIMEN_MASTER_COUNTS: Partial<DenomCounts> = { ...MASTER_TILL_STANDARD };"),
    # mix rules
    ("mixRows: diff sign flipped", CORE, "    const diff = c - standard;\n", "    const diff = standard - c;\n"),
    ("mixCheck: always on standard", CORE, "    onStandard: off.length === 0,\n", "    onStandard: true,\n"),
    ("mixCheck: variance vs 0 not target", CORE, "    varianceMinor: totalMinor - SAFE_TARGET_MINOR,\n", "    varianceMinor: totalMinor,\n"),
    ("mixSentence: off reported as on", CORE,
     '  return m.onStandard ? "Mix on standard." : `Mix off standard: ${m.offText}.`;',
     '  return "Mix on standard.";'),
    # range
    ("range: From after To accepted", CORE, "  if (from.day > to.day) return", "  if (false) return"),
    ("range: no 366-day cap", CORE, "  if (daysBetween(from.day, to.day) + 1 > MAX_RANGE_DAYS) {", "  if (false) {"),
    ("default window: always AM (F-02-5)", CORE, '  if (!todayPmDone) return "pm";', '  if (!todayPmDone) return "am";'),
    # workbook
    ("workbook: standard row dropped", CORE, "        rows: [std, ...countRows],", "        rows: countRows,"),
    ("row mapping: reason dropped", CORE, "    reason: r.variance_reason ?? null,", "    reason: null,"),
    # store
    ("store: failed read reported as complete", STORE,
     "    return { ready: true, counts: read.rows, error: firstError ?? read.verdict.message };",
     "    return { ready: true, counts: read.rows, error: null };"),
    ("store: no unique tiebreak", STORE,
     '      .order("counted_at", { ascending: false })\n      .order("id", { ascending: true })\n      .range(a, b);',
     '      .order("counted_at", { ascending: false })\n      .range(a, b);'),
    ("store: swaps not bounded by day start", STORE, '      .gte("occurred_at", start)\n', ""),
    ("store: missing table treated as error", STORE,
     "  if (missing) return { ready: false, swaps: [], error: null };", ""),
    # action
    ("action: back to managers only", ACTIONS,
     '  const session = await requirePermission("orders.manage");',
     '  const session = await requirePermission("inventory.manage");'),
    ("action: PIN throttle skipped", ACTIONS, "  if (locked) fail(locked);\n", ""),
    ("action: unknown PIN accepted", ACTIONS,
     "  if (!emp) {\n    await notePinFailure(SAFE_COUNT_PIN_SCOPE);",
     "  if (false) {\n    await notePinFailure(SAFE_COUNT_PIN_SCOPE);"),
    ("action: blank PIN allowed", ACTIONS,
     '  if (!pin) fail("Enter your PIN (the employee who counted the master till). Nothing was saved.");\n', ""),
    ("action: audit loses verified flag", ACTIONS,
     '      counted_by_name: counter.full_name,\n      counter_verified: "pin",\n      mix:',
     '      counted_by_name: counter.full_name,\n      mix:'),
    ("action: banner loses the mix", ACTIONS, " Counted by ${counter.full_name}. ${mixSentence(denoms)}", " Counted by ${counter.full_name}."),
    # page
    ("page: back to managers only (door)", PAGE,
     '  const session = await requirePermission("orders.manage");',
     '  const session = await requirePermission("inventory.manage");'),
    ("page: history shown to every login", PAGE,
     '    canManage && range.ok ? listSafeCountsRange(range.from, range.to)',
     '    range.ok ? listSafeCountsRange(range.from, range.to)'),
    ("page: name picker instead of PIN", PAGE, 'name="counter_pin"', 'name="counted_by"'),
    ("page: no standard in grid", PAGE, "                showStandard\n", ""),
    ("page: F-02-7 old placeholder back", PAGE,
     'placeholder="e.g. 3 × $20 from swaps, not yet to the little safe"',
     'placeholder="e.g. two drops waiting to be banked"'),
    ("page: export shown on failed read", PAGE, "                      {readErrors.length === 0 ? (", "                      {true ? ("),
    ("page: window back to AM", PAGE, "defaultValue={startWindow}", 'defaultValue="am"'),
    # grid
    ("grid: mix line removed", GRID, '{mixLine.onStandard ? "Mix on standard" : `Mix off: ${mixLine.offText}`}', '{"Mix on standard"}'),
    # sheet
    ("sheet: open to every login", SHEET, '  await requirePermission("inventory.manage");', '  await requirePermission("orders.manage");'),
    ("sheet: no incomplete warning", SHEET, "This sheet may be incomplete. Do not file it.", "Some rows missing."),
    ("sheet: diff column dropped", SHEET, "{signedDiff(d)}", "{n}"),
    # route
    ("route: open to every login", ROUTE, '  await requirePermission("inventory.manage");', '  await requirePermission("orders.manage");'),
    ("route: bad range replaced", ROUTE, "  if (!range.ok) return bad(range.error);", "  if (!range.ok) return bad(\"\", 200);"),
    ("route: partial file on failed read (door)", ROUTE, "  if (problems.length > 0) {", "  if (false) {"),
    # EOD
    ("eod-store: denominations not read", EOD_STORE, ', ...DENOM_FIELDS.map((d) => d.key)].join(", "))', '].join(", "))'),
    ("eod page: mix words removed (AM)", EOD_PAGE, "${mixWords(safe.amCount.mixOnStandard)}", ""),
    ("eod page: sheet link removed", EOD_PAGE, "/safe/sheet?day=${businessDay}", "/safe"),
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
