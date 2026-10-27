/**
 * R41 S1 — banner design + link target cores (bible SLICE S1).
 * Mirrors key core assertions, and guards the lists the link core COPIES from
 * the client-only InteractiveMenuBrowser (drift guard).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runBannerDesignCoreTests,
  contrastRatio,
  designFromLegacy,
  normalizeDesign,
  BRAND_SWATCHES,
} from "@/lib/cms/banner-design-core";
import {
  __runLinkTargetCoreTests,
  MENU_SORTS,
  MENU_SPECIALS,
  KNOWN_MENU_PARAMS,
  buildMenuHref,
  checkHref,
  PUBLIC_PAGES,
} from "@/lib/cms/link-target-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("R41 S1 self-tests", () => {
  it("banner-design-core passes", () => {
    const r = __runBannerDesignCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(89);
  });
  it("link-target-core passes", () => {
    const r = __runLinkTargetCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(58);
  });
  it("runner registers both suites", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertRan("banner-design-core"');
    expect(runner).toContain('assertRan("link-target-core"');
  });
});

describe("R41 S1 core behavior mirrors", () => {
  it("contrast math matches WCAG", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 2);
  });
  it("legacy conversion is enabled and bound", () => {
    const d = designFromLegacy({ title: "Hi", textAlign: "right" });
    expect(d.enabled).toBe(true);
    expect(d.boxes[0].bind).toBe("title");
    expect(d.image.focusX).toBe(0);
  });
  it("unsafe buttons are dropped", () => {
    const d = normalizeDesign({ buttons: [{ href: "javascript:alert(1)" }] });
    expect(d?.buttons.length).toBe(0);
    expect(checkHref("//evil.com").level).toBe("block");
  });
  it("menu hrefs are canonical", () => {
    expect(buildMenuHref({ categories: ["flower"], sort: "price-low" })).toBe("/menu?categories=flower&sort=price-low");
  });
});

describe("R41 S1 drift guards (copied lists must match the source)", () => {
  const menu = read("src/components/menu/InteractiveMenuBrowser.tsx");
  it("every MENU_SPECIALS key + label exists in previewSpecialCollections", () => {
    const start = menu.indexOf("const previewSpecialCollections");
    const end = menu.indexOf("satisfies Record<string, PreviewSpecialCollection>", start);
    const block = menu.slice(start, end);
    for (const s of MENU_SPECIALS) {
      expect(block).toContain(`"${s.value}": {`);
      expect(block).toContain(`label: "${s.label}"`);
    }
    const keys = [...block.matchAll(/^\s{2}"([a-z0-9-]+)": \{/gm)].map((m) => m[1]);
    expect(keys.sort()).toEqual(MENU_SPECIALS.map((s) => s.value).sort());
  });
  it("MENU_SORTS equals SORT_OPTION_VALUES and labels match SortDropdown", () => {
    const start = menu.indexOf("const SORT_OPTION_VALUES");
    const block = menu.slice(start, menu.indexOf("];", start));
    const values = [...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    expect(values).toEqual(MENU_SORTS.map((s) => s.value));
    const dropdown = read("src/components/menu/SortDropdown.tsx");
    for (const s of MENU_SORTS) expect(dropdown).toContain(`{ value: "${s.value}", label: "${s.label}"`);
  });
  it("every KNOWN_MENU_PARAMS key is read by resolveInitialParams", () => {
    for (const k of KNOWN_MENU_PARAMS) expect(menu).toContain(`pick("${k}")`);
  });
  it("every PUBLIC_PAGES route exists", () => {
    for (const p of PUBLIC_PAGES) {
      const file = p.path === "/" ? "src/app/(site)/page.tsx" : `src/app${p.path}/page.tsx`;
      expect(() => read(file)).not.toThrow();
    }
  });
  it("brand swatches come from globals.css tokens", () => {
    const css = read("src/app/globals.css");
    for (const [token, hex] of [["--greenway", "#7ed957"], ["--orange", "#ff7f00"], ["--charcoal", "#1a1a1a"], ["--gold", "#ffd700"], ["--greenway-dark", "#12351f"]]) {
      expect(css).toContain(`${token}: ${hex};`);
      expect(BRAND_SWATCHES.some((s) => s.hex === hex)).toBe(true);
    }
  });
});
