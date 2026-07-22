/**
 * GW-023 — stranded `pending` ledger rows must be recovered, never silently
 * lost. Mirrors the embedded self-tests in pending-recovery-core.ts and adds
 * scenario framing for the two recovery callers (duplicate-retry + sweeper).
 */
import { describe, it, expect } from "vitest";
import {
  classifyPendingRetry,
  buildOrderExistsReason,
  buildAttemptsExhaustedReason,
  DUPLICATE_RETRY_STALE_MS,
  SWEEP_STALE_MS,
  MAX_RECOVERY_ATTEMPTS,
  SWEEP_BATCH_LIMIT,
  __runPendingRecoveryCoreTests,
  type PendingRetryInput,
} from "@/lib/pos/pending-recovery-core";

const NOW = Date.parse("2026-07-21T18:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const base: PendingRetryInput = {
  receivedAtIso: iso(0),
  nowMs: NOW,
  staleAfterMs: DUPLICATE_RETRY_STALE_MS,
  recoveryAttempts: 0,
  orderId: null,
};

describe("pending-recovery-core (GW-023)", () => {
  it("young rows wait — an in-flight chain is never disturbed, even with an order", () => {
    expect(classifyPendingRetry({ ...base, receivedAtIso: iso(30_000) }).action).toBe("wait");
    expect(
      classifyPendingRetry({ ...base, receivedAtIso: iso(DUPLICATE_RETRY_STALE_MS - 1) }).action,
    ).toBe("wait");
    // Youth wins even over an existing order: the original invocation is
    // most likely about to finish on its own.
    expect(
      classifyPendingRetry({ ...base, receivedAtIso: iso(30_000), orderId: "o-1" }).action,
    ).toBe("wait");
  });

  it("stale rows with no order and attempts remaining are reprocessed", () => {
    expect(classifyPendingRetry({ ...base, receivedAtIso: iso(DUPLICATE_RETRY_STALE_MS) }).action).toBe(
      "reprocess",
    );
    expect(classifyPendingRetry({ ...base, receivedAtIso: iso(3 * 60 * 60_000) }).action).toBe("reprocess");
    expect(
      classifyPendingRetry({
        ...base,
        receivedAtIso: iso(10 * 60_000),
        recoveryAttempts: MAX_RECOVERY_ATTEMPTS - 1,
      }).action,
    ).toBe("reprocess");
  });

  it("a stale row that already materialized an order escalates — never a blind re-run", () => {
    const d = classifyPendingRetry({
      ...base,
      receivedAtIso: iso(10 * 60_000),
      orderId: "11111111-1111-4111-8111-111111111111",
      orderNumber: "GW-1042",
    });
    expect(d.action).toBe("escalate");
    if (d.action === "escalate") {
      expect(d.kind).toBe("order_exists");
      expect(d.reason).toContain("#GW-1042");
      expect(d.reason).toContain("double-count");
    }
  });

  it("attempts exhaust to the manager queue — a poison event never retries forever", () => {
    const d = classifyPendingRetry({
      ...base,
      receivedAtIso: iso(10 * 60_000),
      recoveryAttempts: MAX_RECOVERY_ATTEMPTS,
    });
    expect(d.action).toBe("escalate");
    if (d.action === "escalate") {
      expect(d.kind).toBe("attempts_exhausted");
      expect(d.reason).toContain("re-ring");
    }
  });

  it("garbage/missing timestamps count as stale — a row can never be stranded by bad data", () => {
    expect(classifyPendingRetry({ ...base, receivedAtIso: null }).action).toBe("reprocess");
    expect(classifyPendingRetry({ ...base, receivedAtIso: "not-a-date" }).action).toBe("reprocess");
  });

  it("reason builders write actionable manager instructions", () => {
    expect(buildOrderExistsReason("abc", "GW-7")).toContain("#GW-7");
    expect(buildOrderExistsReason("abc", null)).toContain("abc");
    expect(buildOrderExistsReason("abc")).toContain("resolve this exception");
    expect(buildAttemptsExhaustedReason(3)).toContain("3 time(s)");
  });

  it("tunables are coherent: the sweeper is more conservative than the retry path", () => {
    expect(SWEEP_STALE_MS).toBeGreaterThan(DUPLICATE_RETRY_STALE_MS);
    expect(MAX_RECOVERY_ATTEMPTS).toBeGreaterThanOrEqual(1);
    expect(SWEEP_BATCH_LIMIT).toBeGreaterThanOrEqual(1);
  });

  it("embedded self-tests run clean", () => {
    expect(() => __runPendingRecoveryCoreTests()).not.toThrow();
  });
});
