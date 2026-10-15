/**
 * tests/compliance/r51-po-stage-strip.test.ts — R51 owner item:
 *   "adding the page progression bar to the purchase order page like all the
 *    other pages have in the top section of the page."
 *
 * Source checks: every Purchasing page (list, builder, detail) renders the ONE
 * canonical pipeline bar (CatalogStageStrip) at the "order" stage, at the top of
 * the page body, exactly once.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveStageKey } from "@/lib/catalog/journey-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const PAGES = [
  "src/app/admin/purchasing/page.tsx",
  "src/app/admin/purchasing/new/page.tsx",
  "src/app/admin/purchasing/[id]/page.tsx",
];

describe("R51 — purchase order pages carry the pipeline bar", () => {
  it("'order' is a canonical journey stage", () => {
    expect(resolveStageKey("order")).toBe("order");
  });
  for (const p of PAGES) {
    it(`${p} renders <CatalogStageStrip current="order" /> exactly once, near the top`, () => {
      const src = read(p);
      const tag = '<CatalogStageStrip current="order" />';
      expect(src.split(tag).length - 1).toBe(1);
      expect(src).toContain('import { CatalogStageStrip } from "@/components/admin/catalog/CatalogStageStrip";');
      // Top section: the strip comes before the page's first <HelpPanel / <Section / <Card body block.
      const at = src.indexOf(tag);
      const body = src.indexOf('<div className="space-y-6 px-5 py-6 sm:px-8">');
      expect(body).toBeGreaterThan(-1);
      expect(at).toBeGreaterThan(body);
      for (const next of ["<HelpPanel", "<Section", "<StatCard", "<Card"]) {
        const n = src.indexOf(next, body);
        if (n > -1) expect(at).toBeLessThan(n);
      }
    });
  }
});
