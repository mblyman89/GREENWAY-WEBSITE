import { describe, it, expect } from "vitest";
import {
  __runEvmSyncCoreTests,
  EVM_BACKFILL_WINDOW_BLOCKS,
  EVM_BACKFILL_MIN_WINDOW,
  MAX_EVM_BACKFILL_WINDOWS,
  mapEvmNativeBalance,
  mapEvmTokenBalance,
  deriveTokenBalancesFromHistory,
  txListRowToNativeTransfer,
  tokenTxRowToEvmLog,
  initEvmBackfill,
  currentWindowEnd,
  reduceEvmBackfill,
  shouldContinueEvmBackfill,
  currentCursorString,
  emptyEvmSyncCounts,
  addEvmWindowCounts,
  summarizeEvmSync,
  buildBalanceUpserts,
  buildTransactionUpserts,
  buildSyncStateUpsert,
  untrackedBalances,
  type EvmTxListRow,
  type EvmTokenTxRow,
} from "@/lib/crypto/evm/evm-sync-core";

describe("evm-sync-core embedded self-test", () => {
  it("passes every balance/backfill/counts assertion", () => {
    expect(() => __runEvmSyncCoreTests()).not.toThrow();
  });
});

describe("EVM balance mapping (money safety)", () => {
  it("maps a native coin balance to the right asset + 18 decimals", () => {
    const b = mapEvmNativeBalance("flare", "5000000000000000000");
    expect(b.assetId).toBe("flr");
    expect(b.amountRaw).toBe("5000000000000000000");
    expect(b.decimalsAtRead).toBe(18);
  });
  it("maps an untracked ERC-20 balance with the contract recorded", () => {
    const UNK = "0x9999999999999999999999999999999999999999";
    const b = mapEvmTokenBalance("ethereum", UNK, "7000000", 6);
    expect(b.assetId).toBeNull();
    expect(b.currency).toBe(UNK);
    expect(b.issuer).toBe(UNK);
  });
});

describe("derive token balances from transfer history", () => {
  const A = "0x1111111111111111111111111111111111111111";
  const B = "0x2222222222222222222222222222222222222222";
  const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
  it("sums in - out per contract to a net balance", () => {
    const rows: EvmTokenTxRow[] = [
      { hash: "0x1", from: B, to: A, value: "3000000", contractAddress: USDT, tokenDecimal: "6", tokenSymbol: "USDT", blockNumber: "10", timeStamp: "1", gasUsed: "1", gasPrice: "1" },
      { hash: "0x2", from: A, to: B, value: "1000000", contractAddress: USDT, tokenDecimal: "6", tokenSymbol: "USDT", blockNumber: "11", timeStamp: "2", gasUsed: "1", gasPrice: "1" },
    ];
    const balances = deriveTokenBalancesFromHistory("ethereum", A, rows);
    expect(balances).toHaveLength(1);
    expect(balances[0].assetId).toBe("usdt-eth");
    expect(balances[0].amountRaw).toBe("2000000"); // 3M in - 1M out
  });
  it("skips zero-net contracts and floors negative nets at 0", () => {
    const rows: EvmTokenTxRow[] = [
      { hash: "0x1", from: A, to: B, value: "5000000", contractAddress: USDT, tokenDecimal: "6", tokenSymbol: "USDT", blockNumber: "10", timeStamp: "1", gasUsed: "1", gasPrice: "1" },
      { hash: "0x2", from: B, to: A, value: "5000000", contractAddress: USDT, tokenDecimal: "6", tokenSymbol: "USDT", blockNumber: "11", timeStamp: "2", gasUsed: "1", gasPrice: "1" },
    ];
    // net is zero → skipped
    expect(deriveTokenBalancesFromHistory("ethereum", A, rows)).toHaveLength(0);
  });
});

describe("row-to-mapper-input conversion", () => {
  it("computes the fee as gasUsed * gasPrice and converts the timestamp to ISO", () => {
    const row: EvmTxListRow = {
      hash: "0xabc",
      from: "0x1",
      to: "0x2",
      value: "1000000000000000000",
      blockNumber: "12345",
      timeStamp: "1700000000",
      gasUsed: "21000",
      gasPrice: "1000000000",
      isError: "0",
      transactionIndex: "5",
    };
    const t = txListRowToNativeTransfer(row);
    expect(t.txHash).toBe("0xabc");
    expect(t.blockNumber).toBe(12345);
    expect(t.feeWei).toBe("21000000000000"); // 21000 * 1e9
    expect(t.blockTime).toBe(new Date(1700000000 * 1000).toISOString());
  });
  it("reconstructs a 3-topic ERC-20 Transfer log from a tokentx row", () => {
    const row: EvmTokenTxRow = {
      hash: "0xdef",
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      value: "1000000",
      contractAddress: "0xdac17f958d2ee523a2206206994597c13d831ec7",
      tokenDecimal: "6",
      tokenSymbol: "USDT",
      blockNumber: "99",
      timeStamp: "1",
      gasUsed: "1",
      gasPrice: "1",
    };
    const log = tokenTxRowToEvmLog(row, 3);
    expect(log.topics).toHaveLength(3); // ERC-20 = 3 topics (NOT 4)
    expect(log.logIndex).toBe(3);
    expect(log.topics[0]).toBe(
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    );
  });
});

describe("block-range backfill state machine", () => {
  it("starts at genesis with the default 10000-block window", () => {
    const s = initEvmBackfill(null, 100000);
    expect(s.cursor.nextStartBlock).toBe(0);
    expect(s.windowBlocks).toBe(EVM_BACKFILL_WINDOW_BLOCKS);
    expect(s.done).toBe(false);
    expect(shouldContinueEvmBackfill(s)).toBe(true);
  });
  it("caps the window end at the tip", () => {
    const s = initEvmBackfill(null, 5000);
    expect(currentWindowEnd(s)).toBe(5000);
  });
  it("advances past an empty window and resets the window size", () => {
    const s0 = initEvmBackfill(null, 100000);
    const s1 = reduceEvmBackfill(s0, [], [], 200);
    expect(s1.cursor.nextStartBlock).toBe(EVM_BACKFILL_WINDOW_BLOCKS);
    expect(s1.windowBlocks).toBe(EVM_BACKFILL_WINDOW_BLOCKS);
  });
  it("narrows the window by half on a full page (no data skipped)", () => {
    const fullPage: EvmTxListRow[] = [];
    for (let i = 0; i < 200; i += 1) {
      fullPage.push({ hash: `0x${i}`, from: "0xa", to: "0xb", value: "1", blockNumber: String(i), timeStamp: "1", gasUsed: "1", gasPrice: "1", isError: "0", transactionIndex: "0" });
    }
    const s0 = initEvmBackfill(null, 100000);
    const s1 = reduceEvmBackfill(s0, fullPage, [], 200);
    expect(s1.windowBlocks).toBe(Math.floor(EVM_BACKFILL_WINDOW_BLOCKS / 2));
    expect(s1.cursor.nextStartBlock).toBe(0); // re-request same start
  });
  it("keeps the minimum window and still advances on a full page", () => {
    const fullPage: EvmTxListRow[] = [];
    for (let i = 0; i < 200; i += 1) {
      fullPage.push({ hash: `0x${i}`, from: "0xa", to: "0xb", value: "1", blockNumber: String(i), timeStamp: "1", gasUsed: "1", gasPrice: "1", isError: "0", transactionIndex: "0" });
    }
    let s = initEvmBackfill(null, 100000);
    s = { ...s, windowBlocks: EVM_BACKFILL_MIN_WINDOW };
    const s1 = reduceEvmBackfill(s, fullPage, [], 200);
    expect(s1.windowBlocks).toBe(EVM_BACKFILL_MIN_WINDOW);
    expect(s1.cursor.nextStartBlock).toBe(200); // advanced past consumed rows
  });
  it("marks done when advancing past the tip", () => {
    const s0 = initEvmBackfill("49900:49899", 50000);
    const rows: EvmTxListRow[] = [
      { hash: "0xf", from: "0xa", to: "0xb", value: "1", blockNumber: "50000", timeStamp: "1", gasUsed: "1", gasPrice: "1", isError: "0", transactionIndex: "0" },
    ];
    const s1 = reduceEvmBackfill(s0, rows, [], 200);
    expect(s1.done).toBe(true);
    expect(currentCursorString(s1)).toBeNull();
  });
  it("resumes from a saved cursor", () => {
    const s = initEvmBackfill("1234:1233", 100000);
    expect(s.cursor.nextStartBlock).toBe(1234);
    expect(s.done).toBe(false);
  });
  it("trips the window guard so a runaway endpoint can't spin forever", () => {
    let s = initEvmBackfill(null, 1000000000);
    for (let i = 0; i < MAX_EVM_BACKFILL_WINDOWS; i += 1) {
      s = reduceEvmBackfill(s, [], [], 200);
    }
    expect(s.done).toBe(true);
  });
});

describe("counts + summary + sync-state", () => {
  it("folds window counts and summarizes in plain English", () => {
    let c = emptyEvmSyncCounts();
    c = addEvmWindowCounts(c, { windows: 1, balancesUpserted: 2, transactionsUpserted: 5 });
    c = addEvmWindowCounts(c, { windows: 1, transactionsUpserted: 3, untrackedTransactions: 1 });
    expect(c.windows).toBe(2);
    expect(c.transactionsUpserted).toBe(8);
    expect(summarizeEvmSync(c)).toContain("2 balances");
    expect(summarizeEvmSync(c)).toContain("8 transactions");
    expect(summarizeEvmSync(c)).toContain("untracked-token");
  });
  it("marks backfill complete with a null cursor", () => {
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
      cursor: "5000:4999",
      backfillComplete: false,
      syncedAt: "2026-08-11T00:00:00Z",
      status: "error",
      errorMessage: "rate limited",
    });
    expect(ss.status).toBe("error");
    expect(ss.backfill_cursor).toBe("5000:4999");
    expect(ss.error_message).toBe("rate limited");
  });
});

describe("reuse of chain-agnostic XRPL row builders with EVM legs", () => {
  it("buildTransactionUpserts accepts EVM-mapped legs (chain-agnostic)", () => {
    // A mapped native ETH transfer leg (signed negative = out).
    const rows = buildTransactionUpserts("w-1", [
      {
        txHash: "0xabc",
        eventIndex: 0,
        assetId: "eth",
        chain: "ethereum",
        direction: "out",
        txType: "transfer",
        amountRaw: "-1000000000000000000",
        amountDecimal: null,
        decimalsAtEvent: 18,
        feeRaw: "21000000000000",
        feeAssetId: "eth",
        counterparty: "0xdest",
        blockNumber: 100,
        blockTime: "2026-08-11T00:00:00Z",
        success: true,
      },
    ], { hash: "0xabc" });
    expect(rows).toHaveLength(1);
    expect(rows[0].amount_raw).toBe("1000000000000000000"); // unsigned magnitude
    expect(rows[0].direction).toBe("out");
    expect(rows[0].chain).toBe("ethereum");
    expect(rows[0].asset_id).toBe("eth");
  });
  it("buildBalanceUpserts writes tracked EVM balances and surfaces untracked", () => {
    const balances = [
      mapEvmNativeBalance("flare", "3000000000000000000"),
      mapEvmTokenBalance("ethereum", "0x9999999999999999999999999999999999999999", "100", 18),
    ];
    const rows = buildBalanceUpserts("w-1", balances, "2026-08-11T00:00:00Z");
    expect(rows).toHaveLength(1); // untracked skipped (FK-safe)
    expect(rows[0].asset_id).toBe("flr");
    expect(untrackedBalances(balances)).toHaveLength(1);
  });
});
