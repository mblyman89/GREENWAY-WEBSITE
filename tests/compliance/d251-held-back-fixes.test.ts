/**
 * D251 S1: the four fixes for what the week of 11/01 held back in production.
 *
 * Spec pins:
 *   [G L0581] Product.UnitWeightGrams: one weight per Product, so a restock
 *             lot of another size cannot borrow its card's Product.
 *   [G L0597] "QuanityOnHand is greater than InitialQuantity" (E8).
 *   [G L0219-L0221] "Duplicate External Identifier" (E60 on a re-used id).
 *   [G L0246-L0248] Update alters "an existing record indicated by external identifier".
 * Owner, 2026-11-18: production CCRS sends no success email (U-65).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  __runCcrsHeldBackFixCoreTests,
  combineDuplicateInventoryRows,
  initialQtyForLot,
  restockItems,
  restockVariantIds,
  silenceOutcome,
} from "@/lib/compliance/ccrs-held-back-fix-core";
import { CCRS_COLUMNS } from "@/lib/compliance/ccrs-batch-core";
import { CcrsFilesPanel } from "@/components/admin/compliance/CcrsFilesPanel";

const ROOT = path.resolve(__dirname, "../..");
const SRC = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const BATCH = SRC("src/lib/compliance/ccrs-batch.ts");
const ACTIONS = SRC("src/app/admin/compliance/ccrs/actions.ts");

describe("the pure core", () => {
  it("self-tests pass", () => {
    const r = __runCcrsHeldBackFixCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(19);
  });
});

describe("1. restock lots get their own Product [G L0581]", () => {
  // Real shape (prod, 2026-11-18): lot 21855490017073779 is the 3.5 g variant
  // "21855490017073779-onboarded" on card 21855490017031392 "Blue Nerdz".
  const items = [{ id: "u-1", source_item_id: "21855490017031392", hidden: false, name: "Blue Nerdz", strain_name: "Blue Nerdz" }];
  it("the lot key is looked up as its -onboarded variant", () => {
    expect(restockVariantIds(["21855490017073779", "21855490017031392"], new Set(["21855490017031392"]))).toEqual(["21855490017073779-onboarded"]);
  });
  it("the lot gets a product row with the card's details under its own key", () => {
    const r = restockItems(items, [{ source_variant_id: "21855490017073779-onboarded", menu_item_id: "u-1" }]);
    expect(r.items).toEqual([{ ...items[0], source_item_id: "21855490017073779" }]);
  });
  it("the batch reads the variants and adds the rows before the Product file is built", () => {
    expect(BATCH).toContain('"id, source_item_id, name, strain_name');
    expect(BATCH).toMatch(/readRestockItems\(admin, items, liveLots, syncIssues\)[\s\S]*const itemsByKey[\s\S]*buildProductFile\(items, lots/);
    expect(BATCH).toContain('.from("menu_variants").select("source_variant_id, menu_item_id")');
  });
});

describe("2. a Cultivera-era lot carries CCRS's Initial Quantity [G L0597]", () => {
  it("only for an Update, only when ours is too low, only when CCRS's covers on-hand", () => {
    expect(initialQtyForLot({ received: 0, onHand: 6, op: "Update", ccrsInitial: 24 })).toEqual({ qty: 24, fromCcrs: true });
    expect(initialQtyForLot({ received: 0, onHand: 6, op: "Insert", ccrsInitial: 24 }).fromCcrs).toBe(false);
    // VICE Hash Rosin Lemon Tea: 17 on hand, CCRS 12 -> still E8 (recount).
    expect(initialQtyForLot({ received: 0, onHand: 17, op: "Update", ccrsInitial: 12 }).fromCcrs).toBe(false);
  });
  it("the Inventory row and its TotalCost use that quantity", () => {
    expect(BATCH).toContain("String(init.qty),");
    expect(BATCH).toContain("const totalCostMinor = (l.unit_cost_minor_units ?? 0) * init.qty;");
    expect(BATCH).toContain('.from("ccrs_filed_entities").select("external_id, seed_payload")');
  });
});

describe("3. two lots with one CCRS id are one row [G L0219-L0221]", () => {
  const C = CCRS_COLUMNS.Inventory;
  const cols = { ext: C.indexOf("ExternalIdentifier"), initial: C.indexOf("InitialQuantity"), onHand: C.indexOf("QuantityOnHand"), cost: C.indexOf("TotalCost"), created: C.indexOf("CreatedDate") };
  const row = (init: string, oh: string, cost: string, date: string) =>
    C.map((c) => ({ ExternalIdentifier: "21905170986991945", InitialQuantity: init, QuantityOnHand: oh, TotalCost: cost, CreatedDate: date, Operation: "Update" } as Record<string, string>)[c] ?? "x");
  it("real pair 21905170986991945: 8/3 (10/22) + 8/8 (11/10) -> 16/11, dated 10/22", () => {
    const m = combineDuplicateInventoryRows([row("8", "3", "40.00", "10/22/2026"), row("8", "8", "40.00", "11/10/2026")], cols);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0][cols.initial]).toBe("16");
    expect(m.rows[0][cols.onHand]).toBe("11");
    expect(m.rows[0][cols.cost]).toBe("80.00");
    expect(m.rows[0][cols.created]).toBe("10/22/2026");
  });
  it("the batch combines before the delta and the E60 last check", () => {
    const at = BATCH.indexOf("combineDuplicateInventoryRows(inventory.rows");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(BATCH.indexOf("planInventoryDelta({ rows: strainFill.rows"));
    expect(at).toBeLessThan(BATCH.indexOf('code: "E60_ROW_REFUSED_HELD"'));
  });
});

describe("4. production silence is success (U-65)", () => {
  it("prod -> success, PREprod -> no-email", () => {
    expect(silenceOutcome("prod")).toBe("success");
    expect(silenceOutcome("preprod")).toBe("no-email");
  });
  it("the no-email action records the env's silence outcome", () => {
    expect(ACTIONS).toContain("const outcome = silenceOutcome(env);");
    expect(ACTIONS).toContain("out = await recordOutcome(admin, file.id, outcome,");
  });
  it("the production button says it records acceptance; PREprod's does not", () => {
    const noop = () => {};
    const actions = { markUploaded: noop, recordSuccess: noop, recordError: noop, recordNoEmail: noop, abandon: noop, startPreprod: noop, assignPreprodIds: noop };
    const up = {
      id: "00000000-0000-4000-8000-000000000001", fileType: "Sale", purpose: "weekly", fileName: "Sale_413541_20261117220516.csv",
      numberRecords: 3, state: "uploaded", stampAt: "2026-11-17T22:05:16Z", uploadedAt: "2026-11-17T22:10:00.000Z", errorMessages: null, notes: null,
    };
    const html = (env: "prod" | "preprod") =>
      renderToStaticMarkup(
        createElement(CcrsFilesPanel, {
          env, weekKey: "2026-11-01", canEdit: true, available: true, loadError: null, files: [up], issues: [], ledgerLoaded: true,
          unassignedProductCount: 0, nowISO: "2026-11-17T23:30:00.000Z", actions,
        } as unknown as Parameters<typeof CcrsFilesPanel>[0]),
      );
    expect(html("prod")).toContain("accepted (production sends no success email)");
    expect(html("preprod")).not.toContain("accepted (production");
  });
});
