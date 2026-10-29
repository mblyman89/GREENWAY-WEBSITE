"""
scripts/compliance/mutate-fix-p2-8b.py

Fix Phase 2.8b (cost of returned units). Owner, message 6, verbatim:
"Please completely finish the refund entry, so it puts back the cost of
returned items. Please make sure this is of enterprise grade quality."

Rule 13c: a test that cannot fail is worse than no test. Rule 137: every
anchor must match EXACTLY once or the harness fails.

Usage:  python3 scripts/compliance/mutate-fix-p2-8b.py
"""
import io
import subprocess
import sys

CORE = "src/lib/accounting/refund-cogs-core.ts"
POSTER = "src/lib/accounting/refund-posting-service.ts"
ACTIONS = "src/app/admin/books/drafts/actions.ts"

TESTS = [
    "tests/compliance/fix-p2-8b-refund-cogs.test.ts",
    "tests/compliance/fix-p2-8-returns-books.test.ts",
]

# (label, file, find, replace)
MUTATIONS = [
    ('core: one ref for all days', CORE, '  return `refunds:${businessDay}${REFUND_COGS_SOURCE_SUFFIX}`;', '  return `refunds${REFUND_COGS_SOURCE_SUFFIX}`;'),
    ("core: destroyed return's cost put back", CORE, '    if (it.disposition === "destroy") {', '    if (it.disposition === ("never" as string)) {'),
    ('core: unknown cost guessed as zero', CORE, '    if (it.costLines === null) {', '    if (it.costLines === null) { it.costLines = []; }\n    if (false) {'),
    ('core: debit/credit flipped', CORE, '      amountCents: cents, // debit: the units are back on the shelf', '      amountCents: -cents, // debit: the units are back on the shelf'),
    ('core: COGS line loses its cost class', CORE, '      costClass: "cogs_direct",', '      costClass: "none",'),
    ('core: sale cost mismatch accepted', CORE, '    if (d !== c) {', '    if (false) {'),
    ('core: zero quantity accepted', CORE, '  if (!(Number.isFinite(quantity) && quantity > 0)) {', '  if (!Number.isFinite(quantity)) {'),
    ('core: fractional cents accepted', CORE, '  if (!Number.isSafeInteger(product)) {', '  if (!Number.isFinite(product)) {'),
    ('poster: default disposition becomes restock', POSTER, '    const disposition: "restock" | "destroy" = r?.disposition === "restock" ? "restock" : "destroy";', '    const disposition: "restock" | "destroy" = r?.disposition === "destroy" ? "destroy" : "restock";'),
    ('poster: void reads the wrong ref', POSTER, '    .eq("source_ref", `order:${orderId}#cogs`)', '    .eq("source_ref", `order:${orderId}`)'),
    ('poster: voided cost entries included', POSTER, '    .in("status", ["draft", "posted"]);', '    .in("status", ["draft", "posted", "voided"]);'),
    ('poster: two sale cost entries accepted', POSTER, '  if (rows.length > 1) return', '  if (rows.length > 99) return'),
    ('poster: missing lot treated as zero cost', POSTER, '  if (!lotId) return { costLines: null, note: "the return has no lot recorded" };', '  if (!lotId) return { costLines: [], note: "the return has no lot recorded" };'),
    ('poster: DOOR - cost entry auto-posted', POSTER, '      // autoPost deliberately NOT set: the owner posts it (G-48).\n    },\n    admin,\n  );\n  if (!result.ok) {\n    const conflict = result.code === "GL_POST_CONFLICT";\n    return {\n      kind: "failed",\n      code:', '      autoPost: true,\n    },\n    admin,\n  );\n  if (!result.ok) {\n    const conflict = result.code === "GL_POST_CONFLICT";\n    return {\n      kind: "failed",\n      code:'),
    ('poster: DOOR - cost entry never drafted', POSTER, '    cogs = costItems.length > 0 ? await draftCogsForDay(admin, day, costItems)', '    cogs = costItems.length < 0 ? await draftCogsForDay(admin, day, costItems)'),
    ('action: cost result dropped from audit', ACTIONS, '      cogsKind: outcome.cogs?.kind ?? null,', '      cogsKind: null,'),
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
