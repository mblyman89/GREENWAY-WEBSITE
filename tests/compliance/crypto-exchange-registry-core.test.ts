import { describe, it, expect } from "vitest";
import {
  __runCryptoExchangeRegistryCoreTests,
  buildExchangeRegistry,
  lookupExchange,
  isExchangeOrigin,
  exchangeAddressList,
  normalizeAddress,
  SEED_EXCHANGE_ADDRESSES,
  EXCHANGE_LABELS,
} from "../../src/lib/crypto/crypto-exchange-registry-core";

/**
 * R1-G2 — the exchange-address registry that lets the Origin Trace recognize
 * when a coin came straight from Coinbase / Bitrue / Binance. Seeded ONLY with
 * publicly-labeled (verifiable) Coinbase addresses; everything else is
 * owner-labeled. Never invents an address.
 */

describe("crypto-exchange-registry-core embedded self-tests", () => {
  it("passes all pure self-tests", () => {
    expect(() => __runCryptoExchangeRegistryCoreTests()).not.toThrow();
  });
});

describe("never-guess seed policy", () => {
  it("seeds only verified, publicly-labeled Coinbase addresses", () => {
    expect(SEED_EXCHANGE_ADDRESSES.length).toBeGreaterThan(0);
    for (const e of SEED_EXCHANGE_ADDRESSES) {
      expect(e.source).toBe("verified_known");
      expect(e.exchange).toBe("coinbase");
      // stored lower-cased, and looks like an EVM address
      expect(e.address).toBe(e.address.toLowerCase());
      expect(e.address).toMatch(/^0x[0-9a-f]{40}$/);
    }
  });

  it("ships NO seeded Bitrue or Binance addresses (owner-only)", () => {
    const seededExchanges = new Set(SEED_EXCHANGE_ADDRESSES.map((e) => e.exchange));
    expect(seededExchanges.has("binance")).toBe(false);
    expect(seededExchanges.has("bitrue")).toBe(false);
  });

  it("covers all three of Michael's exchanges as labels", () => {
    expect([...EXCHANGE_LABELS].sort()).toEqual(["binance", "bitrue", "coinbase"]);
  });
});

describe("matching", () => {
  const reg = buildExchangeRegistry();

  it("matches a seeded address case-insensitively", () => {
    const seeded = SEED_EXCHANGE_ADDRESSES[0].address;
    expect(isExchangeOrigin(reg, seeded.toUpperCase())).toBe(true);
    expect(lookupExchange(reg, seeded)!.exchange).toBe("coinbase");
  });

  it("does not match unknown / blank / null", () => {
    expect(isExchangeOrigin(reg, "0x0000000000000000000000000000000000000000")).toBe(false);
    expect(isExchangeOrigin(reg, "")).toBe(false);
    expect(isExchangeOrigin(reg, null)).toBe(false);
  });

  it("feeds a lower-cased address list into the trace", () => {
    const list = exchangeAddressList(reg);
    expect(list.length).toBe(SEED_EXCHANGE_ADDRESSES.length);
    for (const a of list) expect(a).toBe(a.toLowerCase());
  });
});

describe("owner-labeled additions", () => {
  it("adds a Binance address Michael supplies and drops blanks", () => {
    const reg = buildExchangeRegistry([
      { address: "0xAbC0000000000000000000000000000000000001", chain: "ethereum", exchange: "binance", source: "owner_labeled" },
      { address: "   ", chain: "ethereum", exchange: "bitrue", source: "owner_labeled" },
    ]);
    expect(isExchangeOrigin(reg, "0xabc0000000000000000000000000000000000001")).toBe(true);
    expect(lookupExchange(reg, "0xabc0000000000000000000000000000000000001")!.exchange).toBe("binance");
    expect(reg.entries.length).toBe(SEED_EXCHANGE_ADDRESSES.length + 1);
  });

  it("lets an owner label override a seeded label on conflict", () => {
    const seeded = SEED_EXCHANGE_ADDRESSES[0].address;
    const reg = buildExchangeRegistry([
      { address: seeded, chain: "ethereum", exchange: "binance", source: "owner_labeled" },
    ]);
    const hit = lookupExchange(reg, seeded)!;
    expect(hit.source).toBe("owner_labeled");
    expect(hit.exchange).toBe("binance");
    expect(reg.entries.length).toBe(SEED_EXCHANGE_ADDRESSES.length);
  });
});

describe("normalizeAddress", () => {
  it("trims and lowercases", () => {
    expect(normalizeAddress("  0xDeAdBeEf ")).toBe("0xdeadbeef");
    expect(normalizeAddress(null)).toBe("");
  });
});
