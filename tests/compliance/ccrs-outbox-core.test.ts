/**
 * S-12b (CCRS Bible v2 Part 05 §B–D, §G): the outbox planner, the ledger
 * self-check on the exact bytes, the emit payload, and splitAssembledFile.
 *
 * Why this matters to the license: CCRS never accepts the same file name or
 * the same data twice [BRIAN A29]; an Update of a record it does not hold, or
 * an Insert of one it does, errors [FAQ L0052-L0053]; an Inventory row naming
 * a Strain/Area/Product it does not hold is "Invalid Strain/Area/Product"
 * [G L0555] [G L0570] [G L0579]. These checks run on the bytes that will be
 * stored and uploaded — not on a re-generation.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CCRS_COLUMNS, type CcrsRetailerFileType } from "../../src/lib/compliance/ccrs-batch-core";
import { CcrsChunkError, splitAssembledFile } from "../../src/lib/compliance/ccrs-chunk-core";
import { buildLedgerView, type LedgerEntry } from "../../src/lib/compliance/ccrs-ledger-core";
import {
  __runCcrsOutboxCoreTests,
  checkEmitResult,
  emitPayload,
  outboxReadmeLines,
  planOutboxFiles,
  sha256Utf8,
  verifyOutboxAgainstLedger,
  type OutboxFile,
} from "../../src/lib/compliance/ccrs-outbox-core";

const HDR = "SubmittedBy,G\r\nSubmittedDate,10/07/2026\r\n";
const mk = (t: CcrsRetailerFileType, rows: string[]) =>
  `${HDR}NumberRecords,${rows.length}\r\n${CCRS_COLUMNS[t].join(",")}\r\n${rows.map((r) => r + "\r\n").join("")}`;
const inv = (id: string, op: string, product = "P One", strain = "Blue Dream", area = "Sales Floor") =>
  `413541,${strain},${area},${product},5,2,30.00,FALSE,${id},G,10/01/2026,G,10/07/2026,${op}`;
// Laid out from CCRS_COLUMNS.Sale by name, so a template change cannot shift it.
const sale = (lot: string) => {
  const v: Record<string, string> = {
    LicenseNumber: "413541", SoldToLicenseNumber: "", InventoryExternalIdentifier: lot, PlantExternalIdentifier: "",
    SaleType: "RecreationalRetail", SaleDate: "10/07/2026", Quantity: "1", UnitPrice: "25.00", Discount: "0",
    RetailSalesTax: "2.18", CannabisExciseTax: "9.25", SaleExternalIdentifier: "GWS-1", SaleDetailExternalIdentifier: `GWS-1-${lot}`,
    CreatedBy: "G", CreatedDate: "10/07/2026", UpdatedBy: "", UpdatedDate: "", Operation: "Insert",
  };
  return CCRS_COLUMNS.Sale.map((c) => { if (!(c in v)) throw new Error(`test fixture lacks Sale column ${c}`); return v[c]; }).join(",");
};
const OPTS = { licenseNumber: "413541", now: new Date("2026-10-07T19:00:00.400Z"), lastStamp: null };

const ledger = (rows: Partial<LedgerEntry>[]) =>
  buildLedgerView(
    "prod",
    rows.map((r) => ({ fileType: "Inventory", externalId: "x", filedName: null, state: "seed", productExternalId: null, ...r }) as LedgerEntry),
  ).view;
const HELD = ledger([
  { fileType: "Product", externalId: "P1", filedName: "P One" },
  { fileType: "Strain", externalId: "Blue Dream", filedName: "Blue Dream" },
  { fileType: "Area", externalId: "C1100011", filedName: "Sales Floor" },
  { fileType: "Inventory", externalId: "L-SEED", productExternalId: "P1" },
  { fileType: "Inventory", externalId: "L-CLOSED", state: "closed", productExternalId: "P1" },
  { fileType: "Inventory", externalId: "L-UNK", state: "unknown" },
  { fileType: "Inventory", externalId: "L-DEL", state: "deleted" },
]);
const plan1 = (files: { type: CcrsRetailerFileType; rows: string[] }[]) =>
  planOutboxFiles(files.map((f) => ({ type: f.type, csv: mk(f.type, f.rows) })), OPTS);
const codes = (files: OutboxFile[]) => verifyOutboxAgainstLedger(HELD, files).map((p) => p.code);

describe("splitAssembledFile (Part 05 §C)", () => {
  it("one chunk returns the IDENTICAL bytes (a routine week is unchanged)", () => {
    const f = mk("Inventory", [inv("A", "Update")]);
    expect(splitAssembledFile("Inventory", f)).toEqual([f]);
  });
  it("25 rows / 10 → 10, 10, 5; same SubmittedBy/Date; NumberRecords rewritten; rows in order", () => {
    const rows = Array.from({ length: 25 }, (_, i) => inv(`L${i}`, "Update"));
    const parts = splitAssembledFile("Inventory", mk("Inventory", rows), 10);
    expect(parts.map((p) => p.split("\r\n")[2])).toEqual(["NumberRecords,10", "NumberRecords,10", "NumberRecords,5"]);
    expect(parts.every((p) => p.startsWith(HDR) && p.endsWith("\r\n"))).toBe(true);
    expect(parts.flatMap((p) => p.slice(0, -2).split("\r\n").slice(4))).toEqual(rows);
  });
  it("40,662 rows at the default size → 5 files (10,000 ×4 + 662)", () => {
    const rows = Array.from({ length: 40_662 }, (_, i) => inv(`L${i}`, "Update"));
    expect(splitAssembledFile("Inventory", mk("Inventory", rows)).map((p) => p.split("\r\n")[2])).toEqual([
      "NumberRecords,10000", "NumberRecords,10000", "NumberRecords,10000", "NumberRecords,10000", "NumberRecords,662",
    ]);
  });
  it("an empty file is returned as is (the planner drops it)", () => {
    const f = mk("Area", []);
    expect(splitAssembledFile("Area", f)).toEqual([f]);
  });
  it("refuses malformed input instead of guessing: LF, short, wrong columns, wrong count", () => {
    const good = mk("Strain", ["413541,S,Hybrid,G,10/07/2026"]);
    expect(() => splitAssembledFile("Strain", good.replace(/\r\n/g, "\n"))).toThrow(CcrsChunkError);
    expect(() => splitAssembledFile("Strain", "SubmittedBy,G\r\n")).toThrow(CcrsChunkError);
    expect(() => splitAssembledFile("Area", good)).toThrow(/template/);
    expect(() => splitAssembledFile("Strain", good.replace("NumberRecords,1", "NumberRecords,2"))).toThrow(/NumberRecords,2/);
  });
});

describe("planOutboxFiles (Part 05 §B–C)", () => {
  it("upload order, chunks, one second per file, after the last stored stamp", () => {
    const files = planOutboxFiles(
      [
        { type: "Sale", csv: mk("Sale", [sale("L-SEED")]) },
        { type: "Inventory", csv: mk("Inventory", Array.from({ length: 21 }, (_, i) => inv(`N${i}`, "Insert"))) },
        { type: "Strain", csv: mk("Strain", ["413541,Blue Dream,Hybrid,G,10/07/2026"]) },
      ],
      { ...OPTS, lastStamp: new Date("2026-10-07T19:00:05Z"), chunkRows: 10 },
    );
    expect(files.map((f) => `${f.type}${f.chunkNo}/${f.chunkOf}@${f.group}`)).toEqual([
      "Strain1/1@1", "Inventory1/3@2", "Inventory2/3@2", "Inventory3/3@2", "Sale1/1@3",
    ]);
    expect(files.map((f) => f.fileName)).toEqual([
      "Strain_413541_20261007120006.csv",
      "Inventory_413541_20261007120007.csv",
      "Inventory_413541_20261007120008.csv",
      "Inventory_413541_20261007120009.csv",
      "Sale_413541_20261007120010.csv",
    ]);
  });
  it("first emission ever: the stamp is now, floored to the second", () => {
    const [f] = plan1([{ type: "Strain", rows: ["413541,Blue Dream,Hybrid,G,10/07/2026"] }]);
    expect(f.stampAt.toISOString()).toBe("2026-10-07T19:00:00.000Z");
  });
  it("empty files are NOT emitted [FAQ L0049]; all-empty → nothing", () => {
    expect(plan1([{ type: "Area", rows: [] }, { type: "InventoryTransfer", rows: [] }])).toEqual([]);
  });
  it("two files of one type in one emission is refused", () => {
    const s = { type: "Strain" as const, csv: mk("Strain", ["413541,A,Hybrid,G,10/07/2026"]) };
    expect(() => planOutboxFiles([s, s], OPTS)).toThrow(/two Strain files/);
  });
  it("totals come from the chunk's own bytes", () => {
    const files = planOutboxFiles([{ type: "Inventory", csv: mk("Inventory", [inv("A", "Update"), inv("B", "Update"), inv("C", "Update")]) }], { ...OPTS, chunkRows: 2 });
    expect(files.map((f) => [f.recordCount, f.totals.distinctIds, f.totals.sumQoh, f.totals.sumTotalCost])).toEqual([
      [2, 2, "4", "60"], // canonical: no trailing zeros (control-totals-core L50)
      [1, 1, "2", "30"],
    ]);
  });
});

describe("verifyOutboxAgainstLedger (Part 05 §D.4; the Part 07 S-12b verifier cases)", () => {
  it("a clean emission verifies: Update of held lots, Insert of a new lot naming held strings", () => {
    expect(codes(plan1([{ type: "Inventory", rows: [inv("L-SEED", "Update"), inv("L-CLOSED", "Update"), inv("NEW-1", "Insert")] }]))).toEqual([]);
  });
  it("Insert of a ledger-present id → L_INSERT_ON_FILE (closed too: CCRS still holds it)", () => {
    expect(codes(plan1([{ type: "Inventory", rows: [inv("L-SEED", "Insert"), inv("L-CLOSED", "Insert")] }]))).toEqual(["L_INSERT_ON_FILE", "L_INSERT_ON_FILE"]);
  });
  it("Update of a ledger-absent id → L_UPDATE_NOT_ON_FILE [FAQ L0053]; unknown and deleted too", () => {
    expect(codes(plan1([{ type: "Inventory", rows: [inv("NOPE", "Update"), inv("L-UNK", "Update"), inv("L-DEL", "Update")] }]))).toEqual([
      "L_UPDATE_NOT_ON_FILE", "L_UPDATE_NOT_ON_FILE", "L_UPDATE_NOT_ON_FILE",
    ]);
  });
  it("Delete of an id CCRS does not hold → L_DELETE_NOT_ON_FILE; Delete of a held id is fine", () => {
    expect(codes(plan1([{ type: "Inventory", rows: [inv("NOPE", "Delete"), inv("L-SEED", "Delete")] }]))).toEqual(["L_DELETE_NOT_ON_FILE"]);
  });
  it("the same id Inserted twice in one emission → L_INSERT_ON_FILE", () => {
    expect(codes(plan1([{ type: "Inventory", rows: [inv("N1", "Insert"), inv("N1", "Insert")] }]))).toEqual(["L_INSERT_ON_FILE"]);
  });
  it("Product / Strain / Area strings not held → L_REF_PRODUCT / L_REF_STRAIN / L_REF_AREA", () => {
    expect(codes(plan1([{ type: "Inventory", rows: [inv("N1", "Insert", "Nope Product"), inv("N2", "Insert", "P One", "Nope Strain"), inv("N3", "Insert", "P One", "Blue Dream", "Back Room")] }]))).toEqual([
      "L_REF_PRODUCT", "L_REF_STRAIN", "L_REF_AREA",
    ]);
  });
  it("the Strain join ignores case (PREprod P20261005B, U-45); Product and Area do not", () => {
    expect(codes(plan1([{ type: "Inventory", rows: [inv("N1", "Insert", "P One", "BLUE DREAM")] }]))).toEqual([]);
    expect(codes(plan1([{ type: "Inventory", rows: [inv("N1", "Insert", "p one")] }]))).toEqual(["L_REF_PRODUCT"]);
    expect(codes(plan1([{ type: "Inventory", rows: [inv("N1", "Insert", "P One", "Blue Dream", "sales floor")] }]))).toEqual(["L_REF_AREA"]);
  });
  it("names created by an EARLIER file of the same emission count as held", () => {
    const files = plan1([
      { type: "Strain", rows: ["413541,New Strain,Hybrid,G,10/07/2026"] },
      { type: "Area", rows: ["413541,Vault,FALSE,GWA-VAULT,G,10/07/2026,,,Insert"] },
      { type: "Product", rows: ["413541,EndProduct,Usable Marijuana,New Product,,3.5,GWP-000001,G,10/07/2026,,,Insert"] },
      { type: "Inventory", rows: [inv("N1", "Insert", "New Product", "new strain", "Vault")] },
    ]);
    expect(codes(files)).toEqual([]);
  });
  it("an empty Strain cell is not a reference", () => {
    expect(codes(plan1([{ type: "Inventory", rows: [inv("N1", "Insert", "P One", "")] }]))).toEqual([]);
  });
  it("event rows must name a lot CCRS holds (seed/filed/confirmed) or one Inserted earlier → L_REF_INVENTORY", () => {
    expect(codes(plan1([{ type: "Sale", rows: [sale("L-SEED")] }]))).toEqual([]);
    expect(codes(plan1([{ type: "Sale", rows: [sale("NOPE")] }]))).toEqual(["L_REF_INVENTORY"]);
    expect(codes(plan1([{ type: "Sale", rows: [sale("L-CLOSED")] }]))).toEqual(["L_REF_INVENTORY"]);
    expect(codes(plan1([{ type: "Inventory", rows: [inv("N1", "Insert")] }, { type: "Sale", rows: [sale("N1")] }]))).toEqual([]);
  });
  it("totals that no longer match the bytes → L_TOTALS", () => {
    const [f] = plan1([{ type: "Inventory", rows: [inv("L-SEED", "Update")] }]);
    expect(verifyOutboxAgainstLedger(HELD, [{ ...f, totals: { ...f.totals, sumQoh: "999" } }]).map((p) => p.code)).toEqual(["L_TOTALS"]);
  });
  it("every problem is reported — no cap (Part 05 §H)", () => {
    const rows = Array.from({ length: 250 }, (_, i) => inv(`X${i}`, "Update"));
    expect(codes(plan1([{ type: "Inventory", rows }])).length).toBe(250);
  });
  it("row numbers are 1-based within the file", () => {
    const p = verifyOutboxAgainstLedger(HELD, plan1([{ type: "Inventory", rows: [inv("L-SEED", "Update"), inv("NOPE", "Update")] }]));
    expect(p.map((x) => x.row)).toEqual([2]);
  });
});

describe("emitPayload / checkEmitResult", () => {
  const files = plan1([{ type: "Strain", rows: ["413541,Blue Dream,Hybrid,G,10/07/2026"] }, { type: "Inventory", rows: [inv("L-SEED", "Update")] }]);
  const p = emitPayload(files, (f) => (f.type === "Inventory" ? [{ severity: "warning", code: "W", message: "m" }] : []));
  it("sha256 of the exact UTF-8 bytes; snake_case fields the RPC reads", () => {
    expect(p[0].sha256).toBe(sha256Utf8(files[0].csv));
    // Independent reference (Python hashlib): UTF-8 bytes, not Latin-1 / UTF-16.
    expect(sha256Utf8("é")).toBe("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
    expect(sha256Utf8("é")).not.toBe("de2e331d891ae267a7009cb45b4e8830f170e0c937288ea2731a1941c7a53b0d");
    expect(Object.keys(p[0]).sort()).toEqual(
      ["chunk_no", "chunk_of", "content", "control_totals", "distinct_ids", "file_name", "file_type", "issues", "number_records", "purpose", "sha256", "stamp_at", "sum_qoh", "sum_total_cost"].sort(),
    );
    expect(p[1].issues).toEqual([{ severity: "warning", code: "W", message: "m" }]);
    expect(p[0].stamp_at).toBe(files[0].stampAt.toISOString());
  });
  it("accepts a well-formed answer and refuses count / order / hash / name drift", () => {
    const ok = { files: p.map((x, i) => ({ status: "emitted", id: `id${i}`, file_name: x.file_name, sha256: x.sha256, state: "emitted", in_flight: 0 })) };
    expect(checkEmitResult(p, ok).map((r) => r.status)).toEqual(["emitted", "emitted"]);
    expect(() => checkEmitResult(p, { files: ok.files.slice(1) })).toThrow(/returned 1/);
    expect(() => checkEmitResult(p, { files: [...ok.files].reverse() })).toThrow(/different bytes/);
    expect(() => checkEmitResult(p, { files: [ok.files[0], { ...ok.files[1], file_name: "x.csv" }] })).toThrow(/different name/);
    expect(() => checkEmitResult(p, null)).toThrow(/no file/);
    expect(() => checkEmitResult(p, { files: [{ ...ok.files[0], status: "weird" }, ok.files[1]] })).toThrow(/malformed/);
  });
  it("a duplicate may carry the STORED (older) name", () => {
    const dup = { files: p.map((x, i) => ({ status: "duplicate", id: `id${i}`, file_name: `old${i}.csv`, sha256: x.sha256, state: "uploaded", emitted_at: null })) };
    expect(checkEmitResult(p, dup).map((r) => r.file_name)).toEqual(["old0.csv", "old1.csv"]);
  });
});

describe("outboxReadmeLines", () => {
  it("one numbered line per file under its group, chunk parts labelled, pacing rule stated", () => {
    const files = planOutboxFiles(
      [
        { type: "Strain", csv: mk("Strain", ["413541,Blue Dream,Hybrid,G,10/07/2026"]) },
        { type: "Inventory", csv: mk("Inventory", [inv("A", "Update"), inv("B", "Update"), inv("C", "Update")]) },
      ],
      { ...OPTS, chunkRows: 2 },
    );
    const lines = outboxReadmeLines(files, files.map((f) => f.fileName));
    expect(lines).toContain("  Group 1:");
    expect(lines).toContain("  Group 2:");
    expect(lines.some((l) => l.includes("2. Inventory_413541_20261007120001.csv — 2 record(s) (part 1 of 2)"))).toBe(true);
    expect(lines.join("\n")).toMatch(/CCRS Processing Successful/);
    expect(() => outboxReadmeLines(files, [])).toThrow();
  });
});

describe("route wiring (source anchors)", () => {
  const ROUTE = readFileSync(join(__dirname, "../../src/app/admin/reports/compliance/batch-export/route.ts"), "utf8");
  it("maxDuration is on the route segment; env param; plan → verify → emit before the zip", () => {
    expect(ROUTE).toContain("export const maxDuration = 300;");
    expect(ROUTE).toContain('parseLedgerEnv(url.searchParams.get("env"))');
    const iPlan = ROUTE.indexOf("planOutboxFiles(");
    const iVerify = ROUTE.indexOf("verifyOutboxAgainstLedger(");
    const iEmit = ROUTE.indexOf("emitOutboxFiles(");
    const iZip = ROUTE.indexOf("buildZip(");
    expect(iPlan).toBeGreaterThan(0);
    expect(iPlan).toBeLessThan(iVerify);
    expect(iVerify).toBeLessThan(iEmit);
    expect(iEmit).toBeLessThan(iZip);
  });
  it("zip entries are the exact CCRS names (no NN_ prefix) and duplicates come from stored bytes", () => {
    expect(ROUTE).not.toMatch(/padStart\(2, "0"\)\}_\$\{f\.fileName\}/);
    expect(ROUTE).toContain("readStoredFile(admin, r.id)");
  });
  it("ledger problems refuse the export (409) with every row listed", () => {
    expect(ROUTE).toMatch(/if \(problems\.length > 0\) \{\s*return refuse\(/);
    expect(ROUTE).toContain("...problems.map(");
  });
});

describe("embedded self-test", () => {
  it("passes", () => {
    expect(() => __runCcrsOutboxCoreTests()).not.toThrow();
  });
});
