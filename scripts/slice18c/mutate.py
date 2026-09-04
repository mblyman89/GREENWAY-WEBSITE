#!/usr/bin/env python3
"""
SLICE 18C — MUTATION HARNESS.

Michael: "Test everything including the tests."

A green suite proves nothing on its own. It could be green because the code is
right, or green because the assertions never actually look. The only way to
tell the difference is to BREAK the code on purpose and confirm the suite
notices.

Every mutant below is a defect a real shopper would feel, or a lie the website
would tell: a pill on a product the till would refuse, a suppository allowance
rendered as ounces, copy that promises a medical multiple that does not exist,
a badge computed and thrown away.

If a mutant SURVIVES, the suite has a hole and the SUITE gets strengthened —
never the mutant softened.

SAFETY (this edits tracked source, so it is built to fail safe):
  1. PRE-FLIGHT: every anchor must match EXACTLY ONCE in its file. If any
     anchor is missing or ambiguous, we abort having written nothing at all.
  2. BASELINE: the suite must be green before we start. Mutation results are
     meaningless against an already-red suite.
  3. RESTORE: originals are held in memory and rewritten in a `finally`, so
     Ctrl-C, an exception or a failing subprocess still leaves a clean tree.
  4. VERIFY: after restoring we re-run the baseline to prove the tree really is
     back where it started.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

BADGE_CORE = "src/lib/menu/menu-classification-badge-core.ts"
CARD_VISUAL = "src/components/menu/ProductCardVisual.tsx"
PDP_PANEL = "src/components/menu/ProductDetailPurchasePanel.tsx"
PDP_PAGE = "src/app/menu/products/[id]/page.tsx"
SELFTESTS = "scripts/compliance/run-pure-selftests.ts"

VITEST = [
    "npx",
    "vitest",
    "run",
    "tests/compliance/menu-classification-badge-core.test.ts",
    "tests/compliance/classification-badge-plumbing.test.ts",
]
SELFTEST_CMD = ["npx", "tsx", "scripts/slice18c/run-selftests.ts"]


@dataclass(frozen=True)
class Mutant:
    ident: str
    path: str
    old: str
    new: str
    why: str
    gate: str = "either"  # "vitest", "selftest", or "either"


MUTANTS: list[Mutant] = [
    # ── THE CENTRAL RULE: a pill must mean the REGISTER agrees ──────────────
    Mutant(
        "M01-badge-uses-raw-flags",
        BADGE_CORE,
        "    if (!itemHasClassification(item, kind)) continue;",
        "    if (!(item.lowThcLiquid === true || item.otherwiseTaken === true)) continue;",
        "Key the pill off the raw booleans instead of the register's "
        "three-condition test. THE bug of this slice: a 10 mg drink would wear "
        "a 'Low-THC' pill while the till still counts it in the 72 oz bucket.",
    ),
    Mutant(
        "M02-badge-inverted",
        BADGE_CORE,
        "    if (!itemHasClassification(item, kind)) continue;",
        "    if (itemHasClassification(item, kind)) continue;",
        "Badge exactly the wrong products \u2014 every ordinary item gets a pill "
        "and every qualifying one loses it.",
    ),
    Mutant(
        "M03-badge-always-on",
        BADGE_CORE,
        "    if (!itemHasClassification(item, kind)) continue;",
        "    if (false) continue;",
        "Every product wears both pills, destroying the graceful default that "
        "keeps an unreviewed product silent.",
    ),
    # ── The unit trap: a COUNT bucket must never render as a weight ─────────
    Mutant(
        "M04-disclosure-unit-blind",
        BADGE_CORE,
        "    limit: formatLimitAmount(spec.kind, RECREATIONAL_LIMITS[spec.kind]),",
        '    limit: `${RECREATIONAL_LIMITS[spec.kind]} g`,',
        "Bypass the bucket-aware formatter, so 10 suppositories render as "
        "'10 g' and 200 mg THC renders as '200 g'. sales-limits-core warns "
        "about exactly this class of error.",
    ),
    Mutant(
        "M05-disclosure-medical-limits",
        BADGE_CORE,
        "    limit: formatLimitAmount(spec.kind, RECREATIONAL_LIMITS[spec.kind]),",
        "    limit: formatLimitAmount(spec.kind, RECREATIONAL_LIMITS[spec.kind] * 3),",
        "Triple the allowance the way every OTHER bucket triples for a "
        "DOH-database patient. These two do not \u2014 this is the documented "
        "pattern-matching trap, and it would over-state the limit in public.",
    ),
    Mutant(
        "M06-disclosure-drops-citation",
        BADGE_CORE,
        "    citation: CLASSIFICATION_DISCLOSURE_CITATION,",
        '    citation: "",',
        "Strip the WAC citation, making the claim uncheckable.",
    ),
    # ── Honesty of the copy itself ──────────────────────────────────────────
    Mutant(
        "M07-copy-promises-medical-multiple",
        BADGE_CORE,
        '    "your liquid allowance. Your cart keeps a running total, and the final amount is confirmed in store.",',
        '    "your liquid allowance. Medical patients get triple this amount.",',
        "Tell shoppers a medical multiple exists for a bucket where it does "
        "not, and drop the deferral to the store.",
    ),
    Mutant(
        "M08-copy-promises-quantity",
        BADGE_CORE,
        '    "weight and has its own separate allowance. Your cart keeps a running count, and the final amount " +\n    "is confirmed in store.",',
        '    "weight. You can buy 10 of these per visit.",',
        "Promise a hard quantity the basket cannot guarantee, and lose both "
        "the 'separate allowance' explanation and the store deferral.",
    ),
    # ── Disclosure/pill agreement ───────────────────────────────────────────
    Mutant(
        "M09-disclosure-for-every-product",
        BADGE_CORE,
        "  return classificationPillsForItem(item).map((spec) => ({",
        "  return CLASSIFICATION_FILTER_KINDS.map((kind) => ({ kind, ...{ get 0() { return 0; } } } as never)).length === 0 ? [] : CLASSIFICATION_FILTER_KINDS.map((kind) => ({",
        "Detach the disclosure from the badge so an ordinary product shows an "
        "allowance explainer for allowances it has not earned.",
    ),
    # ── Card render hops ────────────────────────────────────────────────────
    Mutant(
        "M10-card-pills-not-rendered",
        CARD_VISUAL,
        "          {classificationPills.map((pill) => (",
        "          {[].map((pill: (typeof classificationPills)[number]) => (",
        "Compute the pills and throw them away \u2014 precisely the pre-existing "
        "DOH defect this slice repairs, reproduced in new code.",
    ),
    Mutant(
        "M11-card-loses-full-label",
        CARD_VISUAL,
        "              title={pill.title}",
        "              title={undefined}",
        "Drop the full shopper label, so hover text and assistive technology "
        "only ever get the abbreviation.",
    ),
    Mutant(
        "M12-card-pill-leaves-the-lane",
        CARD_VISUAL,
        "  const classificationPills = classificationPillsForItem(item);",
        "  const classificationPills = [] as ReturnType<typeof classificationPillsForItem>;",
        "Sever the card from the core entirely.",
    ),
    # ── PDP disclosure hops ─────────────────────────────────────────────────
    Mutant(
        "M13-pdp-disclosure-not-rendered",
        PDP_PANEL,
        "      {allowanceDisclosures.length > 0 ? (",
        "      {false ? (",
        "The allowance explainer never renders \u2014 the roadmap deliverable "
        "silently absent.",
    ),
    Mutant(
        "M14-pdp-disclosure-ungated",
        PDP_PANEL,
        "      {allowanceDisclosures.length > 0 ? (",
        "      {true ? (",
        "Render an empty bordered box on every ordinary product page.",
    ),
    Mutant(
        "M15-pdp-drops-cart-flags",
        PDP_PANEL,
        "            lowThcLiquid: item.lowThcLiquid ?? null,",
        "            lowThcLiquid: null,",
        "Regress SLICE 16: the cart meter would apply the 72 oz liquid limit "
        "to a low-THC drink. Guards that 18C stayed additive.",
    ),
    # ── The DOH gap this slice repairs ──────────────────────────────────────
    Mutant(
        "M16-pdp-doh-pill-regressed",
        PDP_PAGE,
        "  const dohDetailPill = dohPillForItem(item);",
        "  const dohDetailPill = null as ReturnType<typeof dohPillForItem>;",
        "Restore the pre-existing bug: the detail page computes DOH compliance "
        "and shows nothing, so a DOH product loses its pill on click.",
    ),
    Mutant(
        "M17-pdp-classification-pills-regressed",
        PDP_PAGE,
        "  const classificationDetailPills = classificationPillsForItem(item);",
        "  const classificationDetailPills = [] as ReturnType<typeof classificationPillsForItem>;",
        "The detail page loses the classification pills, so a badge on the "
        "card vanishes when the shopper clicks through.",
    ),
    # ── CI registration ─────────────────────────────────────────────────────
    Mutant(
        "M18-core-unregistered-in-ci",
        SELFTESTS,
        "{ const r = __runMenuClassificationBadgeTests(); if (r.passed < 1)",
        "{ const r = { passed: 1 }; if (r.passed < 1)",
        "Drop the badge core out of the compliance job so its 75 assertions "
        "stop running in CI.",
        gate="vitest",
    ),
]


def run(cmd: list[str]) -> tuple[int, str]:
    proc = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


def gate_passes(gate: str) -> tuple[bool, str]:
    if gate in ("selftest", "either"):
        code, _ = run(SELFTEST_CMD)
        if code != 0:
            return False, f"selftest exit {code}"
    if gate in ("vitest", "either"):
        code, _ = run(VITEST)
        if code != 0:
            return False, f"vitest exit {code}"
    return True, "green"


def main() -> int:
    print("=" * 74)
    print("SLICE 18C MUTATION HARNESS")
    print("=" * 74)

    # ── 1. PRE-FLIGHT: verify every anchor before touching a single byte ────
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
        print("\nPRE-FLIGHT FAILED \u2014 nothing was written:\n")
        for p in problems:
            print("  " + p)
        return 2
    print(f"pre-flight OK: {len(MUTANTS)} anchors, each unique.")

    # ── 2. BASELINE ─────────────────────────────────────────────────────────
    ok, detail = gate_passes("either")
    if not ok:
        print(f"\nBASELINE IS RED ({detail}) \u2014 fix before mutating.")
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

            full.write_text(text, encoding="utf-8")
    finally:
        # ── 3. UNCONDITIONAL RESTORE ────────────────────────────────────────
        for path, text in originals.items():
            (REPO / path).write_text(text, encoding="utf-8")
        print("\nall source files restored.")

    # ── 4. VERIFY THE TREE IS TRULY CLEAN ───────────────────────────────────
    ok, detail = gate_passes("either")
    status = "green" if ok else "RED \u2014 " + detail
    print(f"post-restore baseline: {status}")
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
