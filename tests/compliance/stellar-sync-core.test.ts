import { describe, it, expect } from "vitest";
import {
  __runStellarSyncCoreTests,
  initStellarBackfill,
  reduceStellarBackfill,
  shouldContinueStellarBackfill,
  emptyStellarSyncCounts,
  addStellarPageCounts,
  countDustLegs,
  summarizeStellarSync,
  countPersistableBalances,
  MAX_STELLAR_BACKFILL_PAGES,
} from "@/lib/crypto/stellar/stellar-sync-core";
import type { MappedTransaction, MappedBalance } from "@/lib/crypto/stellar/stellar-map-core";

describe("stellar-sync-core embedded self-test", () => {
  it("passes every state-machine + counts assertion", () => {
    expect(() => __runStellarSyncCoreTests()).not.toThrow();
  });
});

describe("stellar-sync-core cursor pagination state machine", () => {
  it("walks pages by cursor and finishes when the cursor clears OR a page is empty", () => {
    let s = initStellarBackfill(null);
    expect(s.cursor).toBeNull();
    expect(shouldContinueStellarBackfill(s)).toBe(true);
    s = reduceStellarBackfill(s, "CUR2", 200);
    expect(s.pages).toBe(1);
    expect(s.cursor).toBe("CUR2");
    // An empty page ends the walk even if a cursor is echoed (Horizon tail).
    s = reduceStellarBackfill(s, "CUR3", 0);
    expect(s.done).toBe(true);
    expect(s.cursor).toBeNull();
    expect(shouldContinueStellarBackfill(s)).toBe(false);
  });

  it("resumes from a saved cursor (trimmed)", () => {
    expect(initStellarBackfill("  ABC  ").cursor).toBe("ABC");
    expect(initStellarBackfill("   ").cursor).toBeNull();
  });

  it("trips the page guard so a misbehaving endpoint can't spin forever", () => {
    let s = initStellarBackfill(null);
    for (let i = 0; i < MAX_STELLAR_BACKFILL_PAGES; i += 1) {
      s = reduceStellarBackfill(s, `c${i}`, 200);
    }
    expect(s.done).toBe(true);
    expect(s.pages).toBe(MAX_STELLAR_BACKFILL_PAGES);
  });
});

describe("stellar-sync-core dust-aware counts + summary", () => {
  it("counts dust legs and mentions them in the plain-English summary", () => {
    const legs: MappedTransaction[] = [
      { txHash: "a", eventIndex: 0, assetId: "xlm", chain: "stellar", direction: "in", txType: "transfer", amountRaw: "1", amountDecimal: null, decimalsAtEvent: 7, feeRaw: null, feeAssetId: null, counterparty: null, blockNumber: null, blockTime: null, success: true, dust: true },
      { txHash: "b", eventIndex: 0, assetId: "xlm", chain: "stellar", direction: "out", txType: "transfer", amountRaw: "-1", amountDecimal: null, decimalsAtEvent: 7, feeRaw: null, feeAssetId: null, counterparty: null, blockNumber: null, blockTime: null, success: true, dust: false },
    ];
    expect(countDustLegs(legs)).toBe(1);

    let c = emptyStellarSyncCounts();
    c = addStellarPageCounts(c, { pages: 1, balancesUpserted: 1, transactionsUpserted: 172, dustTransactions: 172 });
    const summary = summarizeStellarSync(c);
    expect(summary).toContain("172");
    expect(summary).toContain("dust");
  });

  it("counts only persistable (modeled-asset) balances", () => {
    const bals: MappedBalance[] = [
      { assetId: "xlm", amountRaw: "2796501307", amountDecimal: null, decimalsAtRead: 7 },
      { assetId: null, amountRaw: null, amountDecimal: "10.0", decimalsAtRead: null, currency: "USDC" },
    ];
    expect(countPersistableBalances(bals)).toBe(1);
  });
});
