/**
 * tests/compliance/d244-r13-sop-round4.test.ts - D244 round 4, slice R-13.
 *
 * SOP-10 v1.2, the printable sheet / HelpPanel steps, the Concierge, Help and
 * the SOP Library teach the round-4 features: R-11 (Remove text queue on the
 * Copilot and Vendor kits, facts/AI first) and R-12 (Bulk AI select + approve).
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sopForStage } from "@/lib/catalog/sop-core";
import { SOP_CATALOG } from "@/lib/sop-library/catalog-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("SOP-10 v1.2", () => {
  const doc = read("docs/sop/SOP-10-product-enrichment.md");
  it("is version 1.2 with a history row", () => {
    expect(doc).toMatch(/\| \*\*Version\*\* \| 1\.[2-9] \(D244 R-\d+/);
    expect(doc).toMatch(/\| 1\.2 \| D244 R-13 \|/);
  });
  it("quotes the owner for both round-4 features", () => {
    expect(doc).toContain("I want to draw a box on all product images, then click the remove text button.");
    expect(doc).toContain("to be able to select one or all drafts waiting for me to approve.");
  });
  it("teaches facts first, the queue and bulk approve with the real button names", () => {
    for (const s of ["**Facts and AI first, photo last.**", "### 4.14", "Use as the kit photo", "**Select all**", "**Approve selected**", "**⚡ Approve every draft at 80%+**", "Approving never publishes"]) expect(doc, s).toContain(s);
  });
  it("every source-map file exists", () => {
    const files = [...doc.matchAll(/`(src\/[^`]+\.tsx?)`/g)].map((m) => m[1]);
    expect(files).toEqual(expect.arrayContaining(["src/lib/enrichment/bulk-approve-core.ts", "src/components/admin/products/RemoveTextQueue.tsx"]));
    for (const f of files) expect(existsSync(join(ROOT, f)), f).toBe(true);
  });
});

describe("sheet, Concierge, Help and SOP Library", () => {
  it("the printable sheet says facts first, the queue and bulk approve (3–10 steps)", () => {
    const steps = sopForStage("enrich").steps;
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(10);
    const t = steps.join(" ");
    expect(t).toContain("Facts and AI first, photo last");
    expect(t).toContain("press ✂ Remove text once");
    expect(t).toContain("Approve every draft at 80%+");
  });
  it("the Concierge and Help know both", () => {
    const kb = read("src/lib/admin/concierge-kb.ts");
    expect(kb).toContain("Remove text from several photos (D244 R-11)");
    expect(kb).toContain("Facts and AI first, photo last (D244 R-11)");
    expect(kb).toContain("Bulk approve (D244 R-12)");
    const help = read("src/lib/admin/help-content.ts");
    expect(help).toContain("Can I approve many AI drafts at once on Bulk AI?");
    expect(help).toContain("Can I remove text from several photos at once (Copilot or Vendor kits)?");
  });
  it("the SOP Library entry is findable by the new words", () => {
    const meta = SOP_CATALOG.find((m) => m.file === "SOP-10-product-enrichment.md");
    expect(meta?.keywords).toEqual(expect.arrayContaining(["approve all", "select all", "queue"]));
  });
});
