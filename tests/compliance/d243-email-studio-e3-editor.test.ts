/**
 * D243 E-3 (SOP-22 G-123, Phase E "Email Studio"): the full-page newsletter editor.
 *
 * Owner (D243): "I want the website editors plus all the above plus more."
 * ... "I like the idea of having a formatted header and footer and title and
 * logo and such so every newsletter has the same format, with a customized
 * body." ... "The website editor on steroids."
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { __runNewsletterStyleCoreTests } from "@/lib/cms/newsletter-style-core";
import { __runNewsletterLayoutCoreTests, moveBlockTo, TEMPLATE_PLACEHOLDER } from "@/lib/cms/newsletter-layout-core";
import { __runNewsletterTemplatesCoreTests, NEWSLETTER_TEMPLATES, templateCanvas } from "@/lib/cms/newsletter-templates-core";
import { BLOCK_TYPES, canvasPlainText, checkCanvas, normalizeCanvas, renderCanvasEmail, starterCanvas, type RenderOpts } from "@/lib/cms/newsletter-canvas-core";
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

describe("D243 E-3 cores", () => {
  it("self-tests pass", () => {
    for (const [r, floor] of [
      [__runNewsletterStyleCoreTests(), 30],
      [__runNewsletterLayoutCoreTests(), 35],
      [__runNewsletterTemplatesCoreTests(), 54],
    ] as const) {
      expect(r.failed).toBe(0);
      expect(r.passed).toBeGreaterThanOrEqual(floor);
    }
  });

  it("columns and picture-with-words are section types", () => {
    expect(BLOCK_TYPES).toContain("columns");
    expect(BLOCK_TYPES).toContain("overlay");
  });

  it("every template renders with the warnings and unsubscribe, and is blocked until Replace: is written", () => {
    expect(NEWSLETTER_TEMPLATES.map((t) => t.id)).toEqual(["weekly", "sale", "vendor", "holiday", "fourtwenty"]);
    for (const t of NEWSLETTER_TEMPLATES) {
      const doc = templateCanvas(t.id, "Week 1", base.siteUrl);
      const html = renderCanvasEmail(doc, base);
      const text = canvasPlainText(doc, base);
      const codes = checkCanvas(doc, html, text).issues.map((i) => i.code);
      expect(codes).not.toContain("warnings");
      expect(codes).not.toContain("warnings-size");
      expect(codes).not.toContain("unsubscribe");
      expect(codes.includes("placeholder")).toBe(JSON.stringify(doc).includes(TEMPLATE_PLACEHOLDER));
    }
    const sale = templateCanvas("sale", "", base.siteUrl);
    expect(checkCanvas(sale, renderCanvasEmail(sale, base), "").ok).toBe(false);
  });

  it("a section style survives a save round trip; preview markers never reach the sent email", () => {
    const doc = normalizeCanvas({ subject: "S", preheader: "P", blocks: [{ id: "t", type: "text", text: "Hi", align: "left", style: { bg: "#14301f", pad: "m", round: true } }] });
    const back = normalizeCanvas(JSON.parse(JSON.stringify(doc)));
    expect(back.blocks[0].style?.bg).toBe("#14301f");
    expect(renderCanvasEmail(back, base)).not.toContain("data-gw-block");
    expect(renderCanvasEmail(back, { ...base, markBlocks: true })).toContain('data-gw-block="t"');
  });

  it("drag to reorder", () => {
    const l = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(moveBlockTo(l, "a", 2).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });

  it("old canvases render byte for byte", () => {
    const d = starterCanvas("Old");
    expect(renderCanvasEmail(normalizeCanvas(JSON.parse(JSON.stringify(d))), base)).toBe(renderCanvasEmail(d, base));
  });
});

describe("D243 E-3 wiring", () => {
  it("server, actions and editor parts exist and use the guards", () => {
    for (const p of [
      "src/lib/cms/newsletter-templates-server.ts",
      "src/app/admin/newsletter/canvas/layout-actions.ts",
      "src/components/admin/newsletter/CanvasStudioParts.tsx",
    ]) expect(existsSync(join(root, p))).toBe(true);
    const a = read("src/app/admin/newsletter/canvas/layout-actions.ts");
    expect(a).toContain('"use server"');
    expect(a).toContain('requirePermission("blog.manage")');
    for (const k of ["newsletter.canvas.template", "newsletter.sections.save", "newsletter.sections.delete"]) expect(a).toContain(k);
    const ed = read("src/components/admin/newsletter/NewsletterCanvasEditor.tsx");
    for (const k of ['sandbox=""', "SectionLibrary", "StylePanel", "InboxMockups", "forcedDarkHtml", "moveBlockTo", "duplicateAt", 'data-testid="canvas-undo"', "markBlocks: true"]) expect(ed).toContain(k);
    expect(read("src/lib/cms/newsletter-templates-server.ts")).toContain("newsletter_saved_sections");
  });

  it("is registered in the pure self-test runner, the help and the concierge", () => {
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('assertRan("newsletter-style-core", __runNewsletterStyleCoreTests(), 30)');
    expect(runner).toContain('assertRan("newsletter-layout-core", __runNewsletterLayoutCoreTests(), 35)');
    expect(runner).toContain('assertRan("newsletter-templates-core", __runNewsletterTemplatesCoreTests(), 54)');
    expect(runner).toContain("__runNewsletterCanvasCoreTests(), 128)");
    expect(read("src/app/admin/newsletter/canvas/[id]/page.tsx")).toContain("Full-page editor (D243 E-3)");
    expect(JSON.stringify(CONCIERGE_KB)).toContain("Full-page newsletter editor (D243 E-3, SOP-22 G-123)");
  });
});
