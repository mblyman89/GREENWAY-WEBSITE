/**
 * tests/compliance/d244-r21-kit-one-grid.test.ts - D244 round 8, slice R-21.
 *
 * Owner (verbatim): "I do not want two sections of images, I want to be able
 * to remove text from any and all images available on the vendor kit page,
 * not just the small section at the bottom. ... please allow me to remove
 * text from any of the pictures available."
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ERASE_QUEUE_MAX, toggleQueuePick } from "@/lib/enrichment/text-erase-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const PAGE = read("src/app/admin/products/vendor-kits/page.tsx");
const GRID = read("src/app/admin/products/vendor-kits/KitPhotoGrid.tsx");
const QUEUE = read("src/components/admin/products/RemoveTextQueue.tsx");

describe("D244 R-21 one photo grid on Vendor kits", () => {
  it("the page renders ONE grid (KitPhotoGrid) and no separate queue strip", () => {
    expect(PAGE).toContain("<KitPhotoGrid");
    expect(PAGE).not.toContain("<RemoveTextQueue");
    expect(PAGE).not.toContain(".slice(0, 12).map((p) => ({ mediaId");
    expect(PAGE).toContain("s.photos.map((p) => ({");
  });
  it("every photo tile has a Remove text toggle and still picks the kit photo", () => {
    expect(GRID.trimStart().startsWith('"use client";')).toBe(true);
    expect(GRID).toContain('data-testid="kit-photo-remove-text"');
    expect(GRID).toContain('data-testid="kit-photo"');
    expect(GRID).toContain("<Link href={p.href}");
    expect(GRID).toContain("onClick={() => toggle(p.id)}");
    expect(GRID).toContain('pickLabel="Use as the kit photo"');
    expect(GRID).toContain("hidePicker");
  });
  it("the queue lets the page own the ticks and hides the thumbnail strip", () => {
    expect(QUEUE).toContain("const picked = props.picked ?? ownPicked;");
    expect(QUEUE).toContain("props.onToggle ? props.onToggle(m)");
    expect(QUEUE).toContain("{hidePicker ? null : (");
  });
  it("pick rules: any photo, 12 at a time, untick makes room", () => {
    const many = Array.from({ length: ERASE_QUEUE_MAX }, (_, i) => `m${i}`);
    expect(toggleQueuePick(many, "x").full).toBe(true);
    expect(toggleQueuePick(many, "m0").picked).toHaveLength(ERASE_QUEUE_MAX - 1);
    expect(toggleQueuePick([], "a").picked).toEqual(["a"]);
  });
  it("SOP-10 v1.6, Concierge and strategy row explain it", () => {
    expect(read("docs/sop/SOP-10-product-enrichment.md")).toContain("| **Version** | 1.6 (D244 R-21;");
    expect(read("src/lib/admin/concierge-kb.ts")).toContain("Remove text on Vendor kits, any photo (D244 R-21");
    expect(read("docs/sop-program/D244-enrichment-powerhouse-strategy.md")).toMatch(/\| R-21 \| #\d+ \| merged \|/);
  });
});
