/**
 * tests/compliance/sample-cap-notice.test.ts  (H16b Samples vendor-notice)
 *
 * Pins the PURE processor-facing notice builder for the incoming sample-cap
 * refusal (WAC 314-55-096: 120 sample units per processor per quarter). This is
 * a COMPLIANCE COMMUNICATION, so the exact wording + the usage math it states
 * are locked here. The server sender (sendSampleCapVendorNotice) only routes the
 * built notice, so locking the builder locks what a processor actually reads.
 *
 * Owner-approved content rules (verbatim intent): plain + professional, cite the
 * rule, state the quarter usage math (used / cap / remaining / projected), ask
 * them to hold the samples until next quarter, and NO dollar amounts / NO
 * customer data.
 */
import { describe, it, expect } from "vitest";
import {
  buildSampleCapNotice,
  __runSampleCapNoticeCoreTests,
} from "@/lib/compliance/sample-cap-notice-core";

describe("buildSampleCapNotice (WAC 314-55-096 sample-cap refusal)", () => {
  it("runs the core self-test suite", () => {
    expect(() => __runSampleCapNoticeCoreTests()).not.toThrow();
  });

  it("states the used / cap / remaining / projected math and cites the rule", () => {
    const n = buildSampleCapNotice({
      processorName: "High End Farms",
      usedUnits: 115,
      capUnits: 120,
      addUnits: 10,
      quarterKey: "2026-Q1",
      manifestNumber: "M-123",
    });
    // Cites the WAC rule (both bodies).
    expect(n.bodyText).toContain("314-55-096");
    expect(n.html).toContain("314-55-096");
    // The four numbers a processor needs to understand the refusal.
    expect(n.bodyText).toContain("120 units"); // cap
    expect(n.bodyText).toContain("115 units"); // used this quarter
    expect(n.bodyText).toContain("5 units available"); // remaining = 120 - 115
    expect(n.bodyText).toContain("10 units"); // this delivery
    expect(n.bodyText).toContain("125 units"); // projected = 115 + 10
    // Subject names the processor; body references the manifest number.
    expect(n.subject).toContain("High End Farms");
    expect(n.bodyText).toContain("manifest M-123");
    // Asks them to hold the samples until next quarter.
    expect(n.bodyText.toLowerCase()).toContain("hold");
    expect(n.bodyText.toLowerCase()).toContain("next quarter");
  });

  it("never leaks dollar amounts (no pricing / customer data)", () => {
    const n = buildSampleCapNotice({
      processorName: "Any Co",
      usedUnits: 100,
      capUnits: 120,
      addUnits: 40,
      quarterKey: "2026-Q3",
      manifestNumber: "M-9",
    });
    expect(n.bodyText).not.toMatch(/\$/);
    expect(n.html).not.toMatch(/\$/);
  });

  it("handles a missing processor name and a missing manifest number", () => {
    const n = buildSampleCapNotice({
      processorName: null,
      usedUnits: 120,
      capUnits: 120,
      addUnits: 5,
      quarterKey: "2026-Q4",
    });
    expect(n.bodyText).toContain("your company"); // null-name fallback
    expect(n.bodyText).toContain("0 units available"); // remaining floored at 0
    expect(n.bodyText).not.toContain("manifest "); // no manifest ref when absent
  });

  it("uses singular grammar for exactly one unit", () => {
    const n = buildSampleCapNotice({
      processorName: "Solo",
      usedUnits: 119,
      capUnits: 120,
      addUnits: 1,
      quarterKey: "2026-Q1",
    });
    expect(n.bodyText).toContain("1 unit "); // singular, not "1 units"
    expect(n.bodyText).toContain("1 unit available"); // remaining = 120 - 119 = 1
  });
});
