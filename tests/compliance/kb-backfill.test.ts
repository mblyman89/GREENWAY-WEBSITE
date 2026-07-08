/**
 * tests/compliance/kb-backfill.test.ts — Slice H12g.
 *
 * Pins the chunked "Promote all manifests to KB drafts" rules
 * (src/lib/inventory/kb-backfill-core.ts). Owner: "I clicked the button on
 * the promote all to kb, I'm not sure if it works, I don't get a
 * confirmation and I'm not sure where I should look on the kb page."
 */
import { describe, it, expect } from "vitest";
import {
  KB_BACKFILL_CHUNK_SIZE,
  KB_REVIEW_INBOX_PATH,
  chunkManifestIds,
  summarizeKbBackfill,
  kbBackfillMessage,
  type KbChunkOutcome,
} from "@/lib/inventory/kb-backfill-core";

function outcome(partial: Partial<KbChunkOutcome>): KbChunkOutcome {
  return {
    manifestId: "m",
    ok: true,
    promoted: 0,
    strainsEnriched: 0,
    vendorLicenseFilled: false,
    error: null,
    ...partial,
  };
}

describe("H12g chunkManifestIds", () => {
  it("chunks small enough that a server call can never time out", () => {
    expect(KB_BACKFILL_CHUNK_SIZE).toBeLessThanOrEqual(10);
    const ids = Array.from({ length: 12 }, (_, i) => `id-${i}`);
    const chunks = chunkManifestIds(ids);
    expect(chunks.flat()).toEqual(ids);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(KB_BACKFILL_CHUNK_SIZE);
    expect(chunks.length).toBe(Math.ceil(12 / KB_BACKFILL_CHUNK_SIZE));
  });

  it("drops blanks and duplicates", () => {
    expect(chunkManifestIds(["a", " ", "a", "b", ""])).toEqual([["a", "b"]]);
  });

  it("empty input → no chunks", () => {
    expect(chunkManifestIds([])).toEqual([]);
  });
});

describe("H12g summarizeKbBackfill + kbBackfillMessage", () => {
  it("totals across outcomes and counts failures", () => {
    const s = summarizeKbBackfill([
      outcome({ promoted: 3, strainsEnriched: 1, vendorLicenseFilled: true }),
      outcome({ promoted: 2 }),
      outcome({ ok: false, error: "boom" }),
    ]);
    expect(s).toEqual({
      manifestsProcessed: 3,
      promoted: 5,
      strainsEnriched: 1,
      vendorLicensesFilled: 1,
      errors: 1,
    });
  });

  it("the confirmation is explicit: counts, drafts-only, and where to look", () => {
    const msg = kbBackfillMessage(
      summarizeKbBackfill([outcome({ promoted: 4, strainsEnriched: 2 })]),
    );
    expect(msg).toContain("1 manifest processed");
    expect(msg).toContain("4 product facts promoted as KB drafts");
    expect(msg).toContain("2 strain(s) gap-filled");
    expect(msg).toContain("Nothing was published");
    expect(msg).toContain("Review inbox");
  });

  it("errors are surfaced, never hidden", () => {
    const msg = kbBackfillMessage(summarizeKbBackfill([outcome({ ok: false, error: "x" })]));
    expect(msg).toContain("1 manifest(s) had errors");
  });

  it("the drafts live at the KB Review inbox path", () => {
    expect(KB_REVIEW_INBOX_PATH).toBe("/admin/knowledge-base/review");
  });
});
