/**
 * R1-E — Crypto Classify screen view-model (pure).
 *
 * Locks down the logic that turns raw transactions + their saved classifications
 * into ready-to-render rows:
 *   • the primitive is derived from direction + swap flag,
 *   • an unclassified row falls back to the CONSERVATIVE default (never income)
 *     and is flagged "needs review",
 *   • an owner's stored tag wins and counts as classified (with its label/note),
 *   • a stored tag that's invalid for the row's primitive is ignored → default,
 *   • the dropdown options are exactly the tags valid for that primitive,
 *   • progress text summarizes how much review is left.
 * The embedded self-test suite runs here too so the two stay in lockstep.
 */
import { describe, it, expect } from "vitest";
import {
  __runCryptoClassifyViewCoreTests,
  buildClassifyView,
  primitiveLabel,
  type ClassifyTxInput,
} from "../../src/lib/crypto/crypto-classify-view-core";

function makeTx(p: Partial<ClassifyTxInput>): ClassifyTxInput {
  return {
    id: p.id ?? "tx",
    assetId: p.assetId ?? "a",
    direction: p.direction ?? "in",
    isSwap: p.isSwap ?? false,
    amountDisplay: p.amountDisplay ?? "1",
    assetLabel: p.assetLabel ?? "FLR",
    whenDisplay: p.whenDisplay ?? "2026-01-01",
    txRef: p.txRef ?? "0xabc",
  };
}

describe("crypto-classify-view-core (R1-E)", () => {
  it("passes its embedded self-tests", () => {
    expect(() => __runCryptoClassifyViewCoreTests()).not.toThrow();
  });

  it("labels every primitive in plain English", () => {
    expect(primitiveLabel("deposit")).toBe("Received");
    expect(primitiveLabel("withdrawal")).toBe("Sent");
    expect(primitiveLabel("trade")).toBe("Trade / swap");
    expect(primitiveLabel("transfer")).toBe("Wallet transfer");
  });

  it("defaults a received coin to Bought and flags it for review (never income)", () => {
    const v = buildClassifyView([makeTx({ id: "t1", direction: "in" })], new Map());
    expect(v.rows[0].primitive).toBe("deposit");
    expect(v.rows[0].effectiveTagKey).toBe("buy");
    expect(v.rows[0].isClassified).toBe(false);
    expect(v.classifiedCount).toBe(0);
    expect(v.unclassifiedCount).toBe(1);
    expect(v.progressText).toContain("need review");
  });

  it("honors an owner's valid tag and counts it as classified", () => {
    const v = buildClassifyView(
      [makeTx({ id: "t2", direction: "in" })],
      new Map([["t2", "reward_ftso"]]),
    );
    expect(v.rows[0].effectiveTagKey).toBe("reward_ftso");
    expect(v.rows[0].isClassified).toBe(true);
    expect(v.rows[0].effectiveTagLabel.length).toBeGreaterThan(0);
    expect(v.rows[0].taxNote.length).toBeGreaterThan(10);
    expect(v.classifiedCount).toBe(1);
    expect(v.progressText).toContain("all done");
  });

  it("ignores a stored tag that is invalid for the row's primitive", () => {
    // gift_sent is a withdrawal-only tag; it must NOT stick to a deposit.
    const v = buildClassifyView(
      [makeTx({ id: "t3", direction: "in" })],
      new Map([["t3", "gift_sent"]]),
    );
    expect(v.rows[0].effectiveTagKey).toBe("buy");
    expect(v.rows[0].isClassified).toBe(false);
  });

  it("offers only sensible options for the primitive", () => {
    const v = buildClassifyView([makeTx({ id: "d", direction: "in" })], new Map());
    const keys = v.rows[0].options.map((o) => o.key);
    expect(keys).toContain("buy");
    expect(keys).toContain("reward_ftso");
    expect(keys).not.toContain("gift_sent");
    // every option carries a plain-English note
    for (const o of v.rows[0].options) {
      expect(typeof o.note).toBe("string");
    }
  });

  it("derives primitive from direction + swap flag", () => {
    const v = buildClassifyView(
      [
        makeTx({ id: "swap", direction: "in", isSwap: true }),
        makeTx({ id: "out", direction: "out" }),
        makeTx({ id: "self", direction: "self" }),
      ],
      new Map(),
    );
    expect(v.rows[0].primitive).toBe("trade");
    expect(v.rows[0].effectiveTagKey).toBe("trade");
    expect(v.rows[1].primitive).toBe("withdrawal");
    expect(v.rows[1].effectiveTagKey).toBe("sell");
    expect(v.rows[2].primitive).toBe("transfer");
    expect(v.rows[2].effectiveTagKey).toBe("transfer");
  });

  it("gives a friendly message when there is nothing to classify", () => {
    const v = buildClassifyView([], new Map());
    expect(v.total).toBe(0);
    expect(v.rows).toHaveLength(0);
    expect(v.progressText).toBe("No transactions to classify yet.");
  });

  it("mixes classified + unclassified into an accurate progress count", () => {
    const v = buildClassifyView(
      [
        makeTx({ id: "a", direction: "in" }),
        makeTx({ id: "b", direction: "out" }),
        makeTx({ id: "c", direction: "in" }),
      ],
      new Map([["a", "reward_staking"]]),
    );
    expect(v.total).toBe(3);
    expect(v.classifiedCount).toBe(1);
    expect(v.unclassifiedCount).toBe(2);
    expect(v.progressText).toContain("1 of 3 classified");
    expect(v.progressText).toContain("2 need review");
  });
});
