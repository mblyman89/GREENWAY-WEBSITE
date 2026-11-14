/**
 * tests/compliance/d244-r10-sop-round3.test.ts - D244 round 3, slice R-10.
 *
 * SOP-10 v1.1, the printable sheet / HelpPanel steps, the Concierge and the
 * SOP Library entry teach the three round-3 features (R-7 identity strip,
 * R-8 vendor kits, R-9 remove text), quoting the owner.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sopForStage } from "@/lib/catalog/sop-core";
import { SOP_CATALOG } from "@/lib/sop-library/catalog-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("SOP-10 v1.1", () => {
  const doc = read("docs/sop/SOP-10-product-enrichment.md");

  it("is version 1.1 or later with a 1.1 history row", () => {
    expect(doc).toMatch(/\| \*\*Version\*\* \| 1\.[1-9] \(D244 R-1\d/);
    expect(doc).toMatch(/\| 1\.1 \| D244 R-10 \|/);
  });

  it("quotes the owner for each round-3 feature", () => {
    expect(doc).toContain("Add more details about the product, like its category and type and vendor assigned to it");
    expect(doc).toContain("Many vendors use the same non labeled images for all their like kind products.");
    expect(doc).toContain("I want to drag a box over the text, then click a button to remove it.");
  });

  it("teaches the three procedures with the real button names", () => {
    for (const s of ["### 4.11", "### 4.12", "### 4.13", "Ask the AI", "Apply to N products", "✂ Remove text", "✨ Find the text (AI)", "Attach as cover", "FLUX Fill", "warning or compliance text is always kept"]) {
      expect(doc, s).toContain(s);
    }
  });

  it("every source-map file exists", () => {
    const files = [...doc.matchAll(/`(src\/[^`]+\.tsx?)`/g)].map((m) => m[1]);
    expect(files).toEqual(expect.arrayContaining(["src/lib/enrichment/text-erase-core.ts", "src/lib/enrichment/vendor-kit-core.ts", "src/lib/enrichment/product-identity-core.ts"]));
    for (const f of files) expect(existsSync(join(ROOT, f)), f).toBe(true);
  });
});

describe("sheet, Concierge and SOP Library", () => {
  it("the printable sheet has the Vendor kits and Remove text steps (3–10 steps)", () => {
    const steps = sopForStage("enrich").steps;
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(10);
    const t = steps.join(" ");
    expect(t).toContain("Vendor kits");
    expect(t).toContain("✂ Remove text");
  });

  it("the Concierge knows all three", () => {
    const kb = read("src/lib/admin/concierge-kb.ts");
    expect(kb).toContain("Identity strip (D244 R-7)");
    expect(kb).toContain("Vendor kits (D244 R-8");
    expect(kb).toContain("Remove text (D244 R-9)");
    expect(kb).toContain("flux-pro-1.0-fill");
  });

  it("the SOP Library entry is findable by the new words", () => {
    const meta = SOP_CATALOG.find((m) => m.file === "SOP-10-product-enrichment.md");
    expect(meta?.keywords).toEqual(expect.arrayContaining(["vendor kit", "remove text", "flux"]));
  });
});
