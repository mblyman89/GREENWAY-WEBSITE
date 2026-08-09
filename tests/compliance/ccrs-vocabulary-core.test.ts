import { describe, it, expect } from "vitest";
import {
  normalizeCcrsName,
  buildCcrsTypeVocabulary,
  ccrsModernTypeNames,
  isKnownCcrsType,
  canonicalizeCcrsTypeName,
  partitionCcrsNames,
  checkKbCcrsMapConsistency,
  __runCcrsVocabularyCoreTests,
  type KbCategoryForCheck,
} from "@/lib/ai/kb/ccrs-vocabulary-core";
import { PRODUCT_CATEGORIES } from "@/lib/ai/kb/product-categories-data";

describe("ccrs-vocabulary core", () => {
  it("passes its own pure self-tests", () => {
    expect(() => __runCcrsVocabularyCoreTests()).not.toThrow();
  });

  it("derives the vocabulary from the authoritative CCRS source (not hand-typed)", () => {
    const names = buildCcrsTypeVocabulary().map((e) => e.name);
    // A representative slice of Table-2 names must be present.
    expect(names).toContain("Usable Cannabis");
    expect(names).toContain("Concentrate for Inhalation");
    expect(names).toContain("Solid Edible");
    expect(names).toContain("Flower Lot");
    // No normalized duplicates.
    const norm = names.map(normalizeCcrsName);
    expect(new Set(norm).size).toBe(names.length);
  });

  it("modern names exclude legacy spellings", () => {
    const modern = ccrsModernTypeNames();
    expect(modern).toContain("Usable Cannabis");
    // 'Usable Marijuana' is a documented legacy spelling; not a modern name.
    expect(modern).not.toContain("Usable Marijuana");
  });

  it("knows real CCRS types (modern + documented legacy), never guesses typos", () => {
    expect(isKnownCcrsType("Usable Cannabis")).toBe(true);
    expect(isKnownCcrsType("  concentrate for inhalation ")).toBe(true);
    expect(isKnownCcrsType("Usable Marijuana")).toBe(true); // documented legacy
    expect(isKnownCcrsType("Usible Cannabis")).toBe(false); // typo
    expect(isKnownCcrsType("")).toBe(false);
  });

  it("canonicalizes legacy -> modern, modern -> itself, unknown -> null", () => {
    expect(canonicalizeCcrsTypeName("Usable Marijuana")).toBe("Usable Cannabis");
    expect(canonicalizeCcrsTypeName("Marijuana Mix")).toBe("Cannabis Mix");
    expect(canonicalizeCcrsTypeName("solid edible")).toBe("Solid Edible");
    expect(canonicalizeCcrsTypeName("Not A Type")).toBeNull();
  });

  it("partitions typed names into known / legacy / unknown and de-dupes", () => {
    const p = partitionCcrsNames([
      "Solid Edible",
      "solid edible",
      "Usable Marijuana",
      "Made Up",
      "",
    ]);
    expect(p.known).toEqual(["Solid Edible"]);
    expect(p.legacy).toEqual([{ input: "Usable Marijuana", canonical: "Usable Cannabis" }]);
    expect(p.unknown).toEqual(["Made Up"]);
  });

  it("flags a CCRS type mapped to two different KB categories (contradiction)", () => {
    const dup: KbCategoryForCheck[] = [
      { id: "a", slug: "a", name: "A", wa_inventory_types: ["Usable Cannabis"] },
      { id: "b", slug: "b", name: "B", wa_inventory_types: ["Usable Marijuana"] },
    ];
    const issues = checkKbCcrsMapConsistency(dup);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("duplicate-map");
  });
});

// ---------------------------------------------------------------------------
// DATA-CONSISTENCY guard on the SEEDED KB (fails CI on real drift).
//
// Honest scope: the seed's `wa_inventory_types` currently uses an OLDER WA/LCB
// vocabulary (e.g. "Hydrocarbon Wax", "Kief", "Solid Marijuana Infused Edible")
// that predates the CCRS Table-2 grounding. We do NOT guess how those remap, so
// we do NOT hard-fail on them here (they are surfaced to the operator instead,
// and Slice 3 turns them into a one-click review). What we CAN prove safely and
// must keep true as we grow:
//   1. No CCRS type is mapped to two different KB categories (a contradiction).
//   2. The set of not-yet-CCRS names doesn't silently GROW beyond the documented
//      seed baseline without us noticing (a new typo/invented name trips this).
// ---------------------------------------------------------------------------

// The exact, verified baseline of pre-CCRS names in the seed as of Slice 2.
// (Captured directly from product-categories-data.ts, not guessed.) Any NEW
// unknown name added later will exceed this set and fail the test below,
// prompting a deliberate mapping decision.
const KNOWN_LEGACY_SEED_NAMES = new Set<string>([
  "Bubble Hash",
  "CO2 Hash Oil",
  "Food Grade Solvent Extract",
  "Hash",
  "Hydrocarbon Wax",
  "Infused Cooking Oil",
  "Infused Dairy Butter or Fat in Solid Form",
  "Kief",
  "Liquid Marijuana Infused Edible",
  "Marijuana Extract for Inhalation",
  "Marijuana Infused Topicals",
  "Solid Marijuana Infused Edible",
]);

describe("seeded KB CCRS map data-consistency", () => {
  const seedCats: KbCategoryForCheck[] = PRODUCT_CATEGORIES.map((c) => ({
    id: c.slug,
    slug: c.slug,
    name: c.name,
    wa_inventory_types: c.wa_inventory_types,
  }));

  it("has NO CCRS type mapped to two different KB categories", () => {
    const dupes = checkKbCcrsMapConsistency(seedCats).filter(
      (i) => i.kind === "duplicate-map",
    );
    expect(dupes).toEqual([]);
  });

  it("does not introduce NEW unknown CCRS names beyond the documented seed baseline", () => {
    const unknownNames = new Set<string>();
    for (const c of PRODUCT_CATEGORIES) {
      for (const t of c.wa_inventory_types) {
        if (!isKnownCcrsType(t)) unknownNames.add(t);
      }
    }
    const unexpected = [...unknownNames]
      .filter((n) => !KNOWN_LEGACY_SEED_NAMES.has(n))
      .sort();
    // If this fails, a NEW not-yet-CCRS name was added: either use a real CCRS
    // name from ccrsModernTypeNames(), or (deliberately) extend the baseline.
    expect(unexpected).toEqual([]);
  });
});
