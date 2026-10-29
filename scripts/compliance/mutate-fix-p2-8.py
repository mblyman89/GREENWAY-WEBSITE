"""
scripts/compliance/mutate-fix-p2-8.py

Fix Phase 2.8 (G-48 returns in the books and excise Box 1; F-15-14,
F-15-15). G-48, verbatim: "a daily draft journal for customer refunds (debit
50910 Returns & Refunds and the tax liabilities as applicable, credit cash)
awaiting owner approval; LIQ-1295 Box 1 net of returns in the month (by
return date), shown as its own line; tests."

Rule 13c: a test that cannot fail is worse than no test. This breaks the 2.8
work on purpose, one edit at a time, and demands that the suite NOTICE.

Rule 133g: several mutations SEVER THE DOOR (the action stops gating on the
owner, the poster posts instead of drafting, today is allowed, an untied
refund is guessed into the drawer, Box 1 stops subtracting returns, the page
stops rendering the button, the census unwires the poster).
Rule 137: every anchor must match EXACTLY once or the harness fails.

Usage:  python3 scripts/compliance/mutate-fix-p2-8.py
"""
import io
import subprocess
import sys

CORE = "src/lib/accounting/refund-journal-core.ts"
POSTER = "src/lib/accounting/refund-posting-service.ts"
ACTIONS = "src/app/admin/books/drafts/actions.ts"
PAGE = "src/app/admin/books/drafts/page.tsx"
PANEL = "src/app/admin/books/drafts/DraftRefundsPanel.tsx"
EXCORE = "src/lib/compliance/excise-return-core.ts"
EXSVC = "src/lib/compliance/excise-return.ts"
EXPAGE = "src/app/admin/reports/excise/page.tsx"
CENSUS = "src/lib/accounting/ledger-census-data.ts"

TESTS = [
    "tests/compliance/fix-p2-8-returns-books.test.ts",
    "tests/compliance/ledger-census.test.ts",
    "tests/compliance/posting-services-are-reachable.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    # ── the pure builder ──
    ("core: source ref not per day", CORE,
     "  return `${REFUND_DAY_SOURCE_PREFIX}:${businessDay}`;",
     "  return `${REFUND_DAY_SOURCE_PREFIX}`;"),
    ("core: unknown category guessed as cannabis", CORE,
     "  return seed ? seed.isCannabis : null;",
     "  return seed ? seed.isCannabis : true;"),
    ("core: taxes extracted as if everything were cannabis", CORE,
     "    const t = extractTaxes(paid, seed.isCannabis);",
     "    const t = extractTaxes(paid, true);"),
    ("core: books start date not enforced", CORE,
     "  if (day < LINE_IN_THE_SAND) {",
     "  if (day < \"1900-01-01\") {"),
    ("core: negative refund accepted", CORE,
     "    if (!isWholeNonNegative(r.refundCents)) {",
     "    if (!Number.isSafeInteger(r.refundCents)) {"),
    ("core: DOOR - untied refund guessed into the drawer", CORE,
     '    if (r.paidFrom !== "drawer" && r.paidFrom !== "safe") {',
     '    if (false) {'),
    ("core: a refund with no lines accepted", CORE,
     "    if (r.lines.length === 0) {",
     "    if (r.lines.length < 0) {"),
    ("core: lines that disagree accepted", CORE,
     "    if (linesTotal !== r.refundCents) {",
     "    if (linesTotal < 0) {"),
    ("core: safe refunds credited to the drawer", CORE,
     '    if (r.paidFrom === "drawer") fromDrawer += r.refundCents;',
     '    if (r.paidFrom === "drawer" || r.paidFrom === "safe") fromDrawer += r.refundCents;'),
    ("core: excise line dropped", CORE,
     '  if (excise > 0) push(EXCISE_PAYABLE_ACCOUNT, excise,',
     '  if (excise < 0) push(EXCISE_PAYABLE_ACCOUNT, excise,'),
    ("core: sales tax line dropped", CORE,
     '  if (salesTax > 0) push(SALES_TAX_PAYABLE_ACCOUNT, salesTax,',
     '  if (salesTax < 0) push(SALES_TAX_PAYABLE_ACCOUNT, salesTax,'),
    ("core: safe credit dropped", CORE,
     '  if (fromSafe > 0) push(VAULT_ACCOUNT, -fromSafe,',
     '  if (fromSafe < 0) push(VAULT_ACCOUNT, -fromSafe,'),

    # ── the poster ──
    ("poster: DOOR - today allowed", POSTER,
     "  if (day >= pacificToday()) {",
     "  if (day > pacificToday()) {"),
    ("poster: incomplete read treated as complete", POSTER,
     "  if (!read.complete) {",
     "  if (false) {"),
    ("poster: void reads the wrong order", POSTER,
     '    .eq("order_id", sourceId);',
     '    .eq("id", sourceId);'),
    ("poster: DOOR - posts instead of drafting", POSTER,
     "      // autoPost deliberately NOT set: the entry waits for the owner (G-48).",
     "      autoPost: true,"),
    ("poster: duplicate reported as new", POSTER,
     '  const duplicate = result.outcome === "duplicate";',
     '  const duplicate = false;'),
    ("poster: conflict not explained", POSTER,
     '    const conflict = result.code === "GL_POST_CONFLICT";',
     '    const conflict = false;'),

    # ── the action and the page ──
    ("action: DOOR - owner gate removed", ACTIONS,
     "  const session = await requireBooksAccess();\n  const day = (businessDay ?? \"\").trim();",
     "  const session = { userId: \"anyone\" };\n  const day = (businessDay ?? \"\").trim();"),
    ("action: audit removed", ACTIONS,
     '    action: "books.refunds.drafted",',
     '    action: "books.something",'),
    ("action: page not refreshed after a new draft", ACTIONS,
     '  if (outcome.kind === "drafted" && !outcome.duplicate) revalidatePath("/admin/books/drafts");',
     '  if (false) revalidatePath("/admin/books/drafts");'),
    ("page: DOOR - panel not rendered", PAGE,
     "      <DraftRefundsPanel defaultDay={addPacificDays(pacificToday(), -1)} />\n",
     ""),
    ("panel: button no longer calls the action", PANEL,
     "      setOutcome(await draftRefundsAction(day));",
     "      setOutcome(null);"),

    # ── excise Box 1 ──
    ("excise core: non-cannabis returns taken off Box 1", EXCORE,
     "    if (excise <= 0) {",
     "    if (excise < 0) {"),
    ("excise core: Box 1 allowed below zero", EXCORE,
     "  return net < 0 ? { netMinor: 0, clamped: true } : { netMinor: net, clamped: false };",
     "  return { netMinor: net, clamped: false };"),
    ("excise svc: DOOR - Box 1 not net of returns", EXSVC,
     "overrides.cannabisSalesMinorOverride : net.netMinor;",
     "overrides.cannabisSalesMinorOverride : cannabisSalesMinor;"),
    ("excise svc: returns read failure not warned", EXSVC,
     "Box 1 below is NOT net of returns - do not file until this loads.",
     "Returns did not load."),
    ("excise page: Box 1 sum not shown", EXPAGE,
     "How Box 1 is made</p>",
     "Box 1</p>"),

    # ── census ──
    ("census: poster unwired", CENSUS,
     '    poster: "src/lib/accounting/refund-posting-service.ts#draftRefundsForDay",',
     "    poster: null,"),
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
