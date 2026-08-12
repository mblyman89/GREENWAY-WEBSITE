import { describe, it, expect } from "vitest";
import {
  __runCryptoOriginTraceCoreTests,
  traceOrigins,
  normalizeAddress,
  type InboundReceipt,
} from "../../src/lib/crypto/crypto-origin-trace-core";

/**
 * R1-G1 — the pure backwards-trace graph core. It structures a coin's lineage
 * back toward its exchange/owner origin and classifies each receipt's
 * basisSource. It NEVER assigns a dollar amount and NEVER trusts an
 * unconfirmed outside wallet — those are surfaced for confirmation.
 */

function rcpt(over: Partial<InboundReceipt> & { id: string }): InboundReceipt {
  return {
    id: over.id,
    txHash: over.txHash ?? `0xhash-${over.id}`,
    chain: over.chain ?? "flare",
    toAddress: over.toAddress ?? "0xMine",
    fromAddress: "fromAddress" in over ? (over.fromAddress ?? null) : "0xParent",
    receivedAtMs: "receivedAtMs" in over ? (over.receivedAtMs ?? null) : Date.UTC(2022, 0, 15),
    amountDecimal: "amountDecimal" in over ? (over.amountDecimal ?? null) : "10",
    ownerProvidedBasis: over.ownerProvidedBasis,
  };
}

describe("crypto-origin-trace-core embedded self-tests", () => {
  it("passes all pure self-tests", () => {
    expect(() => __runCryptoOriginTraceCoreTests()).not.toThrow();
  });
});

describe("address normalization", () => {
  it("trims and lowercases; matches are case-insensitive", () => {
    expect(normalizeAddress("  0xAbCdEf ")).toBe("0xabcdef");
    const r = traceOrigins({
      receipts: [rcpt({ id: "x", fromAddress: "0xEXCHANGE" })],
      ownerAddresses: [],
      exchangeAddresses: ["0xexchange"],
    });
    expect(r.lineages[0].basisSource).toBe("exchange_origin");
  });
});

describe("classification precedence (owner-provided wins)", () => {
  it("owner-provided basis beats even an exchange match", () => {
    const r = traceOrigins({
      receipts: [rcpt({ id: "o", fromAddress: "0xexch", ownerProvidedBasis: true })],
      ownerAddresses: [],
      exchangeAddresses: ["0xexch"],
    });
    expect(r.lineages[0].basisSource).toBe("owner_provided");
    expect(r.lineages[0].needsPricing).toBe(false);
    expect(r.lineages[0].needsOwnershipConfirmation).toBe(false);
  });
});

describe("never guesses", () => {
  it("tags an outside wallet unknown and surfaces it for confirmation", () => {
    const r = traceOrigins({
      receipts: [rcpt({ id: "u", fromAddress: "0xStranger" })],
      ownerAddresses: [],
      exchangeAddresses: [],
    });
    expect(r.lineages[0].basisSource).toBe("unknown");
    expect(r.lineages[0].needsOwnershipConfirmation).toBe(true);
    expect(r.discoveredWallets).toHaveLength(1);
    expect(r.discoveredWallets[0].address).toBe("0xstranger");
  });

  it("never assigns a dollar amount anywhere in the result", () => {
    const r = traceOrigins({
      receipts: [
        rcpt({ id: "a", fromAddress: "0xexch" }),
        rcpt({ id: "b", fromAddress: "0xStranger" }),
      ],
      ownerAddresses: [],
      exchangeAddresses: ["0xexch"],
    });
    // The pure structural core exposes no monetary FIELDS. (Notes are plain
    // English and may contain the word "price"; we check the keys, not prose.)
    const keys = new Set<string>();
    for (const lin of r.lineages) for (const k of Object.keys(lin)) keys.add(k);
    for (const w of r.discoveredWallets) for (const k of Object.keys(w)) keys.add(k);
    for (const k of Object.keys(r)) keys.add(k);
    for (const k of keys) {
      expect(k.toLowerCase()).not.toMatch(/cents|usd|dollar|basiscents|proceeds/);
    }
  });
});

describe("counts and ordering", () => {
  it("rolls up pricing / ownership / resolved counts", () => {
    const r = traceOrigins({
      receipts: [
        rcpt({ id: "e", fromAddress: "0xexch" }), // exchange -> needs pricing, resolved
        rcpt({ id: "o", fromAddress: "0xmine2" }), // owner wallet -> resolved
        rcpt({ id: "u", fromAddress: "0xStranger" }), // unknown -> needs ownership
        rcpt({ id: "n", fromAddress: null }), // no sender -> unknown, needs manual
      ],
      ownerAddresses: ["0xmine2"],
      exchangeAddresses: ["0xexch"],
    });
    expect(r.needsPricingCount).toBe(1);
    expect(r.needsOwnershipCount).toBe(2); // stranger + no-sender
    expect(r.resolvedCount).toBe(2); // exchange + owner self-transfer
  });

  it("orders discovered wallets by reference count, descending", () => {
    const r = traceOrigins({
      receipts: [
        rcpt({ id: "1", fromAddress: "0xBravo" }),
        rcpt({ id: "2", fromAddress: "0xAlpha" }),
        rcpt({ id: "3", fromAddress: "0xAlpha" }),
      ],
      ownerAddresses: [],
      exchangeAddresses: [],
    });
    expect(r.discoveredWallets[0].address).toBe("0xalpha");
    expect(r.discoveredWallets[0].referenceCount).toBe(2);
    expect(r.discoveredWallets[1].address).toBe("0xbravo");
  });
});
