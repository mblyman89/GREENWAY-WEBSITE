import { describe, it, expect } from "vitest";
import {
  __runCryptoFileReadinessCoreTests,
  evaluateFileReadiness,
  readinessCheckDef,
  READINESS_CHECK_DEFS,
  type FileReadinessInput,
} from "../../src/lib/crypto/crypto-file-readiness-core";

function base(over: Partial<FileReadinessInput>): FileReadinessInput {
  return {
    taxYear: 2024,
    missingBasisCount: 0,
    unclassifiedCount: 0,
    unmatchedTransferCount: 0,
    negativeBalanceCount: 0,
    unpricedDisposalCount: 0,
    method: "fifo",
    ...over,
  };
}

describe("crypto-file-readiness-core embedded self-tests", () => {
  it("passes all pure self-tests", () => {
    expect(() => __runCryptoFileReadinessCoreTests()).not.toThrow();
  });
});

describe("the seven checks", () => {
  it("defines exactly seven checks with the right severities", () => {
    expect(READINESS_CHECK_DEFS).toHaveLength(7);
    expect(readinessCheckDef("MISSING_BASIS").severity).toBe("blocking");
    expect(readinessCheckDef("UNCLASSIFIED").severity).toBe("blocking");
    expect(readinessCheckDef("UNMATCHED_TRANSFER").severity).toBe("warning");
    expect(readinessCheckDef("NEGATIVE_BALANCE").severity).toBe("blocking");
    expect(readinessCheckDef("METHOD_INCONSISTENCY").severity).toBe("blocking");
    expect(readinessCheckDef("UNPRICED_DISPOSAL").severity).toBe("blocking");
    expect(readinessCheckDef("YEAR_LOCKED").severity).toBe("info");
  });

  it("gives every check a plain-English fix", () => {
    for (const d of READINESS_CHECK_DEFS) {
      expect(d.fix.length).toBeGreaterThan(0);
      expect(d.title.length).toBeGreaterThan(0);
    }
  });
});

describe("file-ready gating", () => {
  it("marks a clean year file-ready", () => {
    const r = evaluateFileReadiness(base({}));
    expect(r.fileReady).toBe(true);
    expect(r.blockingCount).toBe(0);
  });

  it("blocks on missing basis until acknowledged", () => {
    expect(evaluateFileReadiness(base({ missingBasisCount: 2 })).fileReady).toBe(false);
    expect(
      evaluateFileReadiness(base({ missingBasisCount: 2, acknowledgedZeroBasisCount: 2 })).fileReady,
    ).toBe(true);
  });

  it("blocks on unclassified, negative balance, and unpriced disposals", () => {
    expect(evaluateFileReadiness(base({ unclassifiedCount: 1 })).fileReady).toBe(false);
    expect(evaluateFileReadiness(base({ negativeBalanceCount: 1 })).fileReady).toBe(false);
    expect(evaluateFileReadiness(base({ unpricedDisposalCount: 1 })).fileReady).toBe(false);
  });

  it("warns (not blocks) on an unmatched transfer", () => {
    const r = evaluateFileReadiness(base({ unmatchedTransferCount: 3 }));
    expect(r.fileReady).toBe(true);
    expect(r.warningCount).toBe(1);
  });

  it("blocks LIFO/HIFO/specid without recorded Spec-ID, allows FIFO always", () => {
    expect(evaluateFileReadiness(base({ method: "lifo" })).fileReady).toBe(false);
    expect(evaluateFileReadiness(base({ method: "hifo" })).fileReady).toBe(false);
    expect(evaluateFileReadiness(base({ method: "specid" })).fileReady).toBe(false);
    expect(evaluateFileReadiness(base({ method: "lifo", hasRecordedSpecId: true })).fileReady).toBe(true);
    expect(evaluateFileReadiness(base({ method: "fifo" })).fileReady).toBe(true);
  });

  it("surfaces a locked year as info without blocking a clean year", () => {
    const r = evaluateFileReadiness(base({ yearFiled: true }));
    expect(r.yearLocked).toBe(true);
    expect(r.fileReady).toBe(true);
    expect(r.issues.some((i) => i.check === "YEAR_LOCKED")).toBe(true);
  });

  it("stacks multiple blocking issues", () => {
    const r = evaluateFileReadiness(
      base({ missingBasisCount: 1, unclassifiedCount: 1, negativeBalanceCount: 1, method: "hifo" }),
    );
    expect(r.blockingCount).toBe(4);
    expect(r.fileReady).toBe(false);
  });

  it("rejects invalid counts", () => {
    expect(() => evaluateFileReadiness(base({ unclassifiedCount: -1 }))).toThrow();
    expect(() =>
      evaluateFileReadiness(base({ missingBasisCount: 1, acknowledgedZeroBasisCount: 2 })),
    ).toThrow();
  });
});
