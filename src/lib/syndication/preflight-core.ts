/**
 * src/lib/syndication/preflight-core.ts  (Task X)
 *
 * PURE preflight validation of the syndication feed BEFORE any live push, so
 * data problems are fixed on our side instead of being rejected (or silently
 * degraded) by Leafly / Weedmaps. No DB, no network, no "server-only".
 *
 * Grounded in docs/LEAFLY_WEEDMAPS_INTEGRATION_RESEARCH.md:
 *  - Both channels: stable unique ids, >=1 variant, positive prices.
 *  - Leafly v2: plain-text descriptions; strain/cannabinoid null-not-NA/0 is
 *    handled by the payload mapper, so preflight focuses on structural issues.
 *  - Weedmaps 2025-07: every variant REQUIRES a weight {unit,value}; prohibited
 *    terms in name/description cause 422s; descriptions/names should be clean.
 */

import type { SyndicationItem } from "./menu-feed-core";
import { parseWeightFromLabel } from "../weedmaps/payload-core";
import { LEAFLY_TYPE_UNIT_MATRIX } from "../leafly/contract-core";
import { toLeaflyType } from "../leafly/payload-core";

/**
 * Does Leafly require a real WEIGHT for this Greenway category?
 *
 * True only when the item's funnel type cannot legally be sold by `each`. For
 * Flower that is the case: Leafly documents `g` or `oz` and nothing else, so
 * there is no fallback and no weight means no variant. Concentrates and
 * cartridges accept `each` as well as `g`, so an unreadable weight there
 * degrades gracefully rather than dropping the product.
 *
 * Derived from LEAFLY_TYPE_UNIT_MATRIX rather than hardcoded, so if Leafly ever
 * changes which types accept `each`, this follows automatically instead of
 * quietly disagreeing with the mapper that uses the same table.
 */
function leaflyWeightIsMandatory(category: string): boolean {
  const units = LEAFLY_TYPE_UNIT_MATRIX[toLeaflyType(category)].variantUnits;
  return !(units as readonly string[]).includes("each");
}

/** The legal variant units for this category, for the error message. */
function leaflyWeightUnitsFor(category: string): string {
  return LEAFLY_TYPE_UNIT_MATRIX[toLeaflyType(category)].variantUnits.join(" or ");
}

export type PreflightSeverity = "error" | "warning";

export type PreflightIssue = {
  severity: PreflightSeverity;
  /** Machine code, stable for tests/UI grouping. */
  code:
    | "duplicate_item_id"
    | "duplicate_variant_id"
    | "missing_name"
    | "nonpositive_price"
    | "no_variants"
    | "unparseable_weight"
    | "leafly_missing_weight"
    | "long_name"
    | "markup_in_description";
  /** Channels the issue matters for. */
  channels: ("leafly" | "weedmaps")[];
  itemId: string;
  variantId?: string;
  message: string;
};

export type PreflightReport = {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  issues: PreflightIssue[];
};

/**
 * Thrown by the push engines when a LIVE push is blocked by preflight ERRORS
 * (bad data would corrupt the third-party menu). Carries the full report so
 * actions/UI can show exactly what to fix. Previews are never blocked.
 */
export class PreflightBlockedError extends Error {
  readonly report: PreflightReport;
  constructor(report: PreflightReport) {
    const first = report.issues.filter((i) => i.severity === "error").slice(0, 3);
    super(
      `Live push blocked by ${report.errorCount} preflight error(s): ` +
        `${first.map((i) => i.message).join(" · ")}${report.errorCount > 3 ? " · …" : ""}`,
    );
    this.name = "PreflightBlockedError";
    this.report = report;
  }
}

const MAX_NAME_LENGTH = 120;

export function runPreflight(items: SyndicationItem[]): PreflightReport {
  const issues: PreflightIssue[] = [];

  // Duplicate item ids (both channels: id churn/collision corrupts menus).
  const seenItemIds = new Map<string, number>();
  for (const item of items) {
    seenItemIds.set(item.id, (seenItemIds.get(item.id) ?? 0) + 1);
  }
  for (const [id, count] of seenItemIds) {
    if (count > 1) {
      issues.push({
        severity: "error",
        code: "duplicate_item_id",
        channels: ["leafly", "weedmaps"],
        itemId: id,
        message: `Item id "${id}" appears ${count} times — ids must be unique and stable.`,
      });
    }
  }

  // Duplicate variant ids across the whole feed.
  const seenVariantIds = new Map<string, string>(); // variantId -> first itemId
  for (const item of items) {
    for (const v of item.variants) {
      const firstOwner = seenVariantIds.get(v.id);
      if (firstOwner !== undefined && firstOwner !== item.id) {
        issues.push({
          severity: "error",
          code: "duplicate_variant_id",
          channels: ["leafly", "weedmaps"],
          itemId: item.id,
          variantId: v.id,
          message: `Variant id "${v.id}" is reused across items ("${firstOwner}" and "${item.id}") — variant ids must be unique.`,
        });
      } else if (firstOwner === undefined) {
        seenVariantIds.set(v.id, item.id);
      }
    }
  }

  for (const item of items) {
    // Missing / blank name (Weedmaps PUT-by-external-id REQUIRES name; Leafly needs it too).
    if (!item.name || item.name.trim().length === 0) {
      issues.push({
        severity: "error",
        code: "missing_name",
        channels: ["leafly", "weedmaps"],
        itemId: item.id,
        message: `Item "${item.id}" has no name — Weedmaps requires name on every upsert.`,
      });
    } else if (item.name.trim().length > MAX_NAME_LENGTH) {
      issues.push({
        severity: "warning",
        code: "long_name",
        channels: ["leafly", "weedmaps"],
        itemId: item.id,
        message: `Item "${item.name.slice(0, 40)}…" name exceeds ${MAX_NAME_LENGTH} characters — long names truncate poorly on menus.`,
      });
    }

    // Non-positive prices (item-level, used when a default variant is synthesized).
    if (item.variants.length === 0 && !(item.priceMinorUnits > 0)) {
      issues.push({
        severity: "error",
        code: "nonpositive_price",
        channels: ["leafly", "weedmaps"],
        itemId: item.id,
        message: `Item "${item.name || item.id}" has no variants and a non-positive price (${item.priceMinorUnits}¢).`,
      });
    }

    // Variant checks.
    if (item.variants.length === 0) {
      issues.push({
        severity: "warning",
        code: "no_variants",
        channels: ["leafly", "weedmaps"],
        itemId: item.id,
        message: `Item "${item.name || item.id}" has no variants — a default variant will be synthesized from the item price.`,
      });
    }
    for (const v of item.variants) {
      if (!(v.priceMinorUnits > 0)) {
        issues.push({
          severity: "error",
          code: "nonpositive_price",
          channels: ["leafly", "weedmaps"],
          itemId: item.id,
          variantId: v.id,
          message: `Variant "${v.label || v.id}" of "${item.name || item.id}" has a non-positive price (${v.priceMinorUnits}¢).`,
        });
      }
      // Weedmaps: weight is REQUIRED per variant; we never invent one.
      const parsedWeight = parseWeightFromLabel(v.label);
      if (parsedWeight === null) {
        issues.push({
          severity: "warning",
          code: "unparseable_weight",
          channels: ["weedmaps"],
          itemId: item.id,
          variantId: v.id,
          message: `Variant label "${v.label || "(blank)"}" of "${item.name || item.id}" has no parseable weight (e.g. "3.5g", "1 oz") — Weedmaps requires a weight per variant.`,
        });
      }

      // SLICE L-2 -- Leafly, and this one is an ERROR, not a warning.
      //
      // Leafly's `variant.unit` table makes weight MANDATORY for some item
      // types and forbids it for others: a Flower variant may only be `g` or
      // `oz`, while an Edible or PreRoll may only be `each`. So an unreadable
      // weight is harmless for most of the menu and fatal for flower.
      //
      // Fatal is meant literally. `payload-core.variantsFor()` refuses to
      // invent a weight (house rule 3), so a Flower variant with an unreadable
      // label produces NO variant; an item whose variants all fail produces NO
      // item; and Leafly's schema requires `minItems: 1`. The product simply
      // vanishes from the Leafly menu. Nothing errors, nothing 400s, the push
      // reports success, and a product the shop is selling is invisible to
      // every shopper on Leafly.
      //
      // That is precisely the failure mode preflight exists to prevent, which
      // is why it blocks the push and names the fix.
      if (
        parsedWeight === null &&
        leaflyWeightIsMandatory(item.category) &&
        v.priceMinorUnits > 0
      ) {
        issues.push({
          severity: "error",
          code: "leafly_missing_weight",
          channels: ["leafly"],
          itemId: item.id,
          variantId: v.id,
          message:
            `Variant "${v.label || v.id}" of "${item.name || item.id}" is a ` +
            `${toLeaflyType(item.category)} product, which Leafly sells by ` +
            `${leaflyWeightUnitsFor(item.category)} — but no weight could be read from the ` +
            `label "${v.label || "(blank)"}". A weight is NEVER guessed, so this variant ` +
            `would be dropped and the product would silently disappear from the Leafly menu. ` +
            `Fix the variant label (e.g. "3.5g", "1 oz").`,
        });
      }
    }

    // Markup in description (both channels want plain text; mapper strips it, but
    // flag it so the source data gets cleaned).
    if (item.description && /<[^>]+>/.test(item.description)) {
      issues.push({
        severity: "warning",
        code: "markup_in_description",
        channels: ["leafly", "weedmaps"],
        itemId: item.id,
        message: `Description of "${item.name || item.id}" contains HTML markup — it will be stripped, but plain-text source copy is cleaner.`,
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.length - errorCount;
  return { ok: errorCount === 0, errorCount, warningCount, issues };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
export function __runPreflightTests(): void {
  let passed = 0;
  let failed = 0;
  const ok = (label: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL: ${label}`);
    }
  };

  const good: SyndicationItem = {
    id: "p1",
    name: "Blue Dream",
    brand: "Acme",
    category: "flower",
    strainType: "sativa",
    strainName: "Blue Dream",
    thc: "22%",
    cbd: null,
    description: "Nice and smooth.",
    priceMinorUnits: 3500,
    inStock: true,
    variants: [{ id: "v1", label: "3.5g", priceMinorUnits: 3500, inStock: true, inventoryLevel: 4 }],
  };

  const clean = runPreflight([good]);
  ok("clean feed ok", clean.ok === true && clean.issues.length === 0);

  // Duplicate item ids
  const dupItems = runPreflight([good, { ...good, variants: [] , priceMinorUnits: 100 }]);
  ok("duplicate item id error", dupItems.issues.some((i) => i.code === "duplicate_item_id" && i.severity === "error"));
  ok("duplicate item ids make report not ok", dupItems.ok === false);

  // Duplicate variant ids across items
  const dupVar = runPreflight([
    good,
    { ...good, id: "p2", variants: [{ id: "v1", label: "1g", priceMinorUnits: 900, inStock: true, inventoryLevel: 2 }] },
  ]);
  ok("duplicate variant id error", dupVar.issues.some((i) => i.code === "duplicate_variant_id"));

  // Missing name
  const noName = runPreflight([{ ...good, id: "p3", name: "  " }]);
  ok("missing name error", noName.issues.some((i) => i.code === "missing_name" && i.severity === "error"));

  // Long name warning
  const longName = runPreflight([{ ...good, id: "p4", name: "x".repeat(150) }]);
  ok("long name warning", longName.issues.some((i) => i.code === "long_name" && i.severity === "warning"));
  ok("warnings alone keep ok true", longName.ok === true);

  // Non-positive variant price
  const badPrice = runPreflight([
    { ...good, id: "p5", variants: [{ id: "v5", label: "1g", priceMinorUnits: 0, inStock: true, inventoryLevel: 1 }] },
  ]);
  ok("nonpositive variant price error", badPrice.issues.some((i) => i.code === "nonpositive_price" && i.variantId === "v5"));

  // No variants + zero item price
  const noVarZero = runPreflight([{ ...good, id: "p6", variants: [], priceMinorUnits: 0 }]);
  ok("no variants warning", noVarZero.issues.some((i) => i.code === "no_variants" && i.severity === "warning"));
  ok("zero item price without variants error", noVarZero.issues.some((i) => i.code === "nonpositive_price" && i.severity === "error"));

  // Unparseable weight (Weedmaps-only warning)
  const badWeight = runPreflight([
    { ...good, id: "p7", variants: [{ id: "v7", label: "10pk", priceMinorUnits: 1500, inStock: true, inventoryLevel: 3 }] },
  ]);
  const weightIssue = badWeight.issues.find((i) => i.code === "unparseable_weight");
  ok("unparseable weight warning", weightIssue !== undefined && weightIssue.severity === "warning");
  ok("weight issue is weedmaps-only", weightIssue !== undefined && weightIssue.channels.length === 1 && weightIssue.channels[0] === "weedmaps");

  // -------------------------------------------------------------------------
  // SLICE L-2 -- leafly_missing_weight.
  //
  // The same unreadable label that is a WARNING for Weedmaps is an ERROR for
  // Leafly on a weight-sold type, because Leafly's schema leaves no legal way
  // to express the variant at all: the product would silently vanish from the
  // menu with the push still reporting success.
  // -------------------------------------------------------------------------
  const leaflyWeight = badWeight.issues.find((i) => i.code === "leafly_missing_weight");
  ok("flower with unreadable weight is a leafly ERROR", leaflyWeight?.severity === "error");
  ok(
    "leafly weight issue is leafly-only",
    leaflyWeight !== undefined &&
      leaflyWeight.channels.length === 1 &&
      leaflyWeight.channels[0] === "leafly",
  );
  ok("leafly weight issue blocks the push", badWeight.ok === false);
  ok("leafly weight issue names the variant", leaflyWeight?.variantId === "v7");
  ok("leafly weight issue names the item", leaflyWeight?.itemId === "p7");
  ok(
    "leafly weight message names the legal units",
    (leaflyWeight?.message ?? "").includes("g or oz"),
  );
  ok(
    "leafly weight message shows the offending label",
    (leaflyWeight?.message ?? "").includes("10pk"),
  );
  ok(
    "leafly weight message explains the silent disappearance",
    (leaflyWeight?.message ?? "").includes("disappear"),
  );

  // A readable weight on flower raises NEITHER issue.
  ok(
    "flower with a readable weight raises no weight issue",
    !runPreflight([good]).issues.some(
      (i) => i.code === "leafly_missing_weight" || i.code === "unparseable_weight",
    ),
  );

  // Every oz/g spelling the label parser accepts must satisfy Leafly too.
  for (const label of ["3.5g", "1 oz", "28 g", "1/8 oz", "7g", "1g"]) {
    ok(
      `flower label "${label}" raises no leafly weight error`,
      !runPreflight([
        {
          ...good,
          id: `w-${label}`,
          variants: [{ id: `wv-${label}`, label, priceMinorUnits: 3500, inStock: true, inventoryLevel: 1 }],
        },
      ]).issues.some((i) => i.code === "leafly_missing_weight"),
    );
  }

  // COUNTED types accept `each`, so an unreadable label is NOT fatal for them.
  // This is the assertion that keeps the rule type-aware instead of blanket:
  // firing it on every edible and pre-roll would make preflight unusable.
  for (const category of [
    "edible-solid",
    "edible-liquid",
    "tincture",
    "preroll",
    "preroll-pack",
    "topical",
    "paraphernalia",
    "accessories",
    "merch",
    "concentrate",
    "cartridge",
    "disposable-cartridge",
  ]) {
    const counted = runPreflight([
      {
        ...good,
        id: `c-${category}`,
        category,
        variants: [
          { id: `cv-${category}`, label: "10pk", priceMinorUnits: 1500, inStock: true, inventoryLevel: 3 },
        ],
      },
    ]);
    ok(
      `"${category}" sells by each -> no leafly weight error`,
      !counted.issues.some((i) => i.code === "leafly_missing_weight"),
    );
  }

  // ...but every FLOWER-family category IS fatal.
  for (const category of ["flower", "popcorn-bud", "infused-flower", "trim"]) {
    const weighed = runPreflight([
      {
        ...good,
        id: `f-${category}`,
        category,
        variants: [
          { id: `fv-${category}`, label: "big jar", priceMinorUnits: 3500, inStock: true, inventoryLevel: 3 },
        ],
      },
    ]);
    ok(
      `"${category}" is weight-sold -> leafly weight error`,
      weighed.issues.some((i) => i.code === "leafly_missing_weight" && i.severity === "error"),
    );
  }

  // A zero-price variant already errors on price; do not pile a second,
  // confusing error on top of a variant that is being rejected anyway.
  ok(
    "no duplicate weight error on an already-invalid price",
    !runPreflight([
      {
        ...good,
        id: "p7b",
        variants: [{ id: "v7b", label: "10pk", priceMinorUnits: 0, inStock: true, inventoryLevel: 3 }],
      },
    ]).issues.some((i) => i.code === "leafly_missing_weight"),
  );

  // Markup in description
  const markup = runPreflight([{ ...good, id: "p8", description: "<b>Loud</b>" }]);
  ok("markup warning", markup.issues.some((i) => i.code === "markup_in_description"));

  // Counts: p5 has exactly one error (price) and no warnings ("1g" weight parses).
  ok("error/warning counts", badPrice.errorCount === 1 && badPrice.warningCount === 0);

  // PreflightBlockedError carries the report + a readable message.
  const blocked = new PreflightBlockedError(dupItems);
  ok("blocked error name", blocked.name === "PreflightBlockedError");
  ok("blocked error carries report", blocked.report.errorCount === dupItems.errorCount);
  ok("blocked error message mentions count", blocked.message.includes("preflight error"));

  console.log(`preflight: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} preflight test(s) failed`);
}
