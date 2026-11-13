/**
 * D238 N-8c (SOP-22 G-118): moving and interactive canvas pieces — GIF maker,
 * live countdown, one-tap poll, clicks by section, hosted web version.
 *
 * Owner (D238): "I want to be able to use moving elements, interactive
 * elements, other types of advanced marketing techniques."
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runNewsletterMotionCoreTests,
  canvasClickReport,
  countdownSvg,
  parseCountdownQuery,
  planGifBuild,
} from "@/lib/cms/newsletter-motion-core";
import { __runNewsletterCanvasCoreTests, checkCanvas, canvasPlainText, normalizeCanvas, renderCanvasEmail, type RenderOpts } from "@/lib/cms/newsletter-canvas-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const opts: RenderOpts = {
  businessName: "Greenway Marijuana",
  address: "Port Orchard, WA",
  siteUrl: "https://www.greenwaymarijuana.com",
  hours: "8am-11pm",
  unsubscribeUrl: null,
  webUrl: null,
  campaign: "week",
};

describe("D238 N-8c moving + interactive canvas", () => {
  it("pure self-tests pass (motion core + canvas core with the new blocks)", () => {
    const m = __runNewsletterMotionCoreTests();
    expect(m.failed).toBe(0);
    expect(m.passed).toBeGreaterThanOrEqual(49);
    const c = __runNewsletterCanvasCoreTests();
    expect(c.failed).toBe(0);
    expect(c.passed).toBeGreaterThanOrEqual(90);
  });

  it("the countdown is drawn without fonts and the image URL is validated", () => {
    expect(countdownSvg(100, "dark")).not.toContain("<text");
    const now = 1_800_000_000;
    expect(parseCountdownQuery({ e: "nope" }, now)).toBeNull();
    expect(parseCountdownQuery({ e: String(now + 400 * 86400) }, now)).toBeNull();
    const route = read("src/app/api/newsletter/countdown/route.ts");
    expect(route).toContain("no-store");
    expect(route).toContain("image/gif");
  });

  it("a poll and a countdown render as email-safe links and pictures and keep the footer", () => {
    const doc = normalizeCanvas({
      subject: "s",
      preheader: "p",
      blocks: [
        { id: "cd", type: "countdown", endsAt: "2030-01-01T00:00:00Z", label: "Ends in" },
        { id: "pl", type: "poll", question: "Next?", options: ["A", "B"] },
      ],
    });
    const html = renderCanvasEmail(doc, opts);
    expect(html).toContain("/api/newsletter/countdown?e=");
    expect(html).toContain("utm_content=pl-o1");
    expect(html).not.toMatch(/<script|<form/i);
    expect(html).toContain('data-gw-footer="fixed"');
    const check = checkCanvas(doc, html, canvasPlainText(doc, opts));
    expect(check.issues.filter((i) => i.level === "must-fix")).toEqual([]);
  });

  it("clicks by section count people once and poll answers as votes", () => {
    const doc = normalizeCanvas({ blocks: [{ id: "pl", type: "poll", question: "Q", options: ["A", "B"] }] });
    const r = canvasClickReport(doc, [
      { url: "https://www.greenwaymarijuana.com/?utm_content=pl-o2", recipient: "a@x.com" },
      { url: "https://www.greenwaymarijuana.com/?utm_content=pl-o2", recipient: "A@x.com" },
    ]);
    expect(r.rows[0].options[1].people).toBe(1);
    expect(r.rows[0].options[1].votes).toBe(2);
  });

  it("the GIF maker limits frames and saves to Media; actions are blog.manage + audited", () => {
    expect(planGifBuild({ frames: 1, width: 600, seconds: 1, shape: "wide" }).ok).toBe(false);
    expect(planGifBuild({ frames: 11, width: 600, seconds: 1, shape: "wide" }).ok).toBe(false);
    const srv = read("src/lib/cms/newsletter-motion-server.ts");
    expect(srv).toContain('import "server-only"');
    expect(srv).toContain("join: { animated: true }");
    expect(srv).toContain("uploadMedia(");
    expect(srv).not.toMatch(/\.limit\(\s*\d{4,}/);
    const a = read("src/app/admin/newsletter/canvas/actions.ts");
    expect(a).toContain("newsletter.canvas.gif");
    expect(a).toContain("export async function buildGifAction");
  });

  it("View in your browser opens the hosted copy (no scripts allowed), and the page shows clicks by section", () => {
    expect(read("src/lib/cms/newsletter-canvas-server.ts")).toContain("/newsletter-web/${post.slug}");
    const web = read("src/app/newsletter-web/[slug]/route.ts");
    expect(web).toContain("default-src 'none'");
    expect(web).toContain("webVersionFor");
    const page = read("src/app/admin/newsletter/canvas/[id]/page.tsx");
    expect(page).toContain("<CanvasClickReport");
    expect(read("src/components/admin/newsletter/CanvasAiStudio.tsx")).toContain("<CanvasGifMaker");
  });
});
