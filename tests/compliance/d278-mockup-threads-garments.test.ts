/**
 * D278 - mockup thread colours (grey-logo preview bug), mockup image fallback,
 * owner-requested blanks with Printful File-guidelines sizes, and "My garments".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BLANKS, getBlank } from "@/lib/merch-studio/garment-catalog-core";
import { __runPrintExportTests } from "@/lib/merch-studio/print-export-core";
import { __runSavedGarmentsTests, SAVED_GARMENTS_KEY } from "@/lib/merch-studio/saved-garments-core";
import { BLANK_CATEGORY, CATEGORY_SLUGS } from "../../merch-site/lib/catalog-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("D278", () => {
  it("mockups carry the order's per-file options (auto_thread_color) so logos aren't rendered grey", () => {
    expect(__runPrintExportTests().failed).toBe(0);
    expect(read("src/app/admin/merch-studio/proof-actions.ts")).toContain("FILE_OPTION_IDS");
    expect(read("src/components/admin/merch-studio/ProofPanel.tsx")).toContain("function MockupImg");
  });
  it("adds every requested garment, mapped to a shop page", () => {
    for (const id of ["ua-1379757", "ad-a401", "ind-prm50ptpd", "socco-sc200", "col-212478", "col-212483", "col-212488", "col-212471", "col-pfg-tamiami", "col-212477", "col-186210"]) {
      expect(getBlank(id), id).toBeTruthy();
      expect(CATEGORY_SLUGS).toContain(BLANK_CATEGORY[id]);
    }
    expect(BLANKS.some((b) => b.printfulId === 428)).toBe(false); // boxer briefs = cut-and-sew, explained in the UI
    expect(read("src/components/admin/merch-studio/CatalogPanel.tsx")).toContain("Boxer Briefs (#428) are cut-and-sew");
  });
  it("saves garments on the server", () => {
    expect(__runSavedGarmentsTests().failed).toBe(0);
    expect(SAVED_GARMENTS_KEY).toBe("merch_saved_garments");
    expect(read("src/app/admin/merch-studio/saved-garments-actions.ts")).toContain('requirePermission("content.edit")');
  });
});
