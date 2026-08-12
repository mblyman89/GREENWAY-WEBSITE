/**
 * R1-A — Crypto tax engine, pure classification vocabulary.
 *
 * Locks down the "dictionary" every later tax slice reads:
 *   • the four transaction primitives + six tax treatments are stable;
 *   • every tag has a valid treatment, at least one valid primitive, a
 *     plain-English note, and derived booleans consistent with its treatment;
 *   • lookups (getTagDefinition / isKnownTag / tagsForPrimitive) behave;
 *   • tags are only offered on sensible primitives (gift-sent never on deposit);
 *   • direction (in/out/self) + swap flag map to the right primitive;
 *   • conservative defaults never invent taxable income.
 * The embedded self-test suite is also executed here so the two stay in lockstep.
 */
import { describe, it, expect } from "vitest";
import {
  __runCryptoClassificationCoreTests,
  TX_PRIMITIVES,
  TAX_TREATMENTS,
  TAG_DEFINITIONS,
  getTagDefinition,
  isKnownTag,
  tagKeys,
  tagsForPrimitive,
  isTagValidOnPrimitive,
  mapDirectionToPrimitive,
  defaultTagForPrimitive,
} from "../../src/lib/crypto/crypto-classification-core";

describe("crypto-classification-core (R1-A)", () => {
  it("passes its embedded self-tests", () => {
    expect(() => __runCryptoClassificationCoreTests()).not.toThrow();
  });

  it("exposes exactly four primitives and six treatments", () => {
    expect(TX_PRIMITIVES).toEqual(["deposit", "withdrawal", "trade", "transfer"]);
    expect(TAX_TREATMENTS).toHaveLength(6);
  });

  it("has a well-formed definition for every tag", () => {
    const keys = new Set<string>();
    for (const t of TAG_DEFINITIONS) {
      expect(keys.has(t.key)).toBe(false);
      keys.add(t.key);
      expect(TAX_TREATMENTS).toContain(t.taxTreatment);
      expect(t.validOn.length).toBeGreaterThan(0);
      expect(t.plainNote.length).toBeGreaterThan(10);
      expect(t.createsIncome).toBe(t.taxTreatment === "income");
      expect(t.isDisposal).toBe(
        t.taxTreatment === "disposal" || t.taxTreatment === "trade",
      );
    }
    expect(tagKeys()).toEqual([...keys]);
  });

  it("treats rewards/airdrops/interest as income that opens a basis lot", () => {
    for (const k of ["reward_ftso", "reward_staking", "reward_mining", "airdrop", "interest"]) {
      const d = getTagDefinition(k);
      expect(d?.createsIncome).toBe(true);
      expect(d?.isAcquisition).toBe(true);
      expect(d?.isDisposal).toBe(false);
    }
  });

  it("treats sell/spend as taxable disposals but gift-sent/donation as not", () => {
    expect(getTagDefinition("sell")?.isDisposal).toBe(true);
    expect(getTagDefinition("spend")?.isDisposal).toBe(true);
    expect(getTagDefinition("gift_sent")?.isDisposal).toBe(false);
    expect(getTagDefinition("donation")?.isDisposal).toBe(false);
  });

  it("treats a trade as both a disposal and an acquisition", () => {
    const t = getTagDefinition("trade");
    expect(t?.isDisposal).toBe(true);
    expect(t?.isAcquisition).toBe(true);
  });

  it("only offers tags on sensible primitives", () => {
    expect(isTagValidOnPrimitive("reward_ftso", "deposit")).toBe(true);
    expect(isTagValidOnPrimitive("reward_ftso", "withdrawal")).toBe(false);
    expect(isTagValidOnPrimitive("gift_sent", "withdrawal")).toBe(true);
    expect(isTagValidOnPrimitive("gift_sent", "deposit")).toBe(false);
    expect(isTagValidOnPrimitive("transfer", "transfer")).toBe(true);
    expect(isTagValidOnPrimitive("unknown", "deposit")).toBe(false);
    for (const p of TX_PRIMITIVES) {
      const tags = tagsForPrimitive(p);
      expect(tags.length).toBeGreaterThan(0);
      for (const t of tags) expect(t.validOn).toContain(p);
    }
  });

  it("rejects unknown tags and returns null for missing lookups", () => {
    expect(isKnownTag("reward_ftso")).toBe(true);
    expect(isKnownTag("nope")).toBe(false);
    expect(getTagDefinition("nope")).toBeNull();
  });

  it("maps direction + swap flag to the correct primitive", () => {
    expect(mapDirectionToPrimitive("in", false)).toBe("deposit");
    expect(mapDirectionToPrimitive("out", false)).toBe("withdrawal");
    expect(mapDirectionToPrimitive("self", false)).toBe("transfer");
    expect(mapDirectionToPrimitive("in", true)).toBe("trade");
    expect(mapDirectionToPrimitive("self", true)).toBe("trade");
  });

  it("uses conservative defaults that never invent income", () => {
    expect(defaultTagForPrimitive("deposit")).toBe("buy");
    expect(defaultTagForPrimitive("withdrawal")).toBe("sell");
    expect(defaultTagForPrimitive("transfer")).toBe("transfer");
    expect(defaultTagForPrimitive("trade")).toBe("trade");
    for (const p of TX_PRIMITIVES) {
      const k = defaultTagForPrimitive(p);
      expect(isKnownTag(k)).toBe(true);
      expect(isTagValidOnPrimitive(k, p)).toBe(true);
      expect(getTagDefinition(k)?.createsIncome).toBe(false);
    }
  });
});
