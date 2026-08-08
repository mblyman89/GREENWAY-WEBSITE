/**
 * SLICE 85 — vitest mirror for menu-description-core (own description first,
 * category/product-line stand-in FLAGGED, mirroring the image-fallback badge)
 * plus the wiring pins that keep the fallback honest across platforms.
 */
import { describe, it, expect } from "vitest";
import {
  resolveMenuDescription,
  DESCRIPTION_FALLBACK_BADGE,
  DESCRIPTION_FALLBACK_TITLE,
  __runMenuDescriptionCoreTests,
} from "@/lib/purchasing/menu-description-core";
import { leaflinkCategoryDescription } from "@/lib/purchasing/leaflink-menu-core";
import { strainImagesToSave } from "@/lib/purchasing/cultivera-kb-link-core";

describe("menu-description-core", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runMenuDescriptionCoreTests()).not.toThrow();
  });

  it("own description always wins and is never flagged", () => {
    const r = resolveMenuDescription("Tangy gummy, 10 pack.", "Edibles for every occasion.");
    expect(r.text).toBe("Tangy gummy, 10 pack.");
    expect(r.isFallback).toBe(false);
  });

  it("category description stands in and is FLAGGED when own is missing", () => {
    const r = resolveMenuDescription("  ", "Edibles for every occasion.");
    expect(r.text).toBe("Edibles for every occasion.");
    expect(r.isFallback).toBe(true);
  });

  it("both missing -> null, unflagged", () => {
    expect(resolveMenuDescription(null, null)).toEqual({ text: null, isFallback: false, fallbackReason: "none" });
    expect(resolveMenuDescription("", "   ")).toEqual({ text: null, isFallback: false, fallbackReason: "none" });
  });

  it("badge copy is pinned (UI + docs reference these strings)", () => {
    expect(DESCRIPTION_FALLBACK_BADGE).toBe("category description");
    expect(DESCRIPTION_FALLBACK_TITLE).toContain("no description of its own");
    expect(DESCRIPTION_FALLBACK_TITLE).toContain("stand-in");
  });
});

describe("PR-D2 smart description picker", () => {
  it("without a productName, own description always wins (legacy SLICE 85)", () => {
    const r = resolveMenuDescription("Blue Dream", "A smooth, uplifting hybrid.");
    expect(r.text).toBe("Blue Dream");
    expect(r.isFallback).toBe(false);
    expect(r.fallbackReason).toBe("none");
  });

  it("good own prose still wins when a productName is provided", () => {
    const r = resolveMenuDescription(
      "A smooth, uplifting hybrid with notes of berry and citrus.",
      "Generic flower category prose.",
      "Blue Dream",
    );
    expect(r.isFallback).toBe(false);
    expect(r.fallbackReason).toBe("none");
  });

  it("own description that is just the NAME -> category stands in (name_echo)", () => {
    const r = resolveMenuDescription(
      "Blue Dream 3.5g",
      "Hang-dried, hand-trimmed flower for a smooth, terpene-rich smoke.",
      "Blue Dream",
    );
    expect(r.isFallback).toBe(true);
    expect(r.fallbackReason).toBe("name_echo");
    expect(r.text).toContain("Hang-dried");
  });

  it("own description too thin -> category stands in (low_value)", () => {
    const r = resolveMenuDescription(
      "Indica",
      "A deeply relaxing indica-dominant selection for winding down.",
      "Northern Lights",
    );
    expect(r.isFallback).toBe(true);
    expect(r.fallbackReason).toBe("low_value");
  });

  it("weak own but NO category prose -> keep the weak own text, never blank it", () => {
    const r = resolveMenuDescription("Blue Dream", null, "Blue Dream");
    expect(r.text).toBe("Blue Dream");
    expect(r.isFallback).toBe(false);
    expect(r.fallbackReason).toBe("none");
  });
});

describe("SLICE 85 wiring", () => {
  it("leaflinkCategoryDescription reads the pinned raw.category.description (HTML stripped)", () => {
    expect(
      leaflinkCategoryDescription({
        category: { id: 7, name: "Edibles", slug: "edibles", description: "<p>Edibles for every occasion.</p>" },
      }),
    ).toBe("Edibles for every occasion.");
    expect(leaflinkCategoryDescription({ category: { id: 7, name: "Edibles" } })).toBeNull();
    expect(leaflinkCategoryDescription(null)).toBeNull();
  });

  it("strainImagesToSave carries descriptions: own first, line stand-in flagged", () => {
    const saves = strainImagesToSave(
      [
        { cleanName: "Colorado Nightshifter", imageUrl: "https://c/cn.png", description: "GMO x Nightshift" },
        { cleanName: "Super Zulu", imageUrl: null },
      ],
      { brand: "SubX", lineImageUrl: "https://c/card.png", lineDescription: "Our signature flower line." },
    );
    expect(saves).toHaveLength(2);
    expect(saves[0].description).toBe("GMO x Nightshift");
    expect(saves[0].descriptionIsFallback).toBe(false);
    expect(saves[1].description).toBe("Our signature flower line.");
    expect(saves[1].descriptionIsFallback).toBe(true);
  });

  it("strainImagesToSave with no descriptions anywhere -> null, unflagged", () => {
    const saves = strainImagesToSave(
      [{ cleanName: "Ghosted", imageUrl: "https://c/g.png" }],
      { brand: "SubX", lineImageUrl: null },
    );
    expect(saves[0].description).toBeNull();
    expect(saves[0].descriptionIsFallback).toBe(false);
  });
});
