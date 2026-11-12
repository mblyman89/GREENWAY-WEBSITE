/**
 * D234 slice C-5 (SOP-11b G-101; F-11-32): picture shape per placement,
 * safe-area overlay, crop-edge hint.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultDesign, imageStyle, withScale, type BannerDesign } from "../../src/lib/cms/banner-design-core";
import { CAROUSEL_SLIDE_SPEC, SECTION_BANNER_SPEC } from "../../src/lib/cms/image-spec-core";
import { __runPictureShapeCoreTests, cropEdgeHint, pictureAdvice, safeArea, shapesAt, specForDesign, visibleWindow } from "../../src/lib/cms/picture-shape-core";
import { WIDTH_STOPS, canvasRefPx } from "../../src/lib/cms/studio-widths-core";
import { PictureShapeFields, SafeAreaOverlay } from "../../src/components/admin/banner-studio/PictureShapeFields";

const read = (p: string) => readFileSync(p, "utf8");
const hero = defaultDesign("hero");
const scaled = withScale(defaultDesign("hero"));

describe("C-5: the picture shape matches the banner in each placement", () => {
  it("the advice uses the banner's real shape at every width stop (same layout as the studio canvas)", () => {
    for (const device of ["desktop", "mobile"] as const) {
      const stops = WIDTH_STOPS.filter((s) => s.device === device);
      const shapes = shapesAt(hero, device);
      expect(shapes.map((s) => s.w)).toEqual(stops.map((s) => s.w));
      for (const s of shapes) {
        const { w, h } = canvasRefPx(hero, device, s.w);
        expect(s.ratio).toBeCloseTo(w / h, 6);
      }
    }
    const a = pictureAdvice(hero);
    expect(a.forBoth.ratio).toBeLessThanOrEqual(Math.min(...a.desktop.map((s) => s.ratio), ...a.mobile.map((s) => s.ratio)) + 0.01);
    // The old one-size advice (1600 × 560, 2.86:1) is not the computer banner's shape.
    expect(Math.abs(a.forDesktop.ratio - 1600 / 560)).toBeGreaterThan(0.5);
  });

  it("a picture of the advised shape is never cut on the sides, at any width (both layouts)", () => {
    const a = pictureAdvice(scaled);
    for (const device of ["desktop", "mobile"] as const) {
      const sa = safeArea(scaled, a.forBoth.w / a.forBoth.h, device);
      expect(sa.x0).toBeLessThan(0.01);
      expect(sa.x1).toBeGreaterThan(0.99);
    }
  });

  it("the window math is the site's crop (object-position = transform-origin = focus, as imageStyle writes)", () => {
    const d: BannerDesign = { ...scaled, image: { ...scaled.image, focusX: 30, focusY: 70, zoom: 150 } };
    const st = imageStyle(d);
    expect(st.objectFit).toBe("cover");
    expect(st.objectPosition).toBe("var(--gip, 30% 70%)");
    expect(st.transformOrigin).toBe(st.objectPosition);
    expect(st.transform).toBe("scale(1.5)");
    // Same shape, zoom 150% around 30%: visible = 30% − 30%/1.5 … 30% + 70%/1.5
    const w = visibleWindow(2, 2, 30, 70, 1.5);
    expect(w.x0).toBeCloseTo(0.3 - 0.3 / 1.5, 6);
    expect(w.x1).toBeCloseTo(0.3 + 0.7 / 1.5, 6);
  });

  it("each placement's upload hint follows its design; no design = the old hint, unchanged", () => {
    expect(specForDesign(SECTION_BANNER_SPEC, null)).toBe(SECTION_BANNER_SPEC);
    expect(specForDesign(CAROUSEL_SLIDE_SPEC, undefined)).toBe(CAROUSEL_SLIDE_SPEC);
    const s = specForDesign(CAROUSEL_SLIDE_SPEC, scaled);
    expect(s.presets[0].label).toBe("Fits this banner");
    expect(s.aspectRatio).toBeCloseTo(pictureAdvice(scaled).forBoth.ratio, 2);
    const wiring: [string, RegExp][] = [
      ["src/components/admin/CarouselSlideCard.tsx", /spec=\{specForDesign\(CAROUSEL_SLIDE_SPEC, adv\?\.design\?\.enabled \? adv\.design : null\)\}/],
      ["src/components/admin/SectionCard.tsx", /spec=\{specForDesign\(imageSpec, design\?\.enabled \? design : null\)\}/],
      ["src/components/admin/ShopBannerEditor.tsx", /specForDesign\(desktopSpec, pres\.design\?\.enabled \? pres\.design : null, "desktop"\)[\s\S]*specForDesign\(mobileSpec, pres\.design\?\.enabled \? pres\.design : null, "mobile"\)/],
      ["src/components/admin/LoyaltyHeroEditor.tsx", /specForDesign\(desktopSpec, pres\.design\?\.enabled \? pres\.design : null, "desktop"\)[\s\S]*specForDesign\(mobileSpec, pres\.design\?\.enabled \? pres\.design : null, "mobile"\)/],
      ["src/components/admin/SpecialsPresentationEditor.tsx", /spec=\{specForDesign\(cardSpec, day\.design\?\.enabled \? day\.design : null\)\}/],
    ];
    for (const [f, re] of wiring) expect(read(f), f).toMatch(re);
  });

  it("the studio shows the safe area and the shape advice on the Picture tab", () => {
    const html = renderToStaticMarkup(<SafeAreaOverlay design={hero} device="desktop" nat={{ w: 1600, h: 560 }} />);
    expect(html).toContain("data-safe-area=");
    expect(renderToStaticMarkup(<SafeAreaOverlay design={hero} device="desktop" nat={null} />)).toBe("");
    const f = renderToStaticMarkup(<PictureShapeFields design={scaled} device="mobile" nat={{ w: 1600, h: 560 }} />);
    expect(f).toContain("Best picture for this banner");
    expect(f).toContain("phones cut about");
    const panel = read("src/components/admin/banner-studio/ImagePanel.tsx");
    expect(panel).toContain("<SafeAreaOverlay design={design} device={device} nat={natHere} />");
    expect(panel).toContain("<PictureShapeFields design={design} device={device} nat={natHere} />");
    expect(panel).toContain("naturalWidth");
  });

  it("a hint appears when the subject is near the crop edge, naming the side and widths", () => {
    const d: BannerDesign = { ...scaled, image: { ...scaled.image, focusXMobile: 6, focusYMobile: 50 } };
    const h = cropEdgeHint(d, 1600 / 560, "mobile");
    expect(h).toMatch(/left/);
    expect(h).toMatch(/328/);
    const f = renderToStaticMarkup(<PictureShapeFields design={d} device="mobile" nat={{ w: 1600, h: 560 }} />);
    expect(f).toContain("data-crop-hint");
    const centred = pictureAdvice(scaled).forMobile;
    expect(cropEdgeHint(scaled, centred.w / centred.h, "mobile")).toBeNull();
  });

  it("the website is untouched (C-5 only changes admin advice)", () => {
    for (const f of ["src/components/site/DesignedBanner.tsx"]) expect(read(f)).not.toContain("picture-shape-core");
  });

  it("pure self-test passes and is in the runner", () => {
    expect(__runPictureShapeCoreTests().failed).toBe(0);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("picture-shape-core", __runPictureShapeCoreTests(), 28)');
  });
});
