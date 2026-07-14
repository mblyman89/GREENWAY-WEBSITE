/**
 * tests/compliance/scan-to-cart-core.test.ts  (POS Slice B23)
 *
 * Vitest mirror of the scan-to-cart-core self-tests: barcode index building
 * and on-device scan resolution for the register's sale screen.
 */
import { describe, expect, it } from "vitest";
import {
  buildBarcodeIndex,
  normalizeBarcode,
  resolveScan,
  __runScanToCartCoreTests,
} from "@/lib/pos/scan-to-cart-core";
import type { PosMenuProduct } from "@/lib/pos/sale-flow-core";

const product = (productId: string, variantId: string, label: string | null): PosMenuProduct => ({
  productId,
  variantId,
  name: `Product ${productId}`,
  brand: null,
  category: "flower",
  categories: ["flower"],
  variantLabel: label,
  regularPriceMinor: 1000,
  costMinorUnits: null,
  inventoryStatus: "in-stock",
});

describe("scan-to-cart-core (POS B23)", () => {
  it("self-tests pass", () => {
    expect(() => __runScanToCartCoreTests()).not.toThrow();
  });

  it("normalizes scanner payloads (CR/LF, whitespace, case)", () => {
    expect(normalizeBarcode("  WAG-123\r\n")).toBe("wag-123");
    expect(normalizeBarcode("A  B\tC")).toBe("a b c");
  });

  it("index maps lot codes + CCRS ids to sellable product keys; drops collisions and delisted", () => {
    const idx = buildBarcodeIndex(
      [
        { lotCode: "WAG-1111", posProductKey: "prod-1", ccrsExternalId: "CCRS-AAA" },
        { lotCode: "WAG-3333", posProductKey: "prod-gone", ccrsExternalId: null },
        { lotCode: "SAME", posProductKey: "prod-1", ccrsExternalId: null },
      ],
      new Set(["prod-1"]),
    );
    expect(idx["wag-1111"]).toBe("prod-1");
    expect(idx["ccrs-aaa"]).toBe("prod-1");
    expect("wag-3333" in idx).toBe(false);
    expect(idx["same"]).toBe("prod-1");

    const collided = buildBarcodeIndex(
      [
        { lotCode: "CODE-X", posProductKey: "prod-1", ccrsExternalId: null },
        { lotCode: "CODE-X", posProductKey: "prod-2", ccrsExternalId: null },
      ],
      new Set(["prod-1", "prod-2"]),
    );
    expect("code-x" in collided).toBe(false);
  });

  it("resolves: single-variant adds, multi-variant picks, unknown falls to search", () => {
    const products = [product("prod-1", "var-1", null), product("prod-2", "var-2a", "1g"), product("prod-2", "var-2b", "3.5g")];
    const idx = { "wag-1111": "prod-1", "wag-2222": "prod-2" };

    const add = resolveScan(products, idx, "WAG-1111\n");
    expect(add.status).toBe("add");
    if (add.status === "add") expect(add.product.variantId).toBe("var-1");

    const pick = resolveScan(products, idx, "wag-2222");
    expect(pick.status).toBe("pick");
    if (pick.status === "pick") expect(pick.candidates).toHaveLength(2);

    expect(resolveScan(products, idx, "no-such-code").status).toBe("none");
    expect(resolveScan(products, idx, "abc").status).toBe("none");
    // exact product key works without an index (pre-B23 cached bundles)
    expect(resolveScan(products, undefined, "PROD-1").status).toBe("add");
    // stale index entry never resolves to a ghost product
    expect(resolveScan(products, { code: "prod-vanished" }, "code").status).toBe("none");
  });
});
