/**
 * C2 — Crypto Portfolio read layer (pure shape core).
 *
 * Exercises the embedded self-test (coercion helpers + snake→camel row mappers)
 * plus targeted assertions that lock down the load-bearing tax-safety facts:
 *   - raw token amounts (numeric(78,0) / text) survive as EXACT strings, never
 *     lossy JS numbers — even beyond Number.MAX_SAFE_INTEGER,
 *   - USD is integer cents (number),
 *   - the two amount models map correctly (evm-minor → amountRaw string;
 *     xrpl-issued → amountDecimal string),
 *   - read-limit clamps can't be blown past the cap by a caller.
 */
import { describe, it, expect } from "vitest";
import {
  __runCryptoStoreCoreTests,
  toAmountString,
  toIntOrNull,
  clampLimit,
  cleanId,
  toCryptoAssetRecord,
  toCryptoBalanceRecord,
  toCryptoTransactionRecord,
  toCryptoAssetMigrationRecord,
  CRYPTO_TXN_READ_LIMIT,
  CRYPTO_PRICE_READ_LIMIT,
} from "../../src/lib/crypto/crypto-store-core";

describe("crypto-store-core embedded self-test", () => {
  it("passes every mapper + coercion assertion", () => {
    expect(() => __runCryptoStoreCoreTests()).not.toThrow();
  });
});

describe("amount safety (never floats for value)", () => {
  it("preserves a huge integer amount as an exact string", () => {
    // 30-digit value — far beyond Number.MAX_SAFE_INTEGER (~9e15).
    const huge = "123456789012345678901234567890";
    expect(toAmountString(huge)).toBe(huge);
  });

  it("keeps 18-decimal wei exactly (1.5 ETH)", () => {
    expect(toAmountString("1500000000000000000")).toBe("1500000000000000000");
  });

  it("normalizes null/undefined/empty to null", () => {
    expect(toAmountString(null)).toBeNull();
    expect(toAmountString(undefined)).toBeNull();
    expect(toAmountString("   ")).toBeNull();
  });

  it("coerces small integers to number and junk to null", () => {
    expect(toIntOrNull("6")).toBe(6);
    expect(toIntOrNull(18)).toBe(18);
    expect(toIntOrNull("")).toBeNull();
    expect(toIntOrNull("abc")).toBeNull();
  });
});

describe("amount-model mapping", () => {
  it("maps an evm-minor balance to amountRaw string (amountDecimal null)", () => {
    const bal = toCryptoBalanceRecord({
      id: "b-1",
      wallet_id: "w-1",
      asset_id: "eth",
      amount_raw: "1500000000000000000",
      amount_decimal: null,
      decimals_at_read: 18,
      usd_value_cents: 250000,
      balances_updated_at: "2026-03-01T00:00:00Z",
    });
    expect(bal.amountRaw).toBe("1500000000000000000");
    expect(bal.amountDecimal).toBeNull();
    expect(bal.usdValueCents).toBe(250000);
  });

  it("maps an xrpl-issued balance to amountDecimal string (amountRaw null)", () => {
    const bal = toCryptoBalanceRecord({
      id: "b-2",
      wallet_id: "w-2",
      asset_id: "solo",
      amount_raw: null,
      amount_decimal: "1234.567890123456",
      decimals_at_read: null,
      usd_value_cents: null,
      balances_updated_at: null,
    });
    expect(bal.amountDecimal).toBe("1234.567890123456");
    expect(bal.amountRaw).toBeNull();
  });
});

describe("asset + migration mapping (tax-critical facts)", () => {
  it("maps USDT-ERC20 as evm-minor, 6 decimals, verified", () => {
    const a = toCryptoAssetRecord({
      id: "usdt-eth",
      symbol: "USDT",
      name: "Tether (Ethereum)",
      chain: "ethereum",
      amount_model: "evm-minor",
      decimals: 6,
      decimals_source: "verified",
      native: false,
      contract: "0xdac17f958d2ee523a2206206994597c13d831ec7",
      issuer: null,
      currency_code: null,
      denom: null,
      migrates_to_asset_id: null,
      active: true,
    });
    expect(a.amountModel).toBe("evm-minor");
    expect(a.decimals).toBe(6);
    expect(a.decimalsSource).toBe("verified");
  });

  it("maps SOLO as xrpl-issued (decimals null) migrating to tx", () => {
    const a = toCryptoAssetRecord({
      id: "solo",
      symbol: "SOLO",
      name: "Sologenic",
      chain: "xrpl",
      amount_model: "xrpl-issued",
      decimals: null,
      decimals_source: "issued-precision",
      native: false,
      contract: null,
      issuer: "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz",
      currency_code: "534F4C4F00000000000000000000000000000000",
      denom: null,
      migrates_to_asset_id: "tx",
      active: true,
    });
    expect(a.amountModel).toBe("xrpl-issued");
    expect(a.decimals).toBeNull();
    expect(a.migratesToAssetId).toBe("tx");
  });

  it("keeps a migration ratio null until officially verified", () => {
    const m = toCryptoAssetMigrationRecord({
      id: "m-1",
      from_asset_id: "solo",
      to_asset_id: "tx",
      ratio_numerator: null,
      ratio_denominator: null,
      conversion_kind: "manual",
      effective_at: null,
      notes: "pending",
    });
    expect(m.ratioNumerator).toBeNull();
    expect(m.ratioDenominator).toBeNull();
    expect(m.conversionKind).toBe("manual");
  });
});

describe("Flare LP transaction (primary DeFi venue) maps richly", () => {
  it("preserves lp_add type, direction, exact raw amount and fee", () => {
    const tx = toCryptoTransactionRecord({
      id: "t-1",
      wallet_id: "w-1",
      asset_id: "flr",
      chain: "flare",
      tx_hash: "0xabc",
      event_index: 2,
      direction: "out",
      tx_type: "lp_add",
      amount_raw: "500000000000000000000",
      amount_decimal: null,
      decimals_at_event: 18,
      fee_raw: "21000000000000000",
      fee_asset_id: "flr",
      usd_value_cents: 100000,
      price_asof: "2026-02-01T12:00:00Z",
      counterparty: "0xpool",
      block_number: 12345678,
      block_time: "2026-02-01T12:00:00Z",
      migration_id: null,
    });
    expect(tx.chain).toBe("flare");
    expect(tx.txType).toBe("lp_add");
    expect(tx.direction).toBe("out");
    expect(tx.amountRaw).toBe("500000000000000000000");
    expect(tx.feeRaw).toBe("21000000000000000");
  });
});

describe("read-limit guards", () => {
  it("caps an oversized limit at the max", () => {
    expect(clampLimit(999999, CRYPTO_TXN_READ_LIMIT)).toBe(CRYPTO_TXN_READ_LIMIT);
    expect(clampLimit(999999, CRYPTO_PRICE_READ_LIMIT)).toBe(CRYPTO_PRICE_READ_LIMIT);
  });

  it("falls back to the cap for zero/negative and floors fractional", () => {
    expect(clampLimit(0, CRYPTO_TXN_READ_LIMIT)).toBe(CRYPTO_TXN_READ_LIMIT);
    expect(clampLimit(-5, CRYPTO_TXN_READ_LIMIT)).toBe(CRYPTO_TXN_READ_LIMIT);
    expect(clampLimit(50.9, CRYPTO_TXN_READ_LIMIT)).toBe(50);
  });

  it("trims ids and treats null as empty", () => {
    expect(cleanId("  abc  ")).toBe("abc");
    expect(cleanId(null)).toBe("");
  });
});
