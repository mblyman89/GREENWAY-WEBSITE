/**
 * tests/compliance/r41-ai-assist.test.ts — R41 S8 AI focus + placement.
 *
 * Bible PART 8: the action returns WITHOUT saving (no upsert/update/insert/
 * save*), is permission-gated, refuses when AI is off, only sends https image
 * URLs, and the studio applies the suggestion to unsaved state only.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { __runBannerAiCoreTests, parsePlacementReply, absoluteImageUrl } from "@/lib/cms/banner-ai-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("R41 S8 pure core", () => {
  it("self-tests pass", () => {
    expect(__runBannerAiCoreTests().passed).toBeGreaterThanOrEqual(38);
  });
  it("rejects unusable replies instead of guessing", () => {
    expect(parsePlacementReply("I think the left side looks good.")).toBeNull();
    expect(parsePlacementReply("")).toBeNull();
  });
  it("only https or site-relative image URLs", () => {
    expect(absoluteImageUrl("/a.webp", "https://greenwaymarijuana.com")).toBe("https://greenwaymarijuana.com/a.webp");
    expect(absoluteImageUrl("http://x.co/a.webp", "https://greenwaymarijuana.com")).toBeNull();
  });
});

describe("R41 S8 action is drafts-only", () => {
  const src = read("src/app/admin/banner-ai-actions.ts");
  it("is a server file exporting only async functions", () => {
    expect(src.startsWith('"use server";')).toBe(true);
    for (const e of src.match(/^export (?!type )\S+ \S+/gm) ?? []) expect(e).toMatch(/^export async function/);
  });
  it("never writes", () => {
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.(upsert|update|insert|delete)\(/);
    expect(code).not.toMatch(/\bsave\w*\(/i);
    expect(code).not.toMatch(/\bpublish\w*\(/i);
    expect(code).not.toContain("createSupabaseAdminClient");
    expect(code).not.toContain("revalidatePath");
  });
  it("permission first, AI-off message, compliance system, validated parse", () => {
    const body = src.slice(src.indexOf("export async function suggestBannerPlacementAction"));
    expect(body.indexOf('requirePermission("content.edit")')).toBeLessThan(body.indexOf("isAiConfigured"));
    expect(body).toContain("AI isn't set up yet");
    expect(body).toContain("COMPLIANCE_SYSTEM");
    expect(body).toContain("PLACEMENT_SYSTEM");
    expect(body).toContain("absoluteImageUrl(");
    expect(body).toContain("parsePlacementReply(raw)");
    expect(body).toContain('feature: "banner.placement"');
  });
});

describe("R41 S8 studio UI", () => {
  const studio = read("src/components/admin/banner-studio/BannerStudio.tsx");
  const canvas = read("src/components/admin/banner-studio/StudioCanvas.tsx");
  it("Apply goes through change() (unsaved, undoable) and nothing else", () => {
    expect(studio).toContain("change(applySuggestion(design, ai.s, legacy, ai.device))");
    expect(studio).toContain("Nothing is saved until you press Save");
    expect(studio).toContain("Dismiss");
  });
  it("ghost is display-only", () => {
    expect(canvas).toContain('data-gw-ai-ghost="zone"');
    expect(canvas).toMatch(/data-gw-ai-ghost="zone"\s+className="pointer-events-none absolute"/);
    expect(canvas).toMatch(/data-gw-ai-ghost="focus"\s+className="pointer-events-none absolute"/);
  });
});
