/**
 * Vitest mirror of the media-autosave-core pure self-tests (MB-1).
 * Locks the background auto-loop's stop conditions (done / stalled / error) so
 * it can never spin forever, plus the progress math and status copy.
 */
import { describe, expect, it } from "vitest";

import {
  decideAutosaveNext,
  autosaveProgressPct,
  autosaveStatusLabel,
  __runMediaAutosaveCoreTests,
} from "@/lib/purchasing/media-autosave-core";

describe("media-autosave-core", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runMediaAutosaveCoreTests()).not.toThrow();
  });

  it("continues while making progress", () => {
    expect(decideAutosaveNext({ ok: true, remaining: 200 }, Number.POSITIVE_INFINITY).continue).toBe(true);
    expect(decideAutosaveNext({ ok: true, remaining: 180 }, 200).continue).toBe(true);
  });

  it("stops when done, stalled, or errored", () => {
    expect(decideAutosaveNext({ ok: true, remaining: 0 }, 20)).toEqual({ continue: false, reason: "done" });
    expect(decideAutosaveNext({ ok: true, remaining: 4 }, 4)).toEqual({ continue: false, reason: "stalled" });
    expect(decideAutosaveNext({ ok: false, remaining: 50 }, 100)).toEqual({ continue: false, reason: "error" });
  });

  it("computes progress percent safely", () => {
    expect(autosaveProgressPct(200, 100)).toBe(50);
    expect(autosaveProgressPct(0, 0)).toBe(100);
    expect(autosaveProgressPct(100, 150)).toBe(0);
  });

  it("renders human status copy", () => {
    expect(autosaveStatusLabel({ phase: "done", total: 237, remaining: 0 })).toBe(
      "All 237 saved to the library.",
    );
    expect(autosaveStatusLabel({ phase: "stalled", total: 237, remaining: 4 })).toBe(
      "Saved 233 of 237 — 4 couldn't be fetched (skipped).",
    );
  });
});
