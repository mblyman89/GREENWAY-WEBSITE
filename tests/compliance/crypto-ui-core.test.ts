/**
 * C3 — Crypto Portfolio page presentation core.
 *
 * Exercises the embedded self-test plus targeted assertions on the tax-safety
 * centerpiece: the portfolio summary must produce HONEST totals (only priced
 * holdings sum; held-but-unpriced holdings are counted separately and NEVER
 * folded in as a guessed $0), token amounts format from EXACT stored values
 * (never floats), and add-wallet validation rejects wrong-chain addresses with
 * plain-English guidance.
 */
import { describe, it, expect } from "vitest";
import {
  __runCryptoUiCoreTests,
  resolveCryptoTab,
  formatCentsUsd,
  formatHeldAmount,
  maskAddress,
  parseAddWallet,
  parseWalletLabel,
  computePortfolioSummary,
  cryptoPosture,
  buildSyncHealth,
  buildWalletRow,
  WALLET_LABEL_MAX,
} from "../../src/lib/crypto/crypto-ui-core";

describe("crypto-ui-core embedded self-test", () => {
  it("passes every view + validation assertion", () => {
    expect(() => __runCryptoUiCoreTests()).not.toThrow();
  });
});

describe("HONEST portfolio totals (tax safety)", () => {
  it("sums ONLY priced holdings and counts unpriced separately", () => {
    const s = computePortfolioSummary([
      { chain: "ethereum", usdValueCents: 250000, hasAmount: true },
      { chain: "ethereum", usdValueCents: 100, hasAmount: true },
      { chain: "flare", usdValueCents: null, hasAmount: true },
      { chain: "coreum", usdValueCents: null, hasAmount: true },
    ]);
    expect(s.totalValuedCents).toBe(250100);
    expect(s.totalValuedText).toBe("$2,501.00");
    expect(s.pricedCount).toBe(2);
    expect(s.pendingCount).toBe(2);
    expect(s.headline).toBe("$2,501.00 valued · 2 holdings priced · 2 awaiting price");
  });

  it("never invents a $0 for an unpriced holding", () => {
    const s = computePortfolioSummary([{ chain: "flare", usdValueCents: null, hasAmount: true }]);
    expect(s.totalValuedCents).toBe(0);
    expect(s.pricedCount).toBe(0);
    expect(s.pendingCount).toBe(1);
  });

  it("ignores zero-amount rows (no phantom holdings)", () => {
    const s = computePortfolioSummary([{ chain: "xrpl", usdValueCents: 0, hasAmount: false }]);
    expect(s.isEmpty).toBe(true);
    expect(s.chainsWithHoldings).toBe(0);
  });

  it("orders per-chain breakdown canonically", () => {
    const s = computePortfolioSummary([
      { chain: "coreum", usdValueCents: 100, hasAmount: true },
      { chain: "ethereum", usdValueCents: 100, hasAmount: true },
      { chain: "flare", usdValueCents: 100, hasAmount: true },
    ]);
    expect(s.perChain.map((c) => c.chain)).toEqual(["ethereum", "flare", "coreum"]);
  });

  it("empty portfolio reads as empty with a friendly headline", () => {
    const s = computePortfolioSummary([]);
    expect(s.isEmpty).toBe(true);
    expect(s.headline).toBe("No holdings yet — connect a wallet to watch.");
  });
});

describe("EXACT token amounts (never floats)", () => {
  it("formats wei to a clean decimal", () => {
    expect(formatHeldAmount({ amountRaw: "1500000000000000000", amountDecimal: null, decimals: 18 })).toBe("1.5");
  });
  it("keeps an xrpl-issued decimal string exact (trailing zeros trimmed)", () => {
    expect(formatHeldAmount({ amountRaw: null, amountDecimal: "153.750", decimals: null })).toBe("153.75");
  });
  it("shows a huge raw exactly when no decimals are known", () => {
    const huge = "123456789012345678901234567890";
    expect(formatHeldAmount({ amountRaw: huge, amountDecimal: null, decimals: null })).toBe(huge);
  });
  it("USD stays integer cents", () => {
    expect(formatCentsUsd(123456)).toBe("$1,234.56");
    expect(formatCentsUsd(null)).toBe("—");
  });
});

describe("add-wallet validation + normalization", () => {
  it("lower-cases EVM addresses for dedup but preserves XRPL/Cosmos case", () => {
    const evm = parseAddWallet({ chain: "ethereum", address: "0xAbC1230000000000000000000000000000000000" });
    expect(evm.ok).toBe(true);
    if (evm.ok) expect(evm.address).toBe("0xabc1230000000000000000000000000000000000");

    const xrpl = parseAddWallet({ chain: "xrpl", address: "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz" });
    expect(xrpl.ok).toBe(true);
    if (xrpl.ok) expect(xrpl.address).toBe("rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz");
  });

  it("rejects a wrong-chain address with a plain-English hint", () => {
    const r = parseAddWallet({ chain: "ethereum", address: "core1tsev3vtllcvg49d06pxrj8ywsj0hzq576hdttd" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain("ethereum");
  });

  it("rejects an unknown chain and an empty address", () => {
    expect(parseAddWallet({ chain: "bitcoin", address: "x" }).ok).toBe(false);
    expect(parseAddWallet({ chain: "ethereum", address: "" }).ok).toBe(false);
  });

  it("caps the label at the max length", () => {
    const r = parseAddWallet({ chain: "ethereum", address: "0x" + "a".repeat(40), label: "z".repeat(500) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.label?.length).toBe(WALLET_LABEL_MAX);
  });
});

describe("watch-only posture + display", () => {
  it("always reports watch-only as a structural guarantee", () => {
    const p = cryptoPosture({ dbReady: false, walletCount: 0, pricingConfigured: false });
    const wo = p.find((i) => i.label === "Watch-only");
    expect(wo?.ok).toBe(true);
    expect(wo?.detail.toLowerCase()).toContain("never move");
  });

  it("masks a long address and preserves the full value for links", () => {
    const row = buildWalletRow({
      id: "w",
      chain: "ethereum",
      address: "0x1234567890abcdef1234567890abcdef12345678",
      label: null,
      active: true,
    });
    expect(row.addressShort).toBe("0x1234…5678");
    expect(row.addressFull).toBe("0x1234567890abcdef1234567890abcdef12345678");
    expect(row.displayName).toBe("Ethereum");
  });

  it("reads sync health in plain English", () => {
    expect(buildSyncHealth(null).label).toBe("Not synced yet");
    expect(
      buildSyncHealth({ backfillComplete: true, status: "idle", lastSyncedAt: "2026-03-01T00:00:00Z", errorMessage: null }).tone,
    ).toBe("green");
  });

  it("resolves tabs with sensible fallbacks", () => {
    expect(resolveCryptoTab(undefined)).toBe("portfolio");
    expect(resolveCryptoTab("addresses")).toBe("wallets");
    expect(resolveCryptoTab("junk")).toBe("portfolio");
  });

  it("masks addresses for display without dropping information", () => {
    expect(maskAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234\u20265678");
    // Short addresses are returned untouched (nothing to hide).
    expect(maskAddress("0xabcd")).toBe("0xabcd");
    // Empty/blank input renders a neutral em-dash placeholder, not a stray ellipsis.
    expect(maskAddress("")).toBe("\u2014");
    expect(maskAddress(null)).toBe("\u2014");
  });

  it("renames a wallet: trims, caps, clears-on-empty, guards the id", () => {
    const ok = parseWalletLabel({ walletId: "w-1", label: "  Main ETH  " });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.walletId).toBe("w-1");
      expect(ok.label).toBe("Main ETH");
    }
    // Empty label clears the nickname (null), so the row falls back to chain name.
    const cleared = parseWalletLabel({ walletId: "w-1", label: "   " });
    expect(cleared.ok && cleared.label).toBeNull();
    // Missing wallet id is rejected with a friendly error.
    expect(parseWalletLabel({ walletId: "", label: "x" }).ok).toBe(false);
    // Over-long labels are capped, never rejected.
    const capped = parseWalletLabel({ walletId: "w-1", label: "z".repeat(500) });
    expect(capped.ok && capped.label!.length).toBe(WALLET_LABEL_MAX);
  });

  it("surfaces the raw label on the wallet row (for the rename box)", () => {
    const named = buildWalletRow({
      id: "w-2",
      chain: "flare",
      address: "0x1234567890abcdef1234567890abcdef12345678",
      label: "DeFi wallet",
      active: true,
    });
    expect(named.label).toBe("DeFi wallet");
    expect(named.displayName).toBe("DeFi wallet");
    // No label → empty string in the box, chain name shown as displayName.
    const unnamed = buildWalletRow({
      id: "w-3",
      chain: "flare",
      address: "0x1234567890abcdef1234567890abcdef12345678",
      label: null,
      active: true,
    });
    expect(unnamed.label).toBe("");
    expect(unnamed.displayName).toBe("Flare");
  });
});
