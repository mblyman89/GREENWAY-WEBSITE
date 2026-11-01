/**
 * R-CART-1 (owner, first trading day, 2026-11-01): "in the employee drop down
 * in the back office, the exceptions page, there is several of these
 * messages. what should we do about it." ... "Invalid cart adjustment:
 * variantId must be a UUID." (31 open, Sales Register 1.)
 *
 * Root cause: the register's variantId is the MENU variant id
 * (menu_variants.source_variant_id, TEXT, migration 0002; api/pos/menu mints
 * `${item.id}-default`; receiving intake mints `${lotKey}-onboarded`;
 * custom-sale-core mints `pos-custom-<uid>`). The S3 tracker demanded a UUID,
 * so every minus / remove with an item went to the exception queue.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isMenuVariantId,
  planCartAdjustReplay,
  REPLAY_RESOLUTION_NOTE,
  STRANDED_UUID_REASON,
  validateCartAdjustPayload,
  __runCartAdjustTests,
} from "../../src/lib/pos/cart-adjust-core";
import { ONBOARDED_VARIANT_SUFFIX } from "../../src/lib/pos/variant-lot-core";
import { LEAFLY_DEFAULT_VARIANT_SUFFIX } from "../../src/lib/pos/leafly-register-lines-core";
import { CUSTOM_PRODUCT_PREFIX } from "../../src/lib/pos/custom-sale-core";

const root = join(__dirname, "..", "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("R-CART-1 cart adjustment variant id", () => {
  it("self-tests pass", () => {
    expect(() => __runCartAdjustTests()).not.toThrow();
  });

  it("accepts every variant id shape the register really sends", () => {
    const ids = [
      `WA-LOT-0042${ONBOARDED_VARIANT_SUFFIX}`, // receiving intake
      `pos-abc123${LEAFLY_DEFAULT_VARIANT_SUFFIX}`, // single-price item, api/pos/menu
      `${CUSTOM_PRODUCT_PREFIX}7f3a`, // custom sale line
      "pos-cult-4411-9c2e1b", // Cultivera import scheme
    ];
    for (const id of ids) {
      expect(isMenuVariantId(id)).toBe(true);
      expect(validateCartAdjustPayload({ action: "qty_decrease", variantId: id, unitsRemoved: 1, valueMinor: 1870 }).ok).toBe(true);
      expect(validateCartAdjustPayload({ action: "line_remove", variantId: id, unitsRemoved: 3, valueMinor: 5610 }).ok).toBe(true);
    }
  });

  it("the old UUID message can no longer be produced", () => {
    expect(src("src/lib/pos/cart-adjust-core.ts")).not.toContain('errors.push("variantId must be a UUID.")');
  });

  it("still refuses garbage", () => {
    for (const bad of ["", "  ", "x".repeat(201), "a\u0000b", 7]) {
      expect(isMenuVariantId(bad)).toBe(false);
    }
  });

  it("replay records only stranded, still-open, now-valid rows", () => {
    const base = {
      eventType: "cart_adjustment",
      status: "exception",
      resolvedAt: null,
      exceptionReason: STRANDED_UUID_REASON,
      payload: { action: "qty_decrease", variantId: "L1-onboarded", productName: "OG Kush (1g)", unitsRemoved: 1, valueMinor: 1870 },
    };
    const plan = planCartAdjustReplay([
      { ...base, id: "a", clientUuid: "ca" },
      { ...base, id: "b", clientUuid: "cb", resolvedAt: "2026-11-01T18:00:00Z" },
      { ...base, id: "c", clientUuid: "cc", eventType: "sale" },
      { ...base, id: "d", clientUuid: "cd", exceptionReason: "Unknown event type." },
    ]);
    expect(plan.record.map((r) => r.id)).toEqual(["a"]);
    expect(plan.leave.map((r) => r.id)).toEqual(["d"]);
    expect(REPLAY_RESOLUTION_NOTE.length).toBeGreaterThanOrEqual(5); // resolvePosException minimum
  });

  it("sync and replay share one insert; replay resolves by compare-and-set", () => {
    const store = src("src/lib/pos/sync-store.ts");
    expect(store.match(/\.from\("pos_cart_adjustments"\)\.upsert\(/g)?.length).toBe(1);
    expect(store).toMatch(/onConflict: "client_uuid", ignoreDuplicates: true/);
    const replay = store.slice(store.indexOf("export async function replayStrandedCartAdjustments"));
    expect(replay).toMatch(/\.eq\("exception_reason", STRANDED_UUID_REASON\)/);
    expect(replay).toMatch(/\.is\("resolved_at", null\)[\s\S]*\.select\("id"\)/);
    expect(replay.indexOf("insertCartAdjustment(")).toBeLessThan(replay.indexOf("resolution_note: REPLAY_RESOLUTION_NOTE"));
  });

  it("the exceptions page offers the button behind staffing.manage, audited", () => {
    const actions = src("src/app/admin/registers/exceptions/actions.ts");
    const fn = actions.slice(actions.indexOf("export async function recordStrandedCartAdjustmentsAction"));
    expect(fn).toMatch(/requirePermission\("staffing\.manage"\)/);
    expect(fn).toMatch(/action: "pos\.cart_adjustments_replayed"/);
    expect(src("src/app/admin/registers/exceptions/page.tsx")).toMatch(/recordStrandedCartAdjustmentsAction/);
  });
});
