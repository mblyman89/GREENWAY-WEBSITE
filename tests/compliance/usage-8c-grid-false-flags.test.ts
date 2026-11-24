import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  GRID_FALSE_DROPPED_FLAGS,
  GRID_SERVER_ONLY_FIELDS,
  toMenuGridItems,
  __runMenuGridProjectionTests,
} from "@/lib/menu/menu-grid-projection-core";
import { isItemDohCompliant } from "@/lib/menu/menu-doh-core";
import type { GreenwayMenuItem } from "@/lib/leafly/types";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const item = (over: Record<string, unknown>) =>
  ({ id: "x", name: "X", category: "flower", variants: [], compounds: [], ...over }) as unknown as GreenwayMenuItem;

describe("USAGE-8c: shop grid drops false flags and server-only stamps", () => {
  it("self-test passes", () => {
    expect(__runMenuGridProjectionTests().failed).toBe(0);
  });
  it("false flags and strainTypeSource are absent; true flags survive", () => {
    const [p] = toMenuGridItems([item({ hidden: false, dohCompliant: false, imageIsFallback: false, strainTypeSource: "reviewer" })]);
    for (const f of [...GRID_FALSE_DROPPED_FLAGS, ...GRID_SERVER_ONLY_FIELDS]) expect(p).not.toHaveProperty(f);
    const [q] = toMenuGridItems([item({ hidden: true, dohCompliant: true, imageIsFallback: true })]);
    expect(q).toMatchObject({ hidden: true, dohCompliant: true, imageIsFallback: true });
  });
  it("the flags are optional in the type and every client reader treats absent as false", () => {
    const types = read("src/lib/leafly/types.ts");
    for (const f of [...GRID_FALSE_DROPPED_FLAGS, ...GRID_SERVER_ONLY_FIELDS]) expect(types).toMatch(new RegExp(`\\b${f}\\?:`));
    const withFalse = item({ dohCompliant: false, dohCategory: null });
    expect(isItemDohCompliant(toMenuGridItems([withFalse])[0])).toBe(isItemDohCompliant(withFalse));
    expect(read("src/lib/menu/menu-card-fallback-core.ts")).toContain("item.imageIsFallback !== true");
    expect(read("src/components/menu/ProductCardVisual.tsx")).toContain("item.imageIsFallback ? (");
  });
  it("no client component reads strainTypeSource", () => {
    for (const f of ["src/components/menu/ShopPage.tsx", "src/components/menu/InteractiveMenuBrowser.tsx", "src/components/menu/ProductCardVisual.tsx"]) {
      expect(read(f)).not.toContain("strainTypeSource");
    }
  });
});
