/**
 * Vitest mirror of the print-retry-core pure self-tests (GW-026).
 * Locks the retry-cap policy: a receipt job gets at most MAX_PRINT_ATTEMPTS
 * claims before it is failed instead of re-claimed forever, one poll's
 * fail-sweep is bounded, and the error note is human-readable — so a poison
 * job can never again block the whole receipt queue.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_PRINT_ATTEMPTS,
  MAX_FAILS_PER_CLAIM,
  hasExhaustedPrintAttempts,
  retryCapNote,
  __runPrintRetryCoreTests,
} from "@/lib/printing/print-retry-core";

describe("print-retry-core", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runPrintRetryCoreTests()).not.toThrow();
  });

  it("pins the policy values (changing them is a deliberate decision)", () => {
    expect(MAX_PRINT_ATTEMPTS).toBe(5);
    expect(MAX_FAILS_PER_CLAIM).toBe(10);
  });

  it("retries below the cap, fails at and beyond it", () => {
    expect(hasExhaustedPrintAttempts(0)).toBe(false);
    expect(hasExhaustedPrintAttempts(MAX_PRINT_ATTEMPTS - 1)).toBe(false);
    expect(hasExhaustedPrintAttempts(MAX_PRINT_ATTEMPTS)).toBe(true);
    expect(hasExhaustedPrintAttempts(MAX_PRINT_ATTEMPTS + 1)).toBe(true);
  });

  it("bad attempt counts never trip the cap (defensive)", () => {
    expect(hasExhaustedPrintAttempts(Number.NaN)).toBe(false);
    expect(hasExhaustedPrintAttempts(Number.POSITIVE_INFINITY)).toBe(false);
    expect(hasExhaustedPrintAttempts(-1)).toBe(false);
  });

  it("the error note names the count and tells staff what to do", () => {
    expect(retryCapNote(5)).toContain("after 5 print attempts");
    expect(retryCapNote(5).toLowerCase()).toContain("re-queue or cancel");
    expect(retryCapNote(Number.NaN)).toContain(`after ${MAX_PRINT_ATTEMPTS} print attempts`);
  });
});
