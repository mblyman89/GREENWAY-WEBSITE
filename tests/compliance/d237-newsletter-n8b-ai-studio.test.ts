/**
 * D238 N-8b (SOP-22 G-118): the canvas AI studio — Build with AI, Improve this
 * section, Subject ideas, and the picture studio (GPT Image, Gemini, FLUX;
 * Remove background).
 *
 * Owner (D238): "the ability to ask the ai to help with building the
 * newsletter like how canva has its ai, you can select an image and ask it to
 * manipulate it or remove the background and other such features. It'd be
 * great if we could use our Gemini or gpt ai to interact with and help us
 * customize and make professional content. Maybe have a feature that lets me
 * use flux from the editor."
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runNewsletterAiCoreTests,
  applyImproved,
  checkAiCopy,
  checkImageAsk,
  editableWords,
  fullImagePrompt,
  gptEditBody,
  IMAGE_SAFETY_SUFFIX,
} from "@/lib/cms/newsletter-ai-core";
import { normalizeCanvas } from "@/lib/cms/newsletter-canvas-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("D238 N-8b canvas AI studio", () => {
  it("pure core self-tests all pass", () => {
    const r = __runNewsletterAiCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(60);
  });

  it("AI copy may not invent prices, links or superlatives", () => {
    const facts = "Deal: 20% off pre-rolls\nhttps://www.greenwaymarijuana.com/deals";
    expect(checkAiCopy("Come get 20% off pre-rolls: https://www.greenwaymarijuana.com/deals", facts).filter((i) => i.level === "must-fix")).toEqual([]);
    expect(checkAiCopy("The best flower in town, now $5!", facts).some((i) => i.level === "must-fix")).toBe(true);
    expect(checkAiCopy("See https://evil.example/x", facts).some((i) => i.level === "must-fix")).toBe(true);
  });

  it("review quotes are locked; other sections only change their words", () => {
    const [review, text] = normalizeCanvas({ blocks: [{ type: "review", quote: "Great staff", author: "Sam" }, { type: "text", text: "Hello", align: "center" }] }).blocks;
    expect(editableWords(review)).toBeNull();
    const r = applyImproved(text, { text: "Hello friends" });
    expect(r.changed).toEqual(["text"]);
    expect(r.block.id).toBe(text.id);
    expect((r.block as { align: string }).align).toBe("center");
  });

  it("picture asks are screened and always carry the safety note; remove background asks GPT for a transparent PNG", () => {
    expect(checkImageAsk("a teenager smoking a joint").some((i) => i.level === "must-fix")).toBe(true);
    expect(checkImageAsk("a jar on a wooden counter").filter((i) => i.level === "must-fix")).toEqual([]);
    expect(fullImagePrompt("a jar")).toContain(IMAGE_SAFETY_SUFFIX);
    const b = gptEditBody({ model: "gpt-image-2", prompt: "x", imageDataUrl: "data:image/png;base64,AA", transparent: true });
    expect(b.background).toBe("transparent");
    expect(b.output_format).toBe("png");
  });

  it("actions require blog.manage, audit every AI call, and the server checks budget + compliance", () => {
    const a = read("src/app/admin/newsletter/canvas/ai-actions.ts");
    expect(a.startsWith('"use server"')).toBe(true);
    expect(a.match(/requirePermission\("blog\.manage"\)/g)?.length).toBe(5);
    for (const x of ["newsletter.canvas.ai_build", "newsletter.canvas.ai_improve", "newsletter.canvas.ai_subjects", "newsletter.canvas.ai_image", "newsletter.canvas.ai_image_flux_ready"]) expect(a).toContain(x);
    const s = read("src/lib/cms/newsletter-ai-server.ts");
    expect(s).toContain('import "server-only"');
    expect(s).toContain("getBudgetStatus()");
    expect(s).toContain("checkCompliance(text)");
    expect(s).toContain("logAiUsage(");
    expect(s).toContain("uploadMedia(");
    expect(s).not.toMatch(/\.limit\(\s*\d{4,}/);
  });

  it("the canvas page shows the AI studio in the editor's tool slot", () => {
    const page = read("src/app/admin/newsletter/canvas/[id]/page.tsx");
    expect(page).toContain("NewsletterCanvasWithAi");
    expect(page).toContain("imageEngines()");
    const ui = read("src/components/admin/newsletter/CanvasAiStudio.tsx");
    expect(ui).toContain("extraTools=");
    expect(ui).toContain("aiFluxPollAction");
  });
});
