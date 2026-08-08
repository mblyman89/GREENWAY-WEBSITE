import { describe, it, expect } from "vitest";
import {
  __runStrainDescriptionChoiceCoreTests,
  buildStrainDescriptionChoices,
  resolveChosenDescription,
  parseStrainChoices,
} from "@/lib/purchasing/strain-description-choice-core";
import type { StrainVariantLike } from "@/lib/purchasing/cultivera-kb-link-core";

const V = (name: string, description: string | null): StrainVariantLike => ({
  cleanName: name,
  name,
  description,
});

describe("strain-description-choice-core", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runStrainDescriptionChoiceCoreTests()).not.toThrow();
  });

  describe("buildStrainDescriptionChoices", () => {
    it("recommends the product description when it is genuinely good", () => {
      const c = buildStrainDescriptionChoices(
        [V("Blue Dream", "A smooth sativa-leaning hybrid with berry and herbal notes.")],
        { lineDescription: "Our signature flower line." },
      );
      expect(c).toHaveLength(1);
      expect(c[0].recommended).toBe("product");
      expect(c[0].productOption.note).toBe("");
      expect(c[0].categoryOption.available).toBe(true);
    });

    it("recommends the category when the product description is just its name", () => {
      const c = buildStrainDescriptionChoices(
        [V("Blue Dream 3.5g", "Blue Dream 3.5g")],
        { lineDescription: "Small-batch indoor flower, hand-trimmed and slow-cured." },
      );
      expect(c[0].recommended).toBe("category");
      expect(c[0].productOption.note).toBe("just its name");
      expect(c[0].recommendedText).toBe("Small-batch indoor flower, hand-trimmed and slow-cured.");
    });

    it("recommends the category when the product description is too short", () => {
      const c = buildStrainDescriptionChoices([V("Gelato", "Tasty.")], {
        lineDescription: "Premium craft cannabis grown in living soil.",
      });
      expect(c[0].recommended).toBe("category");
      expect(c[0].productOption.note).toBe("too short");
    });

    it("recommends the category when the product has no description of its own", () => {
      const c = buildStrainDescriptionChoices([V("Wedding Cake", null)], {
        lineDescription: "House flower line.",
      });
      expect(c[0].recommended).toBe("category");
      expect(c[0].productOption.available).toBe(false);
      expect(c[0].productOption.note).toBe("no description");
    });

    it("recommends the product when there is no category description", () => {
      const c = buildStrainDescriptionChoices(
        [V("Runtz", "A sweet, candy-forward hybrid with a heavy resin coat.")],
        { lineDescription: null },
      );
      expect(c[0].recommended).toBe("product");
      expect(c[0].categoryOption.available).toBe(false);
      expect(c[0].categoryOption.note).toBe("no category description");
    });

    it("omits strains with no description on either side", () => {
      const c = buildStrainDescriptionChoices([V("Mystery", null)], { lineDescription: null });
      expect(c).toHaveLength(0);
    });

    it("collapses sizes of the same strain to one choice (first non-empty own wins)", () => {
      const c = buildStrainDescriptionChoices(
        [V("Zkittlez", null), V("Zkittlez", "Loud tropical candy nose, dense colas.")],
        { lineDescription: "Line." },
      );
      expect(c).toHaveLength(1);
      expect(c[0].productOption.text).toBe("Loud tropical candy nose, dense colas.");
    });
  });

  describe("resolveChosenDescription", () => {
    it("honors an explicit product choice over the smart pick", () => {
      expect(resolveChosenDescription("Blue Dream", "Rich category description.", "product", "Blue Dream")).toBe(
        "Blue Dream",
      );
    });
    it("honors an explicit category choice over a good product", () => {
      expect(
        resolveChosenDescription("A genuinely good product description.", "Category text.", "category", "X"),
      ).toBe("Category text.");
    });
    it("never blanks: choosing an empty source falls back to the other", () => {
      expect(resolveChosenDescription(null, "Category text.", "product", "X")).toBe("Category text.");
      expect(resolveChosenDescription("Product text.", null, "category", "X")).toBe("Product text.");
    });
    it("with no explicit choice reproduces the PR-D2 smart pick", () => {
      expect(resolveChosenDescription("Gelato", "A proper category description.", null, "Gelato")).toBe(
        "A proper category description.",
      );
      expect(
        resolveChosenDescription("A proper, useful product description.", "Category.", null, "Gelato"),
      ).toBe("A proper, useful product description.");
    });
  });

  describe("parseStrainChoices", () => {
    it("keeps only valid entries and tolerates junk", () => {
      const m = parseStrainChoices({ "blue dream": "product", gelato: "category", junk: "nope", "": "product" });
      expect(m.size).toBe(2);
      expect(m.get("blue dream")).toBe("product");
      expect(m.get("gelato")).toBe("category");
      expect(parseStrainChoices(null).size).toBe(0);
      expect(parseStrainChoices("str").size).toBe(0);
    });
  });
});
