/**
 * D250 S2 - the examiner's delta delivery (2026-11-13 + 2026-11-17) merged
 * into the CCRS ledger. Pure core only; fixtures are synthetic (the delivered
 * files hold our sales and are never committed - the repo is public).
 *
 * Spec pins:
 *   [G L0576] "Valid Values: Product.Name"
 *   [G L0582-L0583] product name "in the same format and spelling as previously submitted"
 *   [G L1302-L1304] "Invalid InventoryExternalIdentifier" - a sale CCRS accepted names a lot it holds
 *   [EXAM2 L0065-L0066] CCRS does not change quantity; our Update does (U-68)
 * Evidence: docs/ccrs-bible/evidence/2026-11-17-examiner-delivery/README.md
 */
import { describe, expect, it } from "vitest";
import {
  DELIVERY_CSV_LAYOUTS,
  DELIVERY_SHEETS,
  DeliveryError,
  __runCcrsDeliveryCoreTests,
  deliveryExpect,
  detectDeliveryCsv,
  ledgerAsCopy,
  lotPayload,
  planDeliveryMerge,
  readDeliveredInventory,
  readDeliveredSales,
  readDeliveredSheet,
  xlsxCellText,
  type DeliverySet,
} from "@/lib/compliance/ccrs-delivery-core";
import { LINK_SOURCE, type LedgerRow } from "@/lib/compliance/ccrs-reseed-core";
import type { LedgerFileType } from "@/lib/compliance/ccrs-ledger-core";

const H17 = DELIVERY_CSV_LAYOUTS["inventory-2026-11-17"].join(",");
const H13 = DELIVERY_CSV_LAYOUTS["inventory-2026-11-13"].join(",");
const S17 = DELIVERY_CSV_LAYOUTS["sales-2026-11-17"].join(",");
const S13 = DELIVERY_CSV_LAYOUTS["sales-2026-11-13"].join(",");
const head = (s: keyof typeof DELIVERY_SHEETS) => [...DELIVERY_SHEETS[s]] as string[];

const inv = (rows: string[], h = H17) => `\uFEFF${h}\r\n${rows.join("\r\n")}\r\n`;
const lotLine = (id: string, name: string, qoh = "4", sys = "9/19/2026", strain = "Blue Dream", med = "0") =>
  `413541,${strain},Usable Cannabis,${name},${med},${id},10,${qoh},0.01,User-110211,9/18/2026,NULL,NULL,${sys}`;
const saleLine = (lot: string, date: string, qty = "1") => `413541,GREENWAY MARIJUANA,Usable Cannabis,${lot},0,RecreationalRetail,${date},${qty},10,0,1,3.7,${date}`;
const prod = (id: string, name: string, weight = "1", desc = "NULL") => ["413541", "G", name, desc, id, "EndProduct", "Usable Cannabis", "Each", weight, "U", "1/1/2025", "NULL", "NULL", ""];

const row = (t: LedgerFileType, id: string, over: Partial<LedgerRow> = {}): LedgerRow => ({
  t, id, name: t === "Inventory" ? null : id, prod: null, state: "seed", source: "seed:2026-09-18-delivery",
  lastFile: null, lastOp: null, uploadedAt: null, updatedAt: "1789900000123456", payload: { k: id }, ...over,
});

function baseSet(lots: string[], sales: string[] = [], products: string[][] = [prod("P1", "Solo")]): DeliverySet {
  return {
    lots: readDeliveredInventory(inv(lots), "inv17.csv"),
    sales: sales.length ? readDeliveredSales(`${S17}\r\n${sales.join("\r\n")}\r\n`, "s17.csv") : [],
    products: readDeliveredSheet("Product", [head("Product"), ...products]),
    strains: readDeliveredSheet("strains", [head("strains"), ["413541", "G", "Blue Dream", "U", "10/1/2026", "NULL", "NULL"]]),
    areas: readDeliveredSheet("areas", [head("areas"), ["413541", "G", "A1", "Sales Floor", "U", "8/22/2024", "NULL", "NULL"]]),
  };
}
const SEEDED = [row("Area", "A1", { name: "Sales Floor" })];

describe("the pure core", () => {
  it("self-tests pass", () => {
    const r = __runCcrsDeliveryCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(24);
  });
});

describe("layouts are matched exactly", () => {
  it("knows all four delivered CSV headers, LCB spelling included", () => {
    expect(detectDeliveryCsv(H17)).toBe("inventory-2026-11-17");
    expect(detectDeliveryCsv(H13)).toBe("inventory-2026-11-13");
    expect(detectDeliveryCsv(S17)).toBe("sales-2026-11-17");
    expect(detectDeliveryCsv(S13)).toBe("sales-2026-11-13");
    expect(H17.startsWith("LicenesNumber,")).toBe(true);
    expect(S13).toContain("Unit Price ,");
  });
  it("a corrected spelling or trimmed header is NOT accepted (a changed layout stops the load)", () => {
    expect(detectDeliveryCsv(H17.replace("LicenesNumber", "LicenseNumber"))).toBeNull();
    expect(detectDeliveryCsv(S13.replace("Unit Price ", "Unit Price"))).toBeNull();
    expect(() => readDeliveredInventory(`${H17.replace("Licenes", "License")}\r\n`, "x")).toThrow(DeliveryError);
  });
  it("sheet headers are exact", () => {
    expect(() => readDeliveredSheet("strains", [["LicenseNumber", "DBA", "name"]])).toThrow(DeliveryError);
    expect(() => readDeliveredSheet("Product", [])).toThrow(DeliveryError);
  });
});

describe("values", () => {
  it("isMedical 1/0 is TRUE/FALSE; NULL is empty; ids byte-exact", () => {
    const [a, b] = readDeliveredInventory(inv([lotLine("00012", "Solo", "4", "9/19/2026", "Blue Dream", "1"), lotLine("LOT2", "Solo")]), "f");
    expect(a.isMedical).toBe("TRUE");
    expect(b.isMedical).toBe("FALSE");
    expect(a.id).toBe("00012");
    expect(a.updatedBy).toBe("");
    expect(lotPayload(a, "P1")["Product Identifier"]).toBe("P1");
  });
  it("refuses a bad bit, a negative or non-numeric quantity, a bad date, a short row", () => {
    expect(() => readDeliveredInventory(inv([lotLine("L", "S", "4", "9/19/2026", "B", "Y")]), "f")).toThrow(DeliveryError);
    expect(() => readDeliveredInventory(inv([lotLine("L", "S", "-1")]), "f")).toThrow(DeliveryError);
    expect(() => readDeliveredInventory(inv([lotLine("L", "S", "4", "2026-09-19")]), "f")).toThrow(DeliveryError);
    expect(() => readDeliveredInventory(inv(["413541,x"]), "f")).toThrow(DeliveryError);
  });
  it("xlsx cells read as the CSV writes them", () => {
    expect(xlsxCellText(65264)).toBe("65264");
    expect(xlsxCellText(14.5)).toBe("14.5");
    expect(xlsxCellText(new Date(Date.UTC(2026, 9, 1)))).toBe("10/1/2026");
    expect(xlsxCellText({ richText: [{ text: "a" }, { text: "b" }] })).toBe("ab");
    expect(() => xlsxCellText(Infinity)).toThrow(DeliveryError);
  });
});

describe("the merge plan", () => {
  it("needs the 9/18 seed and a date after it, and our license only", () => {
    const s = baseSet([lotLine("L1", "Solo")]);
    expect(() => planDeliveryMerge(s, [], "2026-11-17")).toThrow(DeliveryError);
    expect(() => planDeliveryMerge(s, SEEDED, "2026-09-18")).toThrow(DeliveryError);
    expect(() => planDeliveryMerge({ ...s, lots: [{ ...s.lots[0], license: "1" }] }, SEEDED, "2026-11-17")).toThrow(DeliveryError);
  });

  it("adds a new lot under the delivery source with the product found by exact Name [G L0576]", () => {
    const p = planDeliveryMerge(baseSet([lotLine("L1", "Solo")]), SEEDED, "2026-11-17");
    const w = p.writes.find((x) => x.id === "L1")!;
    expect(w.op).toBe("add");
    expect(w.prod).toBe("P1");
    expect(w.source).toBe("seed:2026-11-17-delivery");
    expect(w.state).toBe("seed");
    expect(w.payload["Quantity on Hand"]).toBe("4");
  });

  it("a delivered zero lot is added closed", () => {
    const p = planDeliveryMerge(baseSet([lotLine("L0", "Solo", "0")]), SEEDED, "2026-11-17");
    expect(p.writes.find((x) => x.id === "L0")!.state).toBe("closed");
  });

  it("twins: the lowest id by code unit; differing twins reported (U-82)", () => {
    const same = planDeliveryMerge(baseSet([lotLine("L1", "Twin")], [], [prod("C1100011", "Twin"), prod("C1-110211000", "Twin")]), SEEDED, "2026-11-17");
    expect(same.writes.find((x) => x.id === "L1")!.prod).toBe("C1-110211000");
    expect(same.review.twinDiffers).toHaveLength(0);
    const diff = planDeliveryMerge(baseSet([lotLine("L1", "Twin")], [], [prod("C1100011", "Twin", "15"), prod("P9", "Twin", "14.5")]), SEEDED, "2026-11-17");
    expect(diff.review.twinDiffers.map((r) => r.id)).toEqual(["L1"]);
  });

  it("a lot with no product of that exact Name and type is added without a product and reported", () => {
    const p = planDeliveryMerge(baseSet([lotLine("L1", "solo")]), SEEDED, "2026-11-17");
    expect(p.writes.find((x) => x.id === "L1")!.prod).toBeNull();
    expect(p.review.productUnresolved.map((r) => r.id)).toEqual(["L1"]);
  });

  it("a lot one of OUR files touched is never written", () => {
    const ledger = [...SEEDED, row("Inventory", "L1", { state: "filed", lastFile: "f1", source: "file:x", prod: "P1" })];
    const p = planDeliveryMerge(baseSet([lotLine("L1", "Solo")]), ledger, "2026-11-17");
    expect(p.writes.find((x) => x.id === "L1")).toBeUndefined();
    expect(p.counts.unchanged).toBeGreaterThan(0);
    const other = planDeliveryMerge(baseSet([lotLine("L1", "Solo")]), [...SEEDED, row("Inventory", "L1", { state: "filed", lastFile: "f1", source: "file:x", prod: "PX" })], "2026-11-17");
    expect(other.review.oursDiffers.map((r) => r.id)).toEqual(["L1"]);
  });

  it("uncertain / deleted / unknown rows are reported, never written", () => {
    const ledger = [...SEEDED, row("Inventory", "U1", { state: "uncertain", lastFile: "f" }), row("Inventory", "D1", { state: "deleted", lastFile: "f" }), row("Inventory", "K1", { state: "unknown", source: "manual" })];
    const p = planDeliveryMerge(baseSet([lotLine("U1", "Solo"), lotLine("D1", "Solo"), lotLine("K1", "Solo")]), ledger, "2026-11-17");
    expect(p.writes.filter((x) => x.t === "Inventory")).toHaveLength(0);
    expect(p.review.uncertainProved.map((r) => r.id)).toEqual(["U1"]);
    expect(p.review.deletedPresent.map((r) => r.id)).toEqual(["D1"]);
    expect(p.review.unknownHeld.map((r) => r.id)).toEqual(["K1"]);
  });

  it("a migration-lot link row is settled, carrying the guard of the row it saw", () => {
    const ledger = [...SEEDED, row("Inventory", "M1", { state: "unknown", source: LINK_SOURCE, payload: null, updatedAt: "42" })];
    const p = planDeliveryMerge(baseSet([lotLine("M1", "Solo")]), ledger, "2026-11-17");
    const w = p.writes.find((x) => x.id === "M1")!;
    expect(w.op).toBe("settleLink");
    expect(w.expectState).toBe("unknown");
    expect(w.expectUpdatedAt).toBe("42");
  });

  it("a lot named only by an accepted sale is added present with no product [G L1302-L1304]", () => {
    const p = planDeliveryMerge(baseSet([], [saleLine("OLD1", "10/1/2026"), saleLine("OLD1", "10/3/2026")]), SEEDED, "2026-11-17");
    const w = p.writes.find((x) => x.id === "OLD1")!;
    expect(w.op).toBe("add");
    expect(w.prod).toBeNull();
    expect(w.source).toBe("proof:2026-11-17-delivery-sale");
    expect(w.payload["Sale Rows"]).toBe("2");
    expect(w.payload["Quantity on Hand"]).toBeUndefined();
    expect(p.counts.proofAdd).toBe(1);
  });

  it("a sale naming a lot already seeded changes nothing", () => {
    const p = planDeliveryMerge(baseSet([], [saleLine("S1", "10/1/2026")]), [...SEEDED, row("Inventory", "S1")], "2026-11-17");
    expect(p.writes.find((x) => x.id === "S1")).toBeUndefined();
    expect(p.counts.alreadyOnFileBySale).toBe(1);
  });

  it("a sale-proven lot later delivered in full is refreshed; a seeded lot is refreshed by the newer delivery", () => {
    const ledger = [...SEEDED, row("Inventory", "L1", { source: "proof:2026-11-17-delivery-sale", prod: null }), row("Inventory", "L2")];
    const p = planDeliveryMerge(baseSet([lotLine("L1", "Solo"), lotLine("L2", "Solo")]), ledger, "2026-11-20");
    expect(p.writes.find((x) => x.id === "L1")!.op).toBe("refresh");
    expect(p.writes.find((x) => x.id === "L2")!.op).toBe("refresh");
    expect(p.writes.find((x) => x.id === "L2")!.expectUpdatedAt).toBe("1789900000123456");
  });

  it("U-68: only sales dated after the lot's System Date count; overlapping files count a sale once", () => {
    const s = baseSet([lotLine("L1", "Solo", "2", "10/1/2026")], [saleLine("L1", "10/1/2026", "5"), saleLine("L1", "10/2/2026", "2")]);
    const dup = { ...s, sales: [...s.sales, ...readDeliveredSales(`${S13}\r\n${saleLine("L1", "10/2/2026", "2")}\r\n`, "s13.csv")] };
    const p = planDeliveryMerge(dup, SEEDED, "2026-11-17");
    expect(p.counts.staleQoh).toBe(1);
    expect(p.counts.soldOutStillOpen).toBe(1);
    const q = planDeliveryMerge({ ...s, lots: readDeliveredInventory(inv([lotLine("L1", "Solo", "3", "10/1/2026")]), "f") }, SEEDED, "2026-11-17");
    expect(q.counts.soldOutStillOpen).toBe(0);
    // QoH 3, one later sale of 2 delivered in BOTH files: once = 2 (open), twice would be 4 (sold out)
    const o = planDeliveryMerge({ ...dup, lots: readDeliveredInventory(inv([lotLine("L1", "Solo", "3", "10/1/2026")]), "f") }, SEEDED, "2026-11-17");
    expect(o.counts.staleQoh).toBe(1);
    expect(o.counts.soldOutStillOpen).toBe(0);
  });

  it("a lot in both inventory files: the later System Date wins; identical rows are not a conflict", () => {
    const a = readDeliveredInventory(inv([lotLine("L1", "Solo", "4", "10/1/2026")]), "inv17.csv");
    const b = readDeliveredInventory(inv([lotLine("L1", "Solo", "3", "10/29/2026")]), "inv13.csv");
    const s = { ...baseSet([]), lots: [...a, ...b] };
    const p = planDeliveryMerge(s, SEEDED, "2026-11-17");
    expect(p.writes.find((x) => x.id === "L1")!.payload["Quantity on Hand"]).toBe("3");
    expect(p.review.lotTwice).toHaveLength(1);
    const same = planDeliveryMerge({ ...s, lots: [...a, ...readDeliveredInventory(inv([lotLine("L1", "Solo", "4", "10/1/2026")]), "inv13.csv")] }, SEEDED, "2026-11-17");
    expect(same.review.lotTwice).toHaveLength(0);
  });

  it("a strain not on record (any casing) is reported", () => {
    const p = planDeliveryMerge(baseSet([lotLine("L1", "Solo", "4", "9/19/2026", "BLUE DREAM"), lotLine("L2", "Solo", "4", "9/19/2026", "Nowhere")]), SEEDED, "2026-11-17");
    expect(p.review.strainNotOnRecord.map((r) => r.id)).toEqual(["L2"]);
  });

  it("products: new added, renamed untouched seed refreshed, same name unchanged", () => {
    const ledger = [...SEEDED, row("Product", "P1", { name: "Old" }), row("Product", "P2", { name: "Keep" })];
    const p = planDeliveryMerge(baseSet([], [], [prod("P1", "Solo"), prod("P2", "Keep"), prod("P3", "New")]), ledger, "2026-11-17");
    expect(p.writes.find((x) => x.id === "P1")!.op).toBe("refresh");
    expect(p.writes.find((x) => x.id === "P2")).toBeUndefined();
    expect(p.writes.find((x) => x.id === "P3")!.op).toBe("add");
  });

  it("is idempotent: the ledger after the apply plans nothing", () => {
    const s = baseSet([lotLine("L1", "Solo"), lotLine("L2", "Solo", "0")], [saleLine("OLD1", "10/1/2026")]);
    const p = planDeliveryMerge(s, SEEDED, "2026-11-17");
    expect(deliveryExpect(p).add).toBe(p.writes.length);
    const after = [...SEEDED, ...p.writes.map((w) => row(w.t, w.id, { name: w.name, prod: w.prod, state: w.state, source: w.source, payload: w.payload }))];
    expect(planDeliveryMerge(s, after, "2026-11-17").writes).toHaveLength(0);
    const copy = ledgerAsCopy(after);
    expect(copy.map((e) => e.externalId)).toContain("L1");
    expect(copy.map((e) => e.externalId)).not.toContain("OLD1");
  });
});
