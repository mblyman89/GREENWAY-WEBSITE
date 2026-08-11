/**
 * C4 — XRPL mappers (the tax-truth engine for the XRP Ledger connector).
 *
 * Exercises the embedded self-tests plus targeted assertions on the properties
 * that keep Michael's crypto taxes bulletproof:
 *   - The real amount moved is read from transaction METADATA (AffectedNodes),
 *     not the top-level Amount — so partial payments and rippling can't lie.
 *   - Trust-line (issued-token) deltas are computed from the tracked account's
 *     PERSPECTIVE (low vs. high side), with the sign flipped correctly.
 *   - The network fee is attributed to the sender exactly once, and a failed
 *     transaction still records the fee it cost.
 *   - Every amount is exact integer drops / decimal strings — never a float.
 *   - Ripple-epoch timestamps convert to the correct UTC instant.
 */
import { describe, it, expect } from "vitest";
import {
  __runXrplMapCoreTests,
  rippleTimeToIso,
  decodeCurrencyCode,
  resolveXrplIssuedAssetId,
  parseXrplAmount,
  subtractDecimalStrings,
  computeAccountDeltas,
  mapAccountTx,
  mapAccountInfoBalance,
  mapTrustLineBalances,
  directionOf,
  RIPPLE_EPOCH_OFFSET_SECONDS,
  type XrplTxEnvelope,
} from "../../src/lib/crypto/xrpl/xrpl-map-core";

describe("xrpl-map-core embedded self-test", () => {
  it("passes every mapper + tax-truth assertion", () => {
    expect(() => __runXrplMapCoreTests()).not.toThrow();
  });
});

describe("Ripple epoch (verified constant)", () => {
  it("uses the first-party offset and converts correctly", () => {
    expect(RIPPLE_EPOCH_OFFSET_SECONDS).toBe(946684800);
    expect(rippleTimeToIso(0)).toBe("2000-01-01T00:00:00.000Z");
    // Verified fixture from xrpl.org account_tx example.
    expect(rippleTimeToIso(811446652)).toBe("2025-09-17T17:50:52.000Z");
  });
});

describe("currency-code decoding (3-char vs 40-hex)", () => {
  it("keeps standard codes and decodes ASCII hex to a symbol", () => {
    expect(decodeCurrencyCode("USD")).toBe("USD");
    expect(decodeCurrencyCode("534F4C4F00000000000000000000000000000000")).toBe("SOLO");
  });
  it("never guesses a non-ASCII hex blob (falls back to hex)", () => {
    const blob = "0158415500000000C1F76FF6ECB0BAC600000000";
    expect(decodeCurrencyCode(blob)).toBe(blob);
  });
});

describe("asset resolution requires issuer + currency match", () => {
  it("resolves SOLO only with the correct issuer", () => {
    expect(resolveXrplIssuedAssetId("SOLO", "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz")).toBe("solo");
    expect(resolveXrplIssuedAssetId("SOLO", "rNotTheSoloIssuerXXXXXXXXXXXXXXXX")).toBeNull();
    expect(resolveXrplIssuedAssetId("USD", "rSomeGateway")).toBeNull();
  });
});

describe("exact amount math (never floats)", () => {
  it("parses drops and issued tokens exactly", () => {
    const xrp = parseXrplAmount("13100000");
    expect(xrp).toEqual({ kind: "xrp", drops: "13100000" });
    const tok = parseXrplAmount({
      value: "153.750",
      currency: "SOLO",
      issuer: "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz",
    });
    expect(tok.kind).toBe("token");
    if (tok.kind === "token") {
      expect(tok.value).toBe("153.75");
      expect(tok.assetId).toBe("solo");
    }
  });
  it("subtracts decimal strings without precision loss", () => {
    expect(subtractDecimalStrings("10.5", "0.25")).toBe("10.25");
    expect(subtractDecimalStrings("0.000000000001", "0")).toBe("0.000000000001");
    expect(subtractDecimalStrings("5", "5")).toBe("0");
    expect(subtractDecimalStrings("1", "3")).toBe("-2");
  });
});

describe("balances from account_info + account_lines", () => {
  it("maps XRP balance as exact drops", () => {
    const b = mapAccountInfoBalance({ Balance: "24799991" });
    expect(b).toEqual({
      assetId: "xrp",
      amountRaw: "24799991",
      amountDecimal: null,
      decimalsAtRead: 6,
    });
  });
  it("keeps non-zero trust lines, drops zero ones, preserves exactness", () => {
    const bals = mapTrustLineBalances([
      { account: "rsoLo2S1kiGeCcn6hCUXVrCpGMWLrRrLZz", balance: "42.5", currency: "SOLO" },
      { account: "rZeroIssuer", balance: "0", currency: "USD" },
      { account: "rOtherIssuer", balance: "-1.25", currency: "EUR" },
    ]);
    expect(bals).toHaveLength(2);
    expect(bals[0].assetId).toBe("solo");
    expect(bals[0].amountDecimal).toBe("42.5");
    expect(bals[1].assetId).toBeNull();
    expect(bals[1].amountDecimal).toBe("-1.25");
  });
});

describe("metadata is the source of tax truth (partial-payment proof)", () => {
  it("uses AffectedNodes deltas, not the top-level Amount", () => {
    // Top-level Amount says 5,000,000 drops, but the metadata shows only
    // 1,000,000 actually reached the tracked wallet (a partial payment). The
    // mapper MUST record the real 1,000,000 — never the inflated Amount.
    const env: XrplTxEnvelope = {
      meta: {
        TransactionResult: "tesSUCCESS",
        delivered_amount: "1000000",
        AffectedNodes: [
          {
            ModifiedNode: {
              LedgerEntryType: "AccountRoot",
              FinalFields: { Account: "rMe", Balance: "2000000" },
              PreviousFields: { Balance: "1000000" },
            },
          },
        ],
      },
      tx_json: {
        TransactionType: "Payment",
        Account: "rSender",
        Destination: "rMe",
        Amount: "5000000",
        Fee: "10",
        date: 800000000,
      },
      hash: "PARTIAL1",
      ledger_index: 42,
    };
    const legs = mapAccountTx("rMe", env);
    expect(legs).toHaveLength(1);
    expect(legs[0].amountRaw).toBe("1000000"); // the REAL delivered value
    expect(legs[0].direction).toBe("in");
    expect(legs[0].feeRaw).toBeNull(); // not the sender → no fee attributed
    expect(legs[0].txType).toBe("transfer");
  });
});

describe("fee attribution", () => {
  it("attaches the fee to the sender exactly once and records failed-tx fees", () => {
    const failEnv: XrplTxEnvelope = {
      meta: {
        TransactionResult: "tecUNFUNDED_PAYMENT",
        AffectedNodes: [
          {
            ModifiedNode: {
              LedgerEntryType: "AccountRoot",
              FinalFields: { Account: "rMe", Balance: "999990" },
              PreviousFields: { Balance: "1000000" },
            },
          },
        ],
      },
      tx_json: {
        TransactionType: "Payment",
        Account: "rMe",
        Destination: "rDest",
        Amount: "50000000",
        Fee: "10",
        date: 800000000,
      },
      hash: "FAIL1",
      ledger_index: 7,
    };
    const legs = mapAccountTx("rMe", failEnv);
    expect(legs).toHaveLength(1);
    expect(legs[0].success).toBe(false);
    expect(legs[0].amountRaw).toBe("-10");
    expect(legs[0].feeRaw).toBe("10");
    expect(legs[0].txType).toBe("fee");
  });
});

describe("direction helper", () => {
  it("classifies signed amounts", () => {
    expect(directionOf("-1")).toBe("out");
    expect(directionOf("2")).toBe("in");
    expect(directionOf("0")).toBe("self");
  });
});

describe("computeAccountDeltas handles the tracked account only", () => {
  it("ignores other accounts' AccountRoot changes", () => {
    const deltas = computeAccountDeltas("rMe", {
      TransactionResult: "tesSUCCESS",
      AffectedNodes: [
        {
          ModifiedNode: {
            LedgerEntryType: "AccountRoot",
            FinalFields: { Account: "rSomeoneElse", Balance: "1" },
            PreviousFields: { Balance: "1000000" },
          },
        },
      ],
    });
    expect(deltas).toHaveLength(0);
  });
});
