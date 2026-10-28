/**
 * Fix Phase 1.6b (G-24; F-05a-8, F-05a-20; D36, D44).
 *
 * Owner (D36): "hard block edibles and liquid edibles, warnings for
 * everything else." Owner (D44): "Q-05a-6- yes, same with rso too."
 *
 *   - An expired Solid Edible, Liquid Edible, Tincture, Capsule or RSO lot
 *     with sellable units holds its product at completion. No override.
 *   - RSO is CCRS "Concentrate for Inhalation", so the block also reads the
 *     store category and the product name (F-05a-20).
 *   - Every other expired lot needs the warning acknowledged (back office) or
 *     recorded on the order (register sync).
 *   - The sale draw is First-Expired First-Out.
 *   - The register menu leaves out hard-blocked products.
 *   - A nightly job moves expired hard-block lots to Quarantine,
 *     compare-and-set on "active" only.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildExpiredKeyIndex,
  evaluateExpiredLines,
  expiredBlockRefusal,
  expiredWarningNote,
  expiredWarningRefusal,
  expiryKindFor,
  isExpiredOn,
  planExpiredQuarantine,
  EXPIRED_WARNING_REFUSAL_PREFIX,
  __runExpiredStockCoreTests,
  type ExpiryLot,
} from "@/lib/inventory/expired-stock-core";
import { validateSalePayload } from "@/lib/pos/sale-event-core";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const GATE = read("src/lib/orders/completion-gate.ts");
const STORE = read("src/lib/inventory/expired-stock-store.ts");
const DRAW = read("src/lib/inventory/sale-lot-read.ts");
const MENU = read("src/app/api/pos/menu/route.ts");
const CRON = read("src/app/api/cron/expired-quarantine/route.ts");
const VERCEL = JSON.parse(read("vercel.json")) as { crons: { path: string; schedule: string }[] };
const ISSUES = read("src/lib/admin/issues-core.ts");
const ACT = read("src/app/admin/orders/actions.ts");
const SYNC = read("src/lib/pos/sync-store.ts");
const SALEFLOW = read("src/app/(site)/pos/SaleFlow.tsx");
const ORDER_PAGE = read("src/app/admin/orders/[id]/page.tsx");

const TODAY = "2026-08-10";
const lot = (o: Partial<ExpiryLot>): ExpiryLot => ({
  id: "l1",
  posProductKey: "p1",
  productName: "Thing",
  status: "active",
  expiresOn: "2026-08-01",
  sellableQty: 5,
  category: null,
  inventoryType: null,
  isSample: false,
  ...o,
});

describe("G-24 core: which expired lots are hard-blocked (D36, D44)", () => {
  it("self-tests pass", () => {
    const r = __runExpiredStockCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(37);
  });

  it.each([
    ["Solid Edible", { inventoryType: "Solid Edible" }],
    ["Liquid Edible", { inventoryType: "Liquid Edible" }],
    ["Tincture", { inventoryType: "Tincture" }],
    ["Capsule", { inventoryType: "Capsule" }],
    ["legacy Solid Marijuana Infused Edible", { inventoryType: "Solid Marijuana Infused Edible" }],
    ["RSO by store category, filed as Concentrate for Inhalation", { inventoryType: "Concentrate for Inhalation", category: "RSO" }],
    ["RSO by name, filed as Concentrate for Inhalation", { inventoryType: "Concentrate for Inhalation", productName: "Phoenix RSO 1g" }],
    ["Rick Simpson Oil by name", { inventoryType: "Concentrate for Inhalation", productName: "Rick Simpson Oil" }],
  ])("%s is a hard block", (_n, o) => {
    expect(expiryKindFor(lot(o as Partial<ExpiryLot>))).toBe("block");
  });

  it("an RSO order line category blocks even with no lot category", () => {
    expect(expiryKindFor(lot({ inventoryType: "Concentrate for Inhalation" }), "rso")).toBe("block");
  });

  it.each([
    ["non-RSO concentrate", { inventoryType: "Concentrate for Inhalation", productName: "Live Resin 1g", category: "Concentrate" }],
    ["usable flower", { inventoryType: "Usable Marijuana", productName: "Blue Dream" }],
    ["pre-roll", { inventoryType: "Usable Marijuana", productName: "Pre-roll 1g" }],
    ["a name containing 'rso' inside a word", { inventoryType: "Usable Marijuana", productName: "Parsons Kush" }],
  ])("%s is a warning only", (_n, o) => {
    expect(expiryKindFor(lot(o as Partial<ExpiryLot>))).toBe("warn");
  });

  it("expiry is strictly before today; the expiry day itself still sells", () => {
    expect(isExpiredOn("2026-08-09", TODAY)).toBe(true);
    expect(isExpiredOn(TODAY, TODAY)).toBe(false);
    expect(isExpiredOn(null, TODAY)).toBe(false);
  });

  it("an expired edible holds the whole product; refusal has no override", () => {
    const idx = buildExpiredKeyIndex([lot({ inventoryType: "Solid Edible", productName: "Gummies" })], TODAY);
    const v = evaluateExpiredLines([{ productId: "p1", productName: "Gummies" }], idx);
    const msg = expiredBlockRefusal(v);
    expect(msg).toMatch(/^Sale blocked:/);
    expect(msg).toContain("08/01/2026");
    expect(msg).toContain("no override");
    expect(msg).toContain("D36, D44");
  });

  it("a quarantined, sold-out or sample expired lot does not hold the product", () => {
    for (const o of [{ status: "quarantine" }, { sellableQty: 0 }, { isSample: true }]) {
      const idx = buildExpiredKeyIndex([lot({ inventoryType: "Solid Edible", ...o })], TODAY);
      expect(idx.blocked.size).toBe(0);
    }
  });

  it("an expired flower lot asks for the warning, then records the note", () => {
    const idx = buildExpiredKeyIndex([lot({ inventoryType: "Usable Marijuana", productName: "Blue Dream" })], TODAY);
    const v = evaluateExpiredLines([{ productId: "p1", productName: "Blue Dream" }], idx);
    expect(expiredBlockRefusal(v)).toBeNull();
    expect(expiredWarningRefusal(v, false)?.startsWith(EXPIRED_WARNING_REFUSAL_PREFIX)).toBe(true);
    expect(expiredWarningRefusal(v, true)).toBeNull();
    expect(expiredWarningNote(v, "register")).toContain("acknowledged the expiry warning at the register");
    expect(expiredWarningNote(v, "not_acknowledged")).toContain("review this sale");
  });

  it("the nightly plan moves only Active expired hard-block lots", () => {
    const plan = planExpiredQuarantine(
      [
        lot({ id: "a", inventoryType: "Tincture" }),
        lot({ id: "b", inventoryType: "Usable Marijuana" }),
        lot({ id: "c", inventoryType: "Capsule", status: "recalled" }),
        lot({ id: "d", inventoryType: "Liquid Edible", expiresOn: TODAY }),
        lot({ id: "e", category: "RSO", inventoryType: "Concentrate for Inhalation" }),
      ],
      TODAY,
    );
    expect(plan.map((l) => l.id)).toEqual(["a", "e"]);
  });
});

describe("G-24 wiring (source-pinned)", () => {
  it("completion gate reads expiry fail-closed, refuses blocks, then warnings", () => {
    expect(GATE).toContain("readExpiredActiveLots(today)");
    expect(GATE).toContain("the expiry dates of this order's products could not be verified");
    const b = GATE.indexOf("expiredBlockRefusal(verdict)");
    const w = GATE.indexOf("expiredWarningRefusal(verdict, acked)");
    expect(b).toBeGreaterThan(0);
    expect(w).toBeGreaterThan(b);
    expect(GATE).toContain('opts.expiredWarningMode ?? "require_ack"');
  });

  it("back office requires the acknowledgement; register sync records it", () => {
    expect(ACT).toContain('expiredWarningMode: "require_ack"');
    expect(ACT).toContain('formData.get("expiredAck")');
    expect(SYNC).toContain('expiredWarningMode: "record"');
    expect(SYNC).toContain("expiredWarningAcknowledged: sale.expiredWarningAck === true");
    expect(ORDER_PAGE).toContain('data-testid="expired-ack-form"');
    expect(SALEFLOW).toContain('data-testid="expired-ack"');
  });

  it("sale payload accepts a boolean acknowledgement only", () => {
    expect(typeof validateSalePayload).toBe("function");
    expect(read("src/lib/pos/sale-event-core.ts")).toContain("expiredWarningAck, when present, must be true or false.");
  });

  it("the draw is First-Expired First-Out", () => {
    expect(DRAW).toContain('.order("expires_on", { ascending: true, nullsFirst: false })');
  });

  it("the register menu leaves out hard-blocked products and flags warned ones", () => {
    expect(MENU).toContain("expiredIdx.blocked.has(item.id)");
    expect(MENU).toContain("expiredSince: expiredWarn.expiresOn");
  });

  it("the nightly quarantine is scheduled in UTC, CRON_SECRET-guarded and compare-and-set", () => {
    const c = VERCEL.crons.find((x) => x.path === "/api/cron/expired-quarantine");
    expect(c?.schedule).toBe("20 11 * * *");
    expect(CRON).toContain("CRON_SECRET");
    expect(CRON).toContain("const today = pacificToday();");
    expect(CRON).toContain("quarantineExpiredHardBlockLots(today)");
    expect(STORE).toMatch(/\.update\(\{ status: "quarantine" \}\)\s*\.eq\("id", lot\.id\)\s*\.eq\("status", "active"\)/);
    expect(STORE).toContain("recordAudit(");
  });

  it("the Issues tab no longer says the state forbids expired sales", () => {
    expect(ISSUES).not.toContain("Expired product may not be sold");
    expect(ISSUES).toContain("D36");
  });
});
