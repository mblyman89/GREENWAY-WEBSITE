/**
 * intake-review-core.ts — PURE logic that turns a parsed vendor manifest into an
 * employee-facing REVIEW summary (Slice 97).
 *
 * No I/O, no `server-only`, no Supabase — unit-testable under tsx.
 *
 * DRAFTS-ONLY (standing rule): a crawled/parsed manifest is NEVER auto-committed.
 * This module produces a checklist a human validates before accepting the intake.
 * It flags the things a WA I-502 receiver must eyeball:
 *   - vendor license present (CCRS Inventory/Transfer reporting depends on it),
 *   - each line has a lot code (traceability) + a COA (WAC 314-55-102 testing),
 *   - $0 / sample lines (should not be sold; confirm before accepting),
 *   - failed lab results (must NOT be accepted for retail),
 *   - missing quantities / costs.
 *
 * It computes NOTHING destructive and rewrites NO source values — it only reports.
 */

import type { ParsedManifest, ParsedLine } from "@/lib/inventory/intake-parser";

export type IntakeReviewSeverity = "error" | "warning" | "info";

export type IntakeReviewFlag = {
  severity: IntakeReviewSeverity;
  /** null = manifest-level; otherwise the 1-based line number. */
  line: number | null;
  /** Short product label for context (line-level flags). */
  label: string | null;
  message: string;
};

export type IntakeReviewSummary = {
  vendorLabel: string | null;
  vendorLicense: string | null;
  manifestNumber: string | null;
  sourceFormat: ParsedManifest["source_format"];
  lineCount: number;
  sampleCount: number;
  missingCoaCount: number;
  failedLabCount: number;
  /** true iff there are NO error-severity flags — safe for the employee to
   * proceed to acceptance (they still confirm warnings). */
  readyForReview: boolean;
  flags: IntakeReviewFlag[];
};

function lineLabel(line: ParsedLine, index: number): string {
  return line.product_name || line.lot_code || line.pos_product_key || `Line ${index + 1}`;
}

/** Does this line carry a usable COA (a URL or a lab record with any potency)? */
export function lineHasCoa(line: ParsedLine): boolean {
  const lab = line.lab;
  if (!lab) return false;
  if (lab.coa_url && lab.coa_url.trim()) return true;
  // A lab block with a test id or any potency figure counts as "has results".
  if (lab.labtest_external_identifier && lab.labtest_external_identifier.trim()) return true;
  const anyPotency =
    lab.total_thc_pct != null ||
    lab.thc_pct != null ||
    lab.total_cbd_pct != null ||
    lab.cbd_pct != null ||
    (lab.potency_json != null && Object.keys(lab.potency_json).length > 0);
  return anyPotency;
}

/**
 * Build the drafts-only review summary from a parsed manifest. PURE. Never throws.
 */
export function summarizeIntakeForReview(manifest: ParsedManifest): IntakeReviewSummary {
  const flags: IntakeReviewFlag[] = [];
  const addManifest = (severity: IntakeReviewSeverity, message: string) =>
    flags.push({ severity, line: null, label: null, message });

  // Carry manifest-level parser warnings through as warnings.
  for (const w of manifest.warnings ?? []) {
    addManifest("warning", w);
  }

  // Vendor license is required to report received inventory to CCRS.
  if (!manifest.vendor_license || !manifest.vendor_license.trim()) {
    addManifest(
      "error",
      "Vendor license number is missing — required to report received inventory to CCRS. Confirm the sending licensee before accepting.",
    );
  }
  if (!manifest.vendor_label || !manifest.vendor_label.trim()) {
    addManifest("warning", "Vendor name is missing on the manifest.");
  }
  if (!manifest.manifest_number || !manifest.manifest_number.trim()) {
    addManifest("warning", "Manifest number is missing.");
  }

  const lines = manifest.lines ?? [];
  if (lines.length === 0) {
    addManifest("error", "No line items were found on this manifest.");
  }

  let sampleCount = 0;
  let missingCoaCount = 0;
  let failedLabCount = 0;

  lines.forEach((line, i) => {
    const label = lineLabel(line, i);
    const lineNo = i + 1;
    const add = (severity: IntakeReviewSeverity, message: string) =>
      flags.push({ severity, line: lineNo, label, message });

    // Carry per-line parser warnings.
    for (const w of line.warnings ?? []) add("warning", w);

    if (line.is_sample) {
      sampleCount += 1;
      add(
        "warning",
        "Marked as a vendor SAMPLE — samples must not be sold to customers; confirm disposition before accepting.",
      );
    }

    if (!line.lot_code || !line.lot_code.trim()) {
      add("warning", "No lot code — traceability and CCRS Inventory reporting need a lot identifier.");
    }

    if (!lineHasCoa(line)) {
      missingCoaCount += 1;
      add("warning", "No COA / lab results attached — WA testing rules (WAC 314-55-102) require a COA before retail sale.");
    }

    if (line.lab && line.lab.passed === false) {
      failedLabCount += 1;
      add("error", "Lab result is marked FAILED — do NOT accept for retail sale.");
    }

    if (!(line.received_qty > 0)) {
      add("warning", "Received quantity is zero or missing — confirm the count.");
    }

    if (line.unit_cost_minor_units == null && !line.is_sample) {
      add("info", "No unit cost on this line — confirm pricing.");
    }
  });

  const readyForReview = !flags.some((f) => f.severity === "error");

  return {
    vendorLabel: manifest.vendor_label,
    vendorLicense: manifest.vendor_license,
    manifestNumber: manifest.manifest_number,
    sourceFormat: manifest.source_format,
    lineCount: lines.length,
    sampleCount,
    missingCoaCount,
    failedLabCount,
    readyForReview,
    flags,
  };
}

// ---------------------------------------------------------------------------
// Self-tests (run via tsx). Pure — no I/O.
// ---------------------------------------------------------------------------
export function __runIntakeReviewTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, msg: string) => {
    if (cond) {
      passed += 1;
    } else {
      failed += 1;
      console.error("FAIL:", msg);
    }
  };

  const baseLine = (over: Partial<ParsedLine> = {}): ParsedLine => ({
    product_name: "Blue Dream 3.5g",
    lot_code: "LOT-1",
    pos_product_key: "PK-1",
    brand_name: "Acme",
    category: "Usable Marijuana",
    strain_name: "Blue Dream",
    received_qty: 10,
    unit: "each",
    unit_cost_minor_units: 500,
    unit_weight: 3.5,
    unit_weight_uom: "g",
    is_sample: false,
    is_medical: false,
    inventory_type: "Usable Cannabis",
    expires_on: null,
    lab: {
      labtest_external_identifier: "LAB-1",
      lab_name: "Testing Co",
      tested_on: "2025-06-01",
      thc_pct: 20,
      cbd_pct: 1,
      thca_pct: null,
      cbda_pct: null,
      total_thc_pct: 22,
      total_cbd_pct: 1,
      total_cannabinoids_pct: 24,
      potency_json: { thc: 20 },
      terpenes_json: null,
      analytes_json: null,
      passed: true,
      coa_url: "https://files.example.com/coa.pdf",
      coa_release_date: "2025-06-02",
      coa_expire_date: null,
      raw: {},
    },
    warnings: [],
    raw: {},
    ...over,
  });

  const baseManifest = (over: Partial<ParsedManifest> = {}): ParsedManifest => ({
    manifest_number: "M-100",
    vendor_label: "Acme Farms",
    vendor_license: "412345",
    transfer_date: "2025-06-05",
    source_format: "wcia",
    lines: [baseLine()],
    warnings: [],
    ...over,
  });

  // A clean manifest is ready for review with no errors.
  const clean = summarizeIntakeForReview(baseManifest());
  assert(clean.readyForReview === true, "clean manifest ready");
  assert(clean.lineCount === 1, "line count");
  assert(clean.flags.every((f) => f.severity !== "error"), "no errors on clean");
  assert(lineHasCoa(baseLine()) === true, "coa detected");

  // Missing vendor license → error, not ready.
  const noLicense = summarizeIntakeForReview(baseManifest({ vendor_license: null }));
  assert(noLicense.readyForReview === false, "no license blocks");
  assert(noLicense.flags.some((f) => f.severity === "error" && /license/i.test(f.message)), "license error present");

  // Sample line → sampleCount + warning.
  const sample = summarizeIntakeForReview(baseManifest({ lines: [baseLine({ is_sample: true })] }));
  assert(sample.sampleCount === 1, "sample counted");
  assert(sample.flags.some((f) => /SAMPLE/.test(f.message)), "sample flagged");

  // Missing COA → missingCoaCount + warning (no lab block).
  const noCoa = summarizeIntakeForReview(baseManifest({ lines: [baseLine({ lab: null })] }));
  assert(noCoa.missingCoaCount === 1, "missing coa counted");
  assert(noCoa.flags.some((f) => /COA/.test(f.message)), "missing coa flagged");

  // Failed lab → error + failedLabCount, not ready.
  const failedLab = summarizeIntakeForReview(
    baseManifest({ lines: [baseLine({ lab: { ...baseLine().lab!, passed: false } })] }),
  );
  assert(failedLab.failedLabCount === 1, "failed lab counted");
  assert(failedLab.readyForReview === false, "failed lab blocks");

  // No lines → error.
  const empty = summarizeIntakeForReview(baseManifest({ lines: [] }));
  assert(empty.readyForReview === false, "empty manifest blocks");
  assert(empty.lineCount === 0, "empty line count");

  // Zero quantity → warning.
  const zeroQty = summarizeIntakeForReview(baseManifest({ lines: [baseLine({ received_qty: 0 })] }));
  assert(zeroQty.flags.some((f) => /quantity/i.test(f.message)), "zero qty flagged");

  if (failed === 0) console.log(`intake-review-core: all ${passed} tests passed`);
  return { passed, failed };
}
