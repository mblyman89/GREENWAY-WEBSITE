/**
 * tests/compliance/r6-3-inventory-unchanged.test.ts   (Round 6 / Slice R6-3)
 *
 * Inventory.csv sends only what changed. Until R6-3 every live lot CCRS holds
 * went out as an Update EVERY week. The LCB:
 *
 *   - "Inventory.CSV is required weekly by any licensed facility that owns the
 *     inventory, only when inventory exists that is unreported, or unreported
 *     updates to an existing inventory. No report is needed if there are no
 *     changes." [G L0525-L0527]
 *   - "if there is nothing new to report, there is no report to submit"
 *     [FAQ L0049]
 *   - UpdatedBy "the user who subsequently updated a file", UpdatedDate "the
 *     date that the file was modified", "Updated Date cannot be prior to
 *     Created Date." [G L0234-L0242]
 *
 * The SQL (0286) is proven on Postgres by
 * scripts/recon/ccrs-inventory-told-0286-pg-check.sql (CI: POST_APPLY_CHECKS);
 * this file pins the pure planner, the batch wiring and the spec quotes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CCRS_COLUMNS } from "@/lib/compliance/ccrs-batch-core";
import { CCRS_ISSUE_CODES, specPinFor } from "@/lib/compliance/ccrs-preflight-core";
import {
  COMPARED_COLUMNS,
  INVENTORY_TOLD_RPC,
  __runInventoryDeltaTests,
  changedColumns,
  decodeInventoryTold,
  lotsNamedByEventRows,
  planInventoryDelta,
  updatedDateFor,
  type InventoryTold,
  type InventoryToldOutcome,
} from "@/lib/compliance/ccrs-inventory-delta-core";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";

const ROOT = path.resolve(__dirname, "../..");
const SRC = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const PART02 = SRC("docs/ccrs-bible/02-authoritative-spec.md");

function part02Line(heading: string, pin: string): string {
  const start = PART02.indexOf(heading);
  expect(start).toBeGreaterThan(-1);
  const rest = PART02.slice(start);
  const next = rest.indexOf("\n## ", 5);
  const section = next > 0 ? rest.slice(0, next) : rest;
  const line = section.split("\n").find((l) => l.startsWith(`${pin}|`));
  expect(line, `${heading} ${pin}`).toBeDefined();
  return line as string;
}
const G = (pin: string) => part02Line("## 1. CCRS Upload User Guide", pin);
const FAQ = (pin: string) => part02Line("## 2. CCRS FAQ", pin);

const COLS = CCRS_COLUMNS.Inventory;
const at = (name: string) => COLS.indexOf(name);
const DEFAULTS: Record<string, string> = {
  LicenseNumber: "413541", Strain: "Blue Flame", Area: "Sales Floor", Product: "Pastime Blue Flame Flower 3.5g",
  InitialQuantity: "24", QuantityOnHand: "10", TotalCost: "120.00", IsMedical: "FALSE",
  CreatedBy: "Michael Lyman", CreatedDate: "10/20/2026", UpdatedBy: "", UpdatedDate: "",
};
const row = (id: string, op: "Insert" | "Update", over: Partial<Record<string, string>> = {}): string[] =>
  COLS.map((c) => (c === "ExternalIdentifier" ? id : c === "Operation" ? op : over[c] ?? DEFAULTS[c] ?? ""));
const payload = (r: string[]): Record<string, string> => Object.fromEntries(COLS.map((c, i) => [c, r[i]]));
const loaded = (entries: [string, InventoryTold][]): InventoryToldOutcome => ({ kind: "loaded", byId: new Map(entries) });
const held = (r: string[], o: Partial<InventoryTold> = {}): InventoryTold => ({ state: "filed", told: payload(r), inFlight: false, ...o });
const plan = (rows: string[][], told: InventoryToldOutcome, namedByEvents: Set<string> = new Set()) =>
  planInventoryDelta({ rows, told, namedByEvents, updatedBy: "Michael Lyman", batchDay: "10/27/2026" });

describe("R6-3 spec pins (verbatim in Part 02)", () => {
  it("Inventory.csv is required only for unreported inventory or unreported updates", () => {
    expect(G("L0525")).toContain("Inventory.CSV is required weekly by any licensed facility that owns the inventory, only when");
    expect(G("L0526")).toContain("inventory exists that is unreported, or unreported updates to an existing inventory. No report is");
    expect(G("L0527")).toContain("needed if there are no changes.");
    expect(FAQ("L0049")).toContain("if there is nothing new to report, there is no report to submit");
  });
  it("UpdatedBy / UpdatedDate and the date rule", () => {
    expect(G("L0235")).toContain("UpdatedBy field to enter the user who subsequently updated a file");
    expect(G("L0238")).toContain("UpdatedDate field to enter the date that the file was modified");
    expect(G("L0242")).toContain("Updated Date cannot be prior to Created Date.");
  });
  it("E51 is a registered, pinned, advisory code", () => {
    expect(CCRS_ISSUE_CODES).toContain("E51_INVENTORY_UNCHANGED_NOT_SENT");
    expect(specPinFor("E51_INVENTORY_UNCHANGED_NOT_SENT")).toBe("[G L0525-L0527]");
  });
});

describe("planInventoryDelta", () => {
  it("leaves out an Update whose every cell equals what CCRS last accepted", () => {
    const r = row("L1", "Update");
    const p = plan([r], loaded([["L1", held(r)]]));
    expect(p.rows).toHaveLength(0);
    expect(p.unchanged).toEqual([{ id: "L1", state: "filed" }]);
  });
  it("never touches an Insert (unreported inventory), and keeps its Updated cells empty", () => {
    const r = row("N1", "Insert");
    const p = plan([r], loaded([["N1", held(r)]]));
    expect(p.rows).toEqual([r]);
    expect(p.sent.get("N1")?.reason).toBe("insert");
  });
  it.each(["Strain", "Area", "Product", "InitialQuantity", "QuantityOnHand", "TotalCost", "IsMedical", "LicenseNumber", "CreatedBy", "CreatedDate"])(
    "sends the lot when %s changed",
    (column) => {
      const before = row("L1", "Update");
      const after = row("L1", "Update", { [column]: column === "IsMedical" ? "TRUE" : /Quantity|Cost/.test(column) ? "1" : "changed" });
      const p = plan([after], loaded([["L1", held(before)]]));
      expect(p.rows).toHaveLength(1);
      expect(p.sent.get("L1")).toEqual({ reason: "changed", changed: [column] });
    },
  );
  it("compares every data column and ignores only UpdatedBy / UpdatedDate / Operation", () => {
    expect(COMPARED_COLUMNS).toEqual(COLS.filter((c) => !["UpdatedBy", "UpdatedDate", "Operation"].includes(c)));
    expect(COMPARED_COLUMNS).toHaveLength(11);
  });
  it("ignores a difference only in UpdatedBy / UpdatedDate / Operation of the told row", () => {
    const r = row("L1", "Update");
    const told = { ...payload(r), UpdatedBy: "someone", UpdatedDate: "10/21/2026", Operation: "Insert" };
    expect(plan([r], loaded([["L1", { state: "confirmed", told, inFlight: false }]])).rows).toHaveLength(0);
  });
  it("numbers compare as numbers; text exactly; IsMedical case-insensitively", () => {
    const r = row("L1", "Update");
    expect(changedColumns(r, { ...payload(r), TotalCost: "120", QuantityOnHand: "10.000" })).toEqual([]);
    expect(changedColumns(r, { ...payload(r), IsMedical: "False" })).toEqual([]);
    expect(changedColumns(r, { ...payload(r), Product: "pastime blue flame flower 3.5g" })).toEqual(["Product"]);
    expect(changedColumns(r, { ...payload(r), Strain: "Blue Flame " })).toEqual(["Strain"]);
    expect(changedColumns(r, { ...payload(r), TotalCost: "" })).toEqual(["TotalCost"]);
    expect(changedColumns(r, { ...payload(r), TotalCost: "abc" })).toEqual(["TotalCost"]);
    const missing = payload(r);
    delete missing.Area;
    expect(changedColumns(r, missing)).toEqual(["Area"]);
  });
  it("sends when unsure: 0286 absent, no entry, never accepted, in flight", () => {
    const r = row("L1", "Update");
    expect(plan([r], { kind: "absent" }).sent.get("L1")?.reason).toBe("no-told-answer");
    expect(plan([r], loaded([])).sent.get("L1")?.reason).toBe("never-accepted");
    expect(plan([r], loaded([["L1", held(r, { state: "seed", told: null })]])).sent.get("L1")?.reason).toBe("never-accepted");
    expect(plan([r], loaded([["L1", held(r, { inFlight: true })]])).sent.get("L1")?.reason).toBe("in-flight");
  });
  it("always sends a lot an event row of this batch names (a closed lot must be re-reported, R5-1)", () => {
    const r = row("L1", "Update", { QuantityOnHand: "0" });
    const p = plan([r], loaded([["L1", held(r, { state: "closed" })]]), new Set(["L1"]));
    expect(p.rows).toHaveLength(1);
    expect(p.sent.get("L1")?.reason).toBe("named-by-event");
  });
  it("every sent Update carries UpdatedBy and UpdatedDate (never before CreatedDate)", () => {
    const before = row("L1", "Update");
    const p = plan([row("L1", "Update", { QuantityOnHand: "9" }), row("L2", "Update", { CreatedDate: "10/30/2026" })], loaded([["L1", held(before)]]));
    expect(p.rows.map((r) => [r[at("UpdatedBy")], r[at("UpdatedDate")]])).toEqual([
      ["Michael Lyman", "10/27/2026"],
      ["Michael Lyman", "10/30/2026"],
    ]);
    expect(updatedDateFor("", "10/27/2026")).toBe("10/27/2026");
    expect(() => updatedDateFor("10/01/2026", "2026-10-27")).toThrow(/MM\/DD\/YYYY/);
  });
  it("keeps the input order and does not mutate the input rows", () => {
    const a = row("A", "Insert");
    const b = row("B", "Update");
    const c = row("C", "Update", { QuantityOnHand: "1" });
    const p = plan([a, b, c], loaded([["B", held(b)], ["C", held(row("C", "Update"))]]));
    expect(p.rows.map((r) => r[at("ExternalIdentifier")])).toEqual(["A", "C"]);
    expect(c[at("UpdatedBy")]).toBe("");
  });
  it("refuses a row of the wrong width", () => {
    expect(() => plan([["x"]], loaded([]))).toThrow(/expected 14/);
  });
});

describe("decodeInventoryTold (0286 answer)", () => {
  it("reads entries and refuses anything malformed", () => {
    const d = decodeInventoryTold("preprod", { env: "preprod", entries: [["L1", "closed", { QuantityOnHand: "0" }, false]] }, null);
    expect(d.kind === "loaded" && d.byId.get("L1")).toEqual({ state: "closed", told: { QuantityOnHand: "0" }, inFlight: false });
    expect(decodeInventoryTold("prod", null, { code: "PGRST202", message: "Could not find the function" }).kind).toBe("absent");
    for (const bad of [
      null,
      [],
      { env: "prod" },
      { env: "prod", entries: [["L1", "filed", null]] },
      { env: "prod", entries: [["", "filed", null, false]] },
      { env: "prod", entries: [["L1", "bogus", null, false]] },
      { env: "prod", entries: [["L1", "filed", { QuantityOnHand: 4 }, false]] },
      { env: "prod", entries: [["L1", "filed", null, "no"]] },
    ]) {
      expect(() => decodeInventoryTold("prod", bad, null)).toThrow(/R6-3/);
    }
  });
  it("names the 0286 function", () => {
    expect(INVENTORY_TOLD_RPC).toBe("ccrs_inventory_last_told");
    expect(SRC("supabase/migrations/0286_ccrs_inventory_last_told.sql")).toContain("create or replace function public.ccrs_inventory_last_told(p_env text, p_ids text[])");
  });
});

describe("lotsNamedByEventRows", () => {
  it("collects the lot of every Adjustment, Sale and Transfer row", () => {
    const mk = (cols: readonly string[], name: string, v: string) => cols.map((c) => (c === name ? v : "x"));
    const s = lotsNamedByEventRows({
      adjustment: [mk(CCRS_COLUMNS.InventoryAdjustment, "InventoryExternalIdentifier", "A")],
      sale: [mk(CCRS_COLUMNS.Sale, "InventoryExternalIdentifier", "S"), mk(CCRS_COLUMNS.Sale, "InventoryExternalIdentifier", "")],
      transfer: [mk(CCRS_COLUMNS.InventoryTransfer, "ToInventoryExternalIdentifier", "T")],
    });
    expect([...s].sort()).toEqual(["A", "S", "T"]);
  });
});

describe("batch wiring (ccrs-batch.ts)", () => {
  const BATCH = SRC("src/lib/compliance/ccrs-batch.ts");
  it("Inventory is pushed through planInventoryDelta, after the event rows are known", () => {
    expect(BATCH).toContain('push("Inventory", delta.rows, inventory.warnings);');
    expect(BATCH).not.toContain('push("Inventory", inventory.rows, inventory.warnings);');
    const deltaAt = BATCH.indexOf("const delta = planInventoryDelta(");
    expect(deltaAt).toBeGreaterThan(BATCH.indexOf('push("InventoryTransfer", transferRows, transferWarnings);'));
    expect(deltaAt).toBeGreaterThan(BATCH.indexOf("const saleRows = [...insertRows, ...correctionE38.rows];"));
    expect(BATCH).toContain("...lotsNamedByEventRows({ adjustment: [], sale: saleRows, transfer: transferRows }),");
    expect(BATCH).toContain('...eventLotRefs([{ type: "InventoryAdjustment", csv: adj.csv }]),');
  });
  it("only reads 0286 with a ledger, and uses the batch day and SubmittedBy", () => {
    expect(BATCH).toContain("const told = ledger && updateIds.length > 0 ? await loadInventoryTold(admin, env, updateIds) : ({ kind: \"absent\" } as const);");
    // P-F: the rows pass through the strain fill (blank Strain never sent) first.
    expect(BATCH).toContain("const strainFill = fillBlankStrains(inventory.rows,");
    expect(BATCH).toContain("planInventoryDelta({ rows: strainFill.rows, told, namedByEvents, updatedBy: submittedBy, batchDay: createdDate })");
  });
  it("reports left-out lots as advisory E51, every row listed", () => {
    expect(BATCH).toMatch(/severity: "warning",\s+file: "Inventory",\s+code: "E51_INVENTORY_UNCHANGED_NOT_SENT"/);
    expect(BATCH).toContain("rows: delta.unchanged.map((u) =>");
  });
  it("files are still ordered by upload group after the move", () => {
    expect(BATCH).toContain("files.sort((a, b) => (order.get(a.type) ?? 99) - (order.get(b.type) ?? 99));");
  });
  it("the loader chunks and stops at the first absent answer", () => {
    const STORE = SRC("src/lib/compliance/ccrs-ledger-store.ts");
    expect(STORE).toContain("for (let i = 0; i < uniq.length; i += 1000) {");
    expect(STORE).toContain('if (part.kind === "absent") return part;');
  });
});

describe("0286 is proven on Postgres in CI", () => {
  it("the scenario check is a POST_APPLY_CHECK", () => {
    expect(POST_APPLY_CHECKS).toContainEqual({ file: "scripts/recon/ccrs-inventory-told-0286-pg-check.sql", mustPrint: "CCRS 0286 CHECK PASSED" });
  });
  it("told comes from accepted file rows, never ccrs_filed_entities.last_payload", () => {
    const sql = SRC("supabase/migrations/0286_ccrs_inventory_last_told.sql");
    const body = sql.slice(sql.indexOf("as $$"));
    expect(body).not.toContain("last_payload");
    expect(body).toContain("r.state not in ('rejected', 'withheld')");
  });
});

describe("embedded self-tests", () => {
  it("pass", () => {
    const r = __runInventoryDeltaTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(22);
  });
});
