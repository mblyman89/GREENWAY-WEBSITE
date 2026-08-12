import { describe, it, expect } from "vitest";
import {
  EVM_HISTORY_PAGE_SIZE,
  EVM_HISTORY_MAX_PAGES,
  initEvmHistoryCursor,
  parseEvmHistoryCursor,
  serializeEvmHistoryCursor,
  isEvmHistoryComplete,
  nextEvmStream,
  pageForStream,
  advanceEvmStream,
  evmHistoryPhase,
  __runEvmHistoryPaginationCoreTests,
  type EvmHistoryCursor,
} from "../../src/lib/crypto/evm/evm-history-pagination-core";

describe("evm-history-pagination-core", () => {
  it("passes its embedded self-tests", () => {
    expect(() => __runEvmHistoryPaginationCoreTests()).not.toThrow();
  });

  it("requests the documented maximum page size (fastest)", () => {
    expect(EVM_HISTORY_PAGE_SIZE).toBe(10000);
    expect(EVM_HISTORY_MAX_PAGES).toBeGreaterThan(0);
  });

  it("starts a fresh walk from page 1 on both streams", () => {
    const c = initEvmHistoryCursor();
    expect(c.tx).toEqual({ page: 1, done: false });
    expect(c.token).toEqual({ page: 1, done: false });
    expect(isEvmHistoryComplete(c)).toBe(false);
    expect(nextEvmStream(c)).toBe("tx");
    expect(pageForStream(c, "tx")).toBe(1);
  });

  it("treats a legacy block-window cursor as a fresh account walk (no crash, no stale resume)", () => {
    const c = parseEvmHistoryCursor("845123:845000");
    expect(c).toEqual(initEvmHistoryCursor());
  });

  it("advances on a full page and finishes on a short page", () => {
    let c = initEvmHistoryCursor();
    c = advanceEvmStream(c, "tx", EVM_HISTORY_PAGE_SIZE, EVM_HISTORY_PAGE_SIZE);
    expect(c.tx).toEqual({ page: 2, done: false });
    c = advanceEvmStream(c, "tx", 3, EVM_HISTORY_PAGE_SIZE);
    expect(c.tx.done).toBe(true);
    expect(nextEvmStream(c)).toBe("token");
  });

  it("never mutates the input cursor (pure)", () => {
    const c = initEvmHistoryCursor();
    const snapshot = JSON.stringify(c);
    advanceEvmStream(c, "tx", 10, EVM_HISTORY_PAGE_SIZE);
    expect(JSON.stringify(c)).toBe(snapshot);
  });

  it("serialises a completed walk to null and round-trips an in-progress cursor", () => {
    const done: EvmHistoryCursor = { v: 2, tx: { page: 2, done: true }, token: { page: 1, done: true } };
    expect(serializeEvmHistoryCursor(done)).toBeNull();
    const mid: EvmHistoryCursor = { v: 2, tx: { page: 4, done: false }, token: { page: 1, done: true } };
    const s = serializeEvmHistoryCursor(mid);
    expect(typeof s).toBe("string");
    expect(parseEvmHistoryCursor(s)).toEqual(mid);
    expect(evmHistoryPhase(mid)).toBe("paging");
    expect(evmHistoryPhase(done)).toBe("complete");
  });

  it("forces a stream done at the page ceiling (no infinite paging)", () => {
    const nearMax: EvmHistoryCursor = {
      v: 2,
      tx: { page: EVM_HISTORY_MAX_PAGES, done: false },
      token: { page: 1, done: true },
    };
    const c = advanceEvmStream(nearMax, "tx", EVM_HISTORY_PAGE_SIZE, EVM_HISTORY_PAGE_SIZE);
    expect(c.tx.done).toBe(true);
  });
});
