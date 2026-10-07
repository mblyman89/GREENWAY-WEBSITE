/**
 * S-13 — the Area file planned over the CCRS ledger (Bible v2 Part 07 S-13,
 * Part 04 §B, gap E23). Tests first, oracle written by hand from the LCB
 * delivery (analysis2/sheets/Area.csv, 2026-09-18; cross-checked against the
 * real file below where it exists) and the Guide:
 *   [G L0246-L0248] Insert / Update / Delete
 *   [G L0298-L0299] IsQuarantine must be False for cannabis
 *   [BRIAN A11] Delete the unused, keep the most recent Sales Floor
 *   [BRIAN A12] Inventory.Area joins to the most recently ingested record
 *   D-03 keep C1100011–14, retire C1-11021100011–14 + A65303
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PREPROD_AREA_PLAN,
  PROD_AREA_PLAN,
  SALES_FLOOR_AREA,
  __runCcrsAreaCoreTests,
  areaPlanFor,
  isHeldLotStatus,
  mintAreaId,
  planAreaFile,
  type AreaPlanConfig,
} from "@/lib/compliance/ccrs-area-core";
import { buildLedgerView, type LedgerEntry, type LedgerState } from "@/lib/compliance/ccrs-ledger-core";
import { assembleCcrsFile, CCRS_COLUMNS, verifyCcrsFile } from "@/lib/compliance/ccrs-batch-core";
import { planOutboxFiles, verifyOutboxAgainstLedger } from "@/lib/compliance/ccrs-outbox-core";
import { buildLedgerSeed, SEED_HEADERS } from "@/lib/compliance/ccrs-ledger-seed-core";
import { CCRS_ISSUE_CODES, specPinFor } from "@/lib/compliance/ccrs-preflight-core";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/** The 9 Areas CCRS holds for 413541 (Area.csv, read 2026-10-05). */
const SEEDED: [string, string][] = [
  ["A65303", "A65303 - Default Inventory Room"],
  ["C1100011", "Sales Floor"],
  ["C1100012", "Incoming Orders"],
  ["C1100013", "POS Returns"],
  ["C1100014", "Vendor Returns"],
  ["C1-11021100011", "Sales Floor"],
  ["C1-11021100012", "Incoming Orders"],
  ["C1-11021100013", "POS Returns"],
  ["C1-11021100014", "Vendor Returns"],
];
const area = (id: string, name: string, state: LedgerState = "seed"): LedgerEntry => ({ fileType: "Area", externalId: id, filedName: name, state });
const viewOf = (entries: LedgerEntry[], env: "prod" | "preprod" = "prod") => buildLedgerView(env, entries).view;
const seededView = (over: Record<string, LedgerState> = {}) => viewOf(SEEDED.map(([id, n]) => area(id, n, over[id] ?? "seed")));
const DELETE_MODE: AreaPlanConfig = { ...PROD_AREA_PLAN, mode: "delete" };
const base = { license: "413541", by: "Greenway Marijuana", date: "10/08/2026" };
const C = CCRS_COLUMNS.Area;
const col = (r: string[], c: string) => r[C.indexOf(c)];
const ops = (rows: string[][]) => rows.map((r) => `${col(r, "Operation")} ${col(r, "ExternalIdentifier")}`);

describe("S-13 D-03 configuration", () => {
  it("keeps set C and retires C1- + A65303 (D-03), disjoint, all 9 ids covered", () => {
    expect([...PROD_AREA_PLAN.keep]).toEqual(["C1100011", "C1100012", "C1100013", "C1100014"]);
    expect([...PROD_AREA_PLAN.retire]).toEqual(["A65303", "C1-11021100011", "C1-11021100012", "C1-11021100013", "C1-11021100014"]);
    expect([...PROD_AREA_PLAN.keep, ...PROD_AREA_PLAN.retire].sort()).toEqual(SEEDED.map(([id]) => id).sort());
  });
  it("production is UPDATE-ONLY until P-02 proves an Area Delete (U-31 open)", () => {
    expect(PROD_AREA_PLAN.mode).toBe("update-only");
    expect(Object.isFrozen(PROD_AREA_PLAN)).toBe(true);
    expect(read("docs/ccrs-bible/12-unverified-register.md")).toMatch(/\| U-31 \|[^\n]*\| OPEN/);
  });
  it("PREprod retires and keeps nothing; env picks the plan", () => {
    expect(areaPlanFor("prod")).toBe(PROD_AREA_PLAN);
    expect(areaPlanFor("preprod")).toBe(PREPROD_AREA_PLAN);
    expect(PREPROD_AREA_PLAN.keep).toEqual([]);
    expect(PREPROD_AREA_PLAN.retire).toEqual([]);
  });
});

describe("S-13 planAreaFile — delete mode (the plan's 'tests first' case)", () => {
  const p = planAreaFile({ view: seededView(), config: DELETE_MODE, ...base });
  it("9 seeded Areas, keep C → 5 Delete + 4 Update, no Insert", () => {
    expect(ops(p.rows)).toEqual([
      "Delete A65303",
      "Delete C1-11021100011",
      "Delete C1-11021100012",
      "Delete C1-11021100013",
      "Delete C1-11021100014",
      "Update C1100011",
      "Update C1100012",
      "Update C1100013",
      "Update C1100014",
    ]);
    expect(p.summary).toEqual({ inserts: 0, updates: 4, deletes: 5, retirementPending: true });
    expect(p.problems).toEqual([]);
  });
  it("IsQuarantine FALSE on every row [G L0298-L0299]; names are the FILED names byte-for-byte", () => {
    expect(p.rows.every((r) => col(r, "IsQuarantine") === "FALSE")).toBe(true);
    const name = new Map(SEEDED);
    for (const r of p.rows) expect(col(r, "Area")).toBe(name.get(col(r, "ExternalIdentifier")));
  });
  it("Update/Delete rows carry UpdatedBy/UpdatedDate; every row has the 9 columns", () => {
    for (const r of p.rows) {
      expect(r).toHaveLength(C.length);
      expect(col(r, "LicenseNumber")).toBe("413541");
      expect(col(r, "UpdatedBy")).toBe("Greenway Marijuana");
      expect(col(r, "UpdatedDate")).toBe("10/08/2026");
    }
  });
  it("Inventory uses the surviving Sales Floor name", () => {
    expect(p.inventoryAreaName).toBe(SALES_FLOOR_AREA);
    expect(SALES_FLOOR_AREA).toBe("Sales Floor");
  });
  it("after the Deletes land (5 deleted) → nothing to emit; the empty file is skipped", () => {
    const after = planAreaFile({
      view: seededView(Object.fromEntries(PROD_AREA_PLAN.retire.map((id) => [id, "deleted" as LedgerState]))),
      config: DELETE_MODE,
      ...base,
    });
    expect(after.rows).toEqual([]);
    expect(after.problems).toEqual([]);
    expect(after.summary.retirementPending).toBe(false);
    const csv = assembleCcrsFile({ type: "Area", submittedBy: "G", submittedDate: new Date("2026-10-07T17:00:00Z"), rows: after.rows });
    expect(planOutboxFiles([{ type: "Area", csv }], { licenseNumber: "413541", now: new Date("2026-10-07T17:00:00Z"), lastStamp: null })).toEqual([]);
  });
  it("a partly landed retirement Deletes only what CCRS still holds, and still refreshes C", () => {
    const q = planAreaFile({ view: seededView({ A65303: "deleted", "C1-11021100011": "deleted" }), config: DELETE_MODE, ...base });
    expect(ops(q.rows)).toEqual(["Delete C1-11021100012", "Delete C1-11021100013", "Delete C1-11021100014", "Update C1100011", "Update C1100012", "Update C1100013", "Update C1100014"]);
  });
  it("passes the outbox ledger self-check (no L_DELETE_NOT_ON_FILE / L_UPDATE_NOT_ON_FILE) and the file verifier", () => {
    const at = new Date("2026-10-07T17:00:00Z");
    const csv = assembleCcrsFile({ type: "Area", submittedBy: "Greenway Marijuana", submittedDate: at, rows: p.rows });
    expect(verifyCcrsFile("Area", csv).filter((x) => x.severity === "error")).toEqual([]);
    const planned = planOutboxFiles([{ type: "Area", csv }], { licenseNumber: "413541", now: at, lastStamp: null });
    expect(verifyOutboxAgainstLedger(seededView(), planned)).toEqual([]);
  });
});

describe("S-13 planAreaFile — update-only mode (production default; U-31 refused case)", () => {
  const p = planAreaFile({ view: seededView(), config: PROD_AREA_PLAN, ...base });
  it("4 Update of set C, no Delete, no Insert", () => {
    expect(ops(p.rows)).toEqual(["Update C1100011", "Update C1100012", "Update C1100013", "Update C1100014"]);
    expect(p.summary).toEqual({ inserts: 0, updates: 4, deletes: 0, retirementPending: true });
    expect(p.problems).toEqual([]);
  });
  it("the Updates repeat while the retired set is on file (an Update of an existing record is harmless [G L0247])", () => {
    expect(planAreaFile({ view: seededView(), config: PROD_AREA_PLAN, ...base }).rows).toEqual(p.rows);
  });
  it("an Inventory row naming Sales Floor passes L_REF_AREA (CCRS holds it)", () => {
    const at = new Date("2026-10-07T17:00:00Z");
    const inv = [["413541", "", "Sales Floor", "X", "1", "1", "1.00", "FALSE", "L1", "G", "10/08/2026", "", "", "Insert"]];
    const files = planOutboxFiles(
      [
        { type: "Area", csv: assembleCcrsFile({ type: "Area", submittedBy: "G", submittedDate: at, rows: p.rows }) },
        { type: "Inventory", csv: assembleCcrsFile({ type: "Inventory", submittedBy: "G", submittedDate: at, rows: inv }) },
      ],
      { licenseNumber: "413541", now: at, lastStamp: null },
    );
    expect(verifyOutboxAgainstLedger(seededView(), files).filter((x) => x.code === "L_REF_AREA")).toEqual([]);
  });
});

describe("S-13 planAreaFile — when every name is filed and nothing is pending → empty", () => {
  it("no retire list, kept set on file → emits nothing", () => {
    const cfg: AreaPlanConfig = { keep: ["C1100011"], retire: [], mode: "delete" };
    const p = planAreaFile({ view: viewOf([area("C1100011", "Sales Floor", "confirmed")]), config: cfg, ...base });
    expect(p.rows).toEqual([]);
    expect(p.problems).toEqual([]);
  });
  it("PREprod with a filed run Sales Floor → emits nothing", () => {
    const p = planAreaFile({ view: viewOf([area("GWA-SALES-FLOOR", "Sales Floor", "filed")], "preprod"), config: PREPROD_AREA_PLAN, ...base });
    expect(p.rows).toEqual([]);
  });
});

describe("S-13 planAreaFile — a needed name with no surviving record → one Insert (D-01a GWA-)", () => {
  it("PREprod ledger started but empty → Insert GWA-SALES-FLOOR, FALSE", () => {
    const p = planAreaFile({ view: viewOf([], "preprod"), config: PREPROD_AREA_PLAN, ...base });
    expect(p.rows).toEqual([["413541", "Sales Floor", "FALSE", "GWA-SALES-FLOOR", "Greenway Marijuana", "10/08/2026", "", "", "Insert"]]);
    expect(p.summary.inserts).toBe(1);
  });
  it("delete mode with Sales Floor held ONLY by a retired id → Insert (the Delete removes the join target)", () => {
    const cfg: AreaPlanConfig = { keep: [], retire: ["OLD1"], mode: "delete" };
    const p = planAreaFile({ view: viewOf([area("OLD1", "Sales Floor")]), config: cfg, ...base });
    expect(ops(p.rows)).toEqual(["Delete OLD1", "Insert GWA-SALES-FLOOR"]);
  });
  it("update-only mode with Sales Floor held only by a retired id → no Insert (the record survives)", () => {
    const cfg: AreaPlanConfig = { keep: [], retire: ["OLD1"], mode: "update-only" };
    const p = planAreaFile({ view: viewOf([area("OLD1", "Sales Floor")]), config: cfg, ...base });
    expect(p.rows).toEqual([]);
  });
  it("a Deleted id is never re-used: GWA-SALES-FLOOR deleted → GWA-SALES-FLOOR-2", () => {
    const p = planAreaFile({ view: viewOf([area("GWA-SALES-FLOOR", "Sales Floor", "deleted")], "preprod"), config: PREPROD_AREA_PLAN, ...base });
    expect(ops(p.rows)).toEqual(["Insert GWA-SALES-FLOOR-2"]);
    const q = planAreaFile({ view: viewOf([area("GWA-SALES-FLOOR", "X", "deleted"), area("GWA-SALES-FLOOR-2", "Y", "deleted")], "preprod"), config: PREPROD_AREA_PLAN, ...base });
    expect(ops(q.rows)).toEqual(["Insert GWA-SALES-FLOOR-3"]);
  });
  it("a record of that name in an UNPROVEN state blocks a new one (never guess)", () => {
    for (const s of ["uncertain", "unknown"] as const) {
      const p = planAreaFile({ view: viewOf([area("Z9", "Sales Floor", s)], "preprod"), config: PREPROD_AREA_PLAN, ...base });
      expect(p.rows).toEqual([]);
      expect(p.problems).toEqual([expect.objectContaining({ severity: "error", id: "Z9" })]);
    }
  });
});

describe("S-13 planAreaFile — the ledger contradicts D-03 → blocking problem, never a guessed row", () => {
  it("a retired id CCRS does not hold → error, no Delete", () => {
    const p = planAreaFile({ view: viewOf(SEEDED.filter(([id]) => id !== "A65303").map(([id, n]) => area(id, n))), config: DELETE_MODE, ...base });
    expect(p.rows.some((r) => col(r, "ExternalIdentifier") === "A65303")).toBe(false);
    expect(p.problems).toEqual([expect.objectContaining({ severity: "error", id: "A65303" })]);
    expect(p.problems[0].detail).toBe("retired Area A65303 is not in the CCRS ledger");
  });
  it("a kept id uncertain → error, no Update for it", () => {
    const p = planAreaFile({ view: seededView({ C1100012: "uncertain" }), config: PROD_AREA_PLAN, ...base });
    expect(ops(p.rows)).toEqual(["Update C1100011", "Update C1100013", "Update C1100014"]);
    expect(p.problems).toEqual([expect.objectContaining({ severity: "error", id: "C1100012" })]);
  });
  it("a retired id uncertain → error (in both modes), others still go", () => {
    for (const cfg of [DELETE_MODE, PROD_AREA_PLAN]) {
      const p = planAreaFile({ view: seededView({ "C1-11021100013": "uncertain" }), config: cfg, ...base });
      expect(p.problems.map((x) => x.id)).toEqual(["C1-11021100013"]);
      expect(p.problems[0].detail).toBe('retired Area C1-11021100013 is in state "uncertain"; reconcile it first');
    }
  });
  it("a kept id with no filed name → error", () => {
    const v = viewOf(SEEDED.map(([id, n]) => ({ ...area(id, n), filedName: id === "C1100014" ? null : n })));
    const p = planAreaFile({ view: v, config: PROD_AREA_PLAN, ...base });
    expect(p.problems).toEqual([expect.objectContaining({ id: "C1100014" })]);
  });
  it("an id both kept and retired throws (config fault)", () => {
    expect(() => planAreaFile({ view: seededView(), config: { keep: ["A65303"], retire: ["A65303"], mode: "delete" }, ...base })).toThrow(/both kept and retired/);
  });
  it("two surviving records share Sales Floor and neither is refreshed → advisory warning naming both", () => {
    const cfg: AreaPlanConfig = { keep: [], retire: [], mode: "delete" };
    const p = planAreaFile({ view: viewOf([area("A", "Sales Floor"), area("B", "Sales Floor")]), config: cfg, ...base });
    expect(p.rows).toEqual([]);
    expect(p.problems).toEqual([expect.objectContaining({ severity: "warning", id: "Sales Floor" })]);
    expect(p.problems[0].detail).toContain("A, B");
  });
  it("update-only with both Sales Floors present: refreshed here → no advisory", () => {
    expect(planAreaFile({ view: seededView(), config: PROD_AREA_PLAN, ...base }).problems).toEqual([]);
  });
});

describe("S-13 planAreaFile — no ledger (legacy, not recorded)", () => {
  it("production: emits nothing (CCRS already holds Sales Floor; an Insert would be E23)", () => {
    expect(planAreaFile({ view: null, config: PROD_AREA_PLAN, ...base }).rows).toEqual([]);
  });
  it("PREprod not started: one self-consistent Insert, FALSE", () => {
    expect(planAreaFile({ view: null, config: PREPROD_AREA_PLAN, ...base }).rows).toEqual([
      ["413541", "Sales Floor", "FALSE", "GWA-SALES-FLOOR", "Greenway Marijuana", "10/08/2026", "", "", "Insert"],
    ]);
  });
});

describe("S-13 helpers", () => {
  it("mintAreaId (D-01a GWA-<slug>)", () => {
    expect(mintAreaId("Sales Floor")).toBe("GWA-SALES-FLOOR");
    expect(mintAreaId("P20261008A Sales Floor")).toBe("GWA-P20261008A-SALES-FLOOR");
    expect(mintAreaId("a / b")).toBe("GWA-A-B");
    expect(() => mintAreaId(" - ")).toThrow();
  });
  it("isHeldLotStatus over the 0023 enum", () => {
    expect(["active", "quarantine", "recalled", "sold_out", "destroyed"].map(isHeldLotStatus)).toEqual([false, true, true, false, false]);
    expect(isHeldLotStatus(null)).toBe(false);
  });
  it("embedded self-tests pass", () => {
    expect(() => __runCcrsAreaCoreTests()).not.toThrow();
  });
  it("E45 / E46 registered with Guide pins", () => {
    expect(CCRS_ISSUE_CODES).toEqual(expect.arrayContaining(["E45_HELD_LOT_NOT_AN_AREA", "E46_AREA_LEDGER"]));
    expect(specPinFor("E45_HELD_LOT_NOT_AN_AREA")).toBe("[G L0298-L0299]");
    expect(specPinFor("E46_AREA_LEDGER")).toBe("[G L0246-L0248]");
  });
});

describe("S-13 wiring in ccrs-batch.ts", () => {
  const BATCH = read("src/lib/compliance/ccrs-batch.ts");
  it("the literals are gone; no quarantine Area; no TRUE IsQuarantine", () => {
    expect(BATCH).not.toContain('"AREA-SALES-FLOOR"');
    expect(BATCH).not.toContain('"AREA-QUARANTINE"');
    expect(BATCH).not.toContain('? "Quarantine" : "Sales Floor"');
    expect(BATCH).not.toContain("hasQuarantine");
  });
  it("Area file is the core plan for the batch env; Inventory uses its area name; Area issues reach the gate", () => {
    expect(BATCH).toContain("const plan = planAreaFile({ view: ledger, config: areaPlanFor(env), license, by: createdBy, date: createdDate });");
    expect(BATCH).toContain("const area = buildAreaFile(env, license.licenseNumber, createdBy, createdDate, ledger);");
    expect(BATCH).toContain("buildInventoryFile(lots, license.licenseNumber, createdBy, plan, area.inventoryAreaName);");
    expect(BATCH).toContain("    const area = areaName;");
    expect(BATCH).toContain("syncIssues.push(...strain.issues, ...area.issues, ...product.issues, ...inventory.issues);");
    expect(BATCH).toContain('push("Area", area.rows, area.warnings);');
  });
  it("a held lot raises the E45 advisory (warning, never a block) with its row", () => {
    expect(BATCH).toContain("if (isHeldLotStatus(l.status)) e45Rows.push(");
    expect(BATCH).toMatch(/severity: "warning",\s+file: "Inventory",\s+code: "E45_HELD_LOT_NOT_AN_AREA"/);
  });
  it("an E46 error is blocking, a duplicate-name E46 is a warning", () => {
    expect(BATCH).toContain('for (const severity of ["error", "warning"] as const) {');
    expect(BATCH).toContain('code: "E46_AREA_LEDGER",');
  });
});

// ── The real delivery (only where the file exists: the owner's sandbox) ───────
const REAL_AREA = "/workspace/analysis2/sheets/Area.csv";
describe.skipIf(!existsSync(REAL_AREA))("S-13 against the real 2026-09-18 Area delivery", () => {
  it("the hand-written oracle equals the delivery, and the seeded ledger plans exactly 4 Update (prod default)", () => {
    const text = readFileSync(REAL_AREA, "utf8");
    const hdr = SEED_HEADERS;
    const empty = (t: keyof typeof hdr) => hdr[t].join(",") + "\r\n";
    const { entities } = buildLedgerSeed({ Inventory: empty("Inventory"), Product: empty("Product"), Strain: empty("Strain"), Area: text });
    const areas = entities.filter((e) => e.fileType === "Area").map((e) => [e.externalId, e.filedName] as [string, string]);
    expect(areas.sort()).toEqual([...SEEDED].sort());
    const v = viewOf(areas.map(([id, n]) => area(id, n)));
    expect(ops(planAreaFile({ view: v, config: PROD_AREA_PLAN, ...base }).rows)).toEqual(["Update C1100011", "Update C1100012", "Update C1100013", "Update C1100014"]);
    expect(planAreaFile({ view: v, config: DELETE_MODE, ...base }).summary).toEqual({ inserts: 0, updates: 4, deletes: 5, retirementPending: true });
  });
});
