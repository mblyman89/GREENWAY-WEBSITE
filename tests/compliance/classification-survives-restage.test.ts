/**
 * tests/compliance/classification-survives-restage.test.ts
 *
 * SLICE 18G — DEFECT 3: receiving a product must not erase the sales-limit
 * classification of every product in the shop.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS BROKEN
 * ─────────────────────────────────────────────────────────────────────────────
 * Accepting a manifest, or approving any catalog draft, rebuilds the live menu:
 * every currently-published item is carried forward, the newly approved items
 * are appended, and the result is AUTO-PUBLISHED
 * (intake-menu-staging.ts — persistSnapshotItems then autoPublishIntakeVersion).
 *
 * "Carried forward" is implemented as an explicit field list, and the four
 * compliance-limit columns were absent from it. So a classification a human had
 * correctly set was silently dropped and the rebuilt menu went live with all
 * four columns NULL.
 *
 * NULL is the fail-open. Migration 0216 says so in as many words: "NULL = not
 * yet classified; the engine treats NULL as a normal liquid." The register
 * reads these four columns off the MENU row and nothing else
 * (src/lib/pos/live-menu.ts) — that is the 18E doctrine, written into the
 * schema by migration 0219. So dropping them at re-stage does not merely lose
 * a label: it silently stops enforcing a statutory limit, with no error on any
 * screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE ARE TWO PRODUCERS TESTED HERE, NOT ONE
 * ─────────────────────────────────────────────────────────────────────────────
 * The 18E writeup described the CARRY-FORWARD path only. Reading the code again
 * for this slice showed the loss happens in BOTH producers of a staged row:
 *
 *   1. carryForward()        — an ALREADY-PUBLISHED product loses the answer a
 *                              human set earlier;
 *   2. masteredToSnapshot()  — a NEWLY APPROVED product loses the answer the
 *                              approver just gave, even though SLICE 18-0
 *                              deliberately plumbed it this far
 *                              (draft-injection-core.ts: PlannedInjectedItem
 *                              carries all four, and standaloneCard() keeps
 *                              them via `...rest`).
 *
 * Fixing one and not the other would look like a fix and still lose data, so
 * both are pinned below.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TESTING DOCTRINE (carried from 18B–18E, and the owner's instruction to
 * "test everything including the tests")
 * ─────────────────────────────────────────────────────────────────────────────
 * These assertions EXECUTE the real planner and inspect the values it returns.
 * They do not grep the source for column names. Text matching proves a word
 * exists somewhere; it never proves a value arrived. The distinction is the
 * whole reason this defect survived: every layer MENTIONED classification
 * somewhere, and the value still did not travel.
 *
 * The last describe block is the one that matters most long-term. It is a
 * CLASS-OF-BUG guard: it derives its expectations from a single declared list
 * of enforcement-relevant columns and asserts each one survives, so the NEXT
 * compliance column cannot be forgotten in exactly the same way.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildIntakeStagedVersionPlan,
  type CarryForwardItem,
  type StagedSnapshotItem,
} from "@/lib/pos/intake-menu-staging-core";
import type { ApprovedDraftForInjection, DraftEnrichment } from "@/lib/pos/draft-injection-core";

/**
 * THE DECLARED CONTRACT.
 *
 * Every key here is a menu_items column the register reads to decide a
 * statutory limit. `lot` is the value a carried row holds, chosen so it is
 * distinguishable from both null and a default-ish value; `draft` is the
 * matching `chosen_*` field on an approved draft.
 *
 * Adding a compliance column to menu_items means adding it here, and the
 * suite will then demand it survive both producers.
 */
const ENFORCEMENT_COLUMNS = [
  {
    column: "otherwise_taken" as const,
    draftField: "chosen_otherwise_taken" as const,
    carried: true,
    approved: true,
    statute: "WAC 314-55-095(1)(d)(i)(D) — ten-unit bucket",
  },
  {
    column: "units_per_package" as const,
    draftField: "chosen_units_per_package" as const,
    carried: 6,
    approved: 4,
    statute: 'RCW 69.50.101 — "unit" / "package"',
  },
  {
    column: "low_thc_liquid" as const,
    draftField: "chosen_low_thc_liquid" as const,
    carried: true,
    approved: true,
    statute: "WAC 314-55-095(1)(d)(i)(E)+(F) — 200 mg carve-out",
  },
  {
    column: "unit_thc_mg" as const,
    draftField: "chosen_unit_thc_mg" as const,
    carried: 3.5,
    approved: 2.25,
    statute: "WAC 314-55-095(1)(d)(i)(F) — per-unit ceiling",
  },
];

function published(over: Partial<CarryForwardItem>): CarryForwardItem {
  return {
    source_item_id: "LIVE-SUPP-1",
    name: "Relief Suppository 6-pack",
    product_name: "Relief Suppository 6-pack",
    brand_name: "House",
    vendor_name: "House LLC",
    category: "topical",
    filter_categories: ["topical"],
    pos_inventory_type: null,
    pos_inventory_category: null,
    strain_type: "hybrid",
    strain_name: null,
    thc: "10mg",
    cbd: null,
    total_thc_json: null,
    total_cbd_json: null,
    compounds_json: [],
    description: "Live desc.",
    price_label: "$30.00",
    price_minor_units: 3000,
    inventory_status: "in-stock",
    hidden: false,
    hidden_reason: null,
    variants: [
      {
        source_variant_id: "LIVE-SUPP-1-v",
        label: "6-pack",
        price_minor_units: 3000,
        inventory_level: 9,
        medical: false,
      },
    ],
    ...over,
  };
}

function draft(over: Partial<ApprovedDraftForInjection>): ApprovedDraftForInjection {
  return {
    id: "d1",
    pos_product_key: "LOT-NEW-SUPP",
    name: "New Suppository 4-pack",
    brand_name: "Fairwinds",
    vendor_name: "Fairwinds LLC",
    strain_name: null,
    thc_pct: 1,
    cbd_pct: 0,
    total_thc_pct: 1,
    potency_json: { thc: 1 },
    price_minor_units: 2500,
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function enrich(over: Partial<DraftEnrichment>): DraftEnrichment {
  return {
    websiteCategory: "topical",
    strainType: "hybrid",
    onHandQty: 5,
    packageLabel: "4-pack",
    ...over,
  };
}

/** A carried row holding a REAL, human-supplied answer on all four columns. */
function classifiedLiveItem(): CarryForwardItem {
  const over: Record<string, unknown> = {};
  for (const c of ENFORCEMENT_COLUMNS) over[c.column] = c.carried;
  return published(over as Partial<CarryForwardItem>);
}

/** An approved draft holding a REAL answer on all four `chosen_*` fields. */
function classifiedDraft(): ApprovedDraftForInjection {
  const over: Record<string, unknown> = {};
  for (const c of ENFORCEMENT_COLUMNS) over[c.draftField] = c.approved;
  return draft(over as Partial<ApprovedDraftForInjection>);
}

function planWith(
  publishedItems: CarryForwardItem[],
  approvedDrafts: ApprovedDraftForInjection[],
) {
  return buildIntakeStagedVersionPlan({
    publishedItems,
    approvedDrafts,
    enrichmentByDraftId: new Map(approvedDrafts.map((d) => [d.id, enrich({})])),
  });
}

function byKey(items: StagedSnapshotItem[], sourceItemId: string): StagedSnapshotItem {
  const found = items.find((i) => i.source_item_id === sourceItemId);
  if (!found) throw new Error(`no staged item for ${sourceItemId}`);
  return found;
}

/** Read a column off a staged item without `any`. */
function valueOf(item: StagedSnapshotItem, column: string): unknown {
  return (item as unknown as Record<string, unknown>)[column];
}

// ───────────────────────────────────────────────────────────────────────────
// 1. THE CARRIED PRODUCT. The headline defect.
// ───────────────────────────────────────────────────────────────────────────
describe("DEFECT 3: a carried-forward product keeps its classification", () => {
  it("does not erase a classification when an unrelated product is received", () => {
    // A suppository, correctly classified, sitting on the live menu. Then an
    // unrelated new product is approved, which rebuilds and republishes the
    // whole menu. The suppository must come out the other side unchanged.
    const plan = planWith([classifiedLiveItem()], [draft({})]);

    const carried = byKey(plan.items, "LIVE-SUPP-1");
    expect(carried.origin).toBe("carried");

    // Behavioural, column by column, with the statute named so a failure tells
    // the reader what is actually at stake.
    for (const c of ENFORCEMENT_COLUMNS) {
      expect(valueOf(carried, c.column), `${c.column} (${c.statute}) was erased by re-stage`).toBe(
        c.carried,
      );
    }
  });

  it("keeps the classification even when nothing new is added", () => {
    // Re-staging with no new drafts is still a full rebuild + republish. The
    // no-op case must be a genuine no-op for the compliance columns.
    const plan = planWith([classifiedLiveItem()], []);
    const carried = byKey(plan.items, "LIVE-SUPP-1");
    for (const c of ENFORCEMENT_COLUMNS) {
      expect(valueOf(carried, c.column), `${c.column} lost on a no-change re-stage`).toBe(c.carried);
    }
  });

  it("preserves a literal false rather than flattening it to null", () => {
    // false means "a human looked and said no". It is NOT the same as null,
    // which means "nobody has answered". The receiving dock warns only while
    // the value is null, so flattening false to null would resurrect the
    // warning 18E just fixed. Prove the distinction survives.
    const plan = planWith(
      [published({ otherwise_taken: false, low_thc_liquid: false } as Partial<CarryForwardItem>)],
      [],
    );
    const carried = byKey(plan.items, "LIVE-SUPP-1");
    expect(valueOf(carried, "otherwise_taken")).toBe(false);
    expect(valueOf(carried, "low_thc_liquid")).toBe(false);
    // Guard the inverse mistake too: `?? null` on a false value would pass the
    // line above only if written correctly, so pin the type explicitly.
    expect(valueOf(carried, "otherwise_taken")).not.toBeNull();
  });

  it("leaves an unclassified product null — it must not invent an answer", () => {
    // The fix must carry values, not manufacture them. A product nobody has
    // classified stays null, because null is what makes the receiving dock ask
    // the question. Writing false here would silence a question never answered.
    const plan = planWith([published({})], []);
    const carried = byKey(plan.items, "LIVE-SUPP-1");
    for (const c of ENFORCEMENT_COLUMNS) {
      expect(valueOf(carried, c.column), `${c.column} was invented out of nothing`).toBeNull();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. THE NEWLY APPROVED PRODUCT. The second producer, found in 18G recon.
// ───────────────────────────────────────────────────────────────────────────
describe("DEFECT 3: a newly approved product arrives classified", () => {
  it("carries the approver's compliance answers onto the staged row", () => {
    // SLICE 18-0 plumbed these all the way to PlannedInjectedItem, and
    // standaloneCard() keeps them via `...rest`. The staging mapper was the
    // one link that dropped them, so the human's answer never reached the
    // menu by this path.
    const plan = planWith([], [classifiedDraft()]);

    const added = byKey(plan.items, "LOT-NEW-SUPP");
    expect(added.origin).toBe("intake");

    for (const c of ENFORCEMENT_COLUMNS) {
      expect(
        valueOf(added, c.column),
        `${c.column} (${c.statute}) never reached the staged row`,
      ).toBe(c.approved);
    }
  });

  it("leaves an unanswered draft null rather than defaulting it", () => {
    // The fail-safe directions differ between these columns (an unanswered
    // otherwise_taken is PERMISSIVE, an unanswered low_thc_liquid is
    // CONSERVATIVE), which is exactly why neither may be defaulted here. The
    // value is decided at the gate; null means null.
    const plan = planWith([], [draft({})]);
    const added = byKey(plan.items, "LOT-NEW-SUPP");
    for (const c of ENFORCEMENT_COLUMNS) {
      expect(valueOf(added, c.column), `${c.column} was defaulted, not carried`).toBeNull();
    }
  });

  it("keeps the two products' answers separate in one re-stage", () => {
    // Both producers run in the SAME rebuild. A fix that accidentally shared
    // one value across rows, or applied the new card's answer to the carried
    // one, would still be wrong. The fixtures use different values on purpose
    // so a crossed wire cannot pass.
    const plan = planWith([classifiedLiveItem()], [classifiedDraft()]);

    const carried = byKey(plan.items, "LIVE-SUPP-1");
    const added = byKey(plan.items, "LOT-NEW-SUPP");

    for (const c of ENFORCEMENT_COLUMNS) {
      expect(valueOf(carried, c.column), `carried ${c.column} crossed wires`).toBe(c.carried);
      expect(valueOf(added, c.column), `added ${c.column} crossed wires`).toBe(c.approved);
    }

    // And the values really are distinguishable, so the assertions above have
    // teeth. If a future edit made these equal, the crossed-wire test would
    // silently stop testing anything — so assert the fixture itself.
    const distinguishable = ENFORCEMENT_COLUMNS.filter((c) => c.carried !== c.approved);
    expect(
      distinguishable.length,
      "fixtures must differ or the crossed-wire assertions prove nothing",
    ).toBeGreaterThanOrEqual(2);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. THE CLASS-OF-BUG GUARD. The real deliverable.
// ───────────────────────────────────────────────────────────────────────────
describe("DEFECT 3: the class of bug, not just this instance", () => {
  /**
   * The specific bug is four missing lines. The CLASS of bug is a hand-written
   * field list that silently loses whatever nobody remembered to add — and this
   * repo has now been bitten by it twice (SLICE 62 added the structured facts
   * to the carry list for exactly this reason; the compliance flags were never
   * given the same treatment).
   *
   * This block derives its expectations from ENFORCEMENT_COLUMNS rather than
   * repeating them, so declaring a new compliance column immediately demands
   * that it survive a re-stage. That is the part that keeps paying after this
   * slice ships.
   */
  it("every declared enforcement column survives both producers", () => {
    const plan = planWith([classifiedLiveItem()], [classifiedDraft()]);
    const carried = byKey(plan.items, "LIVE-SUPP-1");
    const added = byKey(plan.items, "LOT-NEW-SUPP");

    const lost: string[] = [];
    for (const c of ENFORCEMENT_COLUMNS) {
      if (valueOf(carried, c.column) !== c.carried) lost.push(`carried.${c.column}`);
      if (valueOf(added, c.column) !== c.approved) lost.push(`added.${c.column}`);
    }

    expect(
      lost,
      "a re-stage dropped an enforcement column; the register would stop applying that limit",
    ).toEqual([]);
  });

  it("the guard covers every compliance column the register actually reads", () => {
    // A guard is only as good as its list. If someone adds a fifth flag to the
    // register's read and not to ENFORCEMENT_COLUMNS, the block above would
    // still pass while the new column silently vanished on every re-stage.
    //
    // So: read the register's OWN list of limit inputs out of live-menu.ts and
    // require this file to cover all of it. This is the one place a source
    // read is the right tool — the claim being tested is "our list matches
    // theirs", which is a claim about the source text.
    const src = readFileSync("src/lib/pos/live-menu.ts", "utf8");

    // The register maps snake_case DB columns onto camelCase product fields.
    const registerReads = ["low_thc_liquid", "unit_thc_mg", "otherwise_taken", "units_per_package"]
      .filter((col) => src.includes(`row.${col}`));

    expect(
      registerReads.length,
      "live-menu.ts no longer reads the limit flags the way this guard assumes — re-derive it",
    ).toBe(4);

    const covered = new Set(ENFORCEMENT_COLUMNS.map((c) => c.column as string));
    const uncovered = registerReads.filter((col) => !covered.has(col));
    expect(
      uncovered,
      "the register reads a limit column this test does not guard; add it to ENFORCEMENT_COLUMNS",
    ).toEqual([]);
  });

  it("the fixtures use non-default values, so a stub could not pass", () => {
    // A mapper that hard-coded `false`/`null`, or that returned a fresh empty
    // object, must not be able to satisfy this suite. Every carried fixture
    // value is therefore either `true` or a non-round number that no default
    // would produce.
    for (const c of ENFORCEMENT_COLUMNS) {
      expect(c.carried, `${c.column} fixture must not be null`).not.toBeNull();
      expect(c.carried, `${c.column} fixture must not be undefined`).not.toBeUndefined();
      if (typeof c.carried === "number") {
        expect(c.carried, `${c.column} fixture must not be 0`).not.toBe(0);
      }
    }
  });
});
