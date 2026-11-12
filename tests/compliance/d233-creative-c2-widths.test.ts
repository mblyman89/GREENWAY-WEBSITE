/**
 * D234 slice C-2 (SOP-11b, G-97 / G-98; F-11-22 / F-11-24): the studio shows
 * the banner at the widths the website really uses (same sizing math), and
 * every banner editor can open the real page in Website Sync, Move mode on.
 * Owner (D234), verbatim: "I want to fix everything." … "Q-11-17: I approve and agree."
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { __runStudioWidthsCoreTests, canvasRefPx, fluidPxAt, realPageHref, WIDTH_STOPS } from "@/lib/cms/studio-widths-core";
import { defaultDesign, frameRefPx, interpPx } from "@/lib/cms/banner-design-core";

const read = (p: string) => readFileSync(p, "utf8");

/** Evaluate an interpPx() string at a container width (the browser's math). */
function evalInterp(css: string, w: number): number {
  const m = /^clamp\(([\d.]+)px, calc\(([\d.]+)px \+ (-?[\d.]+) \* \(100cqw - 390px\)\), ([\d.]+)px\)$/.exec(css);
  if (!m) return Number(css.replace("px", ""));
  const [lo, base, slope, hi] = m.slice(1).map(Number);
  return Math.min(hi, Math.max(lo, base + slope * (w - 390)));
}

describe("C-2: the canvas lays out at any real width with the website's math (G-97)", () => {
  it("fluidPxAt matches interpPx at every stop", () => {
    for (const [m, d] of [[200, 360], [160, 200], [24, 56], [13, 15]] as const)
      for (const s of WIDTH_STOPS) expect(Math.abs(fluidPxAt(m, d, s.w) - evalInterp(interpPx(m, d), s.w))).toBeLessThan(1e-6);
  });
  it("no width = exactly today's reference size", () => {
    for (const p of ["hero", "section"] as const) {
      const d = defaultDesign(p);
      for (const dev of ["desktop", "mobile"] as const) expect(canvasRefPx(d, dev, null)).toEqual(frameRefPx(d, dev));
    }
  });
  it("the stops are the real banner widths", () => {
    const ws = WIDTH_STOPS.map((s) => s.w);
    for (const w of [1408, 1344, 1216, 358, 328]) expect(ws).toContain(w);
    expect(read("src/components/home/Hero.tsx")).toContain("max-w-[88rem]");
    expect(read("src/components/specials/SpecialsContent.tsx")).toContain("max-w-[88rem] px-4 py-5 md:px-8");
  });
  it("the canvas and the studio use the width", () => {
    const c = read("src/components/admin/banner-studio/StudioCanvas.tsx");
    expect(c).toContain("canvasRefPx(design, device, width)");
    const s = read("src/components/admin/banner-studio/BannerStudio.tsx");
    expect(s).toContain("<WidthBar");
    expect(s).toContain("width={width}");
    const b = read("src/components/admin/banner-studio/WidthBar.tsx");
    expect(b).toContain('type="range"');
    expect(b).toContain("onWidth(w, layoutForWidth(w))");
  });
  it("pure self-test passes and is in the runner", () => {
    expect(__runStudioWidthsCoreTests().failed).toBe(0);
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain("__runStudioWidthsCoreTests");
  });
});

describe("C-2: Check on the real page (G-98)", () => {
  it("opens Website Sync's live preview at the page and size, Move mode on", () => {
    expect(realPageHref("/", "tablet")).toBe("/admin/website-sync?tab=preview&path=%2F&device=tablet&move=1");
    const page = read("src/app/admin/website-sync/page.tsx");
    expect(page).toContain("initialDevice={parsePreviewDevice(sp.device)}");
    expect(page).toContain('initialMove={sp.move === "1"}');
    const panel = read("src/components/admin/WebsiteSyncPreviewPanel.tsx");
    expect(panel).toContain("useState(canMove && initialMove)");
    expect(read("src/components/admin/PreviewFrame.tsx")).toContain("useState<Device>(initialDevice)");
  });
  it("every studio editor gets the link (it is inside the shared studio)", () => {
    expect(read("src/components/admin/banner-studio/WidthBar.tsx")).toContain("Check on the real page");
    expect(read("src/components/admin/banner-studio/BannerEditorShell.tsx")).toContain("<BannerStudio");
  });
});
