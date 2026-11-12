/**
 * D234 slice C-4 (SOP-11b, G-99; F-11-25): the DRIFT GUARD.
 * Owner (D233), verbatim: "I build the banner or image, place everything where
 * it looks good in the editor. Then I go to the website and all the overlay
 * objects are not where I placed them exactly, so I have to go back and forth
 * over and over till I get it right."  D234: "I want to fix everything."
 *
 * For a fixed set of designs (fluid, Scale, card; text, buttons, phone
 * overrides) this renders the REAL public `DesignedBanner` and the REAL studio
 * `StudioCanvas` (at the C-2 width), reads every item's inline style, and
 * evaluates it the way the browser does at every real width
 * (`WIDTH_STOPS`: 1408, 1344, 1216, 960, 770 computer; 398, 358, 328 phone).
 * Every item's left / top / width and text size must agree within 1% of the
 * banner width, the frame height too. If anyone changes how the studio or the
 * website sizes or places an item, this test goes red.
 *
 * (A pixel-level Playwright run needs a browser and a built site; CI runs no
 * browser — `vitest.config.ts`. This guard compares the exact CSS both sides
 * emit, which is what decides the boxes; the browser only evaluates it.)
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DesignedBanner } from "@/components/site/DesignedBanner";
import { StudioCanvas } from "@/components/admin/banner-studio/StudioCanvas";
import {
  CARD_REF_PX,
  cardDesign,
  defaultButton,
  defaultDesign,
  defaultTextBox,
  designFromLegacy,
  withScale,
  type BannerDesign,
  type DesignDevice,
} from "@/lib/cms/banner-design-core";
import { WIDTH_STOPS, layoutForWidth } from "@/lib/cms/studio-widths-core";
import {
  PHONE_SWAPS,
  __runStudioDriftCoreTests,
  checkAllWidths,
  frameHeightAt,
  measureItem,
  styleOfClass,
  stylesById,
  widthWarnings,
} from "@/lib/cms/studio-drift-core";
import { readFileSync } from "node:fs";

const L = { eyebrow: "New this week", title: "Fresh drops are in", subtitle: "Come see us today" };
const noop = () => {};

/** Fixed designs that cover every sizing path. */
function designs(): { name: string; d: BannerDesign }[] {
  const legacy = designFromLegacy({ ...L, preset: "hero" });
  const withBtns = { ...legacy, buttons: [defaultButton({ id: "go" }), defaultButton({ id: "lg", size: "lg", x: 30, y: 72, mx: 4, my: 80 })] };
  const phone = {
    ...withBtns,
    boxes: [
      ...withBtns.boxes.map((b, i) => ({ ...b, mx: 6, my: 10 + i * 22, mw: 88 })),
      defaultTextBox("badge", { id: "badge", text: "20% OFF", x: 80, y: 10, w: 14, mx: 70, my: 4, mw: 26, rotate: -8 }),
    ],
  };
  return [
    { name: "fluid hero (legacy look)", d: withBtns },
    { name: "fluid section, phone overrides", d: { ...phone, frame: defaultDesign("section").frame } },
    { name: "Scale hero", d: withScale(withBtns) },
    { name: "Scale, phone overrides + badge", d: withScale(phone) },
    { name: "Scale, small text (12 px floor)", d: withScale({ ...withBtns, boxes: withBtns.boxes.map((b) => ({ ...b, size: 13, sizeMobile: 11 })) }) },
  ];
}

const site = (d: BannerDesign) => renderToStaticMarkup(<DesignedBanner design={d} imageSrc="/x.jpg" imageAlt="" legacy={L} editable owner="t" />);
const studio = (d: BannerDesign, device: DesignDevice, width: number | null) =>
  renderToStaticMarkup(<StudioCanvas design={d} device={device} legacy={L} imageSrc="/x.jpg" imageAlt="" selection={null} onSelect={noop} onChange={noop} onRequestDelete={noop} width={width} />);

/** Site markup uses data-gw-design-box/button; studio uses data-studio-id. */
function siteItems(html: string) {
  const m = new Map([...stylesById(html, "data-gw-design-box"), ...stylesById(html, "data-gw-design-button")]);
  return m;
}

type Box = { left: number; top: number; width: number; fontSize: number };
function measure(items: Map<string, Record<string, string>>, frame: Record<string, string>, W: number, phone: boolean): { H: number; boxes: Map<string, Box> } {
  const H = frameHeightAt(frame, W, phone);
  const fv: Record<string, string> = {};
  for (const [k, v] of Object.entries(frame)) if (k.startsWith("--")) fv[k] = v;
  const boxes = new Map<string, Box>();
  for (const [id, st] of items) {
    const m = measureItem(st, fv, W, H, phone);
    boxes.set(id, { left: m.left, top: m.top, width: m.width, fontSize: m.fontSize });
  }
  return { H, boxes };
}

describe("C-4 drift guard: studio = website at every real width (G-99, ≤1% of width)", () => {
  for (const { name, d } of designs()) {
    for (const stop of WIDTH_STOPS) {
      it(`${name} @ ${stop.w}px (${stop.device})`, () => {
        const phone = layoutForWidth(stop.w) === "mobile";
        const sHtml = site(d);
        const cHtml = studio(d, stop.device, stop.w);
        const s = measure(siteItems(sHtml), styleOfClass(sHtml, "gw-dframe"), stop.w, phone);
        const c = measure(stylesById(cHtml, "data-studio-id"), styleOfClass(cHtml, "gw-dframe"), stop.w, phone);
        const tol = stop.w * 0.01;
        expect(Number.isFinite(s.H) && s.H > 0).toBe(true);
        expect(Math.abs(s.H - c.H)).toBeLessThanOrEqual(tol);
        // the studio canvas is laid out at the height the website shows
        const sized = /style="width:(\d+)px;transform:scale/.exec(cHtml);
        expect(Number(sized?.[1])).toBe(stop.w);
        expect(s.boxes.size).toBeGreaterThan(0);
        for (const [id, sb] of s.boxes) {
          const cb = c.boxes.get(id);
          expect(cb, `${id} missing in the studio`).toBeDefined();
          for (const k of ["left", "top", "width", "fontSize"] as const) {
            if (!Number.isFinite(sb[k]) && !Number.isFinite(cb![k])) continue; // e.g. buttons have no width rule
            expect(Number.isFinite(sb[k]), `${id}.${k} site`).toBe(true);
            expect(Math.abs(sb[k] - cb![k]), `${id}.${k}: site ${sb[k]} vs studio ${cb![k]}`).toBeLessThanOrEqual(tol);
          }
        }
      });
    }
  }

  it("Scale designs keep their proportions: positions and text scale with the width", () => {
    const d = withScale(designFromLegacy({ ...L, preset: "hero" }));
    const html = site(d);
    const frame = styleOfClass(html, "gw-dframe");
    const a = measure(siteItems(html), frame, 1408, false);
    const b = measure(siteItems(html), frame, 704, false);
    expect(Math.abs(b.H - a.H / 2)).toBeLessThan(0.5);
    const head = [...a.boxes.keys()].find((k) => k === "headline")!;
    expect(Math.abs(b.boxes.get(head)!.fontSize - a.boxes.get(head)!.fontSize / 2)).toBeLessThan(0.01);
    expect(Math.abs(b.boxes.get(head)!.top - a.boxes.get(head)!.top / 2)).toBeLessThan(0.5);
  });

  it("cards: studio = website at the card reference, both layouts", () => {
    const d = cardDesign({ ratio: 0.75, ratioMobile: 1, subtitle: true, eyebrow: true });
    const sHtml = site(d);
    for (const device of ["desktop", "mobile"] as const) {
      const cHtml = studio(d, device, null);
      const phone = device === "mobile";
      const s = measure(siteItems(sHtml), styleOfClass(sHtml, "gw-dframe"), CARD_REF_PX, phone);
      const c = measure(stylesById(cHtml, "data-studio-id"), styleOfClass(cHtml, "gw-dframe"), CARD_REF_PX, phone);
      expect(Math.abs(s.H - c.H)).toBeLessThanOrEqual(CARD_REF_PX * 0.01);
      for (const [id, sb] of s.boxes) expect(Math.abs(sb.fontSize - c.boxes.get(id)!.fontSize)).toBeLessThanOrEqual(CARD_REF_PX * 0.01);
    }
  });

  it("the guard's phone swaps are exactly the globals.css rules", () => {
    const css = readFileSync("src/app/globals.css", "utf8");
    const i = css.indexOf("@container gwb (max-width: 767px)");
    const block = css.slice(i, css.indexOf("\n}\n", i));
    for (const k of ["--gbx", "--gby", "--gbw", "--gbh", "--gs-fontSize", "--gs-height", "--gs-ar"]) expect(block).toContain(`${k}: ${PHONE_SWAPS[k]};`);
    for (const k of ["--gc-fontSize", "--gc-height", "--gc-ar"]) expect(css).toContain(`${k}: ${PHONE_SWAPS[k]};`);
  });

  it("the guard really catches drift (a moved item fails)", () => {
    const d = designFromLegacy({ ...L, preset: "hero" });
    const moved = { ...d, boxes: d.boxes.map((b) => (b.id === "headline" ? { ...b, x: b.x + 2 } : b)) };
    const s = measure(siteItems(site(d)), styleOfClass(site(d), "gw-dframe"), 960, false);
    const c = measure(stylesById(studio(moved, "desktop", 960), "data-studio-id"), styleOfClass(studio(moved, "desktop", 960), "gw-dframe"), 960, false);
    expect(Math.abs(s.boxes.get("headline")!.left - c.boxes.get("headline")!.left)).toBeGreaterThan(960 * 0.01);
  });
});

describe("C-4: Checks look at every width, phone included", () => {
  it("text that only falls off on phones is reported, naming the widths", () => {
    const d = designFromLegacy({ ...L, preset: "hero" });
    const long = { ...d, boxes: d.boxes.map((b) => (b.id === "subhead" ? { ...b, bind: null, text: "Come in today and see every new strain and pre-roll on the shelf", my: 78 } : b)) };
    const w = widthWarnings(long, L);
    expect(w.some((x) => x.code === "AT_WIDTHS" && x.boxId === "subhead" && /328/.test(x.message))).toBe(true);
    expect(checkAllWidths(long, L).some((x) => x.code === "AT_WIDTHS")).toBe(true);
  });
  it("the default designs are clean at every width", () => {
    for (const p of ["hero", "section"] as const) expect(widthWarnings(designFromLegacy({ ...L, preset: p }), L)).toEqual([]);
  });
  it("the Checks tab and its counter use every width", () => {
    expect(readFileSync("src/components/admin/banner-studio/WarningsPanel.tsx", "utf8")).toContain("checkAllWidths(design, legacy, siteFonts)");
    expect(readFileSync("src/components/admin/banner-studio/BannerStudio.tsx", "utf8")).toContain("checkAllWidths(design, legacy, siteFonts).length");
  });
  it("pure self-test passes and is in the runner", () => {
    expect(__runStudioDriftCoreTests().failed).toBe(0);
    expect(readFileSync("scripts/compliance/run-pure-selftests.ts", "utf8")).toContain("__runStudioDriftCoreTests");
  });
});
