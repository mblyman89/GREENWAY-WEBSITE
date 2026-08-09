/**
 * tests/compliance/enrichment-research-core.test.ts — SLICE 74.
 *
 * Pins the pure edges of the "Research this product on the web" flow
 * (src/lib/enrichment/research-core.ts). Owner: "I want to add a specific
 * product lookup from the internet using gpt or crawl4ai in the product
 * detail page of the enrichment process… deep researching the web
 * intelligently."
 *
 * Guardrail pinned throughout: DRAFTS ONLY — these helpers never touch an
 * enrichment; they validate, pack, parse, and narrate.
 */
import { describe, it, expect } from "vitest";
import {
  validateResearchUrl,
  buildWebSearchUrl,
  packImageCandidates,
  parseImageDraftLines,
  researchOutcomeMessage,
  MAX_RESEARCH_IMAGE_LINES,
  RESEARCH_IMAGES_FIELD,
  __runProductResearchCoreTests,
} from "@/lib/enrichment/research-core";

describe("SLICE 74 — research-core (deep product web research)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runProductResearchCoreTests()).not.toThrow();
  });

  it("accepts only real public http(s) URLs", () => {
    expect(validateResearchUrl("https://example.com/products/gg4").ok).toBe(true);
    expect(validateResearchUrl("  https://example.com/x  ").ok).toBe(true);
    expect(validateResearchUrl("").ok).toBe(false);
    expect(validateResearchUrl("example.com/no-scheme").ok).toBe(false);
    expect(validateResearchUrl("ftp://example.com/file").ok).toBe(false);
    expect(validateResearchUrl("https://localhost/x").ok).toBe(false);
  });

  it("failed validation always explains itself in plain English", () => {
    const r = validateResearchUrl("not a url");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(10);
  });

  it("search link pre-fills brand + name on Google, URL-encoded, never empty", () => {
    expect(buildWebSearchUrl("Grape Gas 3.5g", "Phat Panda")).toBe(
      "https://www.google.com/search?q=Phat%20Panda%20Grape%20Gas%203.5g",
    );
    expect(buildWebSearchUrl("Blue Dream", null)).toBe("https://www.google.com/search?q=Blue%20Dream");
    expect(buildWebSearchUrl("   ", "")).toBe("https://www.google.com/search?q=cannabis%20product");
  });

  it("packs image candidates: dedupes, drops junk and SVGs, caps the list", () => {
    expect(
      packImageCandidates([
        "https://cdn.example.com/a.jpg",
        "not a url",
        "https://cdn.example.com/a.jpg",
        "https://cdn.example.com/logo.svg",
        "http://cdn.example.com/b.png",
      ]),
    ).toBe("https://cdn.example.com/a.jpg\nhttp://cdn.example.com/b.png");
    expect(packImageCandidates([])).toBe("");
    const many = packImageCandidates(
      Array.from({ length: 30 }, (_, i) => `https://cdn.example.com/img-${i}.jpg`),
    );
    expect(many.split("\n")).toHaveLength(MAX_RESEARCH_IMAGE_LINES);
  });

  it("draft body round-trips through parseImageDraftLines", () => {
    const packed = packImageCandidates(["https://cdn.example.com/a.jpg", "http://cdn.example.com/b.png"]);
    expect(parseImageDraftLines(packed)).toEqual([
      "https://cdn.example.com/a.jpg",
      "http://cdn.example.com/b.png",
    ]);
    expect(parseImageDraftLines("junk\n\n")).toEqual([]);
    expect(parseImageDraftLines(null)).toEqual([]);
  });

  it("outcome message is honest: error wins, counts are plural-correct, empty-handed admits it", () => {
    expect(researchOutcomeMessage({ draftsWritten: 2, imageCandidates: 5 })).toBe(
      "Research finished — 2 drafts written and 5 image candidates found. Review below; nothing is applied until you approve it.",
    );
    expect(researchOutcomeMessage({ draftsWritten: 1, imageCandidates: 0 })).toContain("1 draft written");
    expect(researchOutcomeMessage({ draftsWritten: 0, imageCandidates: 0 })).toContain("nothing usable");
    expect(
      researchOutcomeMessage({ draftsWritten: 3, imageCandidates: 0, error: "HTTP 403" }),
    ).toBe("Research failed: HTTP 403");
  });

  it("research_images is a stable reference field key", () => {
    expect(RESEARCH_IMAGES_FIELD).toBe("research_images");
  });
});
