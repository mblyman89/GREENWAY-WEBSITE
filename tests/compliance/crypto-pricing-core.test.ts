/**
 * R3-A — Crypto Portfolio USD valuation, pure pricing core.
 *
 * Locks down the honest, never-guess behaviour of price resolution + valuation:
 *   • toScaledCents turns a plain USD string into integer "cents * 10^6" with
 *     half-up rounding and float-free BigInt math; bad input is rejected.
 *   • resolvePriceSource uses an EXPLICIT verified allow-list — natives/wrapped
 *     + SFIN via CoinGecko id, verified Flare ERC-20s via GeckoTerminal,
 *     rFLR derived from WFLR (documented 1:1), exUSDT assumed 1:1 USDT
 *     (Michael-directed, recorded as source), everything else => none.
 *   • applyPricesToBalances values each balance from its asset's price using the
 *     shared usdValueCents() path; unpriced assets => null ("no market price"),
 *     never $0.
 * Fixtures use Michael's REAL live coins, contracts, amounts and prices.
 */
import { describe, it, expect } from "vitest";
import {
  __runCryptoPricingCoreTests,
  toScaledCents,
  resolvePriceSource,
  buildPriceSnapshotRows,
  applyPricesToBalances,
  PRICE_SCALE,
  type ResolvedPrice,
  type PriceableBalance,
} from "@/lib/crypto/crypto-pricing-core";
import type { CryptoAssetRecord } from "@/lib/crypto/crypto-store-core";

function asset(over: Partial<CryptoAssetRecord>): CryptoAssetRecord {
  return {
    id: "asset-x",
    symbol: "X",
    name: "Token X",
    chain: "flare",
    amountModel: "evm-minor",
    decimals: 18,
    decimalsSource: "verified",
    native: false,
    contract: null,
    issuer: null,
    currencyCode: null,
    denom: null,
    migratesToAssetId: null,
    active: true,
    hidden: undefined,
    ...over,
  };
}

describe("crypto-pricing-core", () => {
  it("runs the embedded self-tests", () => {
    expect(() => __runCryptoPricingCoreTests()).not.toThrow();
  });

  it("toScaledCents converts USD strings to integer cents*10^6, half-up", () => {
    expect(toScaledCents("73.08", 6)).toBe("7308000000");
    expect(toScaledCents("1", 6)).toBe("100000000");
    expect(toScaledCents("0.00100616", 6)).toBe("100616");
    expect(toScaledCents("0.006064", 6)).toBe("606400");
    expect(toScaledCents("0.0000000051", 6)).toBe("1");
    expect(toScaledCents("0.0000000049", 6)).toBe("0");
    expect(PRICE_SCALE).toBe(6);
  });

  it("toScaledCents rejects negative / scientific / non-numeric input", () => {
    expect(() => toScaledCents("-1", 6)).toThrow();
    expect(() => toScaledCents("1e6", 6)).toThrow();
    expect(() => toScaledCents("abc", 6)).toThrow();
    expect(() => toScaledCents("", 6)).toThrow();
  });

  it("resolvePriceSource maps natives/wrapped/SFIN to CoinGecko ids", () => {
    expect(resolvePriceSource(asset({ symbol: "FLR", native: true }))).toMatchObject({
      kind: "coingecko-id",
      coinId: "flare-networks",
    });
    expect(resolvePriceSource(asset({ symbol: "XRP", chain: "xrpl" }))).toMatchObject({
      coinId: "ripple",
    });
    expect(resolvePriceSource(asset({ symbol: "SFIN", chain: "songbird" }))).toMatchObject({
      coinId: "songbird-finance",
    });
    expect(resolvePriceSource(asset({ symbol: "WSGB", chain: "songbird" }))).toMatchObject({
      coinId: "songbird",
    });
  });

  it("resolvePriceSource derives rFLR from WFLR (documented 1:1)", () => {
    const r = resolvePriceSource(
      asset({ symbol: "RFLR", chain: "flare", contract: "0x26d460c3cf931fb2014fa436a49e3af08619810e" }),
    );
    expect(r.kind).toBe("derived-wflr");
    expect(r.kind === "derived-wflr" && r.sourceKey).toBe("derived:wflr-1to1");
  });

  it("resolvePriceSource treats exUSDT as assumed 1:1 USDT (Michael-directed)", () => {
    const r = resolvePriceSource(
      asset({ symbol: "EXUSDT", chain: "songbird", contract: "0x1a7b46656b2b8b29b1694229e122d066020503d0" }),
    );
    expect(r.kind).toBe("assumed-usdt");
    expect(r.kind === "assumed-usdt" && r.sourceKey).toBe("assumed:usdt-1to1");
  });

  it("resolvePriceSource prices verified Flare ERC-20s via GeckoTerminal", () => {
    const r = resolvePriceSource(
      asset({ symbol: "USDX", chain: "flare", contract: "0x4A771Cc1a39FDd8AA08B8EA51F7Fd412e73B3d2B" }),
    );
    expect(r.kind).toBe("geckoterminal-flare");
    expect(r.kind === "geckoterminal-flare" && r.contract).toBe(
      "0x4a771cc1a39fdd8aa08b8ea51f7fd412e73b3d2b",
    );
  });

  it("resolvePriceSource returns none for coins with no honest market", () => {
    expect(
      resolvePriceSource(asset({ symbol: "FLRFROG", chain: "flare", contract: "0x19cf770bbb7b71977b860e7fd8d32fa2513a743c", decimals: 9 })).kind,
    ).toBe("none");
    expect(resolvePriceSource(asset({ symbol: "ZZZ", contract: null })).kind).toBe("none");
  });

  it("applyPricesToBalances values priced balances and leaves unpriced null", () => {
    const prices: Record<string, ResolvedPrice> = {
      "a-sfin": { assetId: "a-sfin", priceScaledCents: "7308000000", priceScale: 6, source: "coingecko:songbird-finance" },
      "a-exusdt": { assetId: "a-exusdt", priceScaledCents: "100000000", priceScale: 6, source: "assumed:usdt-1to1" },
    };
    const balances: PriceableBalance[] = [
      { balanceId: "b1", assetId: "a-sfin", amountText: "3.086739302164081614" },
      { balanceId: "b2", assetId: "a-exusdt", amountText: "2272.482527" },
      { balanceId: "b3", assetId: "a-frog", amountText: "1000000" },
    ];
    const vals = applyPricesToBalances(balances, prices);
    expect(vals[0].usdValueCents).toBe(22558);
    expect(vals[1].usdValueCents).toBe(227248);
    expect(vals[2].usdValueCents).toBeNull();
  });

  it("buildPriceSnapshotRows stamps the date and rejects bad dates", () => {
    const resolved: ResolvedPrice[] = [
      { assetId: "a", priceScaledCents: "100000000", priceScale: 6, source: "assumed:usdt-1to1" },
    ];
    const rows = buildPriceSnapshotRows(resolved, "2026-08-12");
    expect(rows[0]).toMatchObject({ assetId: "a", priceDate: "2026-08-12", source: "assumed:usdt-1to1" });
    expect(() => buildPriceSnapshotRows(resolved, "bad")).toThrow();
  });
});
