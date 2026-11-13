/**
 * D243 E-1 (SOP-22 G-121, Phase E "Email Studio"): the locked brand frame.
 *
 * Owner (D243): "I like the idea of having a formatted header and footer and
 * title and logo and such so every newsletter has the same format, with a
 * customized body."
 * Decision 2 (D243): one locked brand header and footer for every newsletter,
 * editable only by owner/admin in Newsletter settings.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runNewsletterFrameCoreTests,
  defaultFrame,
  frameFooterHtml,
  normalizeFrame,
  FRAME_STYLES,
  FRAME_SETTING_KEY,
} from "@/lib/cms/newsletter-frame-core";
import { canvasPlainText, checkCanvas, renderCanvasEmail, starterCanvas, THEMES, type RenderOpts } from "@/lib/cms/newsletter-canvas-core";
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

describe("D243 E-1 brand frame core", () => {
  it("self-tests pass", () => {
    const r = __runNewsletterFrameCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(60);
  });

  it("every style and both looks keep the email compliant", () => {
    for (const style of FRAME_STYLES) {
      for (const theme of ["dark", "light"] as const) {
        const doc = { ...starterCanvas("Week 1"), theme };
        const o = { ...base, frame: { ...defaultFrame(), style }, issue: { number: 4, date: "2026-06-07" } };
        const html = renderCanvasEmail(doc, o);
        const text = canvasPlainText(doc, o);
        const codes = checkCanvas(doc, html, text).issues.map((i) => i.code);
        expect(codes).not.toContain("warnings");
        expect(codes).not.toContain("warnings-size");
        expect(codes).not.toContain("unsubscribe");
        expect(html).toContain("Issue 4");
        // Bold puts the logo on the colour band, so it picks the logo that reads on the band.
        if (style !== "bold") expect(html).toContain(`greenway-wordmark-${theme === "light" ? "ink" : "white"}.png`);
        else expect(html).toMatch(/greenway-wordmark-(ink|white)\.png/);
      }
    }
  });

  it("switching everything off still prints the warnings and unsubscribe", () => {
    const off = normalizeFrame({ showAddress: false, showHours: false, showPhone: false, showAgeBadge: false, footerNote: "", social: {} });
    const html = frameFooterHtml({ ...off, social: { instagram: false, facebook: false, google: false, yelp: false, leafly: false } }, THEMES.dark, base, "https://x.example/u");
    expect(html).toContain('data-gw-warnings="wac-314-55-155-7"');
    expect(html).toContain('data-gw-unsubscribe="1" href="https://x.example/u"');
  });

  it("frame off or missing renders exactly the pre-E-1 email", () => {
    const doc = starterCanvas("Week 1");
    expect(renderCanvasEmail(doc, { ...base, frame: null })).toBe(renderCanvasEmail(doc, base));
    expect(renderCanvasEmail(doc, { ...base, frame: { ...defaultFrame(), enabled: false } })).not.toContain("data-gw-frame");
  });

  it("the email logos exist in public/", () => {
    expect(existsSync(join(root, "public/brand/email/greenway-wordmark-white.png"))).toBe(true);
    expect(existsSync(join(root, "public/brand/email/greenway-wordmark-ink.png"))).toBe(true);
    for (const k of ["instagram", "facebook", "google", "yelp", "leafly"]) expect(existsSync(join(root, `public/social/glyph-${k}.png`))).toBe(true);
  });
});

describe("D243 E-1 wiring", () => {
  it("saved in site_settings, owner/admin only, audited", () => {
    expect(FRAME_SETTING_KEY).toBe("newsletter_brand_frame");
    const a = read("src/app/admin/newsletter/frame/actions.ts");
    expect(a).toContain("isAdminRole(session.profile.role)");
    expect(a).toContain('action: "newsletter.frame.save"');
    expect(read("src/lib/cms/newsletter-frame-server.ts")).toContain("FRAME_SETTING_KEY");
  });

  it("every render path passes the frame (preview, check, test, send, web copy)", () => {
    const srv = read("src/lib/cms/newsletter-canvas-server.ts");
    expect(srv).toContain("renderOptsFor(post, unsub, ctx)");
    expect(srv).toContain("renderOptsFor(post, null, await frameContextFor(post?.id ?? null))");
    expect(srv).toContain("renderOptsFor(post, null, await frameContextFor(post.id))");
    expect(read("src/lib/cms/newsletter-motion-server.ts")).toContain("await frameContextFor(post.id)");
    expect(read("src/app/admin/newsletter/canvas/[id]/page.tsx")).toContain("renderOptsFor(post, null, frameCtx)");
  });

  it("the page and links exist", () => {
    expect(existsSync(join(root, "src/app/admin/newsletter/frame/page.tsx"))).toBe(true);
    expect(read("src/app/admin/newsletter/page.tsx")).toContain('href="/admin/newsletter/frame"');
  });

  it("the concierge knows about the brand frame", () => {
    const all = JSON.stringify(CONCIERGE_KB);
    expect(all).toContain("Brand frame (D243 E-1");
    expect(all).toContain("/admin/newsletter/frame");
  });
});
