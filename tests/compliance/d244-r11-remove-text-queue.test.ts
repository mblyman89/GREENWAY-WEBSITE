/**
 * tests/compliance/d244-r11-remove-text-queue.test.ts - D244 round 4, slice R-11.
 *
 * Owner (verbatim): "the remove text feature, I would like it to be available
 * on the copilot feature as well as the brand kit. on both, I think it would
 * be a great idea to have the ability to select a product image, draw a box
 * on it where I want it to remove and replace text with the background. I
 * want to draw a box on all product images, then click the remove text
 * button. that way I can quickly queue up several images to feed to flux to
 * fix one after the next. please also add helper text on the page that lets
 * me know that if there are facts to attach, do that first, because the
 * product goes away after the photo is attached, by design".
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("server-only", () => ({}));

import {
  __runTextEraseCoreTests,
  ERASE_QUEUE_MAX,
  FACTS_FIRST_HINT,
  cleanQueueScope,
  eraseQueuePlan,
  queueButtonLabel,
} from "@/lib/enrichment/text-erase-core";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const QUEUE = read("src/components/admin/products/RemoveTextQueue.tsx");
const ACTIONS = read("src/components/admin/products/remove-text-queue-actions.ts");
const COPILOT = read("src/app/admin/products/copilot/page.tsx");
const COPILOT_ACTIONS = read("src/app/admin/products/copilot/actions.ts");
const KITS = read("src/app/admin/products/vendor-kits/page.tsx");
const EDITOR = read("src/app/admin/products/[key]/remove-text/RemoveTextEditor.tsx");

describe("R-11 queue core", () => {
  it("self-tests pass (45 from R-9 + 9 for the queue + 10 for R-17 Erase)", () => {
    const r = __runTextEraseCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(64);
  });
  it("one press sends every boxed photo, in order, skipping done ones", () => {
    expect(
      eraseQueuePlan([
        { mediaId: "a", boxesOn: 1, state: "idle" },
        { mediaId: "b", boxesOn: 0, state: "idle" },
        { mediaId: "c", boxesOn: 3, state: "ready" },
        { mediaId: "d", boxesOn: 2, state: "idle" },
      ]),
    ).toEqual(["a", "d"]);
    expect(ERASE_QUEUE_MAX).toBe(12);
    expect(queueButtonLabel(2, 3)).toBe("\u2702 Remove text from 2 photos (3 boxes)");
  });
  it("scope is a product card or a vendor, nothing else", () => {
    expect(cleanQueueScope({ kind: "vendor", id: "v-1" })).toEqual({ kind: "vendor", id: "v-1" });
    expect(cleanQueueScope({ kind: "admin", id: "x" })).toBeNull();
  });
  it("the helper text says facts/AI first because the photo publishes, by design", () => {
    expect(FACTS_FIRST_HINT).toContain("Attaching a photo publishes the product");
    expect(FACTS_FIRST_HINT).toContain("by design");
    expect(FACTS_FIRST_HINT).toContain("attach them first");
  });
});

describe("R-11 queue wiring", () => {
  it("the queue runs FLUX one after the next (sequential await loop) and never attaches by itself", () => {
    expect(QUEUE).toContain("for (const m of order) {");
    expect(QUEUE).toContain("await runOne(m, boxesFor.get(m) ?? []);");
    expect(QUEUE).toContain('data-testid="queue-run"');
    expect(QUEUE).toContain("disabled={!fluxReady || running || plan.length === 0}");
    expect(QUEUE).not.toMatch(/attachAction\(/);
  });
  it("the queue actions need products.enrich, audit, and reuse the R-9 server", () => {
    expect(ACTIONS.trimStart().startsWith('"use server";')).toBe(true);
    expect((ACTIONS.match(/requirePermission\("products\.enrich"\)/g) ?? []).length).toBe(3);
    for (const a of ["product.remove_text_found", "product.remove_text_started", "product.remove_text_saved"]) expect(ACTIONS).toContain(a);
    expect(ACTIONS).toContain("startTextErase(");
    expect(ACTIONS).toContain("pollTextErase(");
  });
  it("Copilot shows the queue with Attach / Attach as cover, and the facts-first hint", () => {
    expect(COPILOT).toContain("<RemoveTextQueue");
    expect(COPILOT).toContain('scope={{ kind: "product", id: c.key }}');
    expect(COPILOT).toContain("attachAction={copilotAttachPhotoAction}");
    expect(COPILOT).toContain('data-testid="facts-first-hint"');
    expect(COPILOT_ACTIONS).toContain('const asCover = parseCoverIntent(formData.get("cover"));');
    expect(QUEUE).toContain('data-testid="queue-attach-cover"');
  });
  it("Vendor kits shows the queue; the clean photo becomes the kit photo by a click", () => {
    expect(KITS).toContain("<RemoveTextQueue");
    expect(KITS).toContain('scope={{ kind: "vendor", id: s.vendorId }}');
    expect(KITS).toContain('pickLabel="Use as the kit photo"');
    expect(KITS).toContain("await getMedia(photoId)");
    expect(KITS).toContain('data-testid="facts-first-hint"');
  });
  it("the single-photo editor carries the facts-first hint before Attach", () => {
    expect(EDITOR).toContain("{FACTS_FIRST_HINT}");
  });
});
