/**
 * C0 — Crypto Portfolio Integration pure core.
 *
 * Exercises the embedded self-test (asset registry with VERIFIED decimals,
 * two amount models, string-safe token math, deterministic USD cents, and
 * address validation) plus a few targeted API assertions that lock down the
 * load-bearing tax-math facts: USDT=6 decimals, SOLO is a decimal-string
 * issued token (NOT ERC-20 fixed decimals), and no float ever touches value.
 */
import { describe, it, expect } from "vitest";
import {
  __runCryptoCoreTests,
  CHAINS,
  CRYPTO_ASSETS,
  isEvmChain,
  getAsset,
  normalizeMinorUnits,
  formatTokenAmount,
  normalizeXrplIssuedAmount,
  usdValueCents,
  isEvmAddress,
  isXrplAddress,
  isCosmosAddress,
  isValidAddressForChain,
  isDisposalType,
} from "@/lib/crypto/crypto-core";

describe("crypto-core self-test", () => {
  it("passes all embedded self-tests", () => {
    expect(() => __runCryptoCoreTests()).not.toThrow();
  });
});

describe("crypto-core verified facts", () => {
  it("tracks exactly five chains, three of them EVM, one Cosmos", () => {
    expect(CHAINS.length).toBe(5);
    expect(CHAINS.filter(isEvmChain).length).toBe(3);
    expect(isEvmChain("xrpl")).toBe(false);
    expect(CHAINS).toContain("coreum");
  });

  it("registers exactly Michael's eight assets (incl. Coreum TX + Pulsara SARA)", () => {
    expect(CRYPTO_ASSETS.length).toBe(8);
    expect(CRYPTO_ASSETS.map((a) => a.id).sort()).toEqual(
      ["eth", "flr", "sara", "sgb", "solo", "tx", "usdt-eth", "xrp"].sort(),
    );
  });

  it("models Coreum TX with the VERIFIED ucore base denom at 6 decimals", () => {
    const tx = getAsset("tx");
    expect(tx?.chain).toBe("coreum");
    expect(tx?.native).toBe(true);
    expect(tx?.denom).toBe("ucore");
    expect(tx?.decimals).toBe(6);
    expect(tx?.decimalsSource).toBe("verified");
  });

  it("keeps SOLO's history and links it forward to TX (keep-history migration)", () => {
    const solo = getAsset("solo");
    expect(solo?.migratesToAssetId).toBe("tx");
    // TX is the destination and does not itself migrate.
    expect(getAsset("tx")?.migratesToAssetId).toBeUndefined();
  });

  it("uses the VERIFIED USDT-on-Ethereum contract at 6 decimals", () => {
    const usdt = getAsset("usdt-eth");
    expect(usdt?.decimals).toBe(6);
    expect(usdt?.contract).toBe("0xdac17f958d2ee523a2206206994597c13d831ec7");
    expect(usdt?.chain).toBe("ethereum");
  });

  it("models SOLO as an XRPL decimal-string token, NOT fixed decimals", () => {
    const solo = getAsset("solo");
    expect(solo?.amountModel).toBe("xrpl-issued");
    expect(solo?.decimals).toBeUndefined();
    expect(solo?.issuer).toBe("rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz");
  });
});

describe("crypto-core money math is float-free and exact", () => {
  it("handles wei beyond 2^53 without drift", () => {
    expect(normalizeMinorUnits("1234567890123456789012")).toBe("1234567890123456789012");
  });

  it("rejects floats in the integer-minor-unit path", () => {
    expect(() => normalizeMinorUnits(1.5)).toThrow();
    expect(() => normalizeMinorUnits("12.3")).toThrow();
  });

  it("formats USDT 1_500_000 minor units as 1.5", () => {
    expect(formatTokenAmount("1500000", 6)).toBe("1.5");
  });

  it("preserves XRPL issued-token decimal strings exactly", () => {
    expect(normalizeXrplIssuedAmount("00153.750")).toBe("153.75");
    expect(() => normalizeXrplIssuedAmount("1234567890123456")).toThrow();
  });

  it("computes USD value in deterministic integer cents", () => {
    // Price passed as a string of cents * 1_000_000 (priceScale 6):
    //   $2000.00 → 200000 cents → "200000000000"; $1.00 → 100 cents → "100000000".
    expect(usdValueCents("1.5", "200000000000", 6)).toBe(300000);
    expect(usdValueCents("1000", "100000000", 6)).toBe(100000);
  });
});

describe("crypto-core taxonomy & addresses", () => {
  it("flags swaps and LP moves as disposals", () => {
    expect(isDisposalType("swap")).toBe(true);
    expect(isDisposalType("lp_add")).toBe(true);
    expect(isDisposalType("lp_remove")).toBe(true);
    expect(isDisposalType("transfer")).toBe(false);
  });

  it("validates EVM, XRPL and Cosmos addresses without confusing them", () => {
    const coreAddr = "core1tsev3vtllcvg49d06pxrj8ywsj0hzq576hdttd";
    expect(isEvmAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7")).toBe(true);
    expect(isXrplAddress("rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz")).toBe(true);
    expect(isCosmosAddress(coreAddr, "core")).toBe(true);
    // No cross-family confusion.
    expect(isEvmAddress("rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz")).toBe(false);
    expect(isCosmosAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7", "core")).toBe(false);
    expect(isValidAddressForChain("xrpl", "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz")).toBe(true);
    expect(isValidAddressForChain("coreum", coreAddr)).toBe(true);
    expect(isValidAddressForChain("ethereum", coreAddr)).toBe(false);
  });
});
