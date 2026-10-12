/**
 * R49 S7 -- "Research with Google Gemini (step 1)" wiring pins.
 *
 * Pins the Google "Grounding with Google Search" terms guarantees
 * (ai.google.dev/gemini-api/terms): results shown with Search Suggestions,
 * nothing stored automatically, grounded links never handed to the crawler.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { __runVendorGeminiResearchTests } from "@/lib/vendors/vendor-gemini-research-core";

const read = (p: string) => readFileSync(p, "utf8");
const PAGE = read("src/app/admin/vendors/[id]/page.tsx");
const CARD = read("src/app/admin/vendors/[id]/VendorGeminiResearchCard.tsx");
const ACTIONS = read("src/app/admin/vendors/gemini-actions.ts");

describe("R49 S7 vendor Gemini research", () => {
  it("pure core self-tests pass", () => {
    const r = __runVendorGeminiResearchTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(58);
  });

  it("card sits before the crawler card, which is labelled step 2", () => {
    const card = PAGE.indexOf("<VendorGeminiResearchCard");
    const crawler = PAGE.indexOf("🔎 Research with the crawler (step 2)");
    const ai = PAGE.indexOf("✨ Research with AI");
    expect(card).toBeGreaterThan(ai);
    expect(crawler).toBeGreaterThan(card);
    expect(CARD).toContain("Research with Google Gemini (step 1)");
  });

  it("crawler step 2 is prefilled only from the saved website", () => {
    expect(PAGE).toContain('defaultValue={vendor.website ?? ""}');
    // No hand-off from the grounded card to the crawler input.
    expect(CARD).not.toMatch(/getElementById|crawlVendorAction|crawlerInputId/);
  });

  it("grounded results render with Google Search Suggestions", () => {
    expect(CARD).toContain("<GoogleSearchSuggestions html={result.searchSuggestions} />");
  });

  it("research action stores nothing; only the explicit save persists a draft", () => {
    const research = ACTIONS.slice(
      ACTIONS.indexOf("export async function vendorGeminiResearchAction"),
      ACTIONS.indexOf("export async function vendorGeminiSaveAction"),
    );
    expect(research).not.toContain("persistSuggestion");
    expect(research).not.toMatch(/searchSuggestions:\s*ws\.searchSuggestions[^\n]*\n[^]*recordAudit/);
    // The audit row carries counts, never the suggestion HTML or links.
    const audit = research.slice(research.indexOf("recordAudit"), research.indexOf("return {"));
    expect(audit).not.toMatch(/searchSuggestions|sources:|citations:\s*ws/);
    const save = ACTIONS.slice(ACTIONS.indexOf("export async function vendorGeminiSaveAction"));
    expect(save).toContain("persistSuggestion");
    expect(save).toContain("validateGeminiSave(");
  });

  it("both actions require vendors.manage", () => {
    expect(ACTIONS.match(/requirePermission\("vendors\.manage"\)/g)?.length).toBe(2);
  });
});
