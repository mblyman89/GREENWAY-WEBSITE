/**
 * D243 E-4 (SOP-22 G-124, Phase E "Email Studio"): AI picture tools.
 *
 * Owner (D243): "For the ai help, I wanted to be able to generate an image or
 * gif using the ai. Or, use it to remove the background of an image I add to
 * the canvas. Or stretch or extend or other types of advanced features you'd
 * find in canva or adobe. The ai is meant to assist the build process. Change
 * the color, remove this from the image, etc. various image styles and
 * transformations."
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  __runNewsletterPictureCoreTests,
  PICTURE_TOOLS,
  toolEngines,
  extendPadding,
  padTotal,
  FLUX_EXPAND_MAX_SIDE,
  maskBase64,
  buildPicturePrompt,
  upscalePlan,
} from "@/lib/cms/newsletter-picture-core";
import { CONCIERGE_KB } from "@/lib/admin/concierge-kb";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("D243 E-4 picture core", () => {
  it("self-tests pass", () => {
    const r = __runNewsletterPictureCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(58);
  });

  it("has the twelve tools; erase/replace/extend are FLUX only, enlarge is local", () => {
    expect(PICTURE_TOOLS.map((t) => t.key)).toEqual([
      "generate", "edit", "remove-bg", "erase", "replace", "extend", "recolor", "relight", "style", "variation", "upscale", "gif-frame",
    ]);
    for (const k of ["erase", "replace", "extend"] as const) {
      expect(toolEngines(k, ["gpt", "gemini"])).toEqual([]);
      expect(toolEngines(k, ["gpt", "gemini", "flux"])).toEqual(["flux"]);
    }
    expect(toolEngines("upscale", [])).toEqual(["local"]);
  });

  it("extend padding stays inside the FLUX limit and masks must be PNG", () => {
    const p = extendPadding(4000, 4000, "all", 100);
    for (const v of [p.top, p.bottom, p.left, p.right]) expect(v).toBeLessThanOrEqual(FLUX_EXPAND_MAX_SIDE);
    expect(padTotal(extendPadding(1000, 500, "left", 50))).toBeGreaterThan(0);
    expect(maskBase64("data:image/jpeg;base64,AAAA")).toBeNull();
    expect(maskBase64("data:image/png;base64,AAAA")).toBe("AAAA");
    expect(upscalePlan(3000, 2000).ok).toBe(false);
  });

  it("prompts keep compliance: a youth or health-claim ask is refused", () => {
    const bad = buildPicturePrompt("generate", { ask: "kids cartoon character smoking, cures anxiety" });
    expect(bad.ok).toBe(false);
  });
});

describe("D243 E-4 server, actions and panel", () => {
  const server = read("src/lib/cms/newsletter-picture-server.ts");
  const actions = read("src/app/admin/newsletter/canvas/picture-actions.ts");
  const ui = read("src/components/admin/newsletter/CanvasPictureTools.tsx");
  const studio = read("src/components/admin/newsletter/CanvasAiStudio.tsx");

  it("server is server-only, uses FLUX fill and expand, the budget and the usage ledger", () => {
    expect(server).toContain('import "server-only"');
    expect(server).toContain('"flux-pro-1.0-fill"');
    expect(server).toContain('"flux-pro-1.0-expand"');
    expect(server).toContain("budgetBlock()");
    expect(server).toContain("logAiUsage(");
    expect(server).toContain("buildCanvasGif(");
  });

  it("the action needs blog.manage and is audited", () => {
    expect(actions).toContain('"use server"');
    expect(actions).toContain('requirePermission("blog.manage")');
    expect(actions).toContain("recordAudit(");
    expect(actions).toContain("newsletter.picture.${tool}");
  });

  it("the panel has the brush, before/after and undoable swap, and is wired in", () => {
    for (const id of ["picture-tools", "mask-brush", "before-after"]) expect(ui).toContain(`data-testid="${id}"`);
    expect(ui).toContain("aiPictureToolAction");
    expect(ui).toContain("aiFluxPollAction");
    expect(ui).toContain("swapPicture");
    expect(ui).toContain("commit");
    expect(studio).toContain("<CanvasPictureTools");
    expect(studio).toContain("<CanvasGifMaker");
  });

  it("concierge knows the picture tools", () => {
    expect(JSON.stringify(CONCIERGE_KB)).toContain("AI picture tools (D243 E-4, SOP-22 G-124)");
  });
});
