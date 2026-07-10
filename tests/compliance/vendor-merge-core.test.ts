/**
 * tests/compliance/vendor-merge-core.test.ts — Task F (combine duplicate
 * vendors).
 *
 * Pins the pure duplicate-detection + merge-preview helpers behind the
 * /admin/vendors/merge page. The invariants that matter:
 *   • Detection only SUGGESTS — identical normalized name (the
 *     producer/processor multi-license case) or identical website host;
 *     archived cards never join a group.
 *   • The suggested survivor is the most complete card.
 *   • The preview follows the DB gap-fill rule exactly: only EMPTY survivor
 *     fields get filled, first duplicate wins, curated data never overwritten.
 *   • Every distinct license number is preserved in the plan.
 *   • Selection validation mirrors the DB guards (survivor ∉ duplicates,
 *     1–4 duplicates).
 */
import { describe, it, expect } from "vitest";
import {
  normalizeWebsiteHost,
  completenessScore,
  findDuplicateGroups,
  buildMergePlan,
  validateMergeSelection,
  type MergeCandidate,
} from "@/lib/vendors/merge-core";

/** Minimal candidate factory — everything empty unless overridden. */
function vendor(overrides: Partial<MergeCandidate> & { id: string }): MergeCandidate {
  return {
    display_name: "Vendor",
    legal_name: null,
    license_number: null,
    website: null,
    status: "draft",
    product_count: 0,
    brand_count: 0,
    ...overrides,
  } as MergeCandidate;
}

describe("normalizeWebsiteHost", () => {
  it("normalizes full URLs and bare hosts to the same host", () => {
    expect(normalizeWebsiteHost("https://www.QualityGrowers.com/about")).toBe("qualitygrowers.com");
    expect(normalizeWebsiteHost("qualitygrowers.com")).toBe("qualitygrowers.com");
    expect(normalizeWebsiteHost("http://qualitygrowers.com")).toBe("qualitygrowers.com");
  });

  it("returns empty for missing or unusable values", () => {
    expect(normalizeWebsiteHost(null)).toBe("");
    expect(normalizeWebsiteHost("")).toBe("");
    expect(normalizeWebsiteHost("   ")).toBe("");
    expect(normalizeWebsiteHost("localhost")).toBe(""); // no dot — not a usable signal
  });
});

describe("findDuplicateGroups", () => {
  it("groups cards with the same normalized business name (multi-license case)", () => {
    const groups = findDuplicateGroups([
      vendor({ id: "a", display_name: "Quality Growers LLC", license_number: "412345" }),
      vendor({ id: "b", display_name: "Quality Growers", license_number: "412346" }),
      vendor({ id: "c", display_name: "Totally Different Farms" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("same-name");
    expect(groups[0].vendors.map((v) => v.id).sort()).toEqual(["a", "b"]);
  });

  it("prefers legal_name for the grouping key when present", () => {
    const groups = findDuplicateGroups([
      vendor({ id: "a", display_name: "QGT", legal_name: "Quality Growers LLC" }),
      vendor({ id: "b", display_name: "Quality Growers Tacoma", legal_name: "Quality Growers Inc" }),
    ]);
    // Both legal names normalize to "quality growers" (llc/inc stripped).
    expect(groups).toHaveLength(1);
    expect(groups[0].vendors).toHaveLength(2);
  });

  it("groups by identical website host when names differ", () => {
    const groups = findDuplicateGroups([
      vendor({ id: "a", display_name: "Alpha Farms", website: "https://www.greenacres.com" }),
      vendor({ id: "b", display_name: "Green Acres Processing", website: "greenacres.com" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("same-website");
  });

  it("does not double-group: name groups claim their cards before website pass", () => {
    const groups = findDuplicateGroups([
      vendor({ id: "a", display_name: "Quality Growers", website: "qgt.com" }),
      vendor({ id: "b", display_name: "Quality Growers", website: "qgt.com" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("same-name");
  });

  it("never groups archived cards (already-merged duplicates live there)", () => {
    const groups = findDuplicateGroups([
      vendor({ id: "a", display_name: "Quality Growers" }),
      vendor({ id: "b", display_name: "Quality Growers", status: "archived" }),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("suggests the most complete card as the survivor", () => {
    const groups = findDuplicateGroups([
      vendor({ id: "sparse", display_name: "Quality Growers" }),
      vendor({
        id: "rich",
        display_name: "Quality Growers",
        about: "A great producer.",
        website: "https://qgt.com",
        logo_media_id: "media-1",
        status: "published",
        product_count: 12,
        brand_count: 2,
      }),
    ]);
    expect(groups[0].suggestedSurvivorId).toBe("rich");
    expect(groups[0].vendors[0].id).toBe("rich"); // survivor listed first
  });

  it("ignores groups larger than 5 cards (a data problem, not a merge)", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      vendor({ id: `v${i}`, display_name: "Quality Growers" }),
    );
    expect(findDuplicateGroups(many)).toHaveLength(0);
  });
});

describe("completenessScore", () => {
  it("scores a curated card above an empty one", () => {
    const empty = vendor({ id: "a" });
    const curated = vendor({
      id: "b",
      about: "About us",
      mission_statement: "Mission",
      website: "https://x.com",
      logo_media_id: "m1",
      status: "published",
    });
    expect(completenessScore(curated)).toBeGreaterThan(completenessScore(empty));
  });
});

describe("buildMergePlan", () => {
  it("fills only EMPTY survivor fields — curated data is never overwritten", () => {
    const survivor = vendor({
      id: "s",
      display_name: "Quality Growers",
      about: "Curated about copy.",
      license_number: "412345",
    });
    const dup = vendor({
      id: "d",
      display_name: "Quality Growers (Processor)",
      about: "Different about copy.",
      website: "https://qgt.com",
      license_number: "412346",
    });
    const plan = buildMergePlan(survivor, [dup]);
    const fields = plan.fills.map((f) => f.field);
    expect(fields).toContain("Website"); // empty on survivor → filled
    expect(fields).not.toContain("About"); // survivor already curated → untouched
    expect(fields).not.toContain("License number"); // survivor has its own
  });

  it("first duplicate wins when several could fill the same field", () => {
    const survivor = vendor({ id: "s", display_name: "QG" });
    const d1 = vendor({ id: "d1", display_name: "First", email: "first@x.com" });
    const d2 = vendor({ id: "d2", display_name: "Second", email: "second@x.com" });
    const plan = buildMergePlan(survivor, [d1, d2]);
    const emailFill = plan.fills.find((f) => f.field === "Email");
    expect(emailFill?.fromDisplayName).toBe("First");
  });

  it("preserves EVERY distinct license number, survivor's first", () => {
    const survivor = vendor({ id: "s", display_name: "QG", license_number: "412345" });
    const d1 = vendor({ id: "d1", display_name: "QG P", license_number: "412346" });
    const d2 = vendor({ id: "d2", display_name: "QG P2", license_number: "412345" }); // dup of survivor's
    const plan = buildMergePlan(survivor, [d1, d2]);
    expect(plan.licenses).toEqual(["412345", "412346"]);
  });

  it("lists every duplicate as archived and none as deleted", () => {
    const survivor = vendor({ id: "s", display_name: "QG" });
    const d1 = vendor({ id: "d1", display_name: "QG Producer" });
    const d2 = vendor({ id: "d2", display_name: "QG Processor" });
    const plan = buildMergePlan(survivor, [d1, d2]);
    expect(plan.archived).toEqual(["QG Producer", "QG Processor"]);
    expect(plan.duplicateIds).toEqual(["d1", "d2"]);
  });
});

describe("validateMergeSelection", () => {
  it("accepts a sound selection", () => {
    expect(validateMergeSelection("s", ["d1", "d2"])).toBeNull();
  });

  it("requires a survivor and at least one duplicate", () => {
    expect(validateMergeSelection("", ["d1"])).toBeTruthy();
    expect(validateMergeSelection("s", [])).toBeTruthy();
  });

  it("rejects the survivor doubling as a duplicate", () => {
    expect(validateMergeSelection("s", ["s", "d1"])).toBeTruthy();
  });

  it("caps duplicates at 4 per merge (mirrors the DB guard)", () => {
    expect(validateMergeSelection("s", ["a", "b", "c", "d"])).toBeNull();
    expect(validateMergeSelection("s", ["a", "b", "c", "d", "e"])).toBeTruthy();
  });

  it("de-duplicates repeated ids before validating", () => {
    expect(validateMergeSelection("s", ["a", "a", "a"])).toBeNull();
  });
});
