/**
 * src/lib/inventory/intake-review-adapter.ts — SLICE 39 connectivity audit.
 *
 * PURE adapter that rebuilds the ParsedManifest shape intake-review-core
 * expects from the STAGED database rows the manifest review page already
 * loads (InboundManifest + inventory_lots rows + their lab_results). This
 * finally connects the Slice 97 review summary (COA / lot-code / failed-lab /
 * sample / zero-qty flags) to the Receiving detail page WITHOUT re-parsing
 * raw_payload — the staged rows are the record of what was actually staged,
 * so flags computed from them are honest about what acceptance would commit.
 *
 * No I/O, no `server-only`, no Supabase — unit-testable under tsx/vitest.
 */

import type { ParsedManifest, ParsedLine, ParsedLab } from "@/lib/inventory/intake-parser";
import {
  summarizeIntakeForReview,
  type IntakeReviewSummary,
} from "@/lib/inventory/intake-review-core";

/** The subset of an inbound_manifests row the adapter needs. */
export type StagedManifestFacts = {
  manifest_number: string | null;
  vendor_label: string | null;
  /** From the LINKED vendor record (vendors.license_number) — the manifest
   * row itself does not store the license. Null when no vendor is linked or
   * the vendor record has no license on file (a real CCRS gap worth flagging). */
  vendor_license: string | null;
  /** inbound_manifests.source_format is free text in the DB; coerced below. */
  source_format: string;
};

/** The subset of an inventory_lots row the adapter needs (all present in the
 * listManifestLots select). */
export type StagedLotFacts = {
  product_name: string | null;
  lot_code: string | null;
  pos_product_key: string | null;
  received_qty: number;
  unit: string;
  unit_cost_minor_units: number | null;
  lab_result_id: string | null;
  is_sample: boolean;
  strain_name: string | null;
  category: string | null;
  inventory_type: string | null;
  expires_on: string | null;
};

/** The subset of a lab_results row lineHasCoa()/failed-lab detection needs. */
export type StagedLabFacts = {
  id: string;
  labtest_external_identifier: string | null;
  coa_url: string | null;
  thc_pct: number | null;
  total_thc_pct: number | null;
  cbd_pct: number | null;
  total_cbd_pct: number | null;
  potency_json: Record<string, number> | null;
  passed: boolean | null;
};

const KNOWN_FORMATS: ReadonlySet<ParsedManifest["source_format"]> = new Set([
  "wcia",
  "generic",
  "ccrs-csv",
  "pdf-manifest",
] as const);

/** Coerce the DB's free-text source_format to the parser union (never guess:
 * anything unrecognized is reported as "generic"). */
export function coerceSourceFormat(raw: string): ParsedManifest["source_format"] {
  return KNOWN_FORMATS.has(raw as ParsedManifest["source_format"])
    ? (raw as ParsedManifest["source_format"])
    : "generic";
}

function labFactsToParsedLab(lab: StagedLabFacts): ParsedLab {
  return {
    labtest_external_identifier: lab.labtest_external_identifier,
    lab_name: null,
    tested_on: null,
    thc_pct: lab.thc_pct,
    cbd_pct: lab.cbd_pct,
    thca_pct: null,
    cbda_pct: null,
    total_thc_pct: lab.total_thc_pct,
    total_cbd_pct: lab.total_cbd_pct,
    total_cannabinoids_pct: null,
    potency_json: lab.potency_json,
    terpenes_json: null,
    analytes_json: null,
    passed: lab.passed,
    coa_url: lab.coa_url,
    coa_release_date: null,
    coa_expire_date: null,
    raw: null,
  };
}

/**
 * Rebuild the ParsedManifest the review core expects from staged rows, then
 * summarize. PURE; never throws (mirrors summarizeIntakeForReview's contract).
 */
export function summarizeStagedIntake(
  manifest: StagedManifestFacts,
  lots: readonly StagedLotFacts[],
  labsById: ReadonlyMap<string, StagedLabFacts>,
): IntakeReviewSummary {
  const lines: ParsedLine[] = lots.map((lot) => {
    const lab = lot.lab_result_id ? labsById.get(lot.lab_result_id) ?? null : null;
    return {
      product_name: lot.product_name,
      lot_code: lot.lot_code,
      pos_product_key: lot.pos_product_key,
      brand_name: null,
      category: lot.category,
      strain_name: lot.strain_name,
      received_qty: Number.isFinite(lot.received_qty) ? lot.received_qty : 0,
      unit: lot.unit,
      unit_cost_minor_units: lot.unit_cost_minor_units,
      unit_weight: null,
      unit_weight_uom: null,
      is_sample: lot.is_sample,
      // Not used by the review summary; staged rows don't carry it.
      is_medical: false,
      inventory_type: lot.inventory_type,
      expires_on: lot.expires_on,
      lab: lab ? labFactsToParsedLab(lab) : null,
      // Parser warnings are not persisted after staging; the summary's own
      // per-line checks (lot code, COA, qty, cost) regenerate what matters.
      warnings: [],
      raw: null,
    };
  });

  const parsed: ParsedManifest = {
    manifest_number: manifest.manifest_number,
    vendor_label: manifest.vendor_label,
    vendor_license: manifest.vendor_license,
    transfer_date: null,
    source_format: coerceSourceFormat(manifest.source_format),
    lines,
    warnings: [],
  };

  return summarizeIntakeForReview(parsed);
}

// ---------------------------------------------------------------------------
// Self-tests (pure — run by scripts/compliance/run-pure-selftests.ts).
// ---------------------------------------------------------------------------
export function __runIntakeReviewAdapterTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.log(`FAIL: intake-review-adapter: ${msg}`);
    }
  };

  const lot = (over: Partial<StagedLotFacts> = {}): StagedLotFacts => ({
    product_name: "Blue Dream 3.5g",
    lot_code: "LOT-1",
    pos_product_key: "sku-1",
    received_qty: 10,
    unit: "each",
    unit_cost_minor_units: 1500,
    lab_result_id: "lab-1",
    is_sample: false,
    strain_name: "Blue Dream",
    category: null,
    inventory_type: null,
    expires_on: null,
    ...over,
  });
  const lab = (over: Partial<StagedLabFacts> = {}): StagedLabFacts => ({
    id: "lab-1",
    labtest_external_identifier: "EXT-1",
    coa_url: "https://example.com/coa.pdf",
    thc_pct: null,
    total_thc_pct: 21.5,
    cbd_pct: null,
    total_cbd_pct: null,
    potency_json: null,
    passed: true,
    ...over,
  });
  const manifest = (over: Partial<StagedManifestFacts> = {}): StagedManifestFacts => ({
    manifest_number: "M-100",
    vendor_label: "Good Farms",
    vendor_license: "414141",
    source_format: "wcia",
    ...over,
  });

  // Clean staged intake -> ready, no error flags.
  const clean = summarizeStagedIntake(manifest(), [lot()], new Map([["lab-1", lab()]]));
  ok(clean.readyForReview, "clean intake ready for review");
  ok(clean.lineCount === 1 && clean.missingCoaCount === 0 && clean.failedLabCount === 0, "clean counts");
  ok(clean.sourceFormat === "wcia", "source format passes through");

  // Missing vendor license (no linked vendor / no license on file) -> error.
  const noLic = summarizeStagedIntake(manifest({ vendor_license: null }), [lot()], new Map([["lab-1", lab()]]));
  ok(!noLic.readyForReview, "missing vendor license blocks");
  ok(noLic.flags.some((f) => f.severity === "error" && f.line === null), "license error is manifest-level");

  // Failed lab on a staged lot -> error; missing COA counted.
  const failedLab = summarizeStagedIntake(
    manifest(),
    [lot(), lot({ lot_code: "LOT-2", lab_result_id: "lab-2", product_name: "Bad Batch" })],
    new Map([
      ["lab-1", lab()],
      ["lab-2", lab({ id: "lab-2", passed: false })],
    ]),
  );
  ok(!failedLab.readyForReview, "failed lab blocks acceptance");
  ok(failedLab.failedLabCount === 1, "failed lab counted once");

  // Lot without a lab row -> missing COA warning (not error).
  const noCoa = summarizeStagedIntake(manifest(), [lot({ lab_result_id: null })], new Map());
  ok(noCoa.missingCoaCount === 1, "no lab row counts as missing COA");
  ok(noCoa.readyForReview, "missing COA alone is a warning, not a blocker");

  // Sample + zero qty + no cost -> warnings/info carried through.
  const sample = summarizeStagedIntake(
    manifest(),
    [lot({ is_sample: true, received_qty: 0, unit_cost_minor_units: null })],
    new Map([["lab-1", lab()]]),
  );
  ok(sample.sampleCount === 1, "sample counted");
  ok(sample.flags.some((f) => f.severity === "warning" && /SAMPLE/i.test(f.message)), "sample warning present");
  ok(sample.flags.some((f) => /quantity is zero/i.test(f.message)), "zero qty warning present");

  // Unknown source format coerces to generic; NaN qty treated as 0.
  ok(coerceSourceFormat("something-weird") === "generic", "unknown format -> generic");
  ok(coerceSourceFormat("ccrs-csv") === "ccrs-csv", "known format kept");
  const nanQty = summarizeStagedIntake(
    manifest(),
    [lot({ received_qty: Number.NaN })],
    new Map([["lab-1", lab()]]),
  );
  ok(nanQty.flags.some((f) => /quantity is zero/i.test(f.message)), "NaN qty flagged as zero/missing");

  // Lab with potency but no coa_url still counts as having a COA (lineHasCoa).
  const potencyOnly = summarizeStagedIntake(
    manifest(),
    [lot()],
    new Map([["lab-1", lab({ coa_url: null, labtest_external_identifier: null })]]),
  );
  ok(potencyOnly.missingCoaCount === 0, "potency-only lab counts as COA present");

  console.log(`intake-review-adapter: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
