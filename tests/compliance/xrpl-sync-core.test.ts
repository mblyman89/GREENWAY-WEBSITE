import { describe, it, expect } from "vitest";
import {
  __runXrplSyncCoreTests,
  unsignMinor,
  unsignDecimal,
  buildBalanceUpsert,
  buildBalanceUpserts,
  untrackedBalances,
  buildTransactionUpsert,
  buildTransactionUpserts,
  initXrplBackfill,
  reduceXrplBackfill,
  shouldContinueBackfill,
  serializeMarker,
  deserializeMarker,
  buildSyncStateUpsert,
  emptyXrplSyncCounts,
  addXrplPageCounts,
  summarizeXrplSync,
  MAX_XRPL_BACKFILL_PAGES,
} from "@/lib/crypto/xrpl/xrpl-sync-core";
import type { MappedBalance, MappedTransaction } from "@/lib/crypto/xrpl/xrpl-map-core";

describe("xrpl-sync-core embedded self-test", () => {
  it("passes every builder + state-machine assertion", () => {
    expect(() => __runXrplSyncCoreTests()).not.toThrow();
  });
});

describe("xrpl-sync-core amount sign handling (money safety)", () => {
  it("splits the sign off SIGNED mapped amounts, keeping the magnitude exactly", () => {
    // Big values that overflow JS number must survive exactly.
    expect(unsignMinor("-123456789012345678901234567890")).toBe(
      "123456789012345678901234567890",
    );
    expect(unsignMinor("1000000")).toBe("1000000");
    expect(unsignMinor("0")).toBe("0");
    expect(unsignMinor(null)).toBeNull();
    // 15 significant digits — XRPL's exact issued-token precision ceiling.
    expect(unsignDecimal("-1234.56789012345")).toBe("1234.56789012345");
    expect(unsignDecimal(null)).toBeNull();
  });
});

describe("xrpl-sync-core transaction persistence (tax-truth)", () => {
  it("stores a SIGNED-negative send as UNSIGNED magnitude + direction 'out', fee unsigned, RAW preserved", () => {
    const leg: MappedTransaction = {
      txHash: "HASH1",
      eventIndex: 0,
      assetId: "xrp",
      chain: "xrpl",
      direction: "out",
      txType: "transfer",
      amountRaw: "-5000000",
      amountDecimal: null,
      decimalsAtEvent: 6,
      feeRaw: "12",
      feeAssetId: "xrp",
      counterparty: "rDest",
      blockNumber: 80000000,
      blockTime: "2026-08-01T12:00:00Z",
      success: true,
    };
    const envelope = { hash: "HASH1", meta: { TransactionResult: "tesSUCCESS" } };
    const row = buildTransactionUpsert("w-1", leg, envelope);
    expect(row.amount_raw).toBe("5000000"); // UNSIGNED
    expect(row.direction).toBe("out"); // sign carried by direction
    expect(row.fee_raw).toBe("12");
    expect(row.usd_value_cents).toBeNull(); // never guessed
    // The FULL source envelope is preserved verbatim for audit provability.
    expect(JSON.stringify(row.raw)).toBe(JSON.stringify(envelope));
  });

  it("keeps an untracked-token leg (never drops it) with a currency/issuer note in raw", () => {
    const leg: MappedTransaction = {
      txHash: "HASH2",
      eventIndex: 0,
      assetId: null,
      chain: "xrpl",
      direction: "in",
      txType: "transfer",
      amountRaw: null,
      amountDecimal: "7",
      decimalsAtEvent: null,
      feeRaw: null,
      feeAssetId: null,
      counterparty: "rWho",
      blockNumber: 1,
      blockTime: "2026-08-01T00:00:00Z",
      currency: "FOO",
      issuer: "rFoo",
      success: true,
    };
    const row = buildTransactionUpsert("w-1", leg, { hash: "HASH2" });
    expect(row.asset_id).toBeNull();
    const raw = row.raw as { untrackedToken?: { currency: string | null; issuer: string | null } };
    expect(raw.untrackedToken?.currency).toBe("FOO");
    expect(raw.untrackedToken?.issuer).toBe("rFoo");
  });

  it("uses the idempotent natural key (wallet, hash, event_index) on every row", () => {
    const legs: MappedTransaction[] = [
      {
        txHash: "SAME",
        eventIndex: 0,
        assetId: "xrp",
        chain: "xrpl",
        direction: "out",
        txType: "transfer",
        amountRaw: "-1",
        amountDecimal: null,
        decimalsAtEvent: 6,
        feeRaw: "1",
        feeAssetId: "xrp",
        counterparty: null,
        blockNumber: 1,
        blockTime: "2026-08-01T00:00:00Z",
        success: true,
      },
      {
        txHash: "SAME",
        eventIndex: 1,
        assetId: "solo",
        chain: "xrpl",
        direction: "in",
        txType: "transfer",
        amountRaw: null,
        amountDecimal: "2",
        decimalsAtEvent: null,
        feeRaw: null,
        feeAssetId: null,
        counterparty: null,
        blockNumber: 1,
        blockTime: "2026-08-01T00:00:00Z",
        success: true,
      },
    ];
    const rows = buildTransactionUpserts("w-1", legs, { hash: "SAME" });
    expect(rows.map((r) => [r.wallet_id, r.tx_hash, r.event_index])).toEqual([
      ["w-1", "SAME", 0],
      ["w-1", "SAME", 1],
    ]);
  });
});

describe("xrpl-sync-core balance persistence", () => {
  it("writes tracked balances and skips untracked (FK-safe) while surfacing them", () => {
    const balances: MappedBalance[] = [
      { assetId: "xrp", amountRaw: "25500000", amountDecimal: null, decimalsAtRead: 6 },
      { assetId: null, amountRaw: null, amountDecimal: "42", decimalsAtRead: null, currency: "FOO", issuer: "rFoo" },
    ];
    const rows = buildBalanceUpserts("w-1", balances, "2026-08-11T00:00:00Z");
    expect(rows).toHaveLength(1);
    expect(rows[0].asset_id).toBe("xrp");
    expect(rows[0].amount_raw).toBe("25500000");
    expect(rows[0].usd_value_cents).toBeNull();
    expect(buildBalanceUpsert("w-1", balances[1], "t")).toBeNull();
    expect(untrackedBalances(balances)).toHaveLength(1);
  });
});

describe("xrpl-sync-core backfill state machine", () => {
  it("walks pages by marker and finishes when the marker clears", () => {
    let s = initXrplBackfill(null);
    expect(s.marker).toBeUndefined();
    expect(shouldContinueBackfill(s)).toBe(true);
    s = reduceXrplBackfill(s, { ledger: 100, seq: 5 });
    expect(s.pages).toBe(1);
    expect(shouldContinueBackfill(s)).toBe(true);
    s = reduceXrplBackfill(s, null);
    expect(s.done).toBe(true);
    expect(s.marker).toBeUndefined();
    expect(shouldContinueBackfill(s)).toBe(false);
  });

  it("resumes from a saved marker", () => {
    const s = initXrplBackfill({ ledger: 200, seq: 9 });
    expect(s.marker).toEqual({ ledger: 200, seq: 9 });
  });

  it("trips the page guard so a misbehaving endpoint can't spin forever", () => {
    let s = initXrplBackfill(null);
    for (let i = 0; i < MAX_XRPL_BACKFILL_PAGES; i += 1) {
      s = reduceXrplBackfill(s, { ledger: i, seq: i });
    }
    expect(s.done).toBe(true);
    expect(s.pages).toBe(MAX_XRPL_BACKFILL_PAGES);
  });

  it("round-trips markers through text storage", () => {
    expect(serializeMarker({ ledger: 1, seq: 2 })).toBe('{"ledger":1,"seq":2}');
    expect(deserializeMarker('{"ledger":1,"seq":2}')).toEqual({ ledger: 1, seq: 2 });
    expect(deserializeMarker("")).toBeUndefined();
    expect(deserializeMarker(null)).toBeUndefined();
  });
});

describe("xrpl-sync-core counts + sync-state", () => {
  it("accumulates counts and summarizes in plain English", () => {
    let c = emptyXrplSyncCounts();
    c = addXrplPageCounts(c, { pages: 1, balancesUpserted: 3, transactionsUpserted: 10 });
    c = addXrplPageCounts(c, { pages: 1, transactionsUpserted: 5, untrackedTransactions: 2 });
    expect(c.pages).toBe(2);
    expect(c.transactionsUpserted).toBe(15);
    expect(summarizeXrplSync(c)).toContain("3 balances");
    expect(summarizeXrplSync(c)).toContain("15 transactions");
    expect(summarizeXrplSync(c)).toContain("untracked-token");
  });

  it("marks backfill complete with a null cursor when it walks to the end", () => {
    const ss = buildSyncStateUpsert({
      walletId: "w-1",
      cursor: null,
      backfillComplete: true,
      syncedAt: "2026-08-11T00:00:00Z",
      status: "idle",
      errorMessage: null,
    });
    expect(ss.backfill_complete).toBe(true);
    expect(ss.backfill_cursor).toBeNull();
    expect(ss.status).toBe("idle");
  });

  it("keeps the resume cursor on an errored run", () => {
    const ss = buildSyncStateUpsert({
      walletId: "w-1",
      cursor: '{"ledger":123,"seq":4}',
      backfillComplete: false,
      syncedAt: "2026-08-11T00:00:00Z",
      status: "error",
      errorMessage: "rate limited",
    });
    expect(ss.status).toBe("error");
    expect(ss.backfill_cursor).toBe('{"ledger":123,"seq":4}');
    expect(ss.error_message).toBe("rate limited");
  });
});
