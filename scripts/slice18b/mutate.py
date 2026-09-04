#!/usr/bin/env python3
"""
SLICE 18B — MUTATION HARNESS.

Michael: "Test everything including the tests."

A green suite proves nothing on its own. It could be green because the code is
right, or green because the assertions never actually look. The only way to
tell the difference is to BREAK the code on purpose and confirm the suite
notices. Every mutant below is a defect a real shopper or budtender would feel:
a checkbox that lies about its count, a filter that survives Reset, a back
button that loses the lane, a suppository the register cannot find.

If a mutant SURVIVES, the test suite has a hole and the suite gets strengthened
— never the mutant softened.

SAFETY (this edits tracked source, so it is built to fail safe):
  1. PRE-FLIGHT: every anchor must match EXACTLY ONCE in its file. If any anchor
     is missing or ambiguous, we abort having written nothing at all.
  2. BASELINE: the suite must be green before we start. Mutation results are
     meaningless against an already-red suite.
  3. RESTORE: originals are held in memory and rewritten in a `finally`, so
     Ctrl-C, an exception, or a failing subprocess still leaves a clean tree.
  4. VERIFY: after restoring we re-run the baseline to prove the tree really is
     back to where it started.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

BROWSER = "src/components/menu/InteractiveMenuBrowser.tsx"
SIDEBAR = "src/components/menu/FilterMobile.tsx"
MENU_PAGE = "src/app/menu/page.tsx"
CORE = "src/lib/menu/menu-classification-filter-core.ts"
SEARCH_CORE = "src/lib/pos/classification-search-core.ts"
SALE_FLOW = "src/lib/pos/sale-flow-core.ts"
WORKLIST_CORE = "src/lib/inventory/classification-worklist-core.ts"
ADMIN_PAGE = "src/app/admin/compliance/classification/page.tsx"
SELFTESTS = "scripts/compliance/run-pure-selftests.ts"

# The suite that must react. Kept narrow so the loop is fast enough to run every
# mutant; the full sweep runs separately in the gates.
VITEST = [
    "npx",
    "vitest",
    "run",
    "tests/compliance/menu-classification-filter-core.test.ts",
    "tests/compliance/classification-facet-plumbing.test.ts",
]
SELFTEST_CMD = ["npx", "tsx", "scripts/slice18b/run-selftests.ts"]


@dataclass(frozen=True)
class Mutant:
    ident: str
    path: str
    old: str
    new: str
    why: str
    # Which gate is expected to catch it: "vitest", "selftest", or "either".
    gate: str = "either"


MUTANTS: list[Mutant] = [
    # ── The honesty rule: lanes must mean what the REGISTER means ────────────
    Mutant(
        "M01-raw-boolean-low-thc",
        CORE,
        "  const line = menuItemToLimitLine(item);\n  return kind === \"low_thc_liquid\"\n    ? qualifiesAsLowThcLiquid(line)",
        "  const line = menuItemToLimitLine(item);\n  return kind === \"low_thc_liquid\"\n    ? item.lowThcLiquid === true",
        "Key the lane off the raw flag instead of the register's 3-condition "
        "test. This is THE bug of this slice: the shop would advertise "
        "'Low-THC Beverages' for a 10 mg drink the till still counts in the "
        "72 oz bucket.",
    ),
    Mutant(
        "M02-raw-boolean-otherwise-taken",
        CORE,
        "    : qualifiesAsOtherwiseTaken(line);",
        "    : item.otherwiseTaken === true;",
        "Same drift on the suppository lane — a flower flagged otherwise_taken "
        "would appear in a lane the register would never route it to.",
    ),
    Mutant(
        "M03-low-thc-cap-off-by-one",
        "src/lib/menu/menu-classification-filter-core.ts",
        "single servings of ${LOW_THC_UNIT_MAX_MG} mg THC or less",
        "single servings of ${LOW_THC_UNIT_MAX_MG + 1} mg THC or less",
        "Loosen the 4 mg cap in the facet's own label/help wording so it "
        "disagrees with the statute the register enforces.",
    ),
    # ── Dynamism: the facet must appear only when products exist ────────────
    Mutant(
        "M04-lane-always-offered",
        CORE,
        "    if (count <= 0) continue;",
        "    if (count < 0) continue;",
        "Offer an empty lane. Michael: filters 'appear in the list when there "
        "are products with those traits' — a 0-count checkbox is a dead end.",
    ),
    Mutant(
        "M05-sidebar-gate-dropped",
        SIDEBAR,
        "Boolean(onClassificationToggle) && classificationOptions.length > 0",
        "Boolean(onClassificationToggle)",
        "Render the section header with no lanes under it, so the sidebar "
        "shows an empty 'Product Type' block on a menu with no such products.",
    ),
    # ── The count on the checkbox must equal what clicking it yields ────────
    Mutant(
        "M06-count-uses-all-items",
        CORE,
        "      if (itemHasClassification(item, kind)) {\n        counts.set(kind, (counts.get(kind) ?? 0) + 1);\n      }",
        "      counts.set(kind, (counts.get(kind) ?? 0) + 1);",
        "Advertise a count that has nothing to do with the matcher — the "
        "classic 'says 12, shows 3' filter bug.",
    ),
    # ── Wiring hops a shopper would physically notice ────────────────────────
    Mutant(
        "M07-url-not-persisted",
        BROWSER,
        'params.set("classification", activeClassificationId)',
        'params.delete("classification")',
        "Selecting a lane no longer changes the URL, so the view is not "
        "shareable and a refresh silently loses it.",
    ),
    Mutant(
        "M08-popstate-drops-lane",
        BROWSER,
        'setActiveClassificationId((params.get("classification") ?? "").trim() || null);',
        "setActiveClassificationId(null);",
        "Browser Back clears the lane instead of restoring it.",
    ),
    Mutant(
        "M09-reset-skips-lane",
        BROWSER,
        "setActiveClassificationId(null);",
        "/* mutant: reset no longer clears the lane */",
        "'Reset filters' leaves the lane stuck on — the user cannot get back "
        "to the full menu.",
    ),
    Mutant(
        "M10-pool-not-filtered",
        BROWSER,
        "itemMatchesClassificationFilter(item, activeClassificationId)",
        "true",
        "The checkbox ticks but the grid never narrows.",
    ),
    Mutant(
        "M11-menu-page-drops-param",
        MENU_PAGE,
        "classification: firstSearchParamValue(resolvedSearchParams?.classification),",
        "classification: undefined,",
        "A shared /menu?classification=low-thc link renders the unfiltered "
        "grid on first paint.",
    ),
    Mutant(
        "M12-doh-forwarding-regressed",
        MENU_PAGE,
        "doh: firstSearchParamValue(resolvedSearchParams?.doh),",
        "doh: undefined,",
        "Guards the pre-existing gap 18B repaired, so it cannot silently "
        "come back.",
    ),
    # ── Budtender path ───────────────────────────────────────────────────────
    Mutant(
        "M13-haystack-not-widened",
        SALE_FLOW,
        "${\n      classification ? ` ${classification}` : \"\"\n    }",
        "",
        "Register search stops finding a suppository whose product name never "
        "says 'suppository' — the exact gap recon F7 identified.",
    ),
    Mutant(
        "M14-search-leaks-on-ordinary-products",
        SEARCH_CORE,
        'return keywords.length === 0 ? "" : keywords.join(" ");',
        'return keywords.length === 0 ? "product" : keywords.join(" ");',
        "Break the additive guarantee: ordinary products gain a phantom "
        "search token, changing existing budtender results.",
    ),
    Mutant(
        "M15-search-ignores-qualification",
        SEARCH_CORE,
        "qualifiesAsOtherwiseTaken(line)",
        "product.otherwiseTaken !== false",
        "Make the register's search claim products are suppositories that its "
        "own limit engine would not treat as such (and the permissive-null "
        "trap from recon F3).",
    ),
    # ── Back office parity ───────────────────────────────────────────────────
    Mutant(
        "M16-worklist-lane-always-null",
        WORKLIST_CORE,
        "shopLane: classificationKindForItem({",
        "shopLane: null as unknown as ReturnType<typeof classificationKindForItem>, _unused: ({",
        "The back office stops reporting what the customer sees, so staff "
        "lose the feedback loop Michael asked for.",
    ),
    Mutant(
        "M17-admin-hand-rolled-href",
        ADMIN_PAGE,
        "href={classificationShopHref(row.shopLane)}",
        'href={"/menu?classification=" + row.shopLane}',
        "A second, hand-rolled definition of the shop URL — the drift class "
        "that bit us in 18A. Ids would silently diverge from the facet.",
    ),
    # ── CI registration ──────────────────────────────────────────────────────
    Mutant(
        "M18-core-unregistered-in-ci",
        SELFTESTS,
        "{ const r = __runMenuClassificationFilterTests(); if (r.passed < 1)",
        "{ const r = { passed: 1 }; if (r.passed < 1)",
        "Drop the facet core out of the compliance job so its assertions stop "
        "running in CI.",
        gate="vitest",
    ),
]


def run(cmd: list[str]) -> tuple[int, str]:
    proc = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


def gate_passes(gate: str) -> tuple[bool, str]:
    """True if EVERY relevant gate is green."""
    if gate in ("selftest", "either"):
        code, out = run(SELFTEST_CMD)
        if code != 0:
            return False, f"selftest exit {code}"
    if gate in ("vitest", "either"):
        code, out = run(VITEST)
        if code != 0:
            return False, f"vitest exit {code}"
    return True, "green"


def main() -> int:
    print("=" * 74)
    print("SLICE 18B MUTATION HARNESS")
    print("=" * 74)

    # ── 1. PRE-FLIGHT: verify every anchor before touching a single byte ─────
    originals: dict[str, str] = {}
    problems: list[str] = []
    for m in MUTANTS:
        full = REPO / m.path
        if not full.exists():
            problems.append(f"{m.ident}: missing file {m.path}")
            continue
        text = originals.setdefault(m.path, full.read_text(encoding="utf-8"))
        n = text.count(m.old)
        if n != 1:
            problems.append(
                f"{m.ident}: anchor matched {n}x in {m.path} (need exactly 1)\n"
                f"    anchor: {m.old!r}"
            )

    if problems:
        print("\nPRE-FLIGHT FAILED — nothing was written:\n")
        for p in problems:
            print("  " + p)
        return 2
    print(f"pre-flight OK: {len(MUTANTS)} anchors, each unique.")

    # ── 2. BASELINE ──────────────────────────────────────────────────────────
    ok, detail = gate_passes("either")
    if not ok:
        print(f"\nBASELINE IS RED ({detail}) — fix before mutating.")
        return 2
    print("baseline green.\n")

    survivors: list[Mutant] = []
    killed = 0

    try:
        for m in MUTANTS:
            full = REPO / m.path
            text = originals[m.path]
            full.write_text(text.replace(m.old, m.new, 1), encoding="utf-8")

            ok, detail = gate_passes(m.gate)
            if ok:
                survivors.append(m)
                print(f"  SURVIVED  {m.ident}  <-- TEST GAP")
                print(f"            {m.why}")
            else:
                killed += 1
                print(f"  killed    {m.ident}  ({detail})")

            full.write_text(text, encoding="utf-8")  # restore immediately
    finally:
        # ── 3. UNCONDITIONAL RESTORE ─────────────────────────────────────────
        for path, text in originals.items():
            (REPO / path).write_text(text, encoding="utf-8")
        print("\nall source files restored.")

    # ── 4. VERIFY THE TREE IS TRULY CLEAN ────────────────────────────────────
    ok, detail = gate_passes("either")
    print(f"post-restore baseline: {'green' if ok else 'RED — ' + detail}")
    if not ok:
        return 2

    print("=" * 74)
    print(f"killed {killed}/{len(MUTANTS)}   survivors: {len(survivors)}")
    print("=" * 74)
    if survivors:
        print("\nStrengthen the suite until each survivor dies:")
        for m in survivors:
            print(f"  - {m.ident}: {m.why}")
        return 1
    print("Every mutant was caught. The tests test.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
