/**
 * R1-B — Crypto tax engine, classification persistence (pure shape + logic).
 *
 * Locks down the never-guess behaviour of the store's pure layer:
 *   • row→record mappers coerce bad primitives/sources to safe defaults, trim
 *     notes/counterparties, and treat null booleans sensibly;
 *   • buildClassificationUpsertRow refuses unknown tags, tags invalid on the
 *     primitive, and empty transaction ids (returns null — never garbage);
 *   • the rules-engine matcher ANDs all provided conditions, is case-insensitive
 *     on counterparty substrings, ignores inactive rules, and firstMatchingRule
 *     honours priority order + primitive validity (skips a rule whose tag can't
 *     apply to the transaction's primitive).
 * The embedded self-test suite runs here too so the two stay in lockstep.
 */
import { describe, it, expect } from "vitest";
import {
  __runCryptoClassificationStoreCoreTests,
  toClassificationRecord,
  toRuleRecord,
  buildClassificationUpsertRow,
  matchRuleToTransaction,
  firstMatchingRule,
  type CryptoClassificationRuleRecord,
} from "../../src/lib/crypto/crypto-classification-store-core";
import type { CryptoTransactionRecord } from "../../src/lib/crypto/crypto-store-core";
import type { Chain } from "../../src/lib/crypto/crypto-core";

function tx(p: Partial<CryptoTransactionRecord>): CryptoTransactionRecord {
  return {
    id: p.id ?? "tx",
    walletId: p.walletId ?? "w",
    assetId: p.assetId ?? "a",
    chain: (p.chain ?? "flare") as Chain,
    txHash: p.txHash ?? "0x",
    eventIndex: p.eventIndex ?? 0,
    direction: p.direction ?? "in",
    txType: p.txType ?? "other",
    amountRaw: p.amountRaw ?? "1",
    amountDecimal: p.amountDecimal ?? null,
    decimalsAtEvent: p.decimalsAtEvent ?? 18,
    feeRaw: p.feeRaw ?? null,
    feeAssetId: p.feeAssetId ?? null,
    usdValueCents: p.usdValueCents ?? null,
    priceAsof: p.priceAsof ?? null,
    counterparty: p.counterparty ?? null,
    blockNumber: p.blockNumber ?? null,
    blockTime: p.blockTime ?? null,
    migrationId: p.migrationId ?? null,
  };
}

function rule(p: Partial<CryptoClassificationRuleRecord>): CryptoClassificationRuleRecord {
  return {
    id: p.id ?? "r",
    name: p.name ?? "rule",
    tagKey: p.tagKey ?? "reward_ftso",
    matchChain: p.matchChain ?? null,
    matchDirection: p.matchDirection ?? null,
    matchTxType: p.matchTxType ?? null,
    matchAssetId: p.matchAssetId ?? null,
    matchCounterparty: p.matchCounterparty ?? null,
    priority: p.priority ?? 100,
    active: p.active ?? true,
  };
}

describe("crypto-classification-store-core (R1-B)", () => {
  it("passes its embedded self-tests", () => {
    expect(() => __runCryptoClassificationStoreCoreTests()).not.toThrow();
  });

  it("maps rows and coerces bad values to safe defaults", () => {
    const c = toClassificationRecord({
      id: "c",
      transaction_id: "t",
      primitive: "junk",
      tag_key: "sell",
      note: "   ",
      auto_suggested: null,
      source: "??",
      rule_id: null,
      classified_by: null,
      classified_at: null,
    });
    expect(c.primitive).toBe("deposit");
    expect(c.source).toBe("owner");
    expect(c.note).toBeNull();
    expect(c.autoSuggested).toBe(false);

    const r = toRuleRecord({
      id: "r",
      name: "n",
      tag_key: "reward_ftso",
      match_chain: "flare",
      match_direction: "in",
      match_tx_type: "reward",
      match_asset_id: null,
      match_counterparty: "  0xABC ",
      priority: 3,
      active: null,
    });
    expect(r.matchCounterparty).toBe("0xABC");
    expect(r.active).toBe(true);
    expect(r.priority).toBe(3);
  });

  it("refuses to build nonsense classification rows", () => {
    expect(
      buildClassificationUpsertRow({ transactionId: "t", primitive: "deposit", tagKey: "reward_ftso" }),
    ).not.toBeNull();
    expect(buildClassificationUpsertRow({ transactionId: "t", primitive: "deposit", tagKey: "nope" })).toBeNull();
    expect(
      buildClassificationUpsertRow({ transactionId: "t", primitive: "deposit", tagKey: "gift_sent" }),
    ).toBeNull();
    expect(buildClassificationUpsertRow({ transactionId: "  ", primitive: "deposit", tagKey: "buy" })).toBeNull();
  });

  it("matches rules with AND semantics and ci counterparty", () => {
    const r = rule({ matchChain: "flare", matchDirection: "in", matchTxType: "reward" });
    expect(matchRuleToTransaction(r, tx({ chain: "flare", direction: "in", txType: "reward" }))).toBe(true);
    expect(matchRuleToTransaction(r, tx({ chain: "songbird", direction: "in", txType: "reward" }))).toBe(false);
    expect(matchRuleToTransaction(rule({ active: false, matchChain: "flare" }), tx({ chain: "flare" }))).toBe(false);
    const cp = rule({ tagKey: "sell", matchDirection: "out", matchCounterparty: "0xDEAD" });
    expect(matchRuleToTransaction(cp, tx({ direction: "out", counterparty: "0xdeadBEEF" }))).toBe(true);
    expect(matchRuleToTransaction(cp, tx({ direction: "out", counterparty: "0xfeed" }))).toBe(false);
  });

  it("firstMatchingRule honours priority and primitive validity", () => {
    const rules = [
      rule({ id: "hi", priority: 1, tagKey: "reward_staking", matchChain: "flare", matchDirection: "in" }),
      rule({ id: "lo", priority: 50, tagKey: "reward_ftso", matchChain: "flare", matchDirection: "in" }),
    ];
    const m = firstMatchingRule(rules, tx({ chain: "flare", direction: "in", txType: "reward" }));
    expect(m?.rule.id).toBe("hi");
    expect(m?.primitive).toBe("deposit");
    // gift_sent can't apply to a deposit -> skipped -> null
    expect(firstMatchingRule([rule({ tagKey: "gift_sent", matchDirection: "in" })], tx({ direction: "in" }))).toBeNull();
    // swap => trade primitive
    const sw = firstMatchingRule([rule({ id: "sw", tagKey: "trade", matchTxType: "swap" })], tx({ txType: "swap" }));
    expect(sw?.primitive).toBe("trade");
    expect(firstMatchingRule([], tx({}))).toBeNull();
  });
});
