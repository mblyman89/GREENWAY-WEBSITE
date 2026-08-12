/**
 * R1-F2 — Confirmed own-wallet transfer store (pure shape + logic).
 *
 * Verifies the persistence layer that turns a suggested/manual OUT+IN pair into
 * a durable, non-taxable transfer decision the R1-F1 relocation engine consumes:
 *   - row <-> record mapping (confidence clamp, empty gas -> null),
 *   - the validated upsert-row builder (distinct wallets, exact-decimal amount,
 *     rejects zero/garbage — never store a float or a guess),
 *   - the bridge that feeds only CONFIRMED rows into the relocation engine.
 * The module's embedded self-test suite runs here too so the two stay in step.
 */
import { describe, it, expect } from "vitest";
import {
  __runCryptoTransferStoreCoreTests,
  toTransferMatchRecord,
  buildTransferMatchUpsertRow,
  confirmedMatchesToRelocations,
  type CryptoTransferMatchRecord,
} from "../../src/lib/crypto/crypto-transfer-store-core";
import { quantityToScaled } from "../../src/lib/crypto/crypto-cost-basis-core";

describe("crypto-transfer-store-core (embedded self-tests)", () => {
  it("passes its embedded pure self-test suite", () => {
    expect(() => __runCryptoTransferStoreCoreTests()).not.toThrow();
  });
});

describe("buildTransferMatchUpsertRow — validation guard-rails", () => {
  it("builds a valid confirmed transfer, keeping the exact decimal amount", () => {
    const b = buildTransferMatchUpsertRow({
      outTxId: "out1",
      sourceWalletId: "hot",
      destWalletId: "ledger",
      assetId: "flr",
      movedAmount: "12.500000000000000000",
      gasAmount: "0.01",
    });
    expect(b.ok).toBe(true);
    if (b.ok) {
      expect(b.row.moved_amount).toBe("12.500000000000000000");
      expect(b.row.gas_amount).toBe("0.01");
      expect(b.row.status).toBe("confirmed");
    }
  });

  it("rejects a transfer to the same wallet", () => {
    const b = buildTransferMatchUpsertRow({
      outTxId: "o", sourceWalletId: "w", destWalletId: "w", movedAmount: "1",
    });
    expect(b.ok).toBe(false);
  });

  it("rejects a non-numeric amount (never store a guess)", () => {
    const b = buildTransferMatchUpsertRow({
      outTxId: "o", sourceWalletId: "a", destWalletId: "b", movedAmount: "abc",
    });
    expect(b.ok).toBe(false);
  });

  it("preserves a reject decision", () => {
    const b = buildTransferMatchUpsertRow({
      outTxId: "o", sourceWalletId: "a", destWalletId: "b", movedAmount: "1", status: "rejected",
    });
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.row.status).toBe("rejected");
  });
});

describe("toTransferMatchRecord — mapping", () => {
  it("clamps confidence and nulls empty gas", () => {
    const rec = toTransferMatchRecord({
      id: "m", out_tx_id: "o", in_tx_id: null, source_wallet_id: "a", dest_wallet_id: "b",
      asset_id: null, moved_amount: "1", gas_amount: "", status: "confirmed", confidence: 999,
      source: "manual", note: null, confirmed_by: null, confirmed_at: null,
    });
    expect(rec.confidence).toBe(100);
    expect(rec.gasAmount).toBeNull();
    expect(rec.source).toBe("manual");
  });
});

describe("confirmedMatchesToRelocations — bridge to R1-F1", () => {
  const matches: CryptoTransferMatchRecord[] = [
    {
      id: "c1", outTxId: "out1", inTxId: "in1", sourceWalletId: "hot", destWalletId: "ledger",
      assetId: "flr", movedAmount: "2", gasAmount: "0.5", status: "confirmed", confidence: 90,
      source: "suggested", note: null, confirmedBy: null, confirmedAt: null,
    },
    {
      id: "c2", outTxId: "out2", inTxId: null, sourceWalletId: "hot", destWalletId: "ledger",
      assetId: "flr", movedAmount: "9", gasAmount: null, status: "rejected", confidence: 10,
      source: "suggested", note: null, confirmedBy: null, confirmedAt: null,
    },
  ];

  it("feeds only confirmed rows, scaling amounts and mapping wallets/time", () => {
    const relocs = confirmedMatchesToRelocations(matches, { outTimeMsByTxId: { out1: 1234 } });
    expect(relocs).toHaveLength(1);
    expect(relocs[0].id).toBe("c1");
    expect(relocs[0].transferAtMs).toBe(1234);
    expect(relocs[0].movedQuantityScaled === quantityToScaled("2")).toBe(true);
    expect(relocs[0].gasQuantityScaled === quantityToScaled("0.5")).toBe(true);
  });

  it("filters by asset when requested", () => {
    const relocs = confirmedMatchesToRelocations(matches, { assetId: "xrp" });
    expect(relocs).toHaveLength(0);
  });
});
