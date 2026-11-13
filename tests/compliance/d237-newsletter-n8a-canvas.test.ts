/**
 * D238 N-8a (SOP-22 G-118; F-22-8; Q-22-5 (a)): the in-app newsletter canvas,
 * its send checks (size / Gmail clip / images), image compression and QR codes.
 *
 * Owner (D238): "It will also need a way to make sure it can be sent without
 * issues, a checks process to make sure it's not too big to send or a way to
 * compress it if needed."
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runNewsletterCanvasCoreTests,
  GMAIL_CLIP_BYTES,
  checkCanvas,
  canvasPlainText,
  normalizeCanvas,
  renderCanvasEmail,
  starterCanvas,
  type RenderOpts,
} from "@/lib/cms/newsletter-canvas-core";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const opts: RenderOpts = {
  businessName: "Greenway Marijuana",
  address: "Port Orchard, WA",
  siteUrl: "https://www.greenwaymarijuana.com",
  hours: "8am-11pm",
  unsubscribeUrl: null,
  webUrl: null,
  campaign: "test",
};

describe("D238 N-8a newsletter canvas", () => {
  it("pure core self-tests all pass", () => {
    const r = __runNewsletterCanvasCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(82);
  });

  it("the fixed footer (warnings + unsubscribe) is always rendered, even with no blocks", () => {
    const doc = normalizeCanvas({ subject: "Hi", blocks: [] });
    const html = renderCanvasEmail(doc, opts);
    expect(html).toContain('data-gw-footer="fixed"');
    expect(html).toContain('data-gw-unsubscribe="1"');
  });

  it("a starter canvas passes the send check; a huge one is refused for the Gmail clip", () => {
    const doc = starterCanvas("Weekly");
    const ok = checkCanvas(doc, renderCanvasEmail(doc, opts), canvasPlainText(doc, opts));
    expect(ok.issues.filter((i) => i.level === "must-fix")).toEqual([]);
    const big = normalizeCanvas({
      ...doc,
      blocks: Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, type: "text", text: "x".repeat(3000), align: "left" })),
    });
    const r = checkCanvas(big, renderCanvasEmail(big, opts), canvasPlainText(big, opts));
    expect(r.htmlBytes).toBeGreaterThan(GMAIL_CLIP_BYTES);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "clip" && i.level === "must-fix")).toBe(true);
  });

  it("the broadcast and the queue send the canvas and refuse must-fix items", () => {
    const store = read("src/lib/cms/newsletter-send-store.ts");
    expect(store).toContain("canvasEmailFor(n.id)");
    expect(store).toContain("checkCanvas(");
    expect(store).toContain("hasCanvas");
    expect(read("src/lib/cms/newsletter-queue-server.ts")).toContain("canvasEmailFor(send.post_id)");
    const page = read("src/app/admin/newsletter/page.tsx");
    expect(page).toContain("(n.pdfUrl || n.hasCanvas)");
  });

  it("canvas actions require blog.manage, audit, and void approval on save", () => {
    const a = read("src/app/admin/newsletter/canvas/actions.ts");
    expect(a.startsWith('"use server"')).toBe(true);
    expect(a).toContain('requirePermission("blog.manage")');
    for (const x of ["newsletter.canvas.save", "newsletter.canvas.compress", "newsletter.canvas.qr", "newsletter.canvas.test_send", "newsletter.canvas.create"]) {
      expect(a).toContain(x);
    }
    expect(a).toContain("voidApprovalOnEdit(");
  });

  it("stored in site_settings (no migration) and the preview iframe is sandboxed", () => {
    expect(read("src/lib/cms/newsletter-canvas-server.ts")).toContain('from("site_settings")');
    expect(read("src/components/admin/newsletter/NewsletterCanvasEditor.tsx")).toContain('sandbox=""');
  });
});
