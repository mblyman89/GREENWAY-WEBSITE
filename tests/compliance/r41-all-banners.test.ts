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
    const src = read("src/app/(site)/page.tsx");
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

import {
  defaultLoyaltyHeroPresentation,
  normalizeLoyaltyHeroPresentation,
  parseLoyaltyHeroPresentation,
  serializeLoyaltyHeroPresentation,
} from "@/lib/loyalty/loyalty-hero-core";
import { parseMoveMessage } from "@/lib/cms/banner-design-core";

describe("R41 S6 Loyalty hero custom design", () => {
  it("existing rows stay byte-identical (no design key unless set)", () => {
    const def = defaultLoyaltyHeroPresentation();
    const json = serializeLoyaltyHeroPresentation(def);
    expect(json).not.toContain("design");
    expect(serializeLoyaltyHeroPresentation(parseLoyaltyHeroPresentation(json)!)).toBe(json);
  });

  it("a design round-trips and junk is dropped", () => {
    const p = normalizeLoyaltyHeroPresentation({ design: { enabled: true, boxes: [] } });
    expect(p.design?.enabled).toBe(true);
    expect(parseLoyaltyHeroPresentation(serializeLoyaltyHeroPresentation(p))!.design?.enabled).toBe(true);
    expect("design" in normalizeLoyaltyHeroPresentation({ design: 42 })).toBe(false);
  });

  it("public banner renders DesignedBanner only when the design is on", () => {
    const src = read("src/components/loyalty/LoyaltyHeroBanner.tsx");
    expect(src).toContain("if (presentation.design?.enabled)");
    expect(src).toContain('owner="loyalty:hero"');
    // h1 lives on the signup card below; the hero must stay an h2.
    expect(src).toContain("headingLevel={2}");
  });

  it("hub Move mode accepts the loyalty hero owner", () => {
    const good = { type: "gw-design-move", owner: "loyalty:hero", target: "box", id: "headline", x: 1, y: 2, device: "desktop" };
    expect(parseMoveMessage(good)).not.toBeNull();
  });

  it("editor offers the design card + blog posts, and every line takes Enter", () => {
    const ed = read("src/components/admin/LoyaltyHeroEditor.tsx");
    expect(ed).toContain("<DesignCard");
    expect(ed).toContain('preset="hero"');
    expect(ed).not.toContain("multiline={false}");
    const page = read("src/app/admin/loyalty-page/page.tsx");
    expect(page).toContain("posts={heroPosts}");
    expect(page).toContain("listPublishedPostLinks");
  });
});

import {
  defaultShopHeroPresentation,
  normalizeShopHeroPresentation,
  parseShopHeroPresentation,
  serializeShopHeroPresentation,
} from "@/lib/cms/shop-carousel-core";

describe("R41 S6 Shop carousel custom design", () => {
  it("existing slides stay byte-identical (no design key unless set)", () => {
    const json = serializeShopHeroPresentation(defaultShopHeroPresentation());
    expect(json).not.toContain('"design"');
    expect(serializeShopHeroPresentation(parseShopHeroPresentation(json)!)).toBe(json);
  });

  it("a slide design round-trips; junk is dropped", () => {
    const p = normalizeShopHeroPresentation({ design: { enabled: true, boxes: [] } });
    expect(parseShopHeroPresentation(serializeShopHeroPresentation(p))!.design?.enabled).toBe(true);
    expect("design" in normalizeShopHeroPresentation({ design: [] })).toBe(false);
  });

  it("slide render uses DesignedBanner only when on; owner only in Draft Mode", () => {
    const view = read("src/components/menu/ShopBannerCarousel.tsx");
    expect(view).toContain("if (presentation.design?.enabled)");
    expect(view).toContain("designOwner={slide.designOwner}");
    expect(view).toContain("headingLevel={2}");
    const store = read("src/lib/cms/shop-carousel-store.ts");
    expect(store).toContain("designOwner: preview && row.id ? `shop-slide:${row.id}` : undefined");
  });

  it("Move mode accepts shop-slide:<uuid> only", () => {
    const base = { type: "gw-design-move", target: "box", id: "headline", x: 1, y: 2, device: "desktop" };
    expect(parseMoveMessage({ ...base, owner: "shop-slide:123e4567-e89b-12d3-a456-426614174000" })).not.toBeNull();
    expect(parseMoveMessage({ ...base, owner: "shop-slide:abc" })).toBeNull();
  });

  it("editor offers the design card + posts, and every line takes Enter", () => {
    const ed = read("src/components/admin/ShopBannerEditor.tsx");
    expect(ed).toContain("<DesignCard");
    expect(ed).not.toContain("multiline={false}");
    expect(read("src/app/admin/content/shop-banner/page.tsx")).toContain("posts={posts}");
  });

  it("save actions keep the design (they normalize, which now carries it)", () => {
    const actions = read("src/app/admin/content/shop-banner/actions.ts");
    expect(actions).toContain("normalizeShopHeroPresentation(parsed)");
  });
});
