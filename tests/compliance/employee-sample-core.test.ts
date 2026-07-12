/**
 * tests/compliance/employee-sample-core.test.ts  (Task K)
 *
 * Wires the embedded self-test suite of the pure employee-sample core into
 * vitest, plus targeted assertions pinning the Task K compliance contract:
 *   • available-sample table rows come from accepted sample lots (classified
 *     by product type, sized from the lot, zero-on-hand and non-cannabis
 *     lots excluded) — WAC 314-55-096(1)(e)/(j)
 *   • the assignment draft validates on-hand, dates, and per-unit size caps
 *   • the CCRS adjustment note names the employee (LCB-confirmed shape) and
 *     the internal `employee_sample` reason maps to CCRS "Other"
 */
import { describe, it, expect } from "vitest";
import {
  __runEmployeeSampleCoreTests,
  buildAvailableSampleRows,
  parseAssignmentDraft,
  buildEmployeeSampleAdjustmentNote,
  employeeAllowance,
  type RawSampleLot,
} from "@/lib/compliance/employee-sample-core";
import { mapAdjustmentReason, isReportableAdjustment } from "@/lib/compliance/ccrs-inventory-adjustment-core";
import { SAMPLE_DEFAULTS, type SampleSettings } from "@/lib/compliance/trade-samples-core";

const SETTINGS: SampleSettings = {
  enforce: true,
  hardBlock: true,
  ...SAMPLE_DEFAULTS,
};

function lot(over: Partial<RawSampleLot> = {}): RawSampleLot {
  return {
    id: "lot-a",
    product_name: "GG4 Sample 3.5g",
    strain_name: "GG4",
    lot_code: "WAL-0001",
    inventory_type: "Usable Cannabis",
    on_hand_qty: 3,
    unit: "ea",
    unit_weight: 3.5,
    unit_weight_uom: "g",
    created_at: "2026-02-01T00:00:00Z",
    vendor_label: "Example Farms",
    ...over,
  };
}

describe("employee-sample-core (Task K)", () => {
  it("passes the embedded self-test suite", () => {
    expect(() => __runEmployeeSampleCoreTests()).not.toThrow();
  });

  it("builds table rows only from lawful, in-stock sample lots", () => {
    const { rows, skipped } = buildAvailableSampleRows([
      lot(),
      lot({ id: "lot-b", product_name: "Grinder", inventory_type: "Paraphernalia" }),
      lot({ id: "lot-c", on_hand_qty: 0 }),
    ]);
    expect(rows.map((r) => r.lotId)).toEqual(["lot-a"]);
    expect(skipped).toHaveLength(2);
  });

  it("blocks an assignment that exceeds the lot's on-hand quantity", () => {
    const { rows } = buildAvailableSampleRows([lot()]);
    const res = parseAssignmentDraft(
      { lotId: "lot-a", employeeId: "emp-1", unitCount: "4", ymd: "2026-02-10" },
      rows[0]!,
      SETTINGS,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(" ")).toMatch(/on hand/);
  });

  it("carries the product identity (name + lot) into the parsed assignment", () => {
    const { rows } = buildAvailableSampleRows([lot()]);
    const res = parseAssignmentDraft(
      { lotId: "lot-a", employeeId: "emp-1", unitCount: "2", ymd: "2026-02-10" },
      rows[0]!,
      SETTINGS,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.sourceProductName).toBe("GG4 Sample 3.5g");
      expect(res.value.sourceLotRef).toBe("WAL-0001");
      expect(res.value.quarterKey).toBe("2026-Q1");
      expect(res.value.lotId).toBe("lot-a");
    }
  });

  it("CCRS: employee_sample adjustments report as reason Other with an employee-named detail", () => {
    expect(mapAdjustmentReason("employee_sample")).toBe("Other");
    expect(isReportableAdjustment("employee_sample", -2)).toBe(true);
    const note = buildEmployeeSampleAdjustmentNote({
      employeeName: "Jane Budtender",
      productName: "GG4 Sample 3.5g",
      lotCode: "WAL-0001",
      unitCount: 2,
    });
    expect(note).toContain("Jane Budtender");
    expect(note).toContain("WAL-0001");
    // Must fit the CCRS AdjustmentDetail 250-char limit for typical names.
    expect(note.length).toBeLessThanOrEqual(250);
  });

  it("lab 'sample' reason mapping is unchanged (ReturnedLabSample)", () => {
    expect(mapAdjustmentReason("sample")).toBe("ReturnedLabSample");
  });

  it("allowance math floors at zero", () => {
    expect(employeeAllowance(30, 30).remaining).toBe(0);
    expect(employeeAllowance(31, 30).remaining).toBe(0);
    expect(employeeAllowance(0, 30).remaining).toBe(30);
  });
});
