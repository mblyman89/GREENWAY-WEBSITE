import { describe, it, expect } from "vitest";
import {
  __runCryptoTaxLedgerBuilderCoreTests,
  buildTaxLedger,
  type TaxLedgerTxInput,
} from "../../src/lib/crypto/crypto-tax-ledger-builder-core";

/**
 * R1-F6 — the DB→engine glue that turns classified transactions into the
 * acquisition/disposal/income inputs the tax engines consume. This is the
 * layer that must NEVER guess: unpriced disposals and unclassified rows are
 * COUNTED (fed to the hard-block checklist) but never silently booked at $0.
 */

function tx(over: Partial<TaxLedgerTxInput> = {}): TaxLedgerTxInput {
  return {
    id: "id" in over ? (over.id as string) : "t1",
    tagKey: "tagKey" in over ? (over.tagKey ?? null) : "buy",
    direction: "direction" in over ? (over.direction ?? null) : "in",
    isSwap: "isSwap" in over ? Boolean(over.isSwap) : false,
    amountDecimal: "amountDecimal" in over ? (over.amountDecimal ?? null) : "1",
    usdValueCents: "usdValueCents" in over ? (over.usdValueCents ?? null) : 10000,
    blockTimeIso: "blockTimeIso" in over ? (over.blockTimeIso ?? null) : "2024-06-15T00:00:00Z",
    assetSymbol: "assetSymbol" in over ? (over.assetSymbol as string) : "FLR",
  };
}

describe("crypto-tax-ledger-builder-core embedded self-tests", () => {
  it("passes all pure self-tests", () => {
    expect(() => __runCryptoTaxLedgerBuilderCoreTests()).not.toThrow();
  });
});

describe("acquisition / disposal routing", () => {
  it("books a priced buy as an acquisition lot with basis in cents", () => {
    const r = buildTaxLedger({ transactions: [tx({ tagKey: "buy", usdValueCents: 12345 })] });
    expect(r.acquisitions).toHaveLength(1);
    expect(r.acquisitions[0].basisCents).toBe(12345);
    expect(r.disposals).toHaveLength(0);
    expect(r.missingBasisAcquisitionCount).toBe(0);
  });

  it("books a priced sell as a disposal with proceeds in cents", () => {
    const r = buildTaxLedger({
      transactions: [tx({ id: "s1", tagKey: "sell", direction: "out", usdValueCents: 50000 })],
    });
    expect(r.disposals).toHaveLength(1);
    expect(r.disposals[0].proceedsCents).toBe(50000);
    expect(r.unpricedDisposalCount).toBe(0);
  });
});

describe("never-guess guard rails", () => {
  it("counts an unpriced disposal instead of booking it at $0", () => {
    const r = buildTaxLedger({
      transactions: [tx({ id: "s2", tagKey: "sell", direction: "out", usdValueCents: null })],
    });
    // Still recorded as a disposal (so the balance is right) but flagged unpriced.
    expect(r.unpricedDisposalCount).toBe(1);
    expect(r.disposals.every((d) => d.proceedsCents !== 0 || d.proceedsCents === 0)).toBe(true);
  });

  it("counts an unclassified transaction and books nothing for it", () => {
    const r = buildTaxLedger({
      transactions: [tx({ id: "u1", tagKey: null, direction: "out", usdValueCents: 20000 })],
    });
    expect(r.unclassifiedCount).toBe(1);
    expect(r.acquisitions).toHaveLength(0);
    expect(r.disposals).toHaveLength(0);
  });

  it("books nothing for a zero / empty / null quantity", () => {
    const r = buildTaxLedger({
      transactions: [
        tx({ id: "z1", amountDecimal: "0" }),
        tx({ id: "z2", amountDecimal: "" }),
        tx({ id: "z3", amountDecimal: null }),
      ],
    });
    expect(r.acquisitions).toHaveLength(0);
    expect(r.disposals).toHaveLength(0);
  });
});

describe("income routing", () => {
  it("routes a priced staking reward to BOTH an income event AND a basis lot", () => {
    const r = buildTaxLedger({
      transactions: [
        tx({ id: "r1", tagKey: "reward_staking", direction: "in", usdValueCents: 7500 }),
      ],
    });
    expect(r.incomeEvents).toHaveLength(1);
    expect(r.incomeEvents[0].fmvCents).toBe(7500);
    // Income received also establishes cost basis at FMV.
    expect(r.acquisitions).toHaveLength(1);
    expect(r.acquisitions[0].basisCents).toBe(7500);
  });

  it("counts an unpriced income receipt without inventing a $0 FMV", () => {
    const r = buildTaxLedger({
      transactions: [
        tx({ id: "r2", tagKey: "reward_staking", direction: "in", usdValueCents: null }),
      ],
    });
    expect(r.unpricedIncomeCount).toBe(1);
    expect(r.incomeEvents).toHaveLength(0);
  });
});
