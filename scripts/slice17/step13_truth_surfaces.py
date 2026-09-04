#!/usr/bin/env python3
"""SLICE 17 — STEP 13: the TRUTH SURFACES.

Steps 1–12 make the register and the website ENFORCE the ten-unit cap. This step
updates everything that TELLS a human about it:

  1. src/lib/ai/kb/seed.ts            — the customer-facing AI concierge
  2. src/lib/regulatory/compliance-surface.ts — the Regulatory Watch analyst map
  3. docs/COMPLIANCE_BIBLE.md         — the repo's written authority
  4. docs/PRODUCT_NAMING_CONVENTION.md
  5. docs/POS_FRONTEND_RESEARCH.md

DISCIPLINE (unchanged from every prior step):
  * Every anchor is asserted to appear EXACTLY ONCE.
  * All edits are buffered per-file in a dict[Path, str]. NOTHING is written
    unless EVERY anchor in EVERY file matched. (Step 5 buffered by re-reading
    from disk per edit, so two edits to the same file silently discarded the
    first. Buffering per-file is the fix.)
  * The KB prose in this file was run through the REAL checkCompliance() gate
    before being written. Blocked text is dropped SILENTLY.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# ── file paths ─────────────────────────────────────────────────────────────
SEED = ROOT / "src/lib/ai/kb/seed.ts"
SURFACE = ROOT / "src/lib/regulatory/compliance-surface.ts"
BIBLE = ROOT / "docs/COMPLIANCE_BIBLE.md"
NAMING = ROOT / "docs/PRODUCT_NAMING_CONVENTION.md"
POSDOC = ROOT / "docs/POS_FRONTEND_RESEARCH.md"

EDITS: list[tuple[Path, str, str, str]] = []


def edit(path: Path, label: str, find: str, replace: str) -> None:
    EDITS.append((path, label, find, replace))


# ═══════════════════════════════════════════════════════════════════════════
# 1. THE AI CONCIERGE  (src/lib/ai/kb/seed.ts)
# ═══════════════════════════════════════════════════════════════════════════

# 1a. Derive the constant, exactly as SLICE 16 did, so the KB can never drift
#     from what the register enforces.
edit(
    SEED,
    "seed: derived constants",
    "const REC_LOW_THC_MG = RECREATIONAL_LIMITS.low_thc_liquid; // 200\n"
    "const MED_LOW_THC_MG = MEDICAL_LIMITS.low_thc_liquid; // 200 \u2014 identical\n"
    "const LOW_THC_UNIT_MG = LOW_THC_UNIT_MAX_MG; // 4\n",
    "const REC_LOW_THC_MG = RECREATIONAL_LIMITS.low_thc_liquid; // 200\n"
    "const MED_LOW_THC_MG = MEDICAL_LIMITS.low_thc_liquid; // 200 \u2014 identical\n"
    "const LOW_THC_UNIT_MG = LOW_THC_UNIT_MAX_MG; // 4\n"
    "// SLICE 17 \u2014 the \"otherwise taken into the body\" allowance. Not a weight and\n"
    "// not a THC figure: a COUNT OF ITEMS. WAC 314-55-010(40) defines the category\n"
    "// by route of administration \u2014 anything for human consumption that is NOT\n"
    "// inhaled, NOT orally ingested and NOT applied to the skin \u2014 which in a retail\n"
    "// shop means suppositories. Medical is the SAME ten, for a different reason\n"
    "// than the beverage bucket: WAC 314-55-095(2)(d) does not list this category\n"
    "// at all, so there is no enhanced medical figure to grant.\n"
    "const REC_OTHERWISE_UNITS = RECREATIONAL_LIMITS.otherwise_taken; // 10\n"
    "const MED_OTHERWISE_UNITS = MEDICAL_LIMITS.otherwise_taken; // 10 \u2014 identical\n",
)

# 1b. The general purchase-limits rule must enumerate all six buckets. An
#     enumeration missing one of six is a WRONG answer, not a partial one.
edit(
    SEED,
    "seed: purchase-limits enumeration",
    "      `individual units of ${LOW_THC_UNIT_MG} mg of active delta-9 THC or less follow a separate ` +\n"
    "      `allowance instead: up to ${REC_LOW_THC_MG} mg of active delta-9 THC in one transaction.`,",
    "      `individual units of ${LOW_THC_UNIT_MG} mg of active delta-9 THC or less follow a separate ` +\n"
    "      `allowance instead: up to ${REC_LOW_THC_MG} mg of active delta-9 THC in one transaction. ` +\n"
    "      `Products otherwise taken into the body, such as suppositories, follow a count instead: ` +\n"
    "      `up to ${REC_OTHERWISE_UNITS} units in one transaction.`,",
)

# 1c. The dedicated rule. Inserted BEFORE possession-limits so sort_order 27
#     lands between the low-THC rule (25) and possession (30).
edit(
    SEED,
    "seed: dedicated otherwise-taken rule",
    "  {\n"
    "    slug: \"possession-limits\",\n"
    "    title: \"How much you can carry\",\n",
    "  {\n"
    "    slug: \"otherwise-taken-limit\",\n"
    "    title: \"Suppositories are counted, not weighed\",\n"
    "    category: \"purchase-limit\",\n"
    "    rule:\n"
    "      `A cannabis-infused product otherwise taken into the body \u2014 one that is not inhaled, ` +\n"
    "      `not swallowed, and not applied to the skin, which in practice means a suppository \u2014 is ` +\n"
    "      `limited to ${REC_OTHERWISE_UNITS} units in a single transaction. This category is ` +\n"
    "      `counted as a NUMBER OF ITEMS, not by weight and not by THC: a sealed box of six counts ` +\n"
    "      `as six of the ${REC_OTHERWISE_UNITS}. The allowance is ${MED_OTHERWISE_UNITS} units for ` +\n"
    "      `registered medical patients too \u2014 the state's higher medical amounts do not list this ` +\n"
    "      `category at all, so it does not increase with a card.`,\n"
    "    house_note:\n"
    "      \"Practical version: we count items here, not ounces and not milligrams. One suppository \" +\n"
    "      \"is one unit and a sealed box of six is six units, so ten units is the ceiling however \" +\n"
    "      \"they are packaged. The state sets no milligram limit on this category \u2014 the count is \" +\n"
    "      \"the only number that matters. And a product nobody has classified yet does NOT land in \" +\n"
    "      \"this category; it falls back to the regular infused allowance measured in ounces, which \" +\n"
    "      \"is why our intake screen flags anything that looks like one for a person to confirm \" +\n"
    "      \"before it reaches the shelf.\",\n"
    "    severity: \"important\",\n"
    "    citation: \"WAC 314-55-095(1)(d)(i)(D)\",\n"
    "    sources: [WSLCB_USING],\n"
    "    confidence: 0.99,\n"
    "    sort_order: 27,\n"
    "  },\n"
    "  {\n"
    "    slug: \"possession-limits\",\n"
    "    title: \"How much you can carry\",\n",
)

# 1d. Possession follows the transaction limit (RCW 69.50.4013(3)(a) ->
#     69.50.360(3)), so the possession rule must carry the bucket too.
edit(
    SEED,
    "seed: possession-limits enumeration",
    "      `in low-THC liquids packaged in units of ${LOW_THC_UNIT_MG} mg or less \u2014 the same amounts as ` +\n"
    "      `the transaction limit.`,",
    "      `in low-THC liquids packaged in units of ${LOW_THC_UNIT_MG} mg or less \u2014 plus ` +\n"
    "      `${REC_OTHERWISE_UNITS} units of a product otherwise taken into the body \u2014 the same ` +\n"
    "      `amounts as the transaction limit.`,",
)


# ═══════════════════════════════════════════════════════════════════════════
# 2. THE REGULATORY ANALYST MAP  (compliance-surface.ts)
# ═══════════════════════════════════════════════════════════════════════════
#
# THE STALE CLAIM. SLICE 16 wrote "is the only bucket that does NOT triple".
# SLICE 17 makes that FALSE. An analyst reading a future LCB bulletin against
# the stale sentence would conclude the ten-unit cap DOES triple and propose a
# 30-unit medical limit — an over-sale on every medical transaction.
#
# The replacement states BOTH facts and, critically, that the two buckets
# resist tripling for DIFFERENT REASONS. That is not pedantry: (2)(d) NAMES
# 200 mg, so a future amendment could raise it; (2)(d) OMITS "otherwise taken"
# entirely, so there is no medical figure to raise.
edit(
    SURFACE,
    "compliance-surface: sales-limits whatWeRun",
    "      \"The register hard-blocks any sale over the per-category limits (1 oz flower, 16 oz solid edible, 72 oz liquid, 7 g concentrate, and 200 mg active delta-9 THC for low-THC infused beverages packaged in units of 4 mg or less) with an owner-only override ledger. The low-THC beverage bucket is counted in MILLIGRAMS OF THC, not grams, and is the only bucket that does NOT triple for a DOH-database medical patient.\",",
    "      \"The register hard-blocks any sale over the per-category limits (1 oz flower, 16 oz solid edible, 72 oz liquid, 7 g concentrate, 200 mg active delta-9 THC for low-THC infused beverages packaged in units of 4 mg or less, and 10 units of a product otherwise taken into the body) with an owner-only override ledger. TWO of the six buckets are not denominated in grams: the low-THC beverage bucket is counted in MILLIGRAMS OF THC, and the otherwise-taken-into-the-body bucket is a COUNT of individual items (a sealed box of six suppositories is six of the ten, per RCW 69.50.101) \u2014 rendering either one as a weight produces a meaningless figure. Those same two buckets are also the only ones that do NOT triple for a DOH-database medical patient, and they resist tripling for DIFFERENT reasons: WAC 314-55-095(2)(d) NAMES the identical 200 mg figure for patients, whereas it OMITS the otherwise-taken category from its enumeration altogether, so no enhanced medical amount exists to grant. That distinction matters when reading any future amendment \u2014 the beverage figure could be raised by amending a number that is already there, but the otherwise-taken bucket would require the category to be ADDED to (2)(d) first. WAC 314-55-010(40) defines the category by route of administration (not inhaled, not orally ingested, not applied to the skin), so it CANNOT be inferred from the product category slug: one topical shelf holds both balms (72 oz) and suppositories (10 units).\",",
)

# The modules list should name the migration-bearing surfaces for this rule.
edit(
    SURFACE,
    "compliance-surface: sales-limits modules",
    "    modules: [\n"
    "      \"src/lib/compliance/sales-limit-gate-core.ts\",\n"
    "      \"src/lib/compliance/sales-limits-core.ts\",\n"
    "      \"/admin/compliance/sales-limits\",\n"
    "      \"/admin/menu-imports/[id]/facts\",\n"
    "    ],",
    "    modules: [\n"
    "      \"src/lib/compliance/sales-limit-gate-core.ts\",\n"
    "      \"src/lib/compliance/sales-limits-core.ts\",\n"
    "      \"src/lib/menu/cart-limit-meter-core.ts\",\n"
    "      \"src/lib/pos/sale-flow-core.ts\",\n"
    "      \"/admin/compliance/sales-limits\",\n"
    "      \"/admin/menu-imports/[id]/facts\",\n"
    "    ],",
)


# ═══════════════════════════════════════════════════════════════════════════
# 3. COMPLIANCE_BIBLE.md
# ═══════════════════════════════════════════════════════════════════════════

edit(
    BIBLE,
    "bible: limits table row",
    "| **Low-THC infused liquid** (packaged in individual units of \u2264 4 mg active \u03949-THC) | **200 mg active \u03949-THC** | **200 mg active \u03949-THC** \u2014 *NOT tripled* |\n",
    "| **Low-THC infused liquid** (packaged in individual units of \u2264 4 mg active \u03949-THC) | **200 mg active \u03949-THC** | **200 mg active \u03949-THC** \u2014 *NOT tripled* |\n"
    "| **Otherwise taken into the body** (suppositories \u2014 WAC 314-55-010(40)) | **10 units** | **10 units** \u2014 *NOT tripled* |\n",
)

edit(
    BIBLE,
    "bible: otherwise-taken section",
    "Possession follows automatically: **RCW 69.50.4013(3)(a)** legalizes possession of amounts\n",
    "**Otherwise-taken-into-the-body bucket (WAC 314-55-095(1)(d)(i)(D), eff. 1/7/2025).**\n"
    "Subsection (D) reads, in full: *\"Ten units of a cannabis-infused product otherwise taken\n"
    "into the body.\"* **WAC 314-55-010(40)** supplies the definition: *\"'Product(s) otherwise\n"
    "taken into the body' means a cannabis-infused product for human consumption or ingestion\n"
    "intended for uses other than inhalation, oral ingestion, or external application to the\n"
    "skin.\"* The definition is by ROUTE OF ADMINISTRATION, by exclusion \u2014 in a retail shop the\n"
    "category means suppositories. Five consequences the POS must honor:\n"
    "1. **It is a COUNT, not a weight and not a THC figure.** The other five buckets are grams\n"
    "   or milligrams; this one is a number of items. `LIMIT_BUCKET_UNITS.otherwise_taken` is\n"
    "   `\"units\"`. Any formatter that assumes grams renders ten units as *0.353 oz*, which is\n"
    "   meaningless and would misstate the law on a customer-facing page.\n"
    "2. **A unit is an item; a package may hold several.** **RCW 69.50.101** defines *\"unit\"* as\n"
    "   *\"an individual consumable item within a package of one or more consumable items\"* and\n"
    "   *\"package\"* as *\"a container that has a single unit or group of units.\"* So a sealed\n"
    "   **box of six suppositories is ONE package of SIX units** and consumes six of the ten.\n"
    "   The engine computes `quantity \u00d7 units_per_package`, both floored to integers.\n"
    "3. **Medical does NOT triple \u2014 because the rule OMITS the category.** WAC 314-55-095(2)(d)\n"
    "   enumerates useable cannabis, solid edibles, concentrate, liquid, and the low-THC liquid\n"
    "   allowance. It **omits** \"otherwise taken into the body\" entirely \u2014 the phrase does not\n"
    "   appear in the subsection at all, and the category is simply **absent** from it. The rule\n"
    "   grants no enhanced medical amount, so none is granted: the cap stays **10 units**, and\n"
    "   **30 units** would be an over-sale on every medical transaction. Note this is a\n"
    "   DIFFERENT reason from the beverage bucket, where (2)(d) states the identical 200 mg\n"
    "   figure explicitly. The practical difference: raising the beverage figure would take an\n"
    "   amendment to a number already present, whereas this category would first have to be\n"
    "   ADDED to (2)(d).\n"
    "4. **The statute sets NO per-unit potency ceiling here.** (1)(d)(i)(D) states a count and\n"
    "   nothing else. Migration 0217 therefore adds **no** milligram column for this bucket \u2014\n"
    "   inventing one would be adding law. (The \u226410 mg per-serving and \u2264100 mg per-package\n"
    "   figures are real, but they are PACKAGING rules from a different subsection and do not\n"
    "   cap this transaction bucket.)\n"
    "5. **THE FAIL-SAFE INVERTS \u2014 read this before copying the SLICE 16 pattern.** For low-THC\n"
    "   beverages an unflagged product falls back to the 72 oz volume rule, which is STRICTER;\n"
    "   failing to classify one costs the customer nothing. Here the arithmetic runs the\n"
    "   opposite way: an unflagged suppository lands in `liquid_edible`, whose 2,016 g cap is\n"
    "   effectively unlimited for an item that weighs a few grams. **Falling back is PERMISSIVE,\n"
    "   not safe.** The countermeasures are therefore active, not passive: `suspectsOtherwiseTaken()`\n"
    "   flags candidates by name at intake, the fact-review queue holds them for a human, and\n"
    "   partial indexes in migration 0217 keep the unreviewed set cheap to find.\n"
    "\n"
    "Possession follows automatically: **RCW 69.50.4013(3)(a)** legalizes possession of amounts\n",
)


# ═══════════════════════════════════════════════════════════════════════════
# 4. PRODUCT_NAMING_CONVENTION.md
# ═══════════════════════════════════════════════════════════════════════════

edit(
    NAMING,
    "naming: verified-regulation table row",
    "| Serving/package caps | **WAC 314-55-095** |",
    "| Otherwise-taken txn cap | **WAC 314-55-095(1)(d)(i)(D)** + **WAC 314-55-010(40)** | *\"Ten units of a cannabis-infused product otherwise taken into the body\"*, where the category is defined by ROUTE OF ADMINISTRATION \u2014 *\"uses other than inhalation, oral ingestion, or external application to the skin\"* \u2014 i.e. suppositories. It is a **COUNT of items, not a weight**: per **RCW 69.50.101** a sealed **box of six is one package of six units**, consuming six of the ten. Medical is **also 10 units** \u2014 WAC 314-55-095(2)(d) **omits the category entirely**, so there is no enhanced amount to grant and 30 would be an over-sale. **\u2192 neither the NAME nor the CATEGORY can carry this fact: a single `topical` shelf holds balms and lotions (72 oz by volume) alongside suppositories (10 units by count), so the slug is ambiguous by construction. It rides on the intake flag `otherwise_taken` + `units_per_package` (migration 0217), sourced from the invoice and the physical package.** |\n"
    "| Serving/package caps | **WAC 314-55-095** |",
)


# ═══════════════════════════════════════════════════════════════════════════
# 5. POS_FRONTEND_RESEARCH.md
# ═══════════════════════════════════════════════════════════════════════════

edit(
    POSDOC,
    "posdoc: otherwise-taken implementation note",
    "- **10 units** of infused product otherwise taken into the body;\n",
    "- **10 units** of infused product otherwise taken into the body;\n"
    "  - *Implemented in SLICE 17.* Bucket `otherwise_taken`, denominated in **units** \u2014 a\n"
    "    COUNT OF ITEMS, the first bucket that is neither a mass nor a THC figure (see\n"
    "    `LIMIT_BUCKET_UNITS`). Per **RCW 69.50.101** a sealed box of six suppositories is one\n"
    "    package of six units, so the engine counts `quantity \u00d7 units_per_package`. Medical is\n"
    "    **also 10** \u2014 WAC 314-55-095(2)(d) omits the category, so no enhancement exists to\n"
    "    grant. Qualification requires an explicit intake flag (`menu_items.otherwise_taken` +\n"
    "    `units_per_package`, migration 0217) and is deliberately NOT derived from the category\n"
    "    slug, because one `topical` shelf legitimately holds both balms and suppositories.\n"
    "    **WARNING \u2014 the fail-safe here is PERMISSIVE, the opposite of SLICE 16.** An unflagged\n"
    "    suppository falls back to `liquid_edible`, whose 72 oz cap is effectively unlimited for\n"
    "    an item weighing a few grams, so a missing flag does NOT quietly protect the customer\n"
    "    the way a missing low-THC flag does. That is why `suspectsOtherwiseTaken()` raises the\n"
    "    product to the fact-review queue by name instead of relying on the fallback.\n",
)


# ═══════════════════════════════════════════════════════════════════════════
# APPLY
# ═══════════════════════════════════════════════════════════════════════════

def main() -> int:
    # Buffer PER FILE. Re-reading from disk per edit (the step-5 bug) causes two
    # edits to the same file to discard each other silently.
    buffers: dict[Path, str] = {}
    failures: list[str] = []

    for path, label, find, _replace in EDITS:
        if path not in buffers:
            if not path.exists():
                failures.append(f"MISSING FILE {path}")
                continue
            buffers[path] = path.read_text(encoding="utf-8")

    for path, label, find, replace in EDITS:
        if path not in buffers:
            continue
        n = buffers[path].count(find)
        if n != 1:
            failures.append(f"ANCHOR {label}: matched {n}x in {path.relative_to(ROOT)}")
            continue
        buffers[path] = buffers[path].replace(find, replace, 1)

    if failures:
        print("REFUSING TO WRITE \u2014 anchor verification failed:")
        for f in failures:
            print(f"  - {f}")
        return 1

    for path, text in buffers.items():
        path.write_text(text, encoding="utf-8")

    print(f"Applied {len(EDITS)} anchored edits across {len(buffers)} files:")
    for path in buffers:
        print(f"  - {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
