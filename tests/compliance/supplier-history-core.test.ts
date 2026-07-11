/**
 * tests/compliance/supplier-history-core.test.ts
 *
 * S13 (Task H, logged suggestion #5): new-vendor early detection — suppliers
 * appearing in the latest drop's statewide supplier rollup (migration 0109)
 * that are absent from EVERY prior uploaded month with supplier data.
 *
 * NEVER GUESS contract under test:
 *  - Prior months WITHOUT supplier rows (pre-0109 uploads) are excluded from
 *    the comparison — missing data is not evidence of absence — and reported
 *    for the UI's re-upload prompt.
 *  - With NO prior supplier data at all, nothing is detectable (detectable =
 *    false, empty result) instead of wrongly calling everything "new".
 *  - Join key = license number (stable), fallback `id:<licensee_id>` — the
 *    same S9 rule.
 */
import { describe, expect, it } from "vitest";

import {
  buildSupplierHistoryReport,
  MAX_NEW_SUPPLIER_ROWS,
  supplierHistoryKey,
  type SupplierHistoryStatLike,
} from "@/lib/discovery/supplier-history-core";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function stat(overrides: Partial<SupplierHistoryStatLike> = {}): SupplierHistoryStatLike {
  return {
    licensee_id: "901",
    license_number: "7901",
    name: "EVERGREEN GROWERS L.L.C.",
    dba: "Evergreen Growers",
    line_count: 40,
    revenue_minor: 1_500_000,
    distinct_buyers: 12,
    tracked_buyers: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// supplierHistoryKey
// ---------------------------------------------------------------------------

describe("supplierHistoryKey (S13)", () => {
  it("uses the license number when present (trimmed)", () => {
    expect(supplierHistoryKey(stat({ license_number: " 7901 " }))).toBe("7901");
  });

  it("falls back to id:<licensee_id> when the license number is missing/blank", () => {
    expect(supplierHistoryKey(stat({ license_number: null, licensee_id: "55" }))).toBe("id:55");
    expect(supplierHistoryKey(stat({ license_number: "   ", licensee_id: "55" }))).toBe("id:55");
  });

  it("matches a supplier across months even when the licensee id changes", () => {
    // License numbers are the stable WSLCB identity; internal ids can differ.
    const may = stat({ license_number: "7901", licensee_id: "901" });
    const june = stat({ license_number: "7901", licensee_id: "12345" });
    expect(supplierHistoryKey(may)).toBe(supplierHistoryKey(june));
  });
});

// ---------------------------------------------------------------------------
// buildSupplierHistoryReport
// ---------------------------------------------------------------------------

describe("buildSupplierHistoryReport (S13)", () => {
  it("flags a supplier absent from all prior months with data as new", () => {
    const report = buildSupplierHistoryReport(
      [stat({ license_number: "7901" }), stat({ license_number: "7902", licensee_id: "902", dba: "Old Hand" })],
      [{ label: "May 2026", suppliers: [stat({ license_number: "7902", licensee_id: "902" })] }],
    );
    expect(report.detectable).toBe(true);
    expect(report.newSupplierCount).toBe(1);
    expect(report.newSuppliers[0].licenseNumber).toBe("7901");
    expect(report.newSuppliers[0].displayName).toBe("Evergreen Growers");
    expect(report.latestSupplierCount).toBe(2);
  });

  it("a supplier present in ANY prior month with data is not new", () => {
    const report = buildSupplierHistoryReport(
      [stat({ license_number: "7901" })],
      [
        { label: "April 2026", suppliers: [stat({ license_number: "7901" })] },
        { label: "May 2026", suppliers: [stat({ license_number: "7999", licensee_id: "999" })] },
      ],
    );
    expect(report.newSupplierCount).toBe(0);
    expect(report.newSuppliers).toHaveLength(0);
  });

  it("with NO prior supplier data nothing is detectable — never calls everything new", () => {
    const report = buildSupplierHistoryReport(
      [stat()],
      [{ label: "May 2026 (pre-0109)", suppliers: [] }],
    );
    expect(report.detectable).toBe(false);
    expect(report.newSuppliers).toHaveLength(0);
    expect(report.newSupplierCount).toBe(0);
    expect(report.priorWithoutSupplierData).toEqual(["May 2026 (pre-0109)"]);
    expect(report.priorWithSupplierData).toEqual([]);
  });

  it("with zero prior datasets (first upload) nothing is detectable", () => {
    const report = buildSupplierHistoryReport([stat()], []);
    expect(report.detectable).toBe(false);
    expect(report.newSuppliers).toHaveLength(0);
  });

  it("excludes data-less prior months from the comparison but keeps data-ful ones", () => {
    // April has data (supplier 7901 present); May is pre-0109 (no rows).
    // 7901 must NOT be new (April proves it), 7950 IS new.
    const report = buildSupplierHistoryReport(
      [stat({ license_number: "7901" }), stat({ license_number: "7950", licensee_id: "950", dba: "Fresh Farm" })],
      [
        { label: "May 2026", suppliers: [] },
        { label: "April 2026", suppliers: [stat({ license_number: "7901" })] },
      ],
    );
    expect(report.detectable).toBe(true);
    expect(report.priorWithSupplierData).toEqual(["April 2026"]);
    expect(report.priorWithoutSupplierData).toEqual(["May 2026"]);
    expect(report.newSuppliers.map((s) => s.licenseNumber)).toEqual(["7950"]);
  });

  it("joins by license number even when licensee ids differ across months", () => {
    const report = buildSupplierHistoryReport(
      [stat({ license_number: "7901", licensee_id: "12345" })],
      [{ label: "May 2026", suppliers: [stat({ license_number: "7901", licensee_id: "901" })] }],
    );
    expect(report.newSupplierCount).toBe(0);
  });

  it("falls back to licensee id join for license-less suppliers", () => {
    const report = buildSupplierHistoryReport(
      [
        stat({ license_number: null, licensee_id: "55" }),
        stat({ license_number: null, licensee_id: "66", dba: "Truly New" }),
      ],
      [{ label: "May 2026", suppliers: [stat({ license_number: null, licensee_id: "55" })] }],
    );
    expect(report.newSuppliers.map((s) => s.licenseeId)).toEqual(["66"]);
  });

  it("sorts new suppliers by revenue desc and caps rows while counting all", () => {
    const latest = Array.from({ length: 5 }, (_, i) =>
      stat({ license_number: `80${i}`, licensee_id: `8${i}`, revenue_minor: (i + 1) * 1000 }),
    );
    const report = buildSupplierHistoryReport(
      latest,
      [{ label: "May 2026", suppliers: [stat({ license_number: "7000", licensee_id: "700" })] }],
      { max: 2 },
    );
    expect(report.newSupplierCount).toBe(5);
    expect(report.newSuppliers).toHaveLength(2);
    expect(report.newSuppliers.map((s) => s.revenueMinor)).toEqual([5000, 4000]);
  });

  it("defaults the cap to MAX_NEW_SUPPLIER_ROWS", () => {
    const latest = Array.from({ length: MAX_NEW_SUPPLIER_ROWS + 3 }, (_, i) =>
      stat({ license_number: `9${String(i).padStart(3, "0")}`, licensee_id: `9${i}` }),
    );
    const report = buildSupplierHistoryReport(latest, [
      { label: "May 2026", suppliers: [stat({ license_number: "7000", licensee_id: "700" })] },
    ]);
    expect(report.newSuppliers).toHaveLength(MAX_NEW_SUPPLIER_ROWS);
    expect(report.newSupplierCount).toBe(MAX_NEW_SUPPLIER_ROWS + 3);
  });

  it("uses dba → name → Licensee <id> display fallbacks and coerces junk numerics", () => {
    const report = buildSupplierHistoryReport(
      [
        stat({
          license_number: "7999",
          licensee_id: "999",
          dba: "  ",
          name: null,
          line_count: Number.NaN,
          revenue_minor: Number.POSITIVE_INFINITY,
          distinct_buyers: Number.NaN,
          tracked_buyers: Number.NaN,
        }),
      ],
      [{ label: "May 2026", suppliers: [stat({ license_number: "7000", licensee_id: "700" })] }],
    );
    const row = report.newSuppliers[0];
    expect(row.displayName).toBe("Licensee 999");
    expect(row.lineCount).toBe(0);
    expect(row.revenueMinor).toBe(0);
    expect(row.distinctBuyers).toBe(0);
    expect(row.trackedBuyers).toBe(0);
  });
});
