/**
 * tests/compliance/d244-r20-erase-crop.test.ts - D244 round 7, slice R-20.
 *
 * Owner (verbatim): "If this is an actual feature flux has, the results
 * should be significantly better in my opinion. Rather than us just trying
 * to use it in a way it's not meant to be used. We are not doing something
 * right."
 *
 * Fix: crop-and-stitch at FLUX Erase's native ~1 MP (small photos are
 * ENLARGED), a letters-only mask (not whole rectangles), Erase dilation 6
 * for that mask, and the answer stitched back through the same mask.
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

import { ERASE_LETTERS_DILATE_PX, eraseBody, eraseCropPlan, eraseDilateFor, maskCover } from "@/lib/enrichment/text-erase-core";
import { eraseInput, pasteBack, pollMode } from "@/lib/enrichment/text-erase-server";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** A 550x550 "label": orange, with two lines of cream letters (bars) in a dark band. */
async function label(): Promise<Buffer> {
  const bars = [];
  for (let i = 0; i < 8; i++) bars.push(`<rect x="${180 + i * 24}" y="300" width="7" height="26" fill="#f2e6c0"/>`);
  for (let i = 0; i < 8; i++) bars.push(`<rect x="${180 + i * 24}" y="340" width="7" height="26" fill="#f2e6c0"/>`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="550" height="550"><rect width="550" height="550" fill="#e07020"/><rect x="120" y="280" width="320" height="110" fill="#262626"/>${bars.join("")}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
const BOX = { x: 170 / 550, y: 292 / 550, w: 200 / 550, h: 82 / 550 };

async function px(buf: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

describe("D244 R-20 what goes to FLUX Erase", () => {
  it("a 550 px photo's text area is enlarged to about 1 MP (was sent at 0.3 MP)", () => {
    const p = eraseCropPlan(550, 550, [BOX]);
    expect(p.scale).toBeGreaterThan(2);
    expect(p.send.width * p.send.height).toBeGreaterThan(850_000);
    expect(p.send.width * p.send.height).toBeLessThan(1_150_000);
    expect(p.send.width % 16).toBe(0);
    expect(p.send.height % 16).toBe(0);
  });
  it("the mask follows the letters, not the rectangle", async () => {
    const ei = await eraseInput(await label(), 550, 550, [BOX], "letters");
    const { width: sw } = ei.plan.send;
    expect(ei.stroke[0].whole).toBe(false);
    const toSend = (x: number, y: number) => [Math.round((x - ei.plan.crop.left) * ei.plan.scale), Math.round((y - ei.plan.crop.top) * ei.plan.scale)];
    const m = (x: number, y: number) => {
      const [sx, sy] = toSend(x, y);
      return ei.mask[sy * sw + sx];
    };
    expect(m(183, 312)).toBe(255); // a letter
    expect(m(195, 312)).toBe(0); // the dark label between letters
    expect(m(300, 372)).toBe(0); // inside the box, no letter
    const boxes = await eraseInput(await label(), 550, 550, [BOX], "boxes");
    expect(maskCover(ei.mask)).toBeLessThan(maskCover(boxes.mask) / 2);
  });
  it("Erase grows a letters mask less (6) than whole boxes (12)", () => {
    expect(ERASE_LETTERS_DILATE_PX).toBe(6);
    expect(eraseBody({ imageB64: "I", maskB64: "M", dilatePixels: eraseDilateFor("letters") }).dilate_pixels).toBe(6);
    expect(eraseDilateFor("boxes")).toBe(12);
    expect(pollMode("boxes")).toBe("boxes");
    expect(pollMode("junk")).toBe("letters");
  });
});

describe("D244 R-20 stitch-back through the letters mask", () => {
  it("letters take FLUX's answer; the label between them and everything outside stay original; full size", async () => {
    const orig = await label();
    const ei = await eraseInput(orig, 550, 550, [BOX], "letters");
    const answer = await sharp({ create: { width: ei.plan.send.width, height: ei.plan.send.height, channels: 3, background: "#262626" } }).png().toBuffer();
    const out = await pasteBack(orig, answer, [BOX], "letters");
    expect(out).not.toBeNull();
    const meta = await sharp(out!).metadata();
    expect([meta.width, meta.height]).toEqual([550, 550]);
    const letter = await px(out!, 183, 312);
    expect(letter[0]).toBeLessThan(80); // cream letter now dark label
    const far = await px(out!, 20, 20);
    expect(far[0]).toBeGreaterThan(200); // orange untouched
    expect(far[2]).toBeLessThan(60);
  });
  it("a whole-box run still replaces the whole box", async () => {
    const orig = await label();
    const ei = await eraseInput(orig, 550, 550, [BOX], "boxes");
    const answer = await sharp({ create: { width: ei.plan.send.width, height: ei.plan.send.height, channels: 3, background: "#0000ff" } }).png().toBuffer();
    const out = await pasteBack(orig, answer, [BOX], "boxes");
    const mid = await px(out!, 300, 372);
    expect(mid[2]).toBeGreaterThan(200);
  });
});

describe("D244 R-20 wiring and docs", () => {
  it("start crops + masks via eraseInput and sends the mode's dilation; poll stitches with the mode", () => {
    const server = read("src/lib/enrichment/text-erase-server.ts");
    expect(server).toContain("const ei = await eraseInput(up.png, up.width, up.height, check.boxes, mode);");
    expect(server).toContain("dilatePixels: eraseDilateFor(mode)");
    expect(server).toContain("await pasteBack(oin.buf, buffer, boxes, pollMode(p.mode))");
  });
  it("editor has the letters/whole-box choice and both clients pass the mode", () => {
    const ed = read("src/app/admin/products/[key]/remove-text/RemoveTextEditor.tsx");
    expect(ed).toContain('data-testid="remove-text-mode"');
    expect(ed).toContain("startEraseAction(productKey, mediaId, JSON.stringify(chosen), surface, mode)");
    expect(ed).toContain('data-testid="remove-text-detail"');
    const q = read("src/components/admin/products/RemoveTextQueue.tsx");
    expect(q).toContain('data-testid="queue-mode-boxes"');
    expect(q).toContain("queueStartEraseAction(scope, m, JSON.stringify(boxes), surface, mode)");
  });
  it("SOP-10 v1.5, Concierge and the strategy row explain it", () => {
    const sop = read("docs/sop/SOP-10-product-enrichment.md");
    expect(sop).toContain("(D244 R-20).** Owner, round 7:");
    expect(sop).toContain("| **Version** | 1.5 (D244 R-20;");
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Remove text, round 7 fix (D244 R-20");
    expect(read("docs/sop-program/D244-enrichment-powerhouse-strategy.md")).toMatch(/\| R-20 \| #\d+ \| merged \|/);
  });
});
