/**
 * tests/compliance/d244-r17-erase.test.ts - D244 round 6, slice R-17.
 *
 * Owner (verbatim): "Flux adds weird things to the removed text. Barcodes,
 * more text, fuzzy looking text, etc. it is really bad at this right now.
 * Please deep research how to do this properly from the authoritative docs
 * and sources. Use community driven solutions that have been proven."
 *
 * Fix: BFL's purpose-built FLUX Erase (no prompt, dilate_pixels) instead of a
 * Fill prompt that named "letters, words, numbers" (BFL: FLUX has no negative
 * prompts; naming a thing paints it), sent at ~1 MP, and the answer pasted
 * back over the original only inside the boxes (feathered), so nothing
 * outside the boxes can change.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/media/store", () => ({ getMedia: vi.fn(), publicUrlForKey: vi.fn(), uploadMedia: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/cms/newsletter-ai-server", () => ({ loadInput: vi.fn() }));
vi.mock("@/lib/marketing/flux-client", () => ({ isFluxConfigured: vi.fn(), pollFluxTask: vi.fn(), submitFluxTask: vi.fn() }));

import {
  ERASE_FALLBACK_MODEL,
  ERASE_MODEL,
  eraseBody,
  erasePrompt,
  eraseSendSize,
  eraseUnavailable,
  __runTextEraseCoreTests,
} from "@/lib/enrichment/text-erase-core";
import { pasteBack, pollBoxes } from "@/lib/enrichment/text-erase-server";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

async function solid(w: number, h: number, hex: string, fmt: "png" | "jpeg" = "png"): Promise<Buffer> {
  const img = sharp({ create: { width: w, height: h, channels: 3, background: hex } });
  return fmt === "png" ? img.png().toBuffer() : img.jpeg({ quality: 95 }).toBuffer();
}
async function pixel(buf: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

describe("D244 R-17 the remover", () => {
  it("self-tests pass (63 + 1) and are registered", () => {
    expect(__runTextEraseCoreTests()).toEqual({ passed: 64, failed: 0 });
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain('assertRan("text-erase-core", __runTextEraseCoreTests(), 64)');
  });
  it("FLUX Erase, no prompt, BFL's dilation; Fill only as the fallback with a positive prompt", () => {
    expect(ERASE_MODEL).toBe("flux-tools/erase-v1");
    expect(ERASE_FALLBACK_MODEL).toBe("flux-pro-1.0-fill");
    const b = eraseBody({ imageB64: "I", maskB64: "M" });
    expect(b).toEqual({ image: "I", mask: "M", dilate_pixels: 12, output_format: "png" });
    expect(erasePrompt({ surface: "jar label" })).toContain("clean, blank, unmarked jar label surface");
    expect(erasePrompt()).not.toMatch(/\b(no|letters?|words?|text|numbers?|logos?|barcodes?)\b/i);
    expect(eraseUnavailable("FLUX rejected the request (404): Not Found")).toBe(true);
    expect(eraseUnavailable("The BFL account is out of credits. Add credits at dashboard.bfl.ai and try again.")).toBe(false);
  });
  it("big phone photos are sent at about 1 MP (what Erase was trained on)", () => {
    const s = eraseSendSize(4032, 3024);
    expect(s.width * s.height).toBeLessThan(1_060_000);
    expect(s.width % 16).toBe(0);
  });
});

describe("D244 R-17 paste-back: only the boxes change", () => {
  it("outside the boxes is the original pixel for pixel; inside is FLUX's answer; full size kept", async () => {
    const orig = await solid(400, 300, "#ff0000");
    const answer = await solid(200, 150, "#0000ff", "jpeg"); // FLUX answered smaller and "changed" everything
    const out = await pasteBack(orig, answer, [{ x: 0.25, y: 0.3, w: 0.25, h: 0.2 }]);
    expect(out).not.toBeNull();
    const meta = await sharp(out!).metadata();
    expect([meta.width, meta.height]).toEqual([400, 300]);
    const far = await pixel(out!, 10, 10);
    expect(far[0]).toBeGreaterThan(240);
    expect(far[2]).toBeLessThan(15);
    const corner = await pixel(out!, 390, 290);
    expect(corner[0]).toBeGreaterThan(240);
    const mid = await pixel(out!, 150, 120);
    expect(mid[2]).toBeGreaterThan(235);
    expect(mid[0]).toBeLessThan(20);
  });
  it("no boxes means no paste-back (the raw answer is kept)", async () => {
    expect(await pasteBack(await solid(10, 10, "#fff"), await solid(10, 10, "#000"), [])).toBeNull();
  });
  it("poll boxes are re-checked; junk is dropped", () => {
    expect(pollBoxes('[{"x":0.1,"y":0.1,"w":0.2,"h":0.1},{"x":"a"}]')).toHaveLength(1);
    expect(pollBoxes("nope")).toEqual([]);
  });
});

describe("D244 R-17 wiring", () => {
  const server = read("src/lib/enrichment/text-erase-server.ts");
  it("start sends Erase first, Fill only when Erase is unavailable; poll pastes back", () => {
    expect(server).toContain("submitFluxTask(ERASE_MODEL, eraseBody(");
    expect(server).toContain("if (!sub.ok && eraseUnavailable(sub.error))");
    expect(server).toContain("submitFluxTask(ERASE_FALLBACK_MODEL, fluxFillBody(");
    expect(server).toContain("await pasteBack(oin.buf, buffer, boxes)");
    expect(server).toContain(".rotate()");
  });
  it("both clients send the boxes back with each poll", () => {
    expect(read("src/app/admin/products/[key]/remove-text/RemoveTextEditor.tsx")).toContain("pollEraseAction(productKey, sub.pollingUrl, mediaId, JSON.stringify(sub.boxes))");
    expect(read("src/components/admin/products/RemoveTextQueue.tsx")).toContain("queuePollEraseAction(scope, sub.pollingUrl, m, JSON.stringify(sub.boxes))");
  });
  it("SOP-10, Concierge and the strategy row explain it", () => {
    expect(read("docs/sop/SOP-10-product-enrichment.md")).toContain("FLUX Erase (D244 R-17)");
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Remove text quality (D244 R-17, owner:");
    expect(read("docs/sop-program/D244-enrichment-powerhouse-strategy.md")).toMatch(/\| R-17 \| #\d+ \| merged \|/);
  });
});
