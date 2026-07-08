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
  normalizeCannabinoidRatio,
  normalizeStrainType,
  titleWithRatio,
  descriptionWithStrainFacts,
  cleanStrainField,
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
      labelRatio: "",
      labelStrain: "",
      labelStrainType: "",
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

/* ------------------------------------------------------------------
 * H12b — label facts: ratios + strain read off the packaging.
 * ------------------------------------------------------------------ */

describe("normalizeCannabinoidRatio (H12b)", () => {
  it("accepts the owner's Constellation examples", () => {
    expect(normalizeCannabinoidRatio("1:1 THC:CBD")).toBe("1:1 THC:CBD");
    expect(normalizeCannabinoidRatio("2:1:1 THC:CBG:CBN")).toBe("2:1:1 THC:CBG:CBN");
  });
  it("uppercases compounds and keeps digit order", () => {
    expect(normalizeCannabinoidRatio("10:1 cbd:thc")).toBe("10:1 CBD:THC");
  });
  it("rejects count/compound mismatches — never repairs a guess", () => {
    expect(normalizeCannabinoidRatio("1:1:1 THC:CBD")).toBe("");
    expect(normalizeCannabinoidRatio("1:1 THC:CBD:CBN")).toBe("");
  });
  it("rejects unknown compounds, mg amounts, percentages, and prose", () => {
    expect(normalizeCannabinoidRatio("1:1 THC:XYZ")).toBe("");
    expect(normalizeCannabinoidRatio("100mg THC")).toBe("");
    expect(normalizeCannabinoidRatio("21% THC")).toBe("");
    expect(normalizeCannabinoidRatio("a balanced 1:1 blend")).toBe("");
    expect(normalizeCannabinoidRatio("")).toBe("");
    expect(normalizeCannabinoidRatio(null)).toBe("");
  });
});

describe("normalizeStrainType (H12b)", () => {
  it("passes the closed vocabulary through", () => {
    expect(normalizeStrainType("hybrid")).toBe("hybrid");
    expect(normalizeStrainType("Indica")).toBe("indica");
    expect(normalizeStrainType("SATIVA")).toBe("sativa");
  });
  it("folds dominant-hybrid phrasings", () => {
    expect(normalizeStrainType("indica-dominant hybrid")).toBe("indica-hybrid");
    expect(normalizeStrainType("Sativa Dominant")).toBe("sativa-hybrid");
  });
  it("blanks anything off-vocabulary — a made-up type never reaches the form", () => {
    expect(normalizeStrainType("energetic")).toBe("");
    expect(normalizeStrainType("loud")).toBe("");
    expect(normalizeStrainType(null)).toBe("");
  });
});

describe("titleWithRatio (H12b)", () => {
  it("appends the ratio to the title", () => {
    expect(titleWithRatio("Constellation CBD Shot", "1:1 THC:CBD")).toBe(
      "Constellation CBD Shot 1:1 THC:CBD",
    );
  });
  it("is idempotent — a title already carrying the digits is untouched", () => {
    expect(titleWithRatio("Constellation Shot 1:1 THC:CBD", "1:1 THC:CBD")).toBe(
      "Constellation Shot 1:1 THC:CBD",
    );
  });
  it("no ratio → title unchanged; no title → ratio stands alone", () => {
    expect(titleWithRatio("Constellation Shot", "")).toBe("Constellation Shot");
    expect(titleWithRatio("", "1:1 THC:CBD")).toBe("1:1 THC:CBD");
  });
});

describe("descriptionWithStrainFacts (H12b)", () => {
  it("appends strain name + type when the description lacks them", () => {
    expect(descriptionWithStrainFacts("A rosin-infused shot.", "Blue Dream", "hybrid")).toBe(
      "A rosin-infused shot. Label lists strain: Blue Dream, hybrid.",
    );
  });
  it("skips facts the description already mentions (case-insensitive)", () => {
    expect(
      descriptionWithStrainFacts("A Blue Dream hybrid shot.", "Blue Dream", "hybrid"),
    ).toBe("A Blue Dream hybrid shot.");
  });
  it("nothing to add → description unchanged", () => {
    expect(descriptionWithStrainFacts("A shot.", "", "")).toBe("A shot.");
  });
});

describe("cleanStrainField (H12b)", () => {
  it("passes real strain names and squashes whitespace", () => {
    expect(cleanStrainField("  Blue   Dream ")).toBe("Blue Dream");
  });
  it("blanks non-answers, URLs, JSON-ish junk, and over-long strings", () => {
    expect(cleanStrainField("unknown")).toBe("");
    expect(cleanStrainField("N/A")).toBe("");
    expect(cleanStrainField("not visible")).toBe("");
    expect(cleanStrainField("https://example.com/strain")).toBe("");
    expect(cleanStrainField('{"strain":"x"}')).toBe("");
    expect(cleanStrainField("x".repeat(61))).toBe("");
  });
});

describe("parseMediaSuggestResponse — label facts (H12b)", () => {
  it("parses and validates the three label fields, folding them into title/description", () => {
    const parsed = parseMediaSuggestResponse(
      JSON.stringify({
        vision_subject: "product-packaging",
        title: "Constellation CBD Shot",
        description: "A rosin-infused beverage shot.",
        alt_text: "Constellation cannabis beverage shot bottle with ratio label",
        label_ratio: "1:1 thc:cbd",
        label_strain: "Blue Dream",
        label_strain_type: "Hybrid",
      }),
    );
    expect(parsed.labelRatio).toBe("1:1 THC:CBD");
    expect(parsed.labelStrain).toBe("Blue Dream");
    expect(parsed.labelStrainType).toBe("hybrid");
    expect(parsed.title).toBe("Constellation CBD Shot 1:1 THC:CBD");
    expect(parsed.description).toBe(
      "A rosin-infused beverage shot. Label lists strain: Blue Dream, hybrid.",
    );
  });
  it("invalid label facts are dropped and the copy stays untouched", () => {
    const parsed = parseMediaSuggestResponse(
      JSON.stringify({
        vision_subject: "product-packaging",
        title: "Shot",
        description: "A shot.",
        alt_text: "a",
        label_ratio: "about 1 to 1",
        label_strain: "unknown",
        label_strain_type: "energetic",
      }),
    );
    expect(parsed.labelRatio).toBe("");
    expect(parsed.labelStrain).toBe("");
    expect(parsed.labelStrainType).toBe("");
    expect(parsed.title).toBe("Shot");
    expect(parsed.description).toBe("A shot.");
  });
  it("replies without the new fields still parse (backward compatible)", () => {
    const parsed = parseMediaSuggestResponse(
      JSON.stringify({ vision_subject: "logo-wordmark", title: "Fairwinds Logo", description: "d", alt_text: "a" }),
    );
    expect(parsed.labelRatio).toBe("");
    expect(parsed.title).toBe("Fairwinds Logo");
  });
  it("the instruction asks for the label fields and the never-guess rule", () => {
    const p = buildMediaSuggestInstruction({ filename: "shot.png" });
    expect(p).toContain("label_ratio");
    expect(p).toContain("label_strain");
    expect(p).toContain("label_strain_type");
    expect(p).toContain("never guess");
    expect(p).toContain("indica, sativa, hybrid, indica-hybrid, sativa-hybrid");
  });
});
