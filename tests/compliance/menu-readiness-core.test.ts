import { describe, it, expect } from "vitest";
import {
  __runMenuReadinessCoreTests,
  scoreMenuReadiness,
  gradeDescription,
  isMenuReady,
} from "@/lib/purchasing/menu-readiness-core";

const GOOD_DESC = "A smooth, sativa-leaning hybrid with bright citrus and pine on the nose.";

describe("menu-readiness-core", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runMenuReadinessCoreTests()).not.toThrow();
  });

  it("scores a fully-filled product as 100% / complete / menu-ready", () => {
    const r = scoreMenuReadiness({
      hasImage: true,
      description: GOOD_DESC,
      productName: "Blue Dream",
      category: "Flower",
      aromaNotes: ["citrus", "pine"],
      flavorNotes: ["berry"],
    });
    expect(r.percent).toBe(100);
    expect(r.level).toBe("complete");
    expect(r.nextUp).toBeNull();
    expect(isMenuReady(r)).toBe(true);
  });

  it("is strict about descriptions: a name-echo does not count and is flagged", () => {
    const r = scoreMenuReadiness({
      hasImage: true,
      description: "Blue Dream 3.5g",
      productName: "Blue Dream 3.5g",
      category: "Flower",
      aromaNotes: ["citrus"],
      flavorNotes: ["berry"],
    });
    const d = r.items.find((i) => i.key === "description")!;
    expect(d.done).toBe(false);
    expect(r.descriptionState).toBe("weak");
    expect(d.note).toContain("just the product's name");
    expect(isMenuReady(r)).toBe(false);
    expect(r.percent).toBe(67);
    expect(r.nextUp?.key).toBe("description");
  });

  it("prioritizes the photo as the next-up when a product is empty", () => {
    const r = scoreMenuReadiness({
      hasImage: false,
      description: null,
      productName: "Mystery",
      category: null,
      aromaNotes: [],
      flavorNotes: null,
    });
    expect(r.percent).toBe(0);
    expect(r.level).toBe("empty");
    expect(r.nextUp?.key).toBe("photo");
    expect(r.descriptionState).toBe("missing");
  });

  it("treats photo + good description as menu-ready even without details", () => {
    const r = scoreMenuReadiness({
      hasImage: true,
      description: GOOD_DESC,
      productName: "Wedding Cake",
      category: null,
      aromaNotes: null,
      flavorNotes: null,
    });
    expect(isMenuReady(r)).toBe(true);
    expect(r.nextUp?.key).toBe("category");
  });

  it("maps each item to a stable fix destination", () => {
    const r = scoreMenuReadiness({
      hasImage: false,
      description: null,
      productName: "X",
      category: null,
      aromaNotes: null,
      flavorNotes: null,
    });
    expect(r.items.find((i) => i.key === "photo")!.fixKind).toBe("image");
    expect(r.items.find((i) => i.key === "description")!.fixKind).toBe("description");
    expect(r.items.find((i) => i.key === "aroma")!.fixKind).toBe("details");
  });

  describe("gradeDescription", () => {
    it("returns missing / weak / good", () => {
      expect(gradeDescription(null, "X").state).toBe("missing");
      expect(gradeDescription("X", "X").state).toBe("weak");
      expect(gradeDescription("Nice.", "Gelato").state).toBe("weak");
      expect(gradeDescription(GOOD_DESC, "Blue Dream").state).toBe("good");
    });
  });
});
