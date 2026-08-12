/**
 * AREA 4 — Portfolio expandable holdings table, pure core.
 *
 * Locks down the honest, never-guess behaviour of the per-wallet holdings view:
 *   • Amounts come from EXACT stored minor units (never a float); a native coin
 *     and a real alt coin (FLRFROG, 9 decimals) both format correctly.
 *   • USD value shows ONLY when priced (integer cents); unpriced => null =>
 *     the UI shows "value pending", never $0.
 *   • Hidden (scam) tokens are split OUT of the visible list into a separate
 *     hidden list — kept for provability, one click from being unhidden.
 *   • Native coin is pinned first; explorer links are built only for the two
 *     chains proven live (Flare/Songbird), never guessed for others.
 */
import { describe, it, expect } from "vitest";
import {
  __runCryptoHoldingsTableCoreTests,
  buildHoldingsTable,
  buildHoldingRow,
  explorerTokenUrl,
  explorerAddressUrl,
  isHeldBalance,
  computePercentBasisPoints,
  formatPercentBasisPoints,
} from "@/lib/crypto/crypto-holdings-table-core";
import type {
  CryptoAssetRecord,
  CryptoBalanceRecord,
  CryptoWalletRecord,
} from "@/lib/crypto/crypto-store-core";

function asset(over: Partial<CryptoAssetRecord>): CryptoAssetRecord {
  return {
    id: "flare:0x0000000000000000000000000000000000000001",
    symbol: "TKN",
    name: "Token",
    chain: "flare",
    amountModel: "evm-minor",
    decimals: 18,
    decimalsSource: "verified",
    native: false,
    contract: "0x0000000000000000000000000000000000000001",
    issuer: null,
    currencyCode: null,
    denom: null,
    migratesToAssetId: null,
    active: true,
    hidden: false,
    ...over,
  };
}

function bal(over: Partial<CryptoBalanceRecord>): CryptoBalanceRecord {
  return {
    id: "b1",
    walletId: "w1",
    assetId: "flare:0x0000000000000000000000000000000000000001",
    amountRaw: "1000000000000000000",
    amountDecimal: null,
    decimalsAtRead: 18,
    usdValueCents: null,
    balancesUpdatedAt: null,
    ...over,
  };
}

const WALLET: CryptoWalletRecord = {
  id: "w1",
  chain: "flare",
  address: "0xB57Fb1217cc868D401426012157d6CFd311272e4",
  label: "Main",
  active: true,
};

describe("crypto-holdings-table-core self-tests", () => {
  it("passes the embedded pure self-tests", () => {
    expect(() => __runCryptoHoldingsTableCoreTests()).not.toThrow();
  });
});

describe("explorer links (verified chains only, never guessed)", () => {
  it("builds Flare + Songbird token pages, lowercased", () => {
    expect(explorerTokenUrl("flare", "0x12E605bc104e93B45e1aD99F9e555f659051c2BB")).toBe(
      "https://flare-explorer.flare.network/token/0x12e605bc104e93b45e1ad99f9e555f659051c2bb",
    );
    expect(explorerTokenUrl("songbird", "0x02f0826ef6aD107Cfc861152B32B52fD11BaB9ED")).toBe(
      "https://songbird-explorer.flare.network/token/0x02f0826ef6ad107cfc861152b32b52fd11bab9ed",
    );
  });
  it("returns null for unsupported chains and malformed contracts", () => {
    expect(explorerTokenUrl("ethereum", "0x" + "1".repeat(40))).toBeNull();
    expect(explorerTokenUrl("xrpl", "0x" + "1".repeat(40))).toBeNull();
    expect(explorerTokenUrl("flare", "0x123")).toBeNull();
    expect(explorerTokenUrl("flare", null)).toBeNull();
  });
  it("builds a wallet address page", () => {
    expect(explorerAddressUrl("flare", WALLET.address)).toBe(
      "https://flare-explorer.flare.network/address/0xb57fb1217cc868d401426012157d6cfd311272e4",
    );
  });
});

describe("isHeldBalance", () => {
  it("treats zero/blank/null as not held", () => {
    expect(isHeldBalance(bal({ amountRaw: "0" }))).toBe(false);
    expect(isHeldBalance(bal({ amountRaw: "" }))).toBe(false);
    expect(isHeldBalance(bal({ amountRaw: null }))).toBe(false);
    expect(isHeldBalance(bal({ amountRaw: null, amountDecimal: "0" }))).toBe(false);
  });
  it("treats a positive amount as held", () => {
    expect(isHeldBalance(bal({ amountRaw: "5" }))).toBe(true);
    expect(isHeldBalance(bal({ amountRaw: null, amountDecimal: "1.5" }))).toBe(true);
  });
});

describe("buildHoldingRow — exact amounts, honest value, verified flag", () => {
  it("formats a real alt coin using its real decimals (FLRFROG=9)", () => {
    const row = buildHoldingRow(
      bal({ amountRaw: "123000000000" }),
      asset({ symbol: "FLRFROG", decimals: 9, contract: "0x1D80c49BBBCD1c0911346656B529DF9E5c2F783d" }),
    );
    expect(row.amountText).toBe("123");
    expect(row.explorerUrl).toBe(
      "https://flare-explorer.flare.network/token/0x1d80c49bbbcd1c0911346656b529df9e5c2f783d",
    );
    expect(row.contractShort).toBe("0x1D80…783d");
    expect(row.verified).toBe(true);
  });
  it("shows value only when priced; otherwise null (never $0)", () => {
    expect(buildHoldingRow(bal({}), asset({})).valueText).toBeNull();
    expect(buildHoldingRow(bal({ usdValueCents: 12345 }), asset({})).valueText).toBe("$123.45");
  });
  it("a native coin has no contract/explorer", () => {
    const row = buildHoldingRow(
      bal({ assetId: "FLR", amountRaw: "2500000000000000000" }),
      asset({ id: "FLR", symbol: "FLR", native: true, contract: null }),
    );
    expect(row.amountText).toBe("2.5");
    expect(row.explorerUrl).toBeNull();
    expect(row.contractShort).toBeNull();
  });
  it("flags unverified decimals", () => {
    expect(buildHoldingRow(bal({}), asset({ decimalsSource: "denom-convention" })).verified).toBe(false);
  });
});

describe("buildHoldingsTable — hidden split + native-first + empties excluded", () => {
  const table = buildHoldingsTable({
    wallets: [WALLET],
    balances: [
      bal({ id: "b-native", assetId: "FLR", amountRaw: "1000000000000000000" }),
      bal({ id: "b-aaa", assetId: "flare:0x0000000000000000000000000000000000000001", amountRaw: "5" }),
      bal({ id: "b-scam", assetId: "flare:scam", amountRaw: "999" }),
      bal({ id: "b-empty", assetId: "flare:empty", amountRaw: "0" }),
    ],
    assetById: new Map([
      ["FLR", asset({ id: "FLR", symbol: "FLR", name: "Flare", native: true, contract: null })],
      ["flare:0x0000000000000000000000000000000000000001", asset({ symbol: "AAA" })],
      ["flare:scam", asset({ id: "flare:scam", symbol: "SCAM", hidden: true })],
      ["flare:empty", asset({ id: "flare:empty", symbol: "EMP" })],
    ]),
  });

  it("returns one wallet with native pinned first", () => {
    expect(table.wallets).toHaveLength(1);
    expect(table.wallets[0].visible[0].symbol).toBe("FLR");
  });
  it("splits hidden scam token out of the visible list but keeps it", () => {
    const w = table.wallets[0];
    expect(w.visibleCount).toBe(2);
    expect(w.hiddenCount).toBe(1);
    expect(w.hidden[0].symbol).toBe("SCAM");
    expect(table.hiddenTotal).toBe(1);
  });
  it("excludes zero-amount balances", () => {
    const syms = table.wallets[0].visible.map((r) => r.symbol);
    expect(syms).not.toContain("EMP");
  });
  it("drops wallets with no held tokens", () => {
    const empty = buildHoldingsTable({
      wallets: [WALLET],
      balances: [bal({ id: "b0", assetId: "flare:empty", amountRaw: "0" })],
      assetById: new Map([["flare:empty", asset({ id: "flare:empty" })]]),
    });
    expect(empty.wallets).toHaveLength(0);
  });
});

describe("R3-C — USD subtotals, grand total, %-of-portfolio (float-free)", () => {
  it("computePercentBasisPoints uses integer half-up math and guards zero total", () => {
    expect(computePercentBasisPoints(2500, 10000)).toBe(2500);
    expect(computePercentBasisPoints(1, 3)).toBe(3333); // half-up
    expect(computePercentBasisPoints(500, 500)).toBe(10000);
    expect(computePercentBasisPoints(null, 10000)).toBeNull();
    expect(computePercentBasisPoints(100, 0)).toBeNull();
    expect(computePercentBasisPoints(-1, 10000)).toBeNull();
  });

  it("formatPercentBasisPoints renders two decimals honestly", () => {
    expect(formatPercentBasisPoints(1234)).toBe("12.34%");
    expect(formatPercentBasisPoints(500)).toBe("5.00%");
    expect(formatPercentBasisPoints(10000)).toBe("100.00%");
    expect(formatPercentBasisPoints(null)).toBeNull();
  });

  const priced = buildHoldingsTable({
    wallets: [WALLET],
    balances: [
      bal({ id: "p-flr", assetId: "FLR", amountRaw: "1000000000000000000", usdValueCents: 7500 }),
      bal({
        id: "p-aaa",
        assetId: "flare:0x0000000000000000000000000000000000000001",
        amountRaw: "5",
        usdValueCents: 2500,
      }),
      bal({ id: "p-none", assetId: "flare:none", amountRaw: "9", usdValueCents: null }),
    ],
    assetById: new Map([
      ["FLR", asset({ id: "FLR", symbol: "FLR", name: "Flare", native: true, contract: null })],
      [
        "flare:0x0000000000000000000000000000000000000001",
        asset({ id: "flare:0x0000000000000000000000000000000000000001", symbol: "AAA" }),
      ],
      ["flare:none", asset({ id: "flare:none", symbol: "NONE" })],
    ]),
  });

  it("sums only priced holdings into wallet subtotal and grand total", () => {
    expect(priced.totalValuedCents).toBe(10000);
    expect(priced.totalValuedText).toBe("$100.00");
    expect(priced.wallets[0].valuedCents).toBe(10000);
    expect(priced.wallets[0].valuedText).toBe("$100.00");
  });

  it("stamps each priced row's share of the whole portfolio; unpriced => null", () => {
    const rows = priced.wallets[0].visible;
    const flr = rows.find((r) => r.symbol === "FLR")!;
    const aaa = rows.find((r) => r.symbol === "AAA")!;
    const none = rows.find((r) => r.symbol === "NONE")!;
    expect(flr.percentText).toBe("75.00%");
    expect(flr.percentBasisPoints).toBe(7500);
    expect(aaa.percentText).toBe("25.00%");
    expect(none.percentText).toBeNull();
    expect(none.percentBasisPoints).toBeNull();
  });

  it("all-unpriced portfolio: total $0.00, no percents, no divide-by-zero", () => {
    const unpriced = buildHoldingsTable({
      wallets: [WALLET],
      balances: [bal({ id: "u1", assetId: "FLR", amountRaw: "1000000000000000000", usdValueCents: null })],
      assetById: new Map([["FLR", asset({ id: "FLR", symbol: "FLR", native: true, contract: null })]]),
    });
    expect(unpriced.totalValuedCents).toBe(0);
    expect(unpriced.totalValuedText).toBe("$0.00");
    expect(unpriced.wallets[0].visible[0].percentText).toBeNull();
  });
});
