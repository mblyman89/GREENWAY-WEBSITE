/**
 * S-10 (CCRS Bible v2): identifier pass-through.
 *
 * CCRS matches every Inventory / InventoryAdjustment / Sale row by its
 * ExternalIdentifier EXACTLY as filed: Update alters "an existing record
 * indicated by external identifier" [G L0247], and an adjustment's id must be
 * an Inventory.ExternalIdentifier or it fails "Invalid
 * InventoryExternalIdentifier" [G L1077-L1083]. 4,295 of our 62,744
 * filed ids contain a '.', so any export path that "sanitizes" an existing
 * lot's id addresses a different, nonexistent CCRS lot.
 *
 * Behaviour is proven by the pure self-tests (ccrs-identifiers,
 * ccrs-inventory-adjustment-core, import-lot-core). This file pins the
 * server-only wiring those self-tests cannot reach, and the 0246 data repair.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  __runCcrsIdentifierTests,
  assignedInventoryExternalId,
  deriveInventoryExternalId,
  mintInventoryExternalId,
  passThroughExternalId,
  resolveSaleInventoryExternalId,
  validatePassThroughExternalId,
} from "@/lib/compliance/ccrs-identifiers";
import { mapAdjustmentRow } from "@/lib/compliance/ccrs-inventory-adjustment-core";
import { __runImportLotCoreTests, planImportLots } from "@/lib/pos/import-lot-core";
import { CCRS_ISSUE_CODES, specPinFor } from "@/lib/compliance/ccrs-preflight-core";

const read = (p: string) => readFileSync(path.resolve(__dirname, "../..", p), "utf8");

// Real filed ids from the LCB's 2026-09-18 Service Desk delivery.
const FILED_DOTTED = "WAR413541.IN132IB0";
const FILED_HYPHEN = "44557481674921553-1";

describe("S-10 identifier pass-through (behaviour)", () => {
  it("an assigned id is used byte-for-byte (trim only), dots and hyphens kept", () => {
    expect(deriveInventoryExternalId({ ccrs_inventory_external_id: FILED_DOTTED, lot_code: "OTHER" })).toBe(FILED_DOTTED);
    expect(deriveInventoryExternalId({ ccrs_inventory_external_id: ` ${FILED_HYPHEN} ` })).toBe(FILED_HYPHEN);
    expect(passThroughExternalId("  0012.5  ")).toBe("0012.5");
  });

  it("export reads only the assigned id and never mints one", () => {
    expect(assignedInventoryExternalId({ ccrs_inventory_external_id: FILED_DOTTED })).toBe(FILED_DOTTED);
    expect(assignedInventoryExternalId({ ccrs_inventory_external_id: null })).toBeNull();
    expect(assignedInventoryExternalId({ ccrs_inventory_external_id: "  " })).toBeNull();
    // No fallback to lot_code / pos_product_key at export time.
    expect(
      assignedInventoryExternalId({ ccrs_inventory_external_id: null, lot_code: "LOT1", pos_product_key: "PK1" } as never),
    ).toBeNull();
  });

  it("the identifier and import-lot pure self-tests run under vitest too", () => {
    // These are also run by scripts/compliance/run-pure-selftests.ts; running
    // them here lets mutate_check.py target them (mutation M27/M29 found that
    // pure-selftests.test.ts does not include them).
    expect(__runCcrsIdentifierTests().failed).toBe(0);
    expect(() => __runImportLotCoreTests()).not.toThrow();
  });

  it("minting (new lots only) still produces the safe convention", () => {
    expect(mintInventoryExternalId({ lot_code: "LOT 9.5" })).toBe("LOT-9-5");
    expect(deriveInventoryExternalId({ lot_code: "LOT 9.5" })).toBe("LOT-9-5");
  });

  it("a Cultivera import lot keeps its dotted barcode as the CCRS id", () => {
    const plan = planImportLots([
      {
        posProductKey: "pos-s10", itemName: "Amnesia", barcode: ` ${FILED_DOTTED} `, productName: "Buddies - Amnesia",
        category: "Concentrate", inventoryType: "Hydrocarbon Concentrate", strainName: "Amnesia", strainType: "hybrid",
        brand: "Buddies", vendor: "BUDDIES", units: 3, costRaw: "$10.00", receivedDateRaw: "06/17/2026",
        expirationDateRaw: "", coaRaw: "Y", isMedical: false, isSample: false, unitWeight: 1, unitWeightUom: "g",
      } as never,
    ]);
    expect(plan.lots[0].ccrsExternalId).toBe(FILED_DOTTED);
  });

  it("Sale lines keep the filed lot id", () => {
    expect(resolveSaleInventoryExternalId({ lotCanonical: FILED_DOTTED }).value).toBe(FILED_DOTTED);
  });

  it("an adjustment carries the lot's assigned id, not one re-derived from lot_code", () => {
    const r = mapAdjustmentRow(
      {
        id: "a-s10",
        qty_delta: -1,
        reason: "count",
        note: "recount",
        created_at: "2026-10-05T18:00:00Z",
        lot: { id: "L-s10", lot_code: "GF-DIFFERENT", pos_product_key: "pk", ccrs_inventory_external_id: FILED_DOTTED },
      },
      { licenseNumber: "413541", submittedBy: "Greenway" },
    );
    expect(r.row?.[1]).toBe(FILED_DOTTED);
  });

  it("the pass-through validator refuses only what would corrupt the CSV or exceed the limit", () => {
    expect(validatePassThroughExternalId(FILED_DOTTED)).toEqual([]);
    expect(validatePassThroughExternalId(FILED_HYPHEN)).toEqual([]);
    expect(validatePassThroughExternalId("a,b").length).toBe(1);
    expect(validatePassThroughExternalId("x".repeat(101)).length).toBe(1);
  });

  it("E3_EXTERNAL_ID_UNASSIGNED is a registered, pinned issue code", () => {
    expect(CCRS_ISSUE_CODES).toContain("E3_EXTERNAL_ID_UNASSIGNED");
    expect(specPinFor("E3_EXTERNAL_ID_UNASSIGNED")).toBe("[G L0224-L0225]");
  });
});

describe("S-10 real filed ids (fixture from the LCB delivery)", () => {
  const fx = JSON.parse(read("tests/compliance/fixtures/ccrs-filed-ids-sample.json")) as { population: number; ids: string[] };

  it("covers every id shape family, including dotted and hyphenated ids", () => {
    expect(fx.population).toBe(62744);
    expect(fx.ids.length).toBeGreaterThanOrEqual(60);
    expect(fx.ids.filter((i) => i.includes(".")).length).toBeGreaterThanOrEqual(20);
    expect(fx.ids).toContain(FILED_HYPHEN);
    expect(fx.ids).toContain("BAT-BLK-0001");
  });

  it("every real filed id validates and passes through byte-for-byte", () => {
    for (const id of fx.ids) {
      expect(validatePassThroughExternalId(id), id).toEqual([]);
      expect(deriveInventoryExternalId({ ccrs_inventory_external_id: id, lot_code: "X" }), id).toBe(id);
      expect(assignedInventoryExternalId({ ccrs_inventory_external_id: id }), id).toBe(id);
      expect(resolveSaleInventoryExternalId({ lotCanonical: id }).value, id).toBe(id);
    }
  });
});

describe("S-10 guardrail: minting never receives a stored id", () => {
  it("no src/ call passes a stored-id column into mintExternalId / sanitizeExternalId", () => {
    const root = path.resolve(__dirname, "../../src");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(100);
    const bad = /(mintExternalId|sanitizeExternalId)\([^)]*(ccrs_inventory_external_id|filed_external_id)/;
    const hits = files.filter((f) => bad.test(readFileSync(f, "utf8"))).map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
    // The guard regex itself must fire on the forbidden shape (test the test).
    expect(bad.test("mintExternalId(lot.ccrs_inventory_external_id)")).toBe(true);
  });
});

describe("S-10 server wiring (source anchors)", () => {
  it("Inventory.csv withholds unassigned lots instead of minting", () => {
    const src = read("src/lib/compliance/ccrs-batch.ts");
    expect(src).toContain("const ext = assignedInventoryExternalId(l);");
    expect(src).toContain('code: "E3_EXTERNAL_ID_UNASSIGNED"');
    expect(src).not.toMatch(/deriveInventoryExternalId\(/);
  });

  it("the adjustment export selects the lot's assigned id", () => {
    expect(read("src/lib/compliance/ccrs-inventory-adjustment.ts")).toContain(
      "lot:inventory_lots(id, lot_code, pos_product_key, ccrs_inventory_external_id)",
    );
  });

  it("disposition (sale correction) passes the assigned id first", () => {
    expect(read("src/lib/inventory/disposition.ts")).toContain(
      "ccrs_inventory_external_id: lotRow.ccrs_inventory_external_id ?? null,",
    );
  });

  it("Sale.csv validates with the pass-through validator", () => {
    const src = read("src/lib/compliance/ccrs-sales.ts");
    expect(src).toContain("validatePassThroughExternalId(");
    expect(src).not.toMatch(/\bvalidateExternalId\(/);
  });
});

describe("S-10 migration 0246 (data repair) + rollback", () => {
  const mig = read("supabase/migrations/0246_ccrs_lot_external_id_passthrough.sql");
  const rb = read("supabase/rollbacks/0246_ccrs_lot_external_id_passthrough.rollback.sql");

  it("is scoped to Cultivera import lots, dotted lot codes, and the exact 0034 sanitized form", () => {
    expect(mig).toContain("l.notes like '%Cultivera migration (one-time POS import).%'");
    expect(mig).toContain("trim(l.lot_code) like '%.%'");
    expect(mig).toContain("regexp_replace(trim(l.lot_code), '[^A-Za-z0-9]+', '-', 'g')");
    expect(mig).toContain("set ccrs_inventory_external_id = trim(l.lot_code)");
  });

  it("audits every change and the rollback never undoes a later human edit", () => {
    expect(mig).toContain("'migration:0246'");
    expect(rb).toContain("and l.ccrs_inventory_external_id = a.after_json ->> 'ccrs_inventory_external_id';");
    expect(rb).toContain("delete from public.audit_logs");
  });

  it("is not an ALTER (data only) and has an executable scenario check", () => {
    expect(mig).not.toMatch(/\balter\s+table\b/i);
    expect(read("scripts/recon/ccrs-lot-id-passthrough-pg-check.sql")).toContain("CCRS LOT ID PASSTHROUGH CHECK PASSED");
  });
});
