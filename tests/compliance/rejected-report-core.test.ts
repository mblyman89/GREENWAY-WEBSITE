/**
 * tests/compliance/rejected-report-core.test.ts  (GW-027)
 *
 * Vitest mirror of the embedded self-tests plus targeted checks on the
 * register→server rejected-rows report policy.
 */
import { describe, expect, it } from "vitest";
import {
  REJECTED_NOTE_MAX_CHARS,
  buildRejectedReport,
  sanitizeRejectedReport,
  __runRejectedReportTests,
} from "@/lib/pos/rejected-report-core";

describe("rejected-report-core (GW-027)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runRejectedReportTests()).not.toThrow();
  });

  it("builds a report naming the oldest row", () => {
    expect(
      buildRejectedReport([
        { eventType: "sale", rejectedReason: "Bad envelope." },
        { eventType: "punch", rejectedReason: "later" },
      ]),
    ).toEqual({ count: 2, note: "oldest: sale — Bad envelope." });
  });

  it("clamps hostile notes and bounds hostile counts", () => {
    const long = buildRejectedReport([{ eventType: "sale", rejectedReason: "x".repeat(1000) }]);
    expect(long.note?.length).toBe(REJECTED_NOTE_MAX_CHARS);
    expect(sanitizeRejectedReport({ count: 1e12, note: "n".repeat(1000) })).toEqual({
      count: 9999,
      note: `${"n".repeat(REJECTED_NOTE_MAX_CHARS - 1)}…`,
    });
  });

  it("refuses malformed reports so the caller keeps the stored value", () => {
    expect(sanitizeRejectedReport(undefined)).toBeNull();
    expect(sanitizeRejectedReport({ note: "no count" })).toBeNull();
    expect(sanitizeRejectedReport({ count: -5 })).toBeNull();
  });

  it("a zero-count report clears any stale note", () => {
    expect(sanitizeRejectedReport({ count: 0, note: "stale" })).toEqual({ count: 0, note: null });
  });
});
