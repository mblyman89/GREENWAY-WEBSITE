/**
 * tests/compliance/sample-core.test.ts  (H16b Samples Slice C)
 *
 * Wires the embedded self-test suites of the two pure sample cores into vitest
 * so CI actually exercises them. These cores were rewritten in Slice C to
 * RETIRE IQC (internal quality control) — a WA retailer has exactly one sample
 * category, the TRADE sample [WAC 314-55-096]; IQC is producer/processor-only
 * [096(3)]. These tests pin that retired shape.
 */
import { describe, it, expect } from "vitest";
import { __runTradeSamplesCoreTests } from "@/lib/compliance/trade-samples-core";
import { __runSampleHistoryCoreTests } from "@/lib/compliance/sample-history-core";

describe("trade-samples-core (IQC retired)", () => {
  it("passes the embedded self-test suite", () => {
    expect(() => __runTradeSamplesCoreTests()).not.toThrow();
  });
});

describe("sample-history-core (IQC retired)", () => {
  it("passes the embedded self-test suite", () => {
    expect(() => __runSampleHistoryCoreTests()).not.toThrow();
  });
});
