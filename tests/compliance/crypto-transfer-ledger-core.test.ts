/**
 * R1-F1 — Self-transfer basis carryover engine (pure).
 *
 * Verifies the engine that answers Michael's hot-wallet -> Ledger Stax move:
 * relocating own-wallet transfers carries the ORIGINAL cost basis and
 * acquisition date to the new wallet (non-taxable, $0 gain — IRS FAQ Q81),
 * surfaces missing basis instead of assuming $0, and treats gas paid in the
 * moved asset as a real micro-disposal. The module's embedded self-test suite
 * runs here too so the two stay in lockstep.
 */
import { describe, it, expect } from "vitest";
import {
  __runCryptoTransferLedgerCoreTests,
  relocateTransfers,
  QTY_SCALE,
} from "../../src/lib/crypto/crypto-transfer-ledger-core";

const QTY_ONE = (() => {
  let r = BigInt(1);
  for (let i = 0; i < QTY_SCALE; i += 1) r = r * BigInt(10);
  return r;
})();
const DAY = 86400000;
function scaled(units: number): bigint {
  return QTY_ONE * BigInt(units);
}

describe("crypto-transfer-ledger-core (embedded self-tests)", () => {
  it("passes its embedded pure self-test suite", () => {
    expect(() => __runCryptoTransferLedgerCoreTests()).not.toThrow();
  });
});

describe("relocateTransfers — basis + date carryover", () => {
  it("moves a lot to the destination wallet with $0 gain, original date + basis intact", () => {
    const r = relocateTransfers({
      sourceLots: [
        { id: "L1", quantityScaled: scaled(1), basisCents: 12345, acquiredAtMs: 90 * DAY },
      ],
      transfers: [
        {
          id: "move1",
          sourceWalletId: "hotwallet",
          destWalletId: "ledgerstax",
          movedQuantityScaled: scaled(1),
          transferAtMs: 500 * DAY,
        },
      ],
    });
    expect(r.results).toHaveLength(1);
    expect(r.results[0].realizedGainCents).toBe(0);
    expect(r.allDestinationLots).toHaveLength(1);
    expect(r.allDestinationLots[0].basisCents).toBe(12345);
    expect(r.allDestinationLots[0].acquiredAtMs).toBe(90 * DAY);
    expect(r.hasAnyMissingBasis).toBe(false);
  });

  it("surfaces missing basis when more units are moved than the source has lots for (never $0)", () => {
    const r = relocateTransfers({
      sourceLots: [{ id: "only", quantityScaled: scaled(1), basisCents: 5000, acquiredAtMs: 0 }],
      transfers: [
        {
          id: "m",
          sourceWalletId: "w1",
          destWalletId: "w2",
          movedQuantityScaled: scaled(3),
          transferAtMs: DAY,
        },
      ],
    });
    expect(r.results[0].missingBasisQuantityScaled).toBe(scaled(2));
    expect(r.hasAnyMissingBasis).toBe(true);
  });

  it("treats gas paid in the moved asset as a taxable micro-disposal", () => {
    const r = relocateTransfers({
      sourceLots: [{ id: "g", quantityScaled: scaled(2), basisCents: 20000, acquiredAtMs: 0 }],
      transfers: [
        {
          id: "mg",
          sourceWalletId: "w1",
          destWalletId: "w2",
          movedQuantityScaled: scaled(1),
          gasQuantityScaled: scaled(1),
          gasProceedsCents: 15000,
          transferAtMs: 400 * DAY,
        },
      ],
    });
    const gd = r.results[0].gasDisposal;
    expect(gd).not.toBeNull();
    expect(gd?.realizedGainCents).toBe(5000);
    expect(gd?.holdingPeriod).toBe("long");
    expect(r.results[0].realizedGainCents).toBe(0);
  });

  it("keeps the ORIGINAL acquisition date through a multi-hop A->B->C move", () => {
    const r = relocateTransfers({
      sourceLots: [{ id: "o", quantityScaled: scaled(1), basisCents: 30000, acquiredAtMs: 50 * DAY }],
      transfers: [
        { id: "h1", sourceWalletId: "A", destWalletId: "B", movedQuantityScaled: scaled(1), transferAtMs: 100 * DAY },
        { id: "h2", sourceWalletId: "B", destWalletId: "C", movedQuantityScaled: scaled(1), transferAtMs: 200 * DAY },
      ],
    });
    expect(r.results[1].destinationLots[0].acquiredAtMs).toBe(50 * DAY);
    expect(r.results[1].destinationLots[0].basisCents).toBe(30000);
  });

  it("flags unpriced gas and refuses to invent $0 proceeds", () => {
    const r = relocateTransfers({
      sourceLots: [{ id: "u", quantityScaled: scaled(2), basisCents: 20000, acquiredAtMs: 0 }],
      transfers: [
        {
          id: "mu",
          sourceWalletId: "w1",
          destWalletId: "w2",
          movedQuantityScaled: scaled(1),
          gasQuantityScaled: scaled(1),
          transferAtMs: DAY,
        },
      ],
    });
    expect(r.hasUnpricedGas).toBe(true);
    expect(r.totalGasRealizedGainCents).toBeNull();
    expect(r.results[0].gasDisposal?.realizedGainCents).toBeNull();
  });
});
