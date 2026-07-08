/**
 * tests/compliance/media-suggest.test.ts — Slice H10c (KB-grounded media
 * suggestions).
 *
 * Pins the PURE helpers behind the "suggest ALL fields" action: signal
 * derivation from the asset row, the single structured instruction (vision
 * verdict + title + description + alt in ONE call, grounded in KB facts —
 * never literal-pixel prose), and defensive JSON parsing of the model reply.
 */
import { describe, it, expect } from "vitest";
import {
  entityNameFromTitle,
  deriveCategoryWord,
  nameFromFilename,
  buildMediaSuggestInstruction,
  parseMediaSuggestResponse,
  safeUsageType,
} from "@/lib/media/suggest-core";
import { VISION_SUBJECTS } from "@/lib/media/classify-core";

describe("entityNameFromTitle", () => {
  it("strips the importer's '(harvested)' marker", () => {
    expect(entityNameFromTitle("Alpha Crux Llc (harvested)")).toBe("Alpha Crux Llc");
  });
  it("passes plain titles through and tolerates null", () => {
    expect(entityNameFromTitle("Fairwinds")).toBe("Fairwinds");
    expect(entityNameFromTitle(null)).toBe("");
    expect(entityNameFromTitle("  ")).toBe("");
  });
});

describe("deriveCategoryWord", () => {
  it("finds edibles from the crawl path", () => {
    expect(deriveCategoryWord({ path: "/edibles/cosmic-crunch.jpg" })).toBe("edibles");
  });
  it("finds rosin from the filename", () => {
    expect(deriveCategoryWord({ filename: "constellation-rosin-jar.png" })).toBe("rosin");
  });
  it("finds a category from tags when path/filename are silent", () => {
    expect(deriveCategoryWord({ tags: ["harvested", "beverage"] })).toBe("beverage");
  });
  it("returns '' when nothing matches", () => {
    expect(deriveCategoryWord({ path: "/about", filename: "team.jpg" })).toBe("");
  });
});

describe("nameFromFilename", () => {
  it("turns the Rosinade crawl filename into a product-ish name", () => {
    expect(nameFromFilename("Constellation-Rosinade-Lemonade-640x1156.png")).toBe(
      "Constellation Rosinade Lemonade",
    );
  });
  it("strips @2x retina suffixes and underscores", () => {
    expect(nameFromFilename("blue_dream_cart-800x800@2x.webp")).toBe("blue dream cart");
  });
  it("tolerates null/empty", () => {
    expect(nameFromFilename(null)).toBe("");
    expect(nameFromFilename("")).toBe("");
  });
});

describe("buildMediaSuggestInstruction", () => {
  const input = {
    groundedBlock: "Legal Edibles descriptors you may draw from: gummy, chocolate, beverage.",
    entityBlock: "About Constellation: rosin-first producer.\nConstellation mission: solventless everything.",
    entityName: "Constellation",
    derivedName: "Constellation Rosinade Lemonade",
    filename: "Constellation-Rosinade-Lemonade-640x1156.png",
    currentUsageType: "vendor-logo",
  };

  it("asks for STRICT JSON with all four fields", () => {
    const p = buildMediaSuggestInstruction(input);
    expect(p).toContain("STRICT JSON");
    for (const key of ["vision_subject", "title", "description", "alt_text"]) {
      expect(p).toContain(key);
    }
  });

  it("embeds the closed vision vocabulary", () => {
    const p = buildMediaSuggestInstruction(input);
    for (const s of VISION_SUBJECTS) expect(p).toContain(s);
  });

  it("includes the KB facts and company copy, and forbids pixel narration", () => {
    const p = buildMediaSuggestInstruction(input);
    expect(p).toContain("Legal Edibles descriptors");
    expect(p).toContain("rosin-first producer");
    expect(p).toContain("solventless everything");
    expect(p).toMatch(/Do NOT narrate pixels/);
  });

  it("flags the import-time category as possibly wrong", () => {
    const p = buildMediaSuggestInstruction(input);
    expect(p).toContain("Imported as: vendor-logo");
    expect(p).toMatch(/may be wrong/i);
  });

  it("works with no grounding at all (thin but valid prompt)", () => {
    const p = buildMediaSuggestInstruction({});
    expect(p).toContain("STRICT JSON");
    expect(p).toContain("(none)");
  });
});

describe("parseMediaSuggestResponse", () => {
  it("parses clean JSON", () => {
    const r = parseMediaSuggestResponse(
      JSON.stringify({
        vision_subject: "product-packaging",
        title: "Rosinade Lemonade",
        description: "A solventless rosin-infused lemonade beverage from Constellation.",
        alt_text: "Constellation Rosinade Lemonade rosin-infused beverage can",
      }),
    );
    expect(r.visionSubject).toBe("product-packaging");
    expect(r.title).toBe("Rosinade Lemonade");
    expect(r.description).toContain("rosin-infused");
    expect(r.altText).toContain("beverage can");
  });

  it("tolerates code fences and prose around the JSON", () => {
    const r = parseMediaSuggestResponse(
      'Sure! Here it is:\n```json\n{"vision_subject":"logo-wordmark","title":"Fairwinds Logo","description":"d","alt_text":"a"}\n```',
    );
    expect(r.visionSubject).toBe("logo-wordmark");
    expect(r.title).toBe("Fairwinds Logo");
  });

  it("drops unknown vision_subject values instead of trusting them", () => {
    const r = parseMediaSuggestResponse(
      '{"vision_subject":"spaceship","title":"T","description":"D","alt_text":"A"}',
    );
    expect(r.visionSubject).toBeNull();
    expect(r.title).toBe("T");
  });

  it("salvages non-JSON replies as a description and never throws", () => {
    const r = parseMediaSuggestResponse("A rosin-infused lemonade can from Constellation.");
    expect(r.visionSubject).toBeNull();
    expect(r.description).toContain("lemonade");
    expect(parseMediaSuggestResponse("")).toEqual({
      visionSubject: null,
      title: "",
      description: "",
      altText: "",
    });
  });

  it("strips wrapping quotes and squashes whitespace in fields", () => {
    const r = parseMediaSuggestResponse(
      '{"vision_subject":"other","title":"\\"Padded  Title\\"","description":"  a   b  ","alt_text":"x"}',
    );
    expect(r.title).toBe("Padded Title");
    expect(r.description).toBe("a b");
  });
});

describe("safeUsageType", () => {
  it("passes valid taxonomy ids and blanks junk", () => {
    expect(safeUsageType("product")).toBe("product");
    expect(safeUsageType("vendor-logo")).toBe("vendor-logo");
    expect(safeUsageType("spaceship")).toBe("");
    expect(safeUsageType(null)).toBe("");
  });
});
