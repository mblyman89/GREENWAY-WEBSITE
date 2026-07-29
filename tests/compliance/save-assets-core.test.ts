/**
 * SLICE 90 — vitest mirror for save-assets-core: the module that makes the
 * previously SILENT description saves visible on every vendor-menu "save
 * image" flow (Cultivera detail strains, Cultivera single-item KB save,
 * LeafLink + GrowFlow per-item image saves). Pins the outcome decision order,
 * the plain-English sentences, the multi-strain summary, and the new button
 * labels the owner asked for ("Save all assets"-style).
 */
import { describe, it, expect } from "vitest";
import {
  decideDescriptionOutcome,
  descriptionOutcomeSentence,
  strainDescriptionsSentence,
  saveAllAssetsLabel,
  SAVE_ASSETS_ITEM_LABEL,
  __runSaveAssetsCoreTests,
} from "@/lib/purchasing/save-assets-core";

describe("save-assets-core", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runSaveAssetsCoreTests()).not.toThrow();
  });

  it("decides outcomes in precedence order: none > blocked > unwritten > kept > saved", () => {
    const base = { provided: true, blocked: false, existingHadDescription: false, wroteProduct: true };
    expect(decideDescriptionOutcome({ ...base, provided: false })).toBe("none_provided");
    expect(decideDescriptionOutcome({ ...base, blocked: true, wroteProduct: false })).toBe(
      "blocked_noncompliant",
    );
    expect(decideDescriptionOutcome({ ...base, wroteProduct: false })).toBe("kb_unavailable");
    expect(decideDescriptionOutcome({ ...base, existingHadDescription: true })).toBe("kept_existing");
    expect(decideDescriptionOutcome(base)).toBe("saved");
  });

  it("renders an honest sentence for every outcome (and silence for null)", () => {
    expect(descriptionOutcomeSentence("saved", false)).toBe(
      " The vendor's description was saved to the Knowledge Base with it.",
    );
    expect(descriptionOutcomeSentence("saved", true)).toContain("flagged stand-in");
    expect(descriptionOutcomeSentence("kept_existing", false)).toContain("never overwritten");
    expect(descriptionOutcomeSentence("none_provided", false)).toContain("no description");
    expect(descriptionOutcomeSentence("blocked_noncompliant", false)).toContain("compliance");
    expect(descriptionOutcomeSentence("kb_unavailable", false)).toContain("could not be written");
    expect(descriptionOutcomeSentence(null, false)).toBe("");
    expect(descriptionOutcomeSentence(null, true)).toBe("");
  });

  it("summarizes multi-strain description saves", () => {
    expect(strainDescriptionsSentence({ saved: 3, kept: 2, fallbacks: 1 })).toBe(
      " Descriptions: 3 saved to the Knowledge Base, 2 kept (already curated — never overwritten)." +
        " 1 used the product-line description as a flagged stand-in.",
    );
    expect(strainDescriptionsSentence({ saved: 0, kept: 0, fallbacks: 0 })).toBe(
      " Descriptions: none were available to save.",
    );
    expect(strainDescriptionsSentence({ saved: 1, kept: 0, fallbacks: 0 })).toBe(
      " Descriptions: 1 saved to the Knowledge Base.",
    );
  });

  it("pins the new button labels", () => {
    expect(saveAllAssetsLabel(12)).toBe("Save all assets to KB (12 strains)");
    expect(saveAllAssetsLabel(1)).toBe("Save all assets to KB (1 strain)");
    expect(saveAllAssetsLabel(0)).toBe("Save all assets to KB");
    expect(saveAllAssetsLabel(undefined)).toBe("Save all assets to KB");
    expect(SAVE_ASSETS_ITEM_LABEL).toBe("Save assets");
  });
});
