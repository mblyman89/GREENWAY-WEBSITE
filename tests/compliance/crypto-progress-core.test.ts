/**
 * AREA 2 — Backfill progress visibility (pure core).
 *
 * Exercises the embedded self-test plus targeted assertions that lock down the
 * HONESTY rules Michael relies on:
 *   • EVM shows a TRUE percentage from block cursor / chain-tip (exact integer
 *     math), and a real "reached block" readout.
 *   • XRPL shows "reached ledger N" from the opaque marker but NEVER a fake %.
 *   • Coreum shows phase + tx count only — NEVER a fake %.
 *   • Stuck-loop detection: cursor unchanged across runs → "No recent progress".
 */
import { describe, it, expect } from "vitest";
import {
  __runCryptoProgressCoreTests,
  buildBackfillProgress,
  computeMovement,
  integerPercent,
  parseEvmReachedBlock,
  parseXrplReachedLedger,
  formatInt,
} from "@/lib/crypto/crypto-progress-core";

describe("crypto-progress-core backfill progress is honest per chain", () => {
  it("runs the embedded self-test suite", () => {
    expect(() => __runCryptoProgressCoreTests()).not.toThrow();
  });

  it("computes a TRUE integer percent for EVM (exact, clamped)", () => {
    expect(integerPercent(50, 100)).toBe(50);
    expect(integerPercent(1, 3)).toBe(33); // floors, never rounds up
    expect(integerPercent(150, 100)).toBe(100); // clamped
    expect(integerPercent(5, 0)).toBeNull(); // no target → no fake %
  });

  it("parses the EVM block cursor and the XRPL marker ledger", () => {
    expect(parseEvmReachedBlock("8240113:8240100")).toBe(8240113);
    expect(parseEvmReachedBlock(null)).toBeNull();
    // New account-pagination cursor (JSON) has no block position → null, so the
    // EVM progress view uses the honest "transactions captured" readout and can
    // never fabricate or snap a percent (fixes the 100%→4% flip).
    expect(
      parseEvmReachedBlock('{"v":2,"tx":{"page":2,"done":false},"token":{"page":1,"done":true}}'),
    ).toBeNull();
    // Verified-live XRPL marker shape { ledger, seq }.
    expect(parseXrplReachedLedger('{"ledger":106228618,"seq":0}')).toBe(106228618);
    expect(parseXrplReachedLedger("not-json")).toBeNull();
  });

  it("EVM view exposes a percent + reached block", () => {
    const v = buildBackfillProgress({
      chain: "flare",
      cursor: "100:99",
      prevCursor: "50:49",
      targetCursor: "200",
      transactionsTotal: 7,
      backfillComplete: false,
      status: "backfilling",
      lastSyncedAt: "2026-08-11T00:00:00Z",
    });
    expect(v.hasPercent).toBe(true);
    expect(v.percent).toBe(50);
    expect(v.reachedText).toBe("block 100");
  });

  it("XRPL and Coreum NEVER fabricate a percent", () => {
    const xrpl = buildBackfillProgress({
      chain: "xrpl",
      cursor: '{"ledger":106228618,"seq":0}',
      prevCursor: null,
      targetCursor: null,
      transactionsTotal: 3,
      backfillComplete: false,
      status: "backfilling",
      lastSyncedAt: null,
    });
    expect(xrpl.hasPercent).toBe(false);
    expect(xrpl.percent).toBeNull();
    expect(xrpl.reachedText).toBe("ledger 106,228,618");

    const coreum = buildBackfillProgress({
      chain: "coreum",
      cursor: "opaque-key",
      prevCursor: "other-key",
      targetCursor: null,
      transactionsTotal: 3,
      backfillComplete: false,
      status: "backfilling",
      lastSyncedAt: null,
    });
    expect(coreum.hasPercent).toBe(false);
    expect(coreum.percent).toBeNull();
    expect(coreum.reachedText).toBeNull();
  });

  it("detects a stuck backfill (cursor unchanged across runs)", () => {
    const stalled = computeMovement({
      chain: "flare",
      cursor: "100:99",
      prevCursor: "100:99",
      targetCursor: "200",
      transactionsTotal: 5,
      backfillComplete: false,
      status: "backfilling",
      lastSyncedAt: "2026-08-11T00:00:00Z",
    });
    expect(stalled).toBe("stalled");
    const progressing = computeMovement({
      chain: "flare",
      cursor: "150:149",
      prevCursor: "100:99",
      targetCursor: "200",
      transactionsTotal: 5,
      backfillComplete: false,
      status: "backfilling",
      lastSyncedAt: "2026-08-11T00:00:00Z",
    });
    expect(progressing).toBe("progressing");
  });

  it("formats integers with grouping", () => {
    expect(formatInt(8240113)).toBe("8,240,113");
    expect(formatInt(0)).toBe("0");
  });
});
