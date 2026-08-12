import { describe, it, expect } from "vitest";
import {
  __runCryptoHistoricalPricingCoreTests,
  toCoinGeckoDate,
  toIsoPriceDate,
  historicalSourceKey,
  isReconstructedSource,
  planHistoricalFetches,
  assembleHistoricalBasis,
  fetchKey,
  type PricingNeed,
} from "../../src/lib/crypto/crypto-historical-pricing-core";

/**
 * R1-G3 — the pure historical FMV-at-timestamp pricing bridge. It converts a
 * receive instant into CoinGecko's DD-MM-YYYY lookup date + the store's ISO
 * priceDate, tags reconstructed prices with a permanent provenance source,
 * plans de-duplicated history lookups, and assembles fetched USD into
 * FLOAT-FREE reconstructed basis rows. Anything it cannot price is SURFACED as
 * unpriced — never silently booked at $0.
 */

describe("crypto-historical-pricing-core", () => {
  it("passes its embedded pure self-tests", () => {
    expect(() => __runCryptoHistoricalPricingCoreTests()).not.toThrow();
  });

  it("converts a UTC instant to CoinGecko and ISO date forms", () => {
    const ms = Date.UTC(2024, 5, 15, 12, 0, 0);
    expect(toCoinGeckoDate(ms)).toBe("15-06-2024");
    expect(toIsoPriceDate(ms)).toBe("2024-06-15");
  });

  it("zero-pads single-digit day and month", () => {
    const ms = Date.UTC(2023, 0, 5, 0, 0, 0);
    expect(toCoinGeckoDate(ms)).toBe("05-01-2023");
    expect(toIsoPriceDate(ms)).toBe("2023-01-05");
  });

  it("rejects a non-finite / non-integer timestamp", () => {
    expect(() => toCoinGeckoDate(Number.NaN)).toThrow();
    expect(() => toIsoPriceDate(1.5)).toThrow();
  });

  it("tags reconstructed prices with a permanent provenance source", () => {
    const key = historicalSourceKey("ripple", "15-06-2024");
    expect(key).toBe("reconstructed:coingecko:ripple:history:15-06-2024");
    expect(isReconstructedSource(key)).toBe(true);
    // a normal live source is NOT flagged reconstructed
    expect(isReconstructedSource("coingecko:ripple")).toBe(false);
  });

  it("rejects a bad coin id or date layout for the source key", () => {
    expect(() => historicalSourceKey("", "15-06-2024")).toThrow();
    expect(() => historicalSourceKey("ripple", "2024-06-15")).toThrow();
  });

  it("de-duplicates history lookups by coin + calendar day", () => {
    const ms = Date.UTC(2024, 5, 15, 8, 0, 0);
    const needs: PricingNeed[] = [
      { receiptId: "r1", assetId: "a", coinId: "ripple", receivedAtMs: ms },
      { receiptId: "r2", assetId: "a", coinId: "ripple", receivedAtMs: ms + 60000 },
      { receiptId: "r3", assetId: "b", coinId: "flare-networks", receivedAtMs: ms },
      { receiptId: "r4", assetId: "c", coinId: "", receivedAtMs: ms },
    ];
    const plan = planHistoricalFetches(needs);
    // ripple/15-06 once + flare/15-06 once; blank coin dropped.
    expect(plan.length).toBe(2);
    expect(plan.some((p) => p.coinId === "ripple" && p.dateDDMMYYYY === "15-06-2024")).toBe(true);
    expect(plan.some((p) => p.coinId === "flare-networks")).toBe(true);
  });

  it("books positive float-free basis and surfaces everything else", () => {
    const ms = Date.UTC(2024, 5, 15, 8, 0, 0);
    const needs: PricingNeed[] = [
      { receiptId: "r1", assetId: "aXRP", coinId: "ripple", receivedAtMs: ms },
      { receiptId: "r2", assetId: "aFLR", coinId: "flare-networks", receivedAtMs: ms },
      { receiptId: "r3", assetId: "aZ", coinId: "", receivedAtMs: ms },
    ];
    const prices = new Map<string, string>();
    prices.set(fetchKey("ripple", "15-06-2024"), "0.50");
    // flare-networks intentionally missing -> unpriced
    const res = assembleHistoricalBasis(needs, prices);

    const r1 = res.priced.find((p) => p.receiptId === "r1");
    expect(r1?.priceScaledCents).toBe("50000000");
    expect(r1?.priceDate).toBe("2024-06-15");
    expect(r1?.source).toBe("reconstructed:coingecko:ripple:history:15-06-2024");

    expect(res.pricedCount).toBe(1);
    expect(res.unpricedCount).toBe(2);
    // every priced row is strictly positive — never a $0 basis
    for (const p of res.priced) {
      expect(/^[1-9]\d*$/.test(p.priceScaledCents)).toBe(true);
    }
  });

  it("never books a zero price as basis", () => {
    const ms = Date.UTC(2024, 5, 15, 8, 0, 0);
    const needs: PricingNeed[] = [
      { receiptId: "r1", assetId: "a", coinId: "ripple", receivedAtMs: ms },
    ];
    const prices = new Map<string, string>();
    prices.set(fetchKey("ripple", "15-06-2024"), "0");
    const res = assembleHistoricalBasis(needs, prices);
    expect(res.pricedCount).toBe(0);
    expect(res.unpriced[0].reason).toContain("zero");
  });

  it("surfaces a malformed price rather than throwing the batch", () => {
    const ms = Date.UTC(2024, 5, 15, 8, 0, 0);
    const needs: PricingNeed[] = [
      { receiptId: "r1", assetId: "a", coinId: "ripple", receivedAtMs: ms },
    ];
    const prices = new Map<string, string>();
    prices.set(fetchKey("ripple", "15-06-2024"), "1e-3"); // exponent -> rejected by toScaledCents
    const res = assembleHistoricalBasis(needs, prices);
    expect(res.pricedCount).toBe(0);
    expect(res.unpricedCount).toBe(1);
  });
});
