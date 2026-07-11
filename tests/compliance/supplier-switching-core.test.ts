/**
 * tests/compliance/supplier-switching-core.test.ts
 *
 * S9 coverage for the pure month-over-month supplier-switching logic.
 * NEVER GUESS discipline under test:
 *  - competitors lacking supplier data in either month are excluded from the
 *    diff (reported in missing*Data), never treated as "everything changed";
 *  - "exited" only means "left the TOP list" — spends for the absent month
 *    stay null (unknown), never 0;
 *  - junk numbers coerce to safe values.
 */
import { describe, it, expect } from "vitest";

import {
  buildSupplierSwitchReport,
  MAX_SUPPLIER_MOMENTUM,
  type SwitchCompetitorStatLike,
  type SwitchSupplierLike,
} from "@/lib/discovery/supplier-switching-core";

function supplier(over: Partial<SwitchSupplierLike> = {}): SwitchSupplierLike {
  return {
    licenseeId: "500",
    licenseNumber: "600000",
    name: "SUPPLIER LLC",
    dba: null,
    lineCount: 10,
    spendMinor: 100_00,
    ...over,
  };
}

function stat(
  license: string,
  suppliers: SwitchSupplierLike[],
  over: Partial<SwitchCompetitorStatLike> = {},
): SwitchCompetitorStatLike {
  return {
    license_number: license,
    name: `STORE ${license} LLC`,
    dba: `STORE ${license}`,
    wholesale_line_count: suppliers.reduce((a, s) => a + s.lineCount, 0),
    wholesale_spend_minor: suppliers.reduce((a, s) => a + s.spendMinor, 0),
    top_suppliers: suppliers,
    ...over,
  };
}

const ROSTER = [
  { license_number: "415229", tradename: "Pot Zone" },
  { license_number: "414550", tradename: "Clear Choice" },
];

describe("buildSupplierSwitchReport", () => {
  it("detects entered, exited, and continued suppliers with spend deltas", () => {
    const prev = [
      stat("415229", [
        supplier({ licenseeId: "500", licenseNumber: "600000", name: "OLD FARM", spendMinor: 500_00 }),
        supplier({ licenseeId: "501", licenseNumber: "600001", name: "STEADY FARM", spendMinor: 300_00 }),
      ]),
    ];
    const curr = [
      stat("415229", [
        supplier({ licenseeId: "501", licenseNumber: "600001", name: "STEADY FARM", spendMinor: 450_00 }),
        supplier({ licenseeId: "502", licenseNumber: "600002", name: "NEW FARM", spendMinor: 200_00 }),
      ]),
    ];
    const r = buildSupplierSwitchReport(curr, prev, ROSTER);
    expect(r.competitors).toHaveLength(1);
    const c = r.competitors[0];
    expect(c.competitorName).toBe("Pot Zone");
    expect(c.entered.map((s) => s.displayName)).toEqual(["NEW FARM"]);
    expect(c.entered[0].prevSpendMinor).toBeNull(); // unknown, never 0
    expect(c.exited.map((s) => s.displayName)).toEqual(["OLD FARM"]);
    expect(c.exited[0].currSpendMinor).toBeNull();
    expect(c.continued).toHaveLength(1);
    expect(c.continued[0].deltaSpendMinor).toBe(150_00);
  });

  it("excludes competitors missing supplier data in either month (honest, not 'all changed')", () => {
    const prev = [stat("415229", [])]; // pre-0107 row: no suppliers persisted
    const curr = [stat("415229", [supplier()])];
    const r = buildSupplierSwitchReport(curr, prev, ROSTER);
    expect(r.competitors).toHaveLength(0);
    expect(r.momentum).toHaveLength(0); // momentum also restricted to comparable stores
    expect(r.missingPrevData).toEqual(["Pot Zone"]);
    expect(r.missingCurrData).toEqual([]);
  });

  it("competitor absent from the previous dataset entirely counts as missing prev data", () => {
    const r = buildSupplierSwitchReport([stat("415229", [supplier()])], [], ROSTER);
    expect(r.competitors).toHaveLength(0);
    expect(r.missingPrevData).toEqual(["Pot Zone"]);
  });

  it("steady supplier rosters produce no competitor report rows", () => {
    const month = [stat("415229", [supplier()])];
    const r = buildSupplierSwitchReport(month, month, ROSTER);
    expect(r.competitors).toHaveLength(0);
    expect(r.momentum).toHaveLength(0); // no buyer deltas either
  });

  it("builds supplier momentum across competitors, naming gained/lost buyers", () => {
    const shared = (spend: number) =>
      supplier({ licenseeId: "700", licenseNumber: "700000", dba: "BIG BRAND", spendMinor: spend });
    const prev = [
      stat("415229", [shared(100_00)]),
      stat("414550", [supplier({ licenseeId: "701", licenseNumber: "700001", name: "OTHER" })]),
    ];
    const curr = [
      stat("415229", [shared(100_00)]),
      stat("414550", [shared(250_00)]), // Clear Choice ADDS Big Brand
    ];
    const r = buildSupplierSwitchReport(curr, prev, ROSTER);
    const m = r.momentum.find((x) => x.displayName === "BIG BRAND");
    expect(m).toBeDefined();
    expect(m!.prevBuyerCount).toBe(1);
    expect(m!.currBuyerCount).toBe(2);
    expect(m!.buyerDelta).toBe(1);
    expect(m!.gainedBuyers).toEqual(["Clear Choice"]);
    expect(m!.lostBuyers).toEqual([]);
    const other = r.momentum.find((x) => x.displayName === "OTHER");
    expect(other).toBeDefined();
    expect(other!.buyerDelta).toBe(-1);
    expect(other!.lostBuyers).toEqual(["Clear Choice"]);
  });

  it("joins suppliers by license number even when surrogate LicenseeId changes across months", () => {
    // CCRS LicenseeIds are per-extract surrogates; the license number is stable.
    const prev = [stat("415229", [supplier({ licenseeId: "111", licenseNumber: "600000", spendMinor: 100_00 })])];
    const curr = [stat("415229", [supplier({ licenseeId: "999", licenseNumber: "600000", spendMinor: 140_00 })])];
    const r = buildSupplierSwitchReport(curr, prev, ROSTER);
    expect(r.competitors).toHaveLength(0); // continued only — no entered/exited noise
    const momentum = r.momentum;
    expect(momentum).toHaveLength(0); // same single buyer both months
  });

  it("falls back to licenseeId key when the license number is missing", () => {
    const prev = [stat("415229", [supplier({ licenseNumber: null, licenseeId: "42", spendMinor: 50_00 })])];
    const curr = [stat("415229", [supplier({ licenseNumber: null, licenseeId: "42", spendMinor: 80_00 })])];
    const r = buildSupplierSwitchReport(curr, prev, ROSTER);
    expect(r.competitors).toHaveLength(0); // continued — recognized as same supplier
  });

  it("drops supplier rows with neither license number nor licenseeId", () => {
    const junk = supplier({ licenseNumber: null, licenseeId: "" });
    const good = supplier({ licenseeId: "77", licenseNumber: "700077", name: "GOOD" });
    const prev = [stat("415229", [good])];
    const curr = [stat("415229", [good, junk])];
    const r = buildSupplierSwitchReport(curr, prev, ROSTER);
    // junk row never appears as "entered"
    expect(r.competitors).toHaveLength(0);
  });

  it("coerces junk spend/line numbers to safe values", () => {
    const prev = [
      stat("415229", [
        supplier({ licenseeId: "1", licenseNumber: "600001", spendMinor: Number.NaN, lineCount: -5 }),
        supplier({ licenseeId: "2", licenseNumber: "600002", spendMinor: 100_00 }),
      ]),
    ];
    const curr = [
      stat("415229", [
        supplier({ licenseeId: "1", licenseNumber: "600001", spendMinor: 200_00, lineCount: 3 }),
      ]),
    ];
    const r = buildSupplierSwitchReport(curr, prev, ROSTER);
    const c = r.competitors[0];
    const cont = c.continued.find((s) => s.supplierKey === "600001");
    expect(cont).toBeDefined();
    expect(cont!.prevSpendMinor).toBe(0); // NaN coerced, not propagated
    expect(cont!.prevLineCount).toBe(0); // negative coerced
    expect(cont!.deltaSpendMinor).toBe(200_00);
  });

  it("caps momentum output and sorts by |buyer delta| then current spend", () => {
    const prev: SwitchCompetitorStatLike[] = [stat("415229", [supplier({ licenseeId: "1", licenseNumber: "L1" })])];
    const suppliers: SwitchSupplierLike[] = [];
    for (let i = 0; i < 30; i += 1) {
      suppliers.push(
        supplier({ licenseeId: String(100 + i), licenseNumber: `L${100 + i}`, spendMinor: (i + 1) * 100 }),
      );
    }
    const curr = [stat("415229", suppliers)];
    const r = buildSupplierSwitchReport(curr, prev, ROSTER, { maxMomentum: MAX_SUPPLIER_MOMENTUM });
    expect(r.momentum.length).toBeLessThanOrEqual(MAX_SUPPLIER_MOMENTUM);
    // all gained deltas are +1 except L1's −1; ties broken by current spend desc
    for (let i = 1; i < r.momentum.length; i += 1) {
      const a = r.momentum[i - 1];
      const b = r.momentum[i];
      expect(
        Math.abs(a.buyerDelta) > Math.abs(b.buyerDelta) ||
          (Math.abs(a.buyerDelta) === Math.abs(b.buyerDelta) && a.currSpendMinor >= b.currSpendMinor),
      ).toBe(true);
    }
  });

  it("uses roster tradenames, falling back to CCRS dba/name", () => {
    const offRoster = stat("999999", [supplier({ licenseeId: "5", licenseNumber: "L5" })], {
      dba: "MYSTERY STORE",
    });
    const prevOffRoster = stat("999999", [supplier({ licenseeId: "6", licenseNumber: "L6" })], {
      dba: "MYSTERY STORE",
    });
    const r = buildSupplierSwitchReport([offRoster], [prevOffRoster], ROSTER);
    expect(r.competitors[0]?.competitorName).toBe("MYSTERY STORE");
  });
});
