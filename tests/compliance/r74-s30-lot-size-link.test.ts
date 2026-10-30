/**
 * R74 S30 — the lot -> menu SIZE link (migration 0294).
 *
 * Owner request (round 13, verbatim in docs/roadmap/R74-CULTIVERA-MANIFEST-REBUILD.md):
 * build the enterprise lot <-> size (price) link and fix the lot page's
 * "onboard first" price message, so every Cultivera lot's price can be set
 * without waiting on onboarding (cost stays locked).
 *
 * Pins: the pure self-test counts + runner lines, purity of the cores, the
 * migration / rollback / pg-check, the import write + retry, the backfill's
 * owner-pick guard, and the lot page / import page wiring.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import * as sizeCore from "../../src/lib/inventory/lot-size-link-core";
import * as importCore from "../../src/lib/pos/import-lot-core";
import * as liveCore from "../../src/lib/inventory/lot-live-price-core";
import { resolveLotVariant } from "../../src/lib/inventory/price-variant-match-core";
import { POST_APPLY_CHECKS } from "../../scripts/compliance/verify-migrations-execute";

const read = (p: string) => readFileSync(p, "utf8");
const runner = read("scripts/compliance/run-pure-selftests.ts");

describe("R74 S30 A — pure self-tests, pinned", () => {
  it("lot-size-link-core runs exactly 23, pinned in the runner", () => {
    expect(sizeCore.__runLotSizeLinkCoreTests()).toEqual({ passed: 23, failed: 0 });
    expect(runner).toMatch(/__runLotSizeLinkCoreTests\(\);\s*if \(r\.failed > 0 \|\| r\.passed < 23\)/);
  });
  it("import-lot-core size-link runs exactly 21, pinned in the runner", () => {
    expect(importCore.__runImportLotSizeLinkTests()).toEqual({ passed: 21, failed: 0 });
    expect(runner).toMatch(/__runImportLotSizeLinkTests\(\);\s*if \(r\.failed > 0 \|\| r\.passed < 21\)/);
  });
  it("lot-live-price-core grew to 44 (per-size link)", () => {
    expect(liveCore.__runLotLivePriceCoreTests()).toEqual({ passed: 44, failed: 0 });
    expect(runner).toMatch(/__runLotLivePriceCoreTests\(\);\s*if \(r\.failed > 0 \|\| r\.passed < 44\)/);
  });
  it("the cores are pure (no env, no DB)", () => {
    for (const f of [
      "src/lib/inventory/lot-size-link-core.ts",
      "src/lib/pos/import-lot-core.ts",
      "src/lib/inventory/lot-live-price-core.ts",
      "src/lib/inventory/price-variant-match-core.ts",
    ]) {
      const src = read(f);
      expect(src, f).not.toContain("process" + ".env");
      expect(src, f).not.toMatch(/from "@\/lib\/supabase/);
    }
  });
});

describe("R74 S30 B — the rules", () => {
  const card = [
    { source_variant_id: "pos-a-1g", label: "1g" },
    { source_variant_id: "pos-a-3g", label: "3.5g" },
  ];
  it("a linked lot resolves to exactly its size; a stale link falls back (never guesses)", () => {
    const r = resolveLotVariant("pos-a", [], card as never, "pos-a-3g");
    expect(r.kind).toBe("linked");
    const stale = resolveLotVariant("pos-a", [], card as never, "pos-a-gone");
    expect(stale.kind).toBe("ambiguous");
  });
  it("the shared price floor is the HIGHEST cost + tax among the lots that share it", () => {
    const f = sizeCore.sharedSizeFloor(
      [
        { id: "1", lot_code: "A", unit_cost_minor_units: 500 },
        { id: "2", lot_code: "B", unit_cost_minor_units: 900 },
      ],
      "flower",
    );
    expect(f.lotId).toBe("2");
    expect(f.lotCount).toBe(2);
    expect(sizeCore.sharedFloorRefusal((f.floorMinor ?? 0) - 1, f, "1g")).toMatch(/Blocked/);
    expect(sizeCore.sharedFloorRefusal(f.floorMinor ?? 0, f, "1g")).toBeNull();
  });
  it("the owner can only pick a size on this lot's own card", () => {
    const opts = [{ sourceVariantId: "pos-a-1g", label: "1g", priceMinor: 1000, medical: false }];
    expect(sizeCore.checkOwnerSizePick("pos-b-1g", opts).ok).toBe(false);
    expect(sizeCore.checkOwnerSizePick("pos-a-1g", opts).ok).toBe(true);
  });
  it("0294 pair rule in the insert: both or neither", () => {
    expect(importCore.sizeLinkColumns("x")).toEqual({ menu_source_variant_id: "x", menu_source_variant_source: "pos_import" });
    expect(importCore.sizeLinkColumns(null)).toEqual({ menu_source_variant_id: null, menu_source_variant_source: null });
  });
});

describe("R74 S30 C — migration 0294, rollback, pg-check", () => {
  const mig = read("supabase/migrations/0294_inventory_lot_menu_variant.sql");
  it("is idempotent and fails closed on the pair rule", () => {
    expect(mig).toMatch(/add column if not exists menu_source_variant_id text/i);
    expect(mig).toMatch(/add column if not exists menu_source_variant_source text/i);
    expect(mig).toMatch(/inventory_lots_menu_source_variant_source_check/);
    // the NULL-source hole the pg-check caught: `null in (...)` is NULL, not false.
    expect(mig).toMatch(/menu_source_variant_source is not null/i);
    expect(mig).toMatch(/'pos_import'\s*,\s*'owner'/);
    expect(mig).toMatch(/create index if not exists inventory_lots_menu_source_variant_id_idx/i);
    expect(mig).toMatch(/notify pgrst/i);
  });
  it("has a rollback and a registered pg-check", () => {
    const rb = "supabase/rollbacks/0294_inventory_lot_menu_variant.rollback.sql";
    expect(existsSync(rb)).toBe(true);
    expect(read(rb)).toMatch(/drop column if exists menu_source_variant_id/i);
    const chk = "scripts/recon/inventory-lot-menu-variant-0294-pg-check.sql";
    expect(read(chk)).toContain("R74 0294 CHECK PASSED");
    expect(POST_APPLY_CHECKS).toContainEqual({ file: chk, mustPrint: "R74 0294 CHECK PASSED" });
  });
});

describe("R74 S30 D — the wiring", () => {
  const svc = read("src/lib/pos/import-service.ts");
  it("the import writes the size link and survives a missing 0294 (retry strips only those columns, loud)", () => {
    expect(svc).toMatch(/sizeLinkColsOk \? sizeLinkColumns\(lot\.menuSourceVariantId\)/);
    expect(svc).toContain("import_lots_size_link_pending");
    expect(svc).toMatch(/function withoutSizeLink/);
  });
  it("the backfill never overwrites an owner pick (guarded in SQL) and refuses test imports", () => {
    expect(svc).toMatch(/export async function fillImportLotSizeLinks/);
    expect(svc).toContain('.or("menu_source_variant_source.is.null,menu_source_variant_source.eq.pos_import")');
    expect(svc).toMatch(/Link refused: this is a TEST import/);
    expect(svc).toMatch(/migration 0294 \(the lot size link\) is not applied yet/);
  });
  it("the price write resolves per lot (no unpaged card read left)", () => {
    const store = read("src/lib/inventory/price-write-store.ts");
    expect(store).toMatch(/export async function getLotPriceState/);
    expect(store).not.toMatch(/itemIdsForVersion/);
    expect(store).toContain("Which size is this lot?");
  });
  it("the lot page uses the per-lot state, the size picker and no 'onboarded' requirement", () => {
    const page = read("src/app/admin/inventory/[id]/page.tsx");
    expect(page).toMatch(/getLotPriceState\(\{ posProductKey: lot\.pos_product_key, menuSourceVariantId: lot\.menu_source_variant_id/);
    expect(page).toContain('id="lot-size"');
    expect(page).toContain("setLotSizeAction.bind(null, id)");
    expect(page).not.toMatch(/onboarded and published to the menu/);
    expect(page).toContain("Onboarding is not required.");
  });
  it("the action enforces the shared floor and audits the size", () => {
    const act = read("src/app/admin/inventory/actions.ts");
    expect(act).toMatch(/sharedFloorRefusal\(parsed\.afterTaxMinor, floor, state\.sizeLabel\)/);
    expect(act).toContain('"inventory_lot.size_link_set"');
    expect(act).toContain("lots_sharing_price");
  });
  it("the import page has Link + Preview", () => {
    const page = read("src/app/admin/menu-imports/[id]/page.tsx");
    expect(page).toContain("linkLotSizesAction");
    expect(page).toContain('name="mode" value="preview"');
    expect(page).toContain("Link lots to their menu sizes");
  });
});
