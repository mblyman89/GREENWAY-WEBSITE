/**
 * D243 E-6 (SOP-22 G-126, Phase E "Email Studio"): polish.
 *
 * Plan row (06-FIX-PHASE-PLAN.md, E-6): "Polish: animated design sections
 * exported as GIFs, dark-mode-safe logos, contrast and readability checks,
 * inbox size check, first-name merge tags".
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { __runNewsletterPolishCoreTests, designGifPlan, inboxSizeReport } from "@/lib/cms/newsletter-polish-core";
import { checkCanvas, canvasPlainText, normalizeCanvas, renderCanvasEmail, starterCanvas, type RenderOpts } from "@/lib/cms/newsletter-canvas-core";
import { defaultFrame, frameLogoSrc } from "@/lib/cms/newsletter-frame-core";
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

describe("D243 E-6 polish core", () => {
  it("self-tests pass", () => {
    const r = __runNewsletterPolishCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(80);
  });

  it("{{first_name}} becomes the member's name, or the fallback, and never reaches an inbox as braces", () => {
    const doc = normalizeCanvas({ ...starterCanvas("Week 1"), subject: "Hi {{first_name}}", blocks: [{ id: "t1", type: "text", text: "Hey {{first_name|friend}}, new drops are in.", align: "left" }] });
    const named = renderCanvasEmail(doc, { ...base, firstName: "maria" });
    expect(named).toContain("Hey Maria, new drops are in.");
    const anon = renderCanvasEmail(doc, base);
    expect(anon).toContain("Hey friend, new drops are in.");
    expect(anon).not.toContain("{{");
    expect(canvasPlainText(doc, { ...base, firstName: "Lee" })).toContain("Hey Lee, new drops are in.");
    expect(renderCanvasEmail(doc, { ...base, firstName: "<img src=x>" })).not.toContain("<img src=x>");
    expect(checkCanvas(doc, anon, canvasPlainText(doc, base)).issues.map((i) => i.code)).not.toContain("merge-unknown");
  });

  it("an unknown tag is a must-fix in the send check", () => {
    const doc = normalizeCanvas({ ...starterCanvas("Week 1"), blocks: [{ id: "t1", type: "text", text: "Hi {{name}}", align: "left" }] });
    const html = renderCanvasEmail(doc, base);
    const c = checkCanvas(doc, html, canvasPlainText(doc, base));
    expect(c.issues.find((i) => i.code === "merge-unknown")?.level).toBe("must-fix");
    expect(c.ok).toBe(false);
  });

  it("the send paths fill in first names (broadcast list, queue worker, subject)", () => {
    const store = read("src/lib/cms/newsletter-send-store.ts");
    expect(store).toContain('.select("email, first_name, consent, status, email_opt_out, unsubscribe_token")');
    expect(store).toContain("canvas.render(unsubscribeUrl(r.token), r.firstName)");
    expect(store).toContain('applyMergeTags(subject, r.firstName, "text")');
    const queue = read("src/lib/cms/newsletter-queue-server.ts");
    expect(queue).toContain('.select("unsubscribe_token, first_name").in("unsubscribe_token"');
    expect(queue).toContain("canvas?.usesNames");
    expect(queue).toContain("canvas.render(unsubscribeUrl(r.unsubscribe_token), firstName)");
    expect(queue).toContain('applyMergeTags(send.subject, firstName, "text")');
    expect(read("src/lib/cms/newsletter-canvas-server.ts")).toContain("usesNames: docHasMergeTags(doc)");
  });

  it("the wordmark is the dark-mode-safe version and the files exist", () => {
    expect(frameLogoSrc(defaultFrame(), "dark", base.siteUrl)).toMatch(/greenway-wordmark-white-halo\.png$/);
    expect(frameLogoSrc(defaultFrame(), "light", base.siteUrl)).toMatch(/greenway-wordmark-ink-halo\.png$/);
    for (const f of ["white-halo", "ink-halo"]) expect(existsSync(join(root, `public/brand/email/greenway-wordmark-${f}.png`))).toBe(true);
  });

  it("readability checks run in the send check", () => {
    const doc = normalizeCanvas({ ...starterCanvas("Week 1"), theme: "light", blocks: [{ id: "b1", type: "button", label: "Shop", href: "https://www.greenwaymarijuana.com/menu", color: "white" }] });
    const html = renderCanvasEmail(doc, base);
    expect(checkCanvas(doc, html, canvasPlainText(doc, base)).issues.map((i) => i.code)).toContain("button-blends");
    const ui = read("src/components/admin/newsletter/NewsletterCanvasEditor.tsx");
    expect(ui).toContain('data-testid="canvas-inbox-size"');
    expect(ui).toContain("frameDarkIssues(renderOpts.frame)");
    expect(inboxSizeReport({ htmlBytes: 1000, imageBytes: 0, imageCount: 0 }, false).rows).toHaveLength(3);
  });

  it("design sections can be saved as a moving GIF (finished design first)", () => {
    const p = designGifPlan({ boxes: [{ id: "h", x: 1, y: 1, hidden: false, enter: { fx: "rise" } }], buttons: [] } as never);
    expect(p.ok && p.frames[0].hide.length === 0).toBe(true);
    const ui = read("src/components/admin/newsletter/DesignSectionEditor.tsx");
    expect(ui).toContain('data-testid="design-save-gif"');
    expect(ui).toContain("saveDesignGifAction(fd)");
    const act = read("src/app/admin/newsletter/canvas/design-actions.ts");
    expect(act).toContain('requirePermission("blog.manage")');
    expect(act).toContain('action: "newsletter.design.gif"');
    expect(read("src/lib/cms/newsletter-motion-server.ts")).toContain("export async function buildDesignGif(");
  });

  it("is registered, documented for the concierge and in the help steps", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("newsletter-polish-core", __runNewsletterPolishCoreTests(), 80)');
    expect(JSON.stringify(CONCIERGE_KB)).toContain("Email polish (D243 E-6, SOP-22 G-126)");
    expect(read("src/app/admin/newsletter/canvas/[id]/page.tsx")).toContain("Polish (D243 E-6)");
  });
});
