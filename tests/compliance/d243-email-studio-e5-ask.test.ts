/**
 * D243 E-5 (SOP-22 G-125, Phase E "Email Studio"): Ask the canvas.
 *
 * Owner (D243): "I should be able to ask it a question and it does the thing I
 * need on the canvas, by visually inspecting the canvas and then doing the
 * request." Decision 4 (approved): the AI proposes first, then Apply, with Undo.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { __runNewsletterAskCoreTests, applyAskOps, parseAskOps, ASK_PICTURE_TOOLS } from "@/lib/cms/newsletter-ask-core";
import { checkCanvas, canvasPlainText, renderCanvasEmail, starterCanvas, type RenderOpts } from "@/lib/cms/newsletter-canvas-core";
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

describe("D243 E-5 ask core", () => {
  it("self-tests pass", () => {
    const r = __runNewsletterAskCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(60);
  });

  it("whatever the AI asks for, the warnings and unsubscribe survive", () => {
    const doc = starterCanvas("Week 1");
    const ids = doc.blocks.map((b) => b.id);
    const plan = parseAskOps(
      { reply: "ok", ops: [...ids.map((id) => ({ kind: "remove", id })), { kind: "add", type: "text", after: null, fields: { text: "Hi" } }, { kind: "words", id: "footer", fields: { text: "no warnings" } }] },
      doc,
    );
    const out = applyAskOps(doc, plan.ops, (s) => `${s}1`).doc;
    const html = renderCanvasEmail(out, base);
    const codes = checkCanvas(out, html, canvasPlainText(out, base)).issues.map((i) => i.code);
    expect(codes).not.toContain("warnings");
    expect(codes).not.toContain("unsubscribe");
    expect(plan.dropped.some((d) => d.includes("no section footer"))).toBe(true);
  });

  it("the AI never gets the painted-mask tools", () => {
    expect(ASK_PICTURE_TOOLS).not.toContain("erase");
    expect(ASK_PICTURE_TOOLS).not.toContain("replace");
  });
});

describe("D243 E-5 server, actions and panel", () => {
  const server = read("src/lib/cms/newsletter-ask-server.ts");
  const actions = read("src/app/admin/newsletter/canvas/ask-actions.ts");
  const ui = read("src/components/admin/newsletter/CanvasAskPanel.tsx");
  const studio = read("src/components/admin/newsletter/CanvasAiStudio.tsx");
  const editor = read("src/components/admin/newsletter/NewsletterCanvasEditor.tsx");

  it("server: vision model on the screenshot, budget, copy and compliance checks", () => {
    expect(server).toContain('import "server-only"');
    expect(server).toContain("generateVisionJson(");
    expect(server).toContain('detail: "high"');
    expect(server).toContain("ASK_CANVAS_MODEL");
    expect(server).toContain("budgetBlock()");
    expect(server).toContain("checkCompliance(text)");
    expect(server).toContain("checkAiCopy(");
    expect(server).toContain("askShotOk(");
  });

  it("actions need blog.manage and are audited", () => {
    expect(actions).toContain('"use server"');
    expect(actions.match(/requirePermission\("blog\.manage"\)/g)?.length).toBe(2);
    expect(actions).toContain('"newsletter.ai_ask"');
    expect(actions).toContain('"newsletter.ai_ask_apply"');
  });

  it("panel proposes, applies with commit (undo), screenshots the preview, and is wired in", () => {
    for (const id of ["ask-canvas", "ask-canvas-input", "ask-canvas-send", "ask-canvas-plan", "ask-canvas-apply"]) expect(ui).toContain(`data-testid="${id}"`);
    expect(ui).toContain("modern-screenshot");
    expect(ui).toContain("applyAskOps(");
    expect(ui).toContain("api.commit");
    expect(ui).toContain("aiPictureToolAction");
    expect(studio).toContain("<CanvasAskPanel");
    expect(editor).toContain("commit, html })");
  });

  it("concierge knows Ask the canvas", () => {
    expect(JSON.stringify(CONCIERGE_KB)).toContain("Ask the canvas (D243 E-5, SOP-22 G-125)");
  });
});
