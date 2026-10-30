/**
 * W-3 (2026-10-30): a record already in a file still waiting for its CCRS
 * answer is never sent a second time, for EVERY file type; InventoryAdjustment
 * rows are routed against the ledger like every other type.
 *
 * Grounding: the external identifier "must be unique for each row" and an
 * Insert creates "a new record with a unique external identifier"
 * [G L0219-L0221, G L0246-L0248]; "Duplicate Sale detail item for Licensee"
 * [G L1412]. Evidence: docs/ccrs-bible/evidence/2026-10-25-reupload/README.md
 * (a re-upload came back "Duplicate External Identifier" for Product,
 * Inventory and the three ADJ- rows, and "Duplicate Sale" for every line).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CCRS_COLUMNS } from "../../src/lib/compliance/ccrs-batch-core";
import { buildLedgerView, type LedgerPlan, type LedgerState, type PlannedLot, type PlannedProduct } from "../../src/lib/compliance/ccrs-ledger-core";
import {
  IN_FLIGHT_HOLD_PREFIX,
  adjustmentInsertIds,
  applyInflightHolds,
  indexInflightInserts,
  inflightHeldMessage,
  inflightProductLotReason,
  inflightReason,
  isInflightHoldReason,
  routeAdjustmentRows,
} from "../../src/lib/compliance/ccrs-inflight-hold-core";
import { classifyWithholdReason, isWithholdIssue, nextStepFor } from "../../src/lib/compliance/ccrs-issue-display-core";
import { CCRS_ISSUE_CODES, specPinFor } from "../../src/lib/compliance/ccrs-preflight-core";
import { HELD_BACK_CODES, assertCcrsBatchSubmittable } from "../../src/lib/compliance/ccrs-submit-gate-core";
import { unansweredWarningLines } from "../../src/lib/compliance/ccrs-answer-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const plan = (products: [string, PlannedProduct][], lots: [string, PlannedLot][]): LedgerPlan => ({
  strainEmit: new Set(),
  strainCanonical: new Map(),
  strainCaseVariants: [],
  products: new Map(products),
  renames: new Map(),
  lots: new Map(lots),
  nameFromLedger: [],
});

describe("indexInflightInserts: which ids a waiting file already Inserts", () => {
  it("indexes Product / Inventory / InventoryAdjustment Inserts only (null = Insert, as 0249 does)", () => {
    const idx = indexInflightInserts([
      { fileType: "Product", fileName: "P1.csv", externalId: "GWP-1", operation: "Insert" },
      { fileType: "Product", fileName: "P1.csv", externalId: "GWP-2", operation: "Update" },
      { fileType: "Product", fileName: "P1.csv", externalId: "GWP-3", operation: "Delete" },
      { fileType: "InventoryAdjustment", fileName: "A1.csv", externalId: " ADJ-9 ", operation: null },
      { fileType: "Sale", fileName: "S1.csv", externalId: "D1", operation: "Insert" },
      { fileType: "InventoryTransfer", fileName: "T1.csv", externalId: "L1", operation: "Insert" },
    ]);
    expect([...idx.keys()].sort()).toEqual(["InventoryAdjustment\u0000ADJ-9", "Product\u0000GWP-1"]);
  });
  it("the oldest waiting file is named (read order = stamp order)", () => {
    const idx = indexInflightInserts([
      { fileType: "Inventory", fileName: "Old.csv", externalId: "L1", operation: "Insert" },
      { fileType: "Inventory", fileName: "New.csv", externalId: "L1", operation: "Insert" },
    ]);
    expect(idx.get("Inventory\u0000L1")).toBe("Old.csv");
  });
});

describe("applyInflightHolds: Product / Inventory Inserts in a waiting file are held", () => {
  const view = buildLedgerView("prod", [{ fileType: "Product", externalId: "GWP-F", filedName: "Filed", state: "filed" }]).view;
  const idx = indexInflightInserts([
    { fileType: "Product", fileName: "Product_A.csv", externalId: "GWP-1", operation: "Insert" },
    { fileType: "Inventory", fileName: "Inventory_A.csv", externalId: "L-2", operation: "Insert" },
  ]);
  const p = plan(
    [
      ["k1", { action: "emit", op: "Insert", ext: "GWP-1" }],
      ["kF", { action: "emit", op: "Update", ext: "GWP-F" }],
      // an Update of an id a waiting file Inserts: re-sending an Update is harmless (R6-3)
      ["kU", { action: "emit", op: "Update", ext: "GWP-1" }],
    ],
    [
      ["l1", { action: "emit", op: "Insert", productName: "New", strain: "" }],
      ["l2", { action: "emit", op: "Insert", productName: "Filed", strain: "" }],
      ["l3", { action: "emit", op: "Update", productName: "Filed", strain: "" }],
    ],
  );
  const lots = [
    { lotId: "l1", productKey: "k1", ext: "L-1" },
    { lotId: "l2", productKey: "kF", ext: "L-2" },
    { lotId: "l3", productKey: "k1", ext: "L-3" },
  ];
  const h = applyInflightHolds({ plan: p, view, index: idx, lots });
  it("holds the product Insert and the lot whose product name CCRS does not hold yet", () => {
    expect(h.plan.products.get("k1")).toEqual({ action: "withhold", reason: inflightReason("Product_A.csv") });
    expect(h.plan.lots.get("l1")).toEqual({ action: "withhold", reason: inflightProductLotReason("Product_A.csv") });
    expect(h.lots.find((x) => x.lotId === "l1")?.dependent).toBe(true);
  });
  it("holds a lot Insert in a waiting file", () => {
    expect(h.plan.lots.get("l2")).toEqual({ action: "withhold", reason: inflightReason("Inventory_A.csv") });
  });
  it("never holds an Update, nor a lot that names the FILED product name", () => {
    expect(h.plan.products.get("kF")?.action).toBe("emit");
    expect(h.plan.products.get("kU")?.action).toBe("emit");
    expect(h.products.map((x) => x.key)).toEqual(["k1"]);
    expect(h.plan.lots.get("l3")?.action).toBe("emit");
  });
  it("legacy (no ledger view) and nothing waiting change nothing", () => {
    expect(applyInflightHolds({ plan: p, view: null, index: idx, lots }).plan).toBe(p);
    expect(applyInflightHolds({ plan: p, view, index: new Map(), lots }).products).toEqual([]);
  });
});

describe("routeAdjustmentRows: ADJ- rows are routed against the ledger (the 2026-10-25 duplicates)", () => {
  const A = CCRS_COLUMNS.InventoryAdjustment;
  const row = (id: string, op = "Insert") => A.map((c) => (c === "ExternalIdentifier" ? id : c === "Operation" ? op : "v"));
  const idOf = (r: string[]) => r[A.indexOf("ExternalIdentifier")];
  it("held by CCRS -> skipped; unproven -> held back; in a waiting file -> held; new -> sent", () => {
    const held = new Map<string, LedgerState>([
      ["ADJ-1", "confirmed"],
      ["ADJ-2", "uncertain"],
    ]);
    const idx = indexInflightInserts([{ fileType: "InventoryAdjustment", fileName: "Adj_W.csv", externalId: "ADJ-3", operation: "Insert" }]);
    const r = routeAdjustmentRows([row("ADJ-1"), row("ADJ-2"), row("ADJ-3"), row("ADJ-4")], held, idx);
    expect(r.rows.map(idOf)).toEqual(["ADJ-4"]);
    expect(r.alreadyHeld).toEqual([{ id: "ADJ-1", state: "confirmed" }]);
    expect(r.uncertain).toEqual([{ id: "ADJ-2", state: "uncertain" }]);
    expect(r.inFlight).toEqual([{ id: "ADJ-3", file: "Adj_W.csv" }]);
  });
  it("adjustmentInsertIds reads each Insert id once", () => {
    expect(adjustmentInsertIds([row("ADJ-1"), row("ADJ-1"), row("ADJ-2", "Update")])).toEqual(["ADJ-1"]);
  });
});

describe("issues: E61 is advisory (sent, not owed); E62 errors are held back and owed", () => {
  it("codes are registered with a guide pin", () => {
    expect(CCRS_ISSUE_CODES).toContain("E61_IN_FLIGHT_HELD");
    expect(CCRS_ISSUE_CODES).toContain("E62_ADJUSTMENT_LEDGER");
    expect(specPinFor("E61_IN_FLIGHT_HELD")).toBe("[G L0219-L0221]");
    expect(specPinFor("E62_ADJUSTMENT_LEDGER")).toBe("[G L0219-L0221]");
  });
  it("E61 is NOT a held-back (owed) code; E62 is", () => {
    expect(HELD_BACK_CODES.has("E61_IN_FLIGHT_HELD")).toBe(false);
    expect(HELD_BACK_CODES.has("E62_ADJUSTMENT_LEDGER")).toBe(true);
  });
  it("neither blocks the batch", () => {
    const v = assertCcrsBatchSubmittable({
      syncIssues: [
        { severity: "warning", file: "Sale", message: inflightHeldMessage("Sale", 1, ["S.csv"]), code: "E61_IN_FLIGHT_HELD", rows: [{ id: "D1", label: "D1" }] },
        { severity: "error", file: "InventoryAdjustment", message: "held", code: "E62_ADJUSTMENT_LEDGER", rows: [{ id: "ADJ-2", label: "ADJ-2" }] },
      ],
      verifierProblems: [],
      files: [],
    });
    expect(v.submittable).toBe(true);
    expect(v.heldCount).toBe(1);
  });
  it("the hub groups E61 rows with their own class and next step", () => {
    expect(isWithholdIssue({ code: "E61_IN_FLIGHT_HELD" })).toBe(true);
    expect(classifyWithholdReason(`GWP-1: ${inflightReason("P.csv")}`)).toBe("in-flight");
    expect(classifyWithholdReason(inflightProductLotReason("P.csv"))).toBe("in-flight");
    expect(isInflightHoldReason(`x ${IN_FLIGHT_HOLD_PREFIX} y`)).toBe(true);
    for (const env of ["prod", "preprod"] as const) expect(nextStepFor("in-flight", env)).toMatch(/Abandon/);
  });
  it("the message says nothing is owed and how to recover a lost file", () => {
    const m = inflightHeldMessage("InventoryAdjustment", 3, ["B.csv", "A.csv"]);
    expect(m).toMatch(/^3 adjustment\(s\) were left out of InventoryAdjustment\.csv/);
    expect(m).toContain("(A.csv, B.csv)");
    expect(m).toContain("Nothing is owed");
    expect(m).toContain("download it again from the CCRS file list");
  });
  it("the unanswered-files warning names every held type and keeps Abandon", () => {
    const w = unansweredWarningLines([{ fileName: "Product_1.csv", state: "uploaded", fileType: "Product", stampAt: "2026-10-30T10:00:00Z" }]).join(" ");
    expect(w).toMatch(/products, lots, sale lines and adjustments/);
    expect(w).toContain("Abandon");
  });
});

describe("wiring (source pins): the builder applies every W-3 hold", () => {
  const b = read("src/lib/compliance/ccrs-batch.ts");
  const store = read("src/lib/compliance/ccrs-ledger-store.ts");
  it("reads the waiting files' ids beside the Strain/Area rows; a failed read only warns", () => {
    expect(b).toMatch(/Promise\.allSettled\(\[readInflightMasterRows\(admin, env\), readInflightIdRows\(admin, env\)\]\)/);
    expect(b).toMatch(/inflightIndex = indexInflightInserts\(idRead\.value\)/);
  });
  it("applies the Product / Inventory hold after the fix holds and reports it once (E61, not E41)", () => {
    expect(b).toMatch(/applyInflightHolds\(\{\s*plan: holdResult\.plan,/);
    expect(b).toMatch(/const plan = inflightHold\.plan;/);
    expect(b).toMatch(/if \(isInflightHoldReason\(planned\.reason\)\) continue;/);
  });
  it("Sale lines in a waiting file are held (inFlightOnly passed through)", () => {
    expect(b).toMatch(/routeSaleInserts\(sale\.rows, saleSlice\.held, saleSlice\.inFlightOnly\)/);
  });
  it("adjustments are routed against the ledger; an unreadable ledger holds the Inserts back", () => {
    expect(b).toMatch(/loadAdjustmentLedger\(admin, env, adjustmentInsertIds\(adjRows\)\)/);
    expect(b).toMatch(/routeAdjustmentRows\(adjRows, adjHeld, inflightIndex\)/);
    expect(b).toMatch(/dropEventRowsForHeldLots\("InventoryAdjustment", adjRows,/);
  });
  it("store readers never cap silently and throw on an incomplete read", () => {
    expect(store).toMatch(/export async function readInflightIdRows/);
    expect(store).toMatch(/more than 200 Product\/Inventory\/InventoryAdjustment files are waiting/);
    expect(store).toMatch(/\.limit\(201\);/);
    expect(store).toMatch(/if \(\(data\?\.length \?\? 0\) > 200\) throw new Error\(/);
    expect(store).toMatch(/if \(!verdict\.complete\) throw new Error\(`ccrs_file_rows/);
    expect(store).toMatch(/export async function loadAdjustmentLedger/);
    expect(store).toMatch(/unknown state/);
  });
});
