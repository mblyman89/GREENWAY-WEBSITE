/**
 * tests/compliance/r41-all-banners.test.ts — R41 S6 "every banner on every page".
 *
 * Locks the wiring so every builder banner (Home, Specials extras, Shop extras,
 * Vendors grow/brands/extras) passes the owner's Custom design AND the classic
 * "Text align" + "Image focus" settings, and the Home hero carousel keeps the
 * owner's Enter → new line.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pinnedImageFocus } from "@/lib/cms/page-sections-types";

const read = (p: string) => readFileSync(p, "utf8");

describe("R41 S6 all banners", () => {
  it("pinnedImageFocus keeps the classic look for center/absent", () => {
    expect(pinnedImageFocus(undefined)).toBeUndefined();
    expect(pinnedImageFocus(null)).toBeUndefined();
    expect(pinnedImageFocus("center")).toBeUndefined();
    for (const f of ["top", "bottom", "left", "right"] as const) {
      expect(pinnedImageFocus(f)).toBe(f);
    }
  });

  it("toBannerData carries textAlign, imageFocus, design, designOwner", () => {
    const src = read("src/lib/cms/page-sections-store.ts");
    const fn = src.slice(src.indexOf("export function toBannerData"));
    for (const k of ["textAlign: s.textAlign", "imageFocus: s.imageFocus", "design: readDesign(s.settings)", "designOwner:"]) {
      expect(fn).toContain(k);
    }
  });

  it("SectionBannerData exposes optional textAlign + imageFocus", () => {
    const src = read("src/components/home/SectionBanner.tsx");
    const t = src.slice(src.indexOf("export type SectionBannerData"), src.indexOf("export function SectionBanner"));
    expect(t).toContain("textAlign?:");
    expect(t).toContain("imageFocus?:");
  });

  const extrasFiles = [
    "src/components/specials/SpecialsContent.tsx",
    "src/components/menu/ShopPage.tsx",
    "src/components/vendors/VendorDirectory.tsx",
  ];
  for (const f of extrasFiles) {
    it(`${f} passes align + focus + design to builder banners`, () => {
      const src = read(f);
      expect(src).toContain("textAlign={s.textAlign}");
      expect(src).toContain("imageFocus={pinnedImageFocus(s.imageFocus)}");
      expect(src).toContain("design={s.design}");
      expect(src).toContain("designOwner={s.designOwner}");
    });
  }

  it("Vendors grow + brands each use their OWN design and settings", () => {
    const src = read("src/components/vendors/VendorDirectory.tsx");
    for (const k of ["grow", "brands"]) {
      expect(src).toContain(`textAlign={content?.${k}?.textAlign}`);
      expect(src).toContain(`imageFocus={pinnedImageFocus(content?.${k}?.imageFocus)}`);
      expect(src).toContain(`design={content?.${k}?.design}`);
      expect(src).toContain(`designOwner={content?.${k}?.designOwner}`);
    }
  });

  it("Home page uses the shared pinnedImageFocus (no local copy)", () => {
    const src = read("src/app/page.tsx");
    expect(src).not.toContain("function pinnedFocus");
    expect(src).toContain("imageFocus={pinnedImageFocus(s.imageFocus)}");
  });

  it("Home hero carousel keeps Enter → new line in title + description", () => {
    const src = read("src/components/home/Hero.tsx");
    expect(src).toMatch(/<h1 className="[^"]*whitespace-pre-line/);
    expect(src).toMatch(/<p className="[^"]*whitespace-pre-line[^"]*text-zinc-300/);
  });

  it("Loyalty hero + Shop carousel split hard line breaks", () => {
    for (const f of ["src/components/loyalty/LoyaltyHeroBanner.tsx", "src/components/menu/ShopBannerCarousel.tsx"]) {
      expect(read(f)).toContain("heroTextLines(block.text)");
    }
  });
});
