import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { __runGridDefaultsPackTests } from "@/lib/menu/grid-defaults-pack-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("USAGE-10a — /menu grid defaults packed", () => {
  it("the pure core passes its self-test", () => {
    const r = __runGridDefaultsPackTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(9);
  });
  it("the shop page packs and the browser unpacks before any reader", () => {
    expect(read("src/components/menu/ShopPage.tsx")).toContain("packedItems={packGridItems(menuItems)}");
    const b = read("src/components/menu/InteractiveMenuBrowser.tsx");
    const restore = b.indexOf("unpackGridItems(packedItems)");
    expect(restore).toBeGreaterThan(0);
    expect(restore).toBeLessThan(b.indexOf("resolveInitialParams(initialSearchParams)"));
  });
});
