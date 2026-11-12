/**
 * D234 slice C-3 (SOP-11b, G-96 / G-100; F-11-21 / F-11-23): Scale mode and
 * the Shop banner width.
 * Owner (D234), verbatim: "I want to fix everything. Q-11-10: yes. Q-11-11: yes.
 * Q-11-12: yes. Q-11-13: yes."
 *
 * Q-11-10: new banners use Scale mode; existing ones keep today's look and
 * switch only by choice (Switch to Scale, with a before/after).
 * Q-11-11: Scale mode keeps a separate Phone layout.
 * Q-11-12: the Shop banner is capped at 1408 px, centred, like home.
 * Q-11-13: Scale-mode text has a 12 px floor, with a Checks warning.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  __runBannerDesignCoreTests,
  boxStyle,
  buttonStyle,
  cardDesign,
  checkDesign,
  curvedBoxStyle,
  defaultButton,
  defaultDesign,
  designFromLegacy,
  frameStyle,
  normalizeDesign,
  sizingOf,
  withScale,
  withoutScale,
  type BannerDesign,
} from "@/lib/cms/banner-design-core";
import { canvasRefPx } from "@/lib/cms/studio-widths-core";

const read = (p: string) => readFileSync(p, "utf8");
const L = { eyebrow: "New this week", title: "Fresh drops are in", subtitle: "Come see us today" };

/** Every style a design produces, as one string (frame, boxes, curved boxes, buttons). */
function allStyles(d: BannerDesign, mode: Parameters<typeof boxStyle>[1]): string {
  return JSON.stringify([
    frameStyle(d),
    d.boxes.map((b) => boxStyle(b, mode)),
    d.boxes.map((b) => curvedBoxStyle(b, mode)),
    d.buttons.map((b) => buttonStyle(b, mode)),
  ]);
}

describe("C-3: existing banners render exactly as before (B.5)", () => {
  const olds: BannerDesign[] = [
    defaultDesign("hero"),
    defaultDesign("section"),
    { ...designFromLegacy({ ...L, preset: "hero" }), buttons: [defaultButton(), defaultButton({ id: "b2", size: "lg" })] },
    { ...designFromLegacy({ ...L, preset: "section" }), buttons: [defaultButton({ size: "sm" })] },
  ];
  it("a stored design with no scale flag is still fluid, and its styles match the boolean (pre-C-3) call", () => {
    for (const d of olds) {
      const rt = normalizeDesign(JSON.parse(JSON.stringify(d)))!;
      expect(sizingOf(rt)).toBe("fluid");
      expect("scale" in rt.frame).toBe(false);
      expect(allStyles(rt, sizingOf(rt))).toBe(allStyles(rt, false));
      expect(frameStyle(rt).height.startsWith("clamp(")).toBe(true);
    }
  });
  it("cards still use card scaling (sizingOf = card, same as the boolean true)", () => {
    const c = cardDesign({ ratio: 0.75, subtitle: true });
    expect(sizingOf(c)).toBe("card");
    expect(allStyles(c, sizingOf(c))).toBe(allStyles(c, true));
    expect(withScale(c)).toBe(c);
  });
  it("Switch back restores the old design exactly", () => {
    for (const d of olds) expect(JSON.stringify(withoutScale(withScale(d)))).toBe(JSON.stringify(d));
  });
  it("the website and the studio both size by sizingOf(design)", () => {
    const site = read("src/components/site/DesignedBanner.tsx");
    const studio = read("src/components/admin/banner-studio/StudioCanvas.tsx");
    for (const src of [site, studio]) {
      expect(src).toContain("const mode = sizingOf(design)");
      expect(src).toContain("boxStyle(b, mode)");
      expect(src).toContain("buttonStyle(btn, mode)");
      expect(src).not.toContain("boxStyle(b, card)");
    }
  });
});

describe("C-3: Scale mode keeps the design's shape at every width (G-96, Q-11-10/11)", () => {
  const sd = withScale(defaultDesign("hero")); // 1408 × 260, phone 390 × 200
  it("frame keeps 1408/height on computers and 390/phone height on phones", () => {
    const fs = frameStyle(sd);
    expect(fs.aspectRatio).toBe("var(--gs-ar, var(--gs-ar-d))");
    expect(Number(fs["--gs-ar-d"])).toBeCloseTo(1408 / 260, 3);
    expect(Number(fs["--gs-ar-m"])).toBeCloseTo(390 / 200, 3);
    expect(fs.height).toBe("auto");
  });
  it("the phone values swap in by the same container query as the phone layout", () => {
    const css = read("src/app/globals.css");
    const i = css.indexOf("@container gwb (max-width: 767px)");
    const block = css.slice(i, css.indexOf("\n}\n", i));
    expect(block).toContain("--gs-fontSize: var(--gs-fontSize-m);");
    expect(block).toContain("--gs-height: var(--gs-height-m);");
    expect(block).toContain("--gs-ar: var(--gs-ar-m);");
    expect(block).toContain("--gbx: var(--gmx, var(--gx));"); // the separate phone layout is unchanged
  });
  it("text and buttons are container units of the 1408 / 390 design", () => {
    const b = { ...sd.boxes[1], size: 56, sizeMobile: 28 };
    const s = boxStyle(b, "scale");
    // 56 px at 1408 → 3.9773cqw: at a 704 px banner that is 28 px (half), exactly in proportion.
    expect(s["--gs-fontSize-d"]).toBe("max(12px, 3.9773cqw)");
    expect(s["--gs-fontSize-m"]).toBe("max(12px, 7.1795cqw)");
    const bt = buttonStyle(defaultButton({ size: "lg" }), "scale");
    expect(bt["--gs-height-d"]).toBe("max(28px, 3.4091cqw)");
    expect(bt.padding.endsWith("em")).toBe(true); // padding follows the button's text size
  });
  it("the studio canvas at any width has the same shape", () => {
    for (const w of [1856, 1408, 1216, 960, 770]) expect(canvasRefPx(sd, "desktop", w).h).toBe(Math.round((w * 260) / 1408));
    for (const w of [398, 358, 328]) expect(canvasRefPx(sd, "mobile", w).h).toBe(Math.round((w * 200) / 390));
  });
  it("normalize keeps the flag only when it is exactly true", () => {
    expect(normalizeDesign(JSON.parse(JSON.stringify(sd)))!.frame.scale).toBe(true);
    expect("scale" in normalizeDesign({ ...sd, frame: { ...sd.frame, scale: 1 } })!.frame).toBe(false);
  });
});

describe("C-3: new banners start in Scale mode; existing ones switch by choice (Q-11-10)", () => {
  it("the shared editor shell turns a NEW design into Scale; a stored design is left as it is", () => {
    const shell = read("src/components/admin/banner-studio/BannerEditorShell.tsx");
    expect(shell).toContain("design ? { ...design, enabled: true } : withScale(makeNew ? makeNew() : designFromLegacy({ ...seed, preset }))");
  });
  it("the studio shows Switch to Scale with a before / after, and Switch back", () => {
    const sw = read("src/components/admin/banner-studio/ScaleSwitch.tsx");
    expect(sw).toContain("Switch to Scale");
    expect(sw).toContain("Switch back to fixed sizes");
    expect(sw).toContain('title="Before: fixed sizes"');
    expect(sw).toContain('title="After: Scale"');
    expect(sw).toContain("onChange(withScale(design))");
    expect(sw).toContain("onChange(withoutScale(design))");
    expect(read("src/components/admin/banner-studio/BannerStudio.tsx")).toContain("<ScaleSwitch ");
  });
});

describe("C-3: 12 px text floor with a Checks warning (Q-11-13)", () => {
  it("floor is in the CSS; a box designed smaller keeps its own size as the floor", () => {
    const b = defaultDesign().boxes[0];
    expect(boxStyle({ ...b, size: 20, sizeMobile: 14 }, "scale")["--gs-fontSize-m"]).toMatch(/^max\(12px, /);
    expect(boxStyle({ ...b, size: 10, sizeMobile: 9 }, "scale")["--gs-fontSize-m"]).toMatch(/^max\(9px, /);
  });
  it("warns only in Scale mode, only when text would go under 12 px at 770 / 328", () => {
    const d = defaultDesign("hero");
    expect(checkDesign(d, L).some((w) => w.code === "SMALL_TEXT")).toBe(false);
    expect(checkDesign(withScale(d), L).some((w) => w.code === "SMALL_TEXT")).toBe(true);
    const big = withScale({ ...d, boxes: d.boxes.map((b) => ({ ...b, size: 22, sizeMobile: 15 })) });
    expect(checkDesign(big, L).some((w) => w.code === "SMALL_TEXT")).toBe(false);
  });
});

describe("C-3: Shop banner capped at 1408 px, centred (G-100, Q-11-12)", () => {
  it("the Shop carousel uses the home banner's 88rem cage; the rest of the Shop keeps --shop-max", () => {
    const shop = read("src/components/menu/ShopBannerCarousel.tsx");
    expect(shop).toContain('<div className="mx-auto max-w-[88rem]">');
    expect(shop).not.toContain("max-w-[var(--shop-max)]");
    expect(read("src/components/home/Hero.tsx")).toContain("max-w-[88rem]");
  });
});

describe("C-3: pure self-tests", () => {
  it("banner-design-core self-tests pass (incl. C-3 cases)", () => {
    const r = __runBannerDesignCoreTests();
    expect(r.failed).toBe(0);
  });
});
