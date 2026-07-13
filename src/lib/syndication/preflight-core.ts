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
      if (parseWeightFromLabel(v.label) === null) {
        issues.push({
          severity: "warning",
          code: "unparseable_weight",
          channels: ["weedmaps"],
          itemId: item.id,
          variantId: v.id,
          message: `Variant label "${v.label || "(blank)"}" of "${item.name || item.id}" has no parseable weight (e.g. "3.5g", "1 oz") — Weedmaps requires a weight per variant.`,
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

  // Markup in description
  const markup = runPreflight([{ ...good, id: "p8", description: "<b>Loud</b>" }]);
  ok("markup warning", markup.issues.some((i) => i.code === "markup_in_description"));

  // Counts: p5 has exactly one error (price) and no warnings ("1g" weight parses).
  ok("error/warning counts", badPrice.errorCount === 1 && badPrice.warningCount === 0);

  console.log(`preflight: ${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error(`${failed} preflight test(s) failed`);
}
