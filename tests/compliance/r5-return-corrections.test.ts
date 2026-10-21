/**
 * Round 5 / Slice R5-1: customer-return corrections reach CCRS through the
 * weekly batch, per environment, checked against what CCRS holds.
 *
 * Why this matters to the license. The LCB FAQ says a valid return means "the
 * sale identifier should be deleted from CCRS, and the inventory identifier
 * reported on an Inventory Adjustment as a return" [FAQ L0038-L0039]. Before
 * R5-1 the add-back went out in the batch but the Sale correction did not: it
 * was a separate download that was not env-aware, not recorded, and computed
 * a second partial return's remaining quantity from that return alone.
 *
 * Every rule below is grounded in a verbatim LCB line (GUIDE_LINES / FAQ_LINES,
 * re-checked against ../lcb/*.txt when present):
 *   - Update alters "an existing record indicated by external identifier",
 *     Delete deletes one [G L0247-L0248]; an Update of a record CCRS lacks is
 *     an error [FAQ L0052-L0053]; "SaleDetailExternalIdentifier not found"
 *     [G L1414]  -> a correction goes out only for a sale line CCRS holds.
 *   - Quantity "No negative values allowed" [G L1345] -> remaining >= 0, and
 *     a return of the whole line is a Delete, never a 0-quantity Update.
 *   - "Invalid InventoryExternalIdentifier ... ensure that you have already
 *     reported the inventory in an inventory.CSV" [G L1302-L1304] -> an event
 *     row may name a lot CCRS holds at QoH 0 when this emission's Inventory
 *     file reports it (the examiner's own method: "submit an inventory update
 *     for all those ids and get them to zero and then an inventory adjustment
 *     for those ids" [EXAM L0430]).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CCRS_COLUMNS, type CcrsRetailerFileType } from "../../src/lib/compliance/ccrs-batch-core";
import { buildLedgerView, type LedgerEntry } from "../../src/lib/compliance/ccrs-ledger-core";
import { planOutboxFiles, verifyOutboxAgainstLedger } from "../../src/lib/compliance/ccrs-outbox-core";
import { CCRS_ISSUE_CODES, specPinFor } from "../../src/lib/compliance/ccrs-preflight-core";
import {
  __runReturnCorrectionsTests,
  decodeSaleSlice,
  eventLotRefs,
  planReturnCorrections,
  saleLedgerEntries,
  SALE_SLICE_RPC,
  type ReturnRecord,
  type SaleHeld,
} from "../../src/lib/compliance/ccrs-return-corrections-core";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const GUIDE_LINES: Record<number, string> = {
  247: "Update (alter an existing record indicated by external identifier).",
  248: "Delete (delete a record indicated by external identifier).",
  1302: "Invalid InventoryExternalIdentifier",
  1303: "Note: If you have received this error, ensure that you have already reported the",
  1304: "inventory in an inventory.CSV",
  1345: "No negative values allowed",
  1413: "Invalid Sale Detail (UD)",
  1414: "SaleDetailExternalIdentifier not found",
};
const FAQ_LINES: Record<number, string> = {
  39: "the sale identifier should be deleted from CCRS",
  53: "The record doesn't exist, so an error message would be received.",
};

describe("the LCB lines this slice rests on are quoted exactly", () => {
  const guide = join(ROOT, "../lcb/guide.txt");
  const faq = join(ROOT, "../lcb/faq.txt");
  it.skipIf(!existsSync(guide))("guide lines", () => {
    const lines = readFileSync(guide, "utf8").split("\n");
    for (const [n, text] of Object.entries(GUIDE_LINES)) expect(lines[Number(n) - 1], `G L${n}`).toContain(text);
  });
  it.skipIf(!existsSync(faq))("faq lines", () => {
    const lines = readFileSync(faq, "utf8").split("\n");
    for (const [n, text] of Object.entries(FAQ_LINES)) expect(lines[Number(n) - 1], `FAQ L${n}`).toContain(text);
  });
});

const LIC = { licenseNumber: "413541", submittedBy: "Greenway" };
const ret = (o: Partial<ReturnRecord> = {}): ReturnRecord => ({
  id: "r1",
  saleExternalId: "GWY-AAA111",
  saleDetailExternalId: "GWY-AAA111-0a1b2c3d",
  inventoryExternalId: "LOT-1",
  saleType: "RecreationalRetail",
  saleDateISO: "2026-10-05",
  originalQuantity: 4,
  quantity: 1,
  unitPriceMinor: 2000,
  discountMinor: 400,
  salesTaxMinor: 800,
  exciseMinor: 2960,
  createdAtISO: "2026-10-08T19:00:00Z",
  pending: true,
  ...o,
});
const C = CCRS_COLUMNS.Sale;
const col = (row: string[], name: string) => row[C.indexOf(name)];
const held = (o: Partial<SaleHeld> = {}): SaleHeld => ({ state: "filed", quantity: "4", inFlight: false, ...o });
const ledgerMap = (entries: Record<string, SaleHeld | null>) => new Map(Object.entries(entries));

describe("planReturnCorrections: one row per sale line, from the cumulative return", () => {
  it("a partial return is an Update reporting the REMAINING quantity, money pro-rated", () => {
    const p = planReturnCorrections({ returns: [ret()], license: LIC, ledger: "legacy", insertedDetailIds: new Set() });
    expect(p.rows).toHaveLength(1);
    const r = p.rows[0];
    expect(col(r, "Operation")).toBe("Update");
    expect(col(r, "Quantity")).toBe("3");
    expect(col(r, "Discount")).toBe("3.00");
    expect(col(r, "RetailSalesTax")).toBe("6.00");
    expect(col(r, "CannabisExciseTax")).toBe("22.20");
    expect(col(r, "SaleDetailExternalIdentifier")).toBe("GWY-AAA111-0a1b2c3d");
    expect(col(r, "SaleExternalIdentifier")).toBe("GWY-AAA111");
    expect(col(r, "InventoryExternalIdentifier")).toBe("LOT-1");
    expect(p.groups[0]).toMatchObject({ operation: "Update", cumulative: 1, original: 4, returnIds: ["r1"] });
  });

  it("a SECOND partial return uses the cumulative quantity (the old route sent original - this return)", () => {
    const p = planReturnCorrections({
      returns: [ret({ id: "r1", quantity: 1, pending: false }), ret({ id: "r2", quantity: 2, createdAtISO: "2026-10-09T19:00:00Z" })],
      license: LIC,
      ledger: "legacy",
      insertedDetailIds: new Set(),
    });
    expect(p.rows).toHaveLength(1);
    expect(col(p.rows[0], "Quantity")).toBe("1");
    expect(col(p.rows[0], "Operation")).toBe("Update");
    // UpdatedDate is the latest return's day.
    expect(col(p.rows[0], "UpdatedDate")).toBe("10/09/2026");
    // Only the PENDING return is marked by this row; r1 was already exported.
    expect(p.groups[0].returnIds).toEqual(["r2"]);
  });

  it("returns that add up to the whole line are ONE Delete restating the original line (never a 0-quantity Update)", () => {
    const p = planReturnCorrections({
      returns: [ret({ id: "r1", quantity: 1 }), ret({ id: "r2", quantity: 3 })],
      license: LIC,
      ledger: "legacy",
      insertedDetailIds: new Set(),
    });
    expect(p.rows).toHaveLength(1);
    expect(col(p.rows[0], "Operation")).toBe("Delete");
    expect(col(p.rows[0], "Quantity")).toBe("4");
    expect(col(p.rows[0], "Discount")).toBe("4.00");
    expect(p.groups[0].returnIds).toEqual(["r1", "r2"]);
  });

  it("two different sale lines give two rows, sorted by SaleDetailExternalIdentifier", () => {
    const p = planReturnCorrections({
      returns: [ret({ id: "b", saleDetailExternalId: "GWY-AAA111-ffff0000" }), ret({ id: "a" })],
      license: LIC,
      ledger: "legacy",
      insertedDetailIds: new Set(),
    });
    expect(p.rows.map((r) => col(r, "SaleDetailExternalIdentifier"))).toEqual(["GWY-AAA111-0a1b2c3d", "GWY-AAA111-ffff0000"]);
  });

  it("a line with no pending return is not re-sent", () => {
    const p = planReturnCorrections({ returns: [ret({ pending: false })], license: LIC, ledger: "legacy", insertedDetailIds: new Set() });
    expect(p.rows).toEqual([]);
    expect(p.withheld).toEqual([]);
  });

  it("more returned than sold, disagreeing snapshots, or a missing id are refused by name, never sent", () => {
    const over = planReturnCorrections({ returns: [ret({ id: "r1", quantity: 3 }), ret({ id: "r2", quantity: 2 })], license: LIC, ledger: "legacy", insertedDetailIds: new Set() });
    expect(over.rows).toEqual([]);
    expect(over.invalid[0]).toMatchObject({ detailId: "GWY-AAA111-0a1b2c3d", returnIds: ["r1", "r2"] });
    expect(over.invalid[0].reason).toMatch(/5 returned.*4 sold/);
    const clash = planReturnCorrections({ returns: [ret({ id: "r1" }), ret({ id: "r2", originalQuantity: 5 })], license: LIC, ledger: "legacy", insertedDetailIds: new Set() });
    expect(clash.rows).toEqual([]);
    expect(clash.invalid[0].reason).toMatch(/disagree/);
    const noId = planReturnCorrections({ returns: [ret({ saleDetailExternalId: "  " })], license: LIC, ledger: "legacy", insertedDetailIds: new Set() });
    expect(noId.rows).toEqual([]);
    expect(noId.invalid[0].reason).toMatch(/SaleDetailExternalIdentifier/);
  });
});

describe("planReturnCorrections with the Sale ledger: only what CCRS holds is corrected", () => {
  const D = "GWY-AAA111-0a1b2c3d";
  const plan = (h: SaleHeld | null, inserted: string[] = [], returns = [ret()]) =>
    planReturnCorrections({ returns, license: LIC, ledger: ledgerMap({ [D]: h }), insertedDetailIds: new Set(inserted) });

  it("held (filed/confirmed/seed) and nothing in flight -> emitted", () => {
    for (const state of ["filed", "confirmed", "seed"] as const) expect(plan(held({ state })).rows).toHaveLength(1);
  });
  it("not held -> withheld E48 (\"SaleDetailExternalIdentifier not found\" [G L1414]); the return stays pending", () => {
    const p = plan(null);
    expect(p.rows).toEqual([]);
    expect(p.withheld).toHaveLength(1);
    expect(p.withheld[0]).toMatchObject({ detailId: D, returnIds: ["r1"] });
    expect(p.withheld[0].reason).toMatch(/does not hold/);
  });
  it("a file naming this sale line is not answered yet -> withheld (never a second assertion in flight)", () => {
    const p = plan(held({ inFlight: true }));
    expect(p.rows).toEqual([]);
    expect(p.withheld[0].reason).toMatch(/not answered/);
  });
  it("the sale itself is Inserted in THIS batch -> withheld until CCRS answers that file", () => {
    const p = plan(null, [D]);
    expect(p.rows).toEqual([]);
    expect(p.withheld[0].reason).toMatch(/same batch/);
    // Even if (impossibly) also held, an Insert and its correction never share a file.
    expect(plan(held(), [D]).rows).toEqual([]);
  });
  it("uncertain / unknown / closed / deleted (for an Update) -> withheld with the state named", () => {
    for (const state of ["uncertain", "unknown", "closed", "deleted"] as const) {
      const p = plan(held({ state }));
      expect(p.rows, state).toEqual([]);
      expect(p.withheld[0].reason).toContain(state);
    }
  });
  it("already reflected: a Delete CCRS already applied, or an Update to the quantity CCRS already holds -> not re-sent, reported as done", () => {
    const full = [ret({ id: "r1", quantity: 4 })];
    const del = plan(held({ state: "deleted" }), [], full);
    expect(del.rows).toEqual([]);
    expect(del.withheld).toEqual([]);
    expect(del.reflected).toEqual([{ detailId: D, returnIds: ["r1"] }]);
    const upd = plan(held({ quantity: "3" }));
    expect(upd.rows).toEqual([]);
    expect(upd.reflected).toEqual([{ detailId: D, returnIds: ["r1"] }]);
    // A held quantity that differs is corrected.
    expect(plan(held({ quantity: "4" })).rows).toHaveLength(1);
  });
});

describe("E48 is a registered, pinned issue code", () => {
  it("in CCRS_ISSUE_CODES with pin [G L1413-L1414]", () => {
    expect(CCRS_ISSUE_CODES).toContain("E48_SALE_CORRECTION_WITHHELD");
    expect(specPinFor("E48_SALE_CORRECTION_WITHHELD")).toBe("[G L1413-L1414]");
  });
});

describe("decodeSaleSlice (migration 0283 ccrs_sale_slice)", () => {
  it("names the RPC", () => expect(SALE_SLICE_RPC).toBe("ccrs_sale_slice"));
  it("missing function -> absent; any other error or a malformed answer throws", () => {
    expect(decodeSaleSlice("preprod", null, { code: "PGRST202", message: "" })).toEqual({ kind: "absent" });
    expect(() => decodeSaleSlice("preprod", null, { code: "57014", message: "timeout" })).toThrow();
    expect(() => decodeSaleSlice("preprod", { env: "prod", entries: [] }, null)).toThrow(/env/);
    expect(() => decodeSaleSlice("preprod", { env: "preprod", entries: [["D", "bogus", null, false]] }, null)).toThrow(/state/);
    expect(() => decodeSaleSlice("preprod", { env: "preprod", entries: [["D", "filed", null]] }, null)).toThrow();
    expect(() => decodeSaleSlice("preprod", { env: "preprod", entries: [["D", "filed", null, "no"]] }, null)).toThrow();
    expect(() => decodeSaleSlice("preprod", { env: "preprod", entries: [["D", null, null, false], ["D", null, null, false]] }, null)).toThrow(/twice/);
  });
  it("decodes held and not-held lines", () => {
    const out = decodeSaleSlice("preprod", { env: "preprod", entries: [["A", "filed", "3", false], ["B", null, null, true]] }, null);
    expect(out.kind).toBe("loaded");
    if (out.kind !== "loaded") return;
    expect(out.held.get("A")).toEqual({ state: "filed", quantity: "3", inFlight: false });
    // Not held but in flight: the sale's own Insert file is unanswered.
    expect(out.held.get("B")).toEqual(null);
    expect(out.inFlightOnly.has("B")).toBe(true);
  });
  it("saleLedgerEntries turns held lines into Sale ledger entries for the self-check", () => {
    expect(saleLedgerEntries(ledgerMap({ A: held(), B: null }))).toEqual([
      { fileType: "Sale", externalId: "A", filedName: null, state: "filed", productExternalId: null },
    ]);
  });
});

describe("eventLotRefs: the lots event files name", () => {
  it("reads InventoryExternalIdentifier from Adjustment and Sale rows only", () => {
    const adj = mk("InventoryAdjustment", [adjRow("LOT-D")]);
    const s = mk("Sale", [saleRow("LOT-S", "GWS-1", "GWS-1-a", "Insert")]);
    const inv = mk("Inventory", [invRow("LOT-I", "Insert")]);
    expect(eventLotRefs([{ type: "InventoryAdjustment", csv: adj }, { type: "Sale", csv: s }, { type: "Inventory", csv: inv }])).toEqual(["LOT-D", "LOT-S"]);
    expect(eventLotRefs([{ type: "Sale", csv: mk("Sale", []) }])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * The outbox self-check: closed lots reported in this emission.
 * ------------------------------------------------------------------ */
const HDR = "SubmittedBy,G\r\nSubmittedDate,10/20/2026\r\n";
function mk(t: CcrsRetailerFileType, rows: string[]) {
  return `${HDR}NumberRecords,${rows.length}\r\n${CCRS_COLUMNS[t].join(",")}\r\n${rows.map((r) => r + "\r\n").join("")}`;
}
const byName = (t: CcrsRetailerFileType, v: Record<string, string>) =>
  CCRS_COLUMNS[t].map((c) => { if (!(c in v)) throw new Error(`fixture lacks ${t}.${c}`); return v[c]; }).join(",");
function invRow(id: string, op: string, qoh = "1") {
  return byName("Inventory", {
    LicenseNumber: "413541", Strain: "Blue Dream", Area: "Sales Floor", Product: "P One", InitialQuantity: "5", QuantityOnHand: qoh,
    TotalCost: "30.00", IsMedical: "FALSE", ExternalIdentifier: id, CreatedBy: "G", CreatedDate: "10/01/2026", UpdatedBy: "G", UpdatedDate: "10/20/2026", Operation: op,
  });
}
function saleRow(lot: string, sale: string, detail: string, op: string) {
  return byName("Sale", {
    LicenseNumber: "413541", SoldToLicenseNumber: "", InventoryExternalIdentifier: lot, PlantExternalIdentifier: "",
    SaleType: "RecreationalRetail", SaleDate: "10/05/2026", Quantity: "3", UnitPrice: "20.00", Discount: "3.00",
    RetailSalesTax: "6.00", CannabisExciseTax: "22.20", SaleExternalIdentifier: sale, SaleDetailExternalIdentifier: detail,
    CreatedBy: "G", CreatedDate: "10/05/2026", UpdatedBy: op === "Insert" ? "" : "G", UpdatedDate: op === "Insert" ? "" : "10/20/2026", Operation: op,
  });
}
function adjRow(lot: string) {
  return byName("InventoryAdjustment", {
    LicenseNumber: "413541", InventoryExternalIdentifier: lot, AdjustmentReason: "Destruction", AdjustmentDetail: "destroyed", Quantity: "1",
    AdjustmentDate: "10/20/2026", ExternalIdentifier: `ADJ-${lot}`, CreatedBy: "G", CreatedDate: "10/20/2026", UpdatedBy: "", UpdatedDate: "", Operation: "Insert",
  });
}
const view = (rows: Partial<LedgerEntry>[]) =>
  buildLedgerView("preprod", [
    { fileType: "Product", externalId: "P1", filedName: "P One", state: "filed" },
    { fileType: "Strain", externalId: "Blue Dream", filedName: "Blue Dream", state: "filed" },
    { fileType: "Area", externalId: "GWA-SALES-FLOOR", filedName: "Sales Floor", state: "filed" },
    ...rows.map((r) => ({ fileType: "Inventory", externalId: "x", filedName: null, state: "filed", productExternalId: "P1", ...r }) as LedgerEntry),
  ]).view;
const OPTS = { licenseNumber: "413541", now: new Date("2026-10-20T19:00:00Z"), lastStamp: null };
const check = (v: ReturnType<typeof view>, files: { type: CcrsRetailerFileType; rows: string[] }[]) =>
  verifyOutboxAgainstLedger(v, planOutboxFiles(files.map((f) => ({ type: f.type, csv: mk(f.type, f.rows) })), OPTS)).map((p) => p.code);

describe("self-check: a closed lot (QoH 0 in CCRS) that THIS emission reports may carry event rows", () => {
  const V = view([{ externalId: "LOT-C", state: "closed" }, { externalId: "LOT-U", state: "uncertain" }, { externalId: "LOT-X", state: "deleted" }]);
  it("sold out, then returned: Inventory Update re-reports the lot -> the add-back and the Sale correction pass", () => {
    expect(check(V, [
      { type: "Inventory", rows: [invRow("LOT-C", "Update", "1")] },
      { type: "InventoryAdjustment", rows: [adjRow("LOT-C")] },
    ])).toEqual([]);
  });
  it("fully destroyed: Inventory Update to QoH 0 in the same emission -> the Destruction adjustment passes", () => {
    expect(check(V, [
      { type: "Inventory", rows: [invRow("LOT-C", "Update", "0")] },
      { type: "InventoryAdjustment", rows: [adjRow("LOT-C")] },
    ])).toEqual([]);
  });
  it("a closed lot NOT reported in this emission is still refused (unchanged: Part 03 L189 / M95)", () => {
    expect(check(V, [{ type: "InventoryAdjustment", rows: [adjRow("LOT-C")] }])).toEqual(["L_REF_INVENTORY"]);
  });
  it("uncertain or deleted lots are never relaxed, even when an Inventory row names them", () => {
    // (The Update itself is also refused: neither state is UPDATABLE, Part 03 §D.3.)
    expect(check(V, [{ type: "Inventory", rows: [invRow("LOT-U", "Update")] }, { type: "InventoryAdjustment", rows: [adjRow("LOT-U")] }])).toEqual(["L_UPDATE_NOT_ON_FILE", "L_REF_INVENTORY"]);
    expect(check(V, [{ type: "Inventory", rows: [invRow("LOT-X", "Update")] }, { type: "InventoryAdjustment", rows: [adjRow("LOT-X")] }])).toEqual(["L_UPDATE_NOT_ON_FILE", "L_REF_INVENTORY"]);
  });
});

describe("self-check: Sale Update/Delete rows are checked against the Sale ledger", () => {
  const V = (sale: Partial<LedgerEntry>[]) =>
    buildLedgerView("preprod", [
      { fileType: "Inventory", externalId: "LOT-1", filedName: null, state: "filed" },
      ...sale.map((s) => ({ fileType: "Sale", externalId: "D1", filedName: null, state: "filed", ...s }) as LedgerEntry),
    ]).view;
  it("an Update or Delete of a sale line CCRS holds passes", () => {
    expect(check(V([{}]), [{ type: "Sale", rows: [saleRow("LOT-1", "S1", "D1", "Update")] }])).toEqual([]);
    expect(check(V([{}]), [{ type: "Sale", rows: [saleRow("LOT-1", "S1", "D1", "Delete")] }])).toEqual([]);
  });
  it("an Update or Delete of a sale line CCRS does not hold is refused [FAQ L0053]", () => {
    expect(check(V([]), [{ type: "Sale", rows: [saleRow("LOT-1", "S1", "D1", "Update")] }])).toEqual(["L_UPDATE_NOT_ON_FILE"]);
    expect(check(V([{ state: "deleted" }]), [{ type: "Sale", rows: [saleRow("LOT-1", "S1", "D1", "Delete")] }])).toEqual(["L_DELETE_NOT_ON_FILE"]);
  });
  it("an Insert of a sale line CCRS already holds, or the same line twice in one emission, is refused (\"Duplicate Sale detail item\")", () => {
    expect(check(V([{}]), [{ type: "Sale", rows: [saleRow("LOT-1", "S1", "D1", "Insert")] }])).toEqual(["L_INSERT_ON_FILE"]);
    expect(check(V([]), [{ type: "Sale", rows: [saleRow("LOT-1", "S1", "D1", "Insert"), saleRow("LOT-1", "S1", "D1", "Insert")] }])).toEqual(["L_INSERT_ON_FILE"]);
  });
});

describe("wiring (source pins)", () => {
  const batch = read("src/lib/compliance/ccrs-batch.ts");
  const route = read("src/app/admin/reports/compliance/batch-export/route.ts");
  const manual = read("src/app/admin/inventory/disposition/sale-correction-export/route.ts");
  it("the batch merges planned corrections into the ONE Sale file and merges Sale entries into the ledger view", () => {
    expect(batch).toContain("planReturnCorrections(");
    expect(batch).toContain("saleLedgerEntries(");
    expect(batch).toContain('code: "E48_SALE_CORRECTION_WITHHELD"');
    expect(batch).toMatch(/assembleCcrsFile\(\{ type: "Sale", submittedBy, submittedDate: now, rows: saleRows \}\)/);
  });
  it("the batch reports a destroyed lot that an event row of this batch names", () => {
    expect(batch).toContain("eventLotRefs(");
    expect(batch).toMatch(/\.eq\("status", "destroyed"\)/);
  });
  it("the export route marks returns exported only AFTER the outbox stored the Sale file", () => {
    const emitAt = route.indexOf("await emitOutboxFiles(");
    const markAt = route.indexOf("await markCorrectionsExported(");
    expect(emitAt).toBeGreaterThan(0);
    expect(markAt).toBeGreaterThan(emitAt);
    expect(route).toContain("batch.corrections.exportReturnIds");
  });
  it("the manual route uses the same cumulative planner (legacy mode)", () => {
    expect(manual).toContain("planReturnCorrections(");
    expect(manual).toContain('ledger: "legacy"');
    expect(manual).not.toContain("returnQuantity: Number(r.quantity)");
  });
  it("migration 0283 adds ccrs_sale_slice for the service role only", () => {
    const sql = read("supabase/migrations/0283_ccrs_sale_slice.sql");
    expect(sql).toMatch(/create or replace function public\.ccrs_sale_slice\(p_env text, p_detail_ids text\[\]\)/);
    expect(sql).toMatch(/revoke all on function public\.ccrs_sale_slice\(text, text\[\]\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.ccrs_sale_slice\(text, text\[\]\) to service_role;/);
    expect(sql).not.toMatch(/create table|alter table|drop table/i);
    expect(read("supabase/rollbacks/0283_ccrs_sale_slice.rollback.sql")).toMatch(/drop function if exists public\.ccrs_sale_slice\(text, text\[\]\)/);
  });
});

describe("embedded self-tests", () => {
  it("pass", () => {
    const r = __runReturnCorrectionsTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(8);
  });
});
