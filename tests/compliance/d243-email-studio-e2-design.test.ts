/**
 * D243 E-2 (SOP-22 G-122, Phase E "Email Studio"): the Banner Studio design section.
 *
 * Owner (D243): "I want the editor to be the same one used for building
 * banners and other content from the website editors. But with added features
 * like QR codes and the other things requested earlier."
 * Decision 1 (D243): design sections are turned into pictures in the email
 * (alt text + link); prices, dates, the warnings and the footer stay live HTML.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runNewsletterDesignCoreTests,
  addQrToDesign,
  designHash,
  designIssues,
  emailDesign,
  EMAIL_DESIGN_SHAPES,
  qrIconPath,
  shapeOf,
} from "@/lib/cms/newsletter-design-core";
import {
  blankBlock,
  canvasPlainText,
  checkCanvas,
  normalizeCanvas,
  renderCanvasEmail,
  starterCanvas,
  BLOCK_TYPES,
  type RenderOpts,
} from "@/lib/cms/newsletter-canvas-core";
import { CONCIERGE_KB } from "@/lib/admin/concierge-kb";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const base: RenderOpts = {
  businessName: "Greenway Marijuana",
  address: "4851 Geiger Rd SE, Port Orchard, WA 98367",
  siteUrl: "https://www.greenwaymarijuana.com",
  hours: "Open daily, 8:00 am to 11:00 pm",
  unsubscribeUrl: "https://www.greenwaymarijuana.com/unsubscribe?token=t",
  webUrl: null,
  campaign: "week-1",
};

function designDoc() {
  const doc = starterCanvas("Week 1");
  const b = blankBlock("design", "d1");
  if (b.type !== "design") throw new Error("not design");
  const design = emailDesign("wide");
  const ready = {
    ...b,
    design,
    src: "https://www.greenwaymarijuana.com/media/x.png",
    w: 1200,
    h: 600,
    alt: "Fresh drops this week",
    href: "https://www.greenwaymarijuana.com/menu",
    products: [{ id: "p1", name: "Blue Dream 3.5g", brand: "Acme", priceCents: 2500, href: "https://www.greenwaymarijuana.com/menu/products/p1", imageUrl: "" }],
  };
  ready.hash = designHash(ready);
  return { ...doc, blocks: [...doc.blocks, ready] };
}

describe("D243 E-2 design section core", () => {
  it("self-tests pass", () => {
    const r = __runNewsletterDesignCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(93);
  });

  it("is a canvas section type and survives a save round trip", () => {
    expect(BLOCK_TYPES).toContain("design");
    const doc = designDoc();
    const back = normalizeCanvas(JSON.parse(JSON.stringify(doc)));
    const d = back.blocks.find((b) => b.id === "d1");
    expect(d?.type).toBe("design");
    if (d?.type === "design") {
      expect(d.alt).toBe("Fresh drops this week");
      expect(d.products[0].priceCents).toBe(2500);
    }
  });

  it("renders as one picture with alt + link; the price stays live HTML and plain text", () => {
    const doc = designDoc();
    const html = renderCanvasEmail(doc, base);
    expect(html).toContain('data-gw-design="d1"');
    expect(html).toContain('alt="Fresh drops this week"');
    expect(html).toContain('data-gw-live="products"');
    expect(html).toContain("$25.00");
    const text = canvasPlainText(doc, base);
    expect(text).toContain("$25.00");
    const codes = checkCanvas(doc, html, text).issues.map((i) => i.code);
    expect(codes).not.toContain("design-unrendered");
    expect(codes).not.toContain("design-stale");
    expect(codes).not.toContain("warnings");
  });

  it("an edit after the picture was made is a must-fix (out of date)", () => {
    const doc = designDoc();
    const d = doc.blocks.find((b) => b.id === "d1");
    if (d?.type !== "design") throw new Error("no design");
    const changed = { ...d, design: { ...d.design, frame: { ...d.design.frame, height: d.design.frame.height + 10 } } };
    const codes = designIssues(changed).map((i) => i.code);
    expect(codes).toContain("design-stale");
  });

  it("five shapes, and a QR code fits on the picture", () => {
    expect(EMAIL_DESIGN_SHAPES.map((s) => s.id)).toEqual(["wide", "banner", "strip", "square", "tall"]);
    for (const s of EMAIL_DESIGN_SHAPES) expect(shapeOf(emailDesign(s.id))).toBe(s.id);
    expect(qrIconPath("https://www.greenwaymarijuana.com/menu?utm_source=newsletter")).toBeTruthy();
    const r = addQrToDesign(emailDesign("wide"), "https://www.greenwaymarijuana.com/menu");
    expect(r.ok).toBe(true);
  });

  it("old canvases (no design sections) still load", () => {
    const doc = normalizeCanvas(JSON.parse(JSON.stringify(starterCanvas("Old"))));
    expect(doc.blocks.length).toBeGreaterThan(0);
  });
});

describe("D243 E-2 wiring", () => {
  it("server + actions + editor exist and use the guards", () => {
    for (const p of [
      "src/lib/cms/newsletter-design-server.ts",
      "src/app/admin/newsletter/canvas/design-actions.ts",
      "src/components/admin/newsletter/DesignSectionEditor.tsx",
    ]) expect(existsSync(join(root, p))).toBe(true);
    const actions = read("src/app/admin/newsletter/canvas/design-actions.ts");
    expect(actions).toContain('"use server"');
    expect(actions).toContain('requirePermission("blog.manage")');
    expect(actions).toContain("newsletter.design.render");
    const ed = read("src/components/admin/newsletter/DesignSectionEditor.tsx");
    expect(ed).toContain("BannerStudio");
    expect(ed).toContain("domToBlob");
    expect(read("src/components/admin/newsletter/NewsletterCanvasEditor.tsx")).toContain("DesignSectionEditor");
  });

  it("is registered in the pure self-test runner and the concierge knows it", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertRan("newsletter-design-core", __runNewsletterDesignCoreTests(), 93)');
    expect(JSON.stringify(CONCIERGE_KB)).toContain("Design section (D243 E-2, SOP-22 G-122)");
  });
});
