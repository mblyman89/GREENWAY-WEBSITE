/**
 * tests/compliance/d244-r6-sop10-concierge.test.ts — D244 R-6 (strategy slice E-7)
 *
 * Owner (round 2): "please finish the last 2 slices." E-7 is SOP-10 + the
 * printable `enrich` sheet + Concierge coverage. Pins:
 *  - SOP-10 exists, is in the SOP Library catalog, and states the owner's
 *    rules (photo publishes, 80%, best guesses accepted + flagged, on hand,
 *    live vs overnight, the Copilot keys) against the real constants.
 *  - The printable `enrich` sheet and the products HelpPanel are ONE list
 *    (paper and screen cannot disagree) and link the full SOP-10.
 *  - The Concierge has a product-enrichment topic whose hrefs are real routes.
 *  - Help Center answers no longer describe the old description-only helper.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SOP_CATALOG, sopSlugFromFile } from "@/lib/sop-library/catalog-core";
import { sopForStage } from "@/lib/catalog/sop-core";
import { CONCIERGE_KB } from "@/lib/admin/concierge-kb";
import { HELP_SECTIONS } from "@/lib/admin/help-content";
import { ACCEPT_ALL_THRESHOLD } from "@/lib/enrichment/ai-draft-v2-core";
import { COPILOT_KEYS } from "@/lib/enrichment/copilot-core";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const SOP = "docs/sop/SOP-10-product-enrichment.md";
const pageExists = (href: string) => {
  const path = href.split("#")[0].split("?")[0].replace(/^\/admin\/staffing\/sop-library\/[^/]+$/, "/admin/staffing/sop-library/[slug]");
  return existsSync(join(ROOT, "src", "app", path, "page.tsx"));
};

describe("SOP-10 document", () => {
  const doc = read(SOP);

  it("is in the SOP Library on the Receiving & Inventory shelf as sop-10", () => {
    const meta = SOP_CATALOG.find((m) => m.file === "SOP-10-product-enrichment.md");
    expect(meta?.category).toBe("inventory");
    expect(sopSlugFromFile("SOP-10-product-enrichment.md")).toBe("sop-10");
    expect(meta?.keywords).toEqual(expect.arrayContaining(["copilot", "overnight", "best guess", "potency"]));
  });

  it("quotes the owner and states the photo-first rule", () => {
    expect(doc).toContain("a product should be publish once it has a picture");
    expect(doc).toContain("so long as the system thinks we have at least 1 lot in stock");
    expect(doc).toContain("best guesses should auto accepted, but flagged");
  });

  it("uses the real accept-all threshold and the real Copilot keys", () => {
    expect(ACCEPT_ALL_THRESHOLD).toBe(80);
    expect(doc).toContain(`Accept all ≥ ${ACCEPT_ALL_THRESHOLD}%`);
    expect(doc).not.toMatch(/≥ 85%/);
    for (const k of ["A", "P", "N", "S", "D"]) expect(JSON.stringify(COPILOT_KEYS)).toContain(`"${k.toLowerCase()}"`);
    expect(doc).toContain("**1–9** attach photo");
  });

  it("explains live vs overnight side by side", () => {
    expect(doc).toContain("⚡ Draft now (live)");
    expect(doc).toContain("🌙 Add to the overnight batch");
    expect(doc).toContain("About half");
  });

  it("every file in the source map exists", () => {
    const files = [...doc.matchAll(/`(src\/[^`]+\.tsx?|supabase\/[^`]+\.sql)`/g)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(existsSync(join(ROOT, f)), f).toBe(true);
  });
});

describe("printable sheet and products HelpPanel are one list", () => {
  const sheet = sopForStage("enrich");
  const page = read("src/app/admin/products/page.tsx");

  it("the sheet teaches photo-first, the Copilot, 80% and live vs overnight", () => {
    const text = sheet.steps.join(" ");
    expect(text).toContain("a product goes live once it has a photo");
    expect(text).toContain("Open Copilot session");
    expect(text).toContain("80% or better");
    expect(text).toContain("overnight batch");
    expect(sheet.steps.length).toBeLessThanOrEqual(10);
  });

  it("the HelpPanel reads the sheet's steps and links SOP-10", () => {
    expect(page).toContain('steps={[...sopForStage("enrich").steps]}');
    expect(page).toContain('sopLibraryHref("sop-10")');
    expect(page).not.toContain("Use the AI helper to draft");
  });
});

describe("Concierge and Help Center coverage", () => {
  const topic = CONCIERGE_KB.find((t) => t.id === "product-enrichment");

  it("has a product-enrichment topic covering every round-2 feature", () => {
    expect(topic).toBeTruthy();
    const facts = topic!.facts.join(" ");
    for (const s of ["Photo first", "On hand", "Enrichment Copilot", "80%", "Best guess", "Looks right", "lab certificates", "overnight batch", "Save & accept", "Semantic photo search", "AI_COPILOT_MODEL", "SOP-10"]) {
      expect(facts, s).toContain(s);
    }
    expect(pageExists(topic!.href!)).toBe(true);
    expect(new Set(CONCIERGE_KB.map((k) => k.id)).size).toBe(CONCIERGE_KB.length);
  });

  it("the Copilot route the concierge names exists", () => {
    expect(pageExists("/admin/products/copilot")).toBe(true);
  });

  it("Help Center answers are current and their links resolve", () => {
    const sec = HELP_SECTIONS.find((h) => h.id === "products")!;
    const all = sec.items.map((i) => i.a).join(" ");
    expect(all).toContain("As soon as it has a photo");
    expect(all).toContain("🌙 Add to the overnight batch");
    expect(all).not.toContain("draft a description, tags, or alt-text");
    for (const i of sec.items) if (i.href) expect(pageExists(i.href), i.href).toBe(true);
  });
});
