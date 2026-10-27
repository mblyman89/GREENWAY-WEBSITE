/**
 * R42 owner answers Q3 + Q4.
 *
 * Q3: About / FAQ / Locations / Price Match keep their own designed top; any
 *     banners the owner adds in Admin → Pages show as an optional strip right
 *     above the footer, and NOTHING renders when none are published.
 * Q4: Custom design can carry an optional separate phone picture
 *     (design.image.srcMobile). Unset = one picture exactly as before.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const getPageBanners = vi.fn();
vi.mock("@/lib/cms/page-sections-store", () => ({
  getPageBanners: (...a: unknown[]) => getPageBanners(...a),
}));

import { PageBuilderBanners } from "@/components/site/PageBuilderBanners";
import {
  designFromLegacy,
  mobileImageSrc,
  normalizeDesign,
  safeImageSrc,
} from "@/lib/cms/banner-design-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("R42 Q3 — builder banners on the four static pages", () => {
  it("renders nothing (null) when no banners are published", async () => {
    getPageBanners.mockResolvedValueOnce({ byKey: {}, extras: [] });
    const out = await PageBuilderBanners({ pageSlug: "about" });
    expect(out).toBeNull();
    expect(getPageBanners).toHaveBeenCalledWith("about", []);
  });

  it("renders a labelled strip when at least one banner exists", async () => {
    getPageBanners.mockResolvedValueOnce({
      byKey: {},
      extras: [
        {
          key: "about-extra-1",
          image: "/home/hero-banner.webp",
          imageAlt: "",
          eyebrow: "",
          title: "Hello",
          subtitle: "",
          buttons: [],
          textAlign: "left",
        },
      ],
    });
    const out = (await PageBuilderBanners({ pageSlug: "faq" })) as { props: { "aria-label": string } } | null;
    expect(out).not.toBeNull();
    expect(out!.props["aria-label"]).toBe("More from Greenway");
  });

  for (const slug of ["about", "faq", "locations", "price-match"]) {
    it(`/${slug} renders PageBuilderBanners with its slug, before the Footer`, () => {
      const src = read(`src/app/(site)/${slug}/page.tsx`);
      const strip = src.indexOf(`<PageBuilderBanners pageSlug="${slug}" />`);
      const footer = src.indexOf("<Footer");
      expect(strip).toBeGreaterThan(-1);
      expect(footer).toBeGreaterThan(strip);
    });
  }

  it("admin page explains where these banners show", () => {
    const src = read("src/app/admin/pages/[slug]/page.tsx");
    expect(src).toContain('new Set(["about", "faq", "locations", "price-match"])');
    expect(src).toContain("BOTTOM_STRIP_PAGES.has(slug)");
    expect(src).toContain("Where these show</summary>");
  });
});

describe("R42 Q4 — optional separate phone picture", () => {
  const base = () => designFromLegacy({ title: "T", preset: "section" });

  it("unset by default: normalized design has no srcMobile key (byte-identical)", () => {
    const d = base();
    expect("srcMobile" in d.image).toBe(false);
    expect(mobileImageSrc(d, "/a.webp")).toBe("/a.webp");
  });

  // R53 (owner, dev phase): one picture per banner — every phone picture is
  // now dropped on normalize, safe or not; phones use the main picture.
  it("R53: drops every phone picture (safe ones too); safeImageSrc rules unchanged", () => {
    const keep = ["/media/p.webp", "https://abc.supabase.co/storage/v1/object/public/media/p.webp"];
    const drop = ["//evil.com/x.png", "http://abc.supabase.co/storage/v1/object/public/m/p.webp", "https://evil.com/p.webp", "javascript:alert(1)", "/a\\b.png", "https://u:p@abc.supabase.co/storage/v1/object/public/m/p.webp"];
    for (const v of keep) {
      expect(safeImageSrc(v)).toBe(v);
      const d = normalizeDesign({ ...base(), image: { ...base().image, srcMobile: v } })!;
      expect("srcMobile" in d.image).toBe(false);
      expect(mobileImageSrc(d, "/main.webp")).toBe("/main.webp");
    }
    for (const v of drop) {
      expect(safeImageSrc(v)).toBeNull();
      const d = normalizeDesign({ ...base(), image: { ...base().image, srcMobile: v } })!;
      expect("srcMobile" in d.image).toBe(false);
    }
  });

  it("DesignedBanner renders two lazy pictures only when a different phone picture is set", () => {
    const src = read("src/components/site/DesignedBanner.tsx");
    expect(src).toContain("design.image.srcMobile !== imageSrc");
    expect(src).toContain('className="gw-dimg-d');
    expect(src).toContain('className="gw-dimg-m');
    // both pictures in the two-picture path are lazy (hidden one never downloads)
    const twoPath = src.slice(src.indexOf("{phoneSrc ? ("), src.indexOf(") : imageSrc ? ("));
    expect(twoPath.match(/loading="lazy"/g)?.length).toBe(2);
    expect(twoPath).not.toContain("priority={");
  });

  it("CSS: phone picture hidden by default BEFORE the container rule that swaps it in", () => {
    const css = read("src/app/globals.css");
    const hide = css.indexOf(".gw-dimg-m {\n  display: none;");
    const container = css.indexOf("@container gwb (max-width: 767px)");
    expect(hide).toBeGreaterThan(-1);
    expect(container).toBeGreaterThan(hide);
    const block = css.slice(container);
    expect(block).toMatch(/\.gw-dimg-d \{\s*display: none;/);
    expect(block).toMatch(/\.gw-dimg-m \{\s*display: block;/);
  });

  it("every Banner Studio host passes the media library through", () => {
    // R61 S1: one shared shell hosts the studio for every banner editor.
    expect(read("src/components/admin/banner-studio/BannerEditorShell.tsx")).toMatch(/<BannerStudio[\s\S]*?mediaChoices=\{mediaChoices\}/);
    for (const f of ["LoyaltyHeroEditor", "ShopBannerEditor", "SpecialsPresentationEditor", "SectionCard", "CarouselSlideCard", "TypeCardImagesEditor"]) {
      const src = read(`src/components/admin/${f}.tsx`);
      const cards = src.split("<DesignCard").length - 1;
      const wired = src.split("<DesignCard\n").slice(1).filter((s) => s.trimStart().startsWith("mediaChoices={mediaChoices}")).length;
      expect(cards).toBeGreaterThan(0);
      expect(wired).toBe(cards);
    }
  });
});
