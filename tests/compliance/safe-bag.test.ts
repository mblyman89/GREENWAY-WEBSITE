/**
 * tests/compliance/safe-bag.test.ts
 *
 * books-98 — the store safe layer, the numbered bag, and the deposit-shape
 * self-check.
 *
 * Michael asked for three things, and this file is where each one is proved:
 *
 *   A) the bag ID       — so a bank credit is matched to counted cash by
 *                         EVIDENCE (a number on the bag) rather than by a
 *                         convention (whichever day is oldest).
 *   B) the lifecycle    — available -> undeclared -> counted -> deposited, and
 *                         a register that CANNOT close while a bag it created
 *                         is still undeclared.
 *   C) the shape check  — a WARNING, never a refusal, when a deposit lands
 *                         under $10,000 while more than $10,000 is still on
 *                         hand.
 *
 * The lifecycle is stored as a table rather than a chain of ifs, which is what
 * lets the test below walk ALL SIXTEEN status/action combinations instead of
 * the four that happen to be legal. A test that only checks the happy path
 * proves the door opens; it does not prove the other twelve doors are shut.
 */
import { describe, expect, it } from "vitest";

import {
  BAG_STATUSES,
  BAG_ACTIONS,
  applyBagAction,
  blockCloseForUndeclaredBags,
  validateBagAmount,
  normaliseBagNo,
  checkDepositShape,
  CTR_THRESHOLD_MINOR,
  __runSafeBagTests,
  type BagStatus,
} from "@/lib/accounting/safe-bag-core";

describe("books-98 · self-tests", () => {
  it("the core's own self-test passes inside vitest", () => {
    expect(() => __runSafeBagTests()).not.toThrow();
  });
});

describe("books-98 · B — the bag lifecycle", () => {
  it("walks Michael's actual day: pull, count into the safe, seal, reuse", () => {
    // available -> undeclared: cash comes out of the drawer into a bag.
    const pulled = applyBagAction("available", "pull");
    expect(pulled).toEqual({ ok: true, from: "available", to: "undeclared" });

    // undeclared -> counted: somebody counts it INTO the safe. This is the
    // step that makes it the store's money rather than the drawer's.
    const counted = applyBagAction("undeclared", "declare");
    expect(counted).toEqual({ ok: true, from: "undeclared", to: "counted" });

    // counted -> deposited: the bag is sealed and committed to a deposit.
    const sealed = applyBagAction("counted", "seal");
    expect(sealed).toEqual({ ok: true, from: "counted", to: "deposited" });

    // deposited -> available: the empty bag comes back from the bank.
    const back = applyBagAction("deposited", "return");
    expect(back).toEqual({ ok: true, from: "deposited", to: "available" });
  });

  it("refuses all twelve illegal moves, not just the four legal ones", () => {
    const legal = new Set([
      "available|pull",
      "undeclared|declare",
      "counted|seal",
      "deposited|return",
    ]);

    let legalSeen = 0;
    let refusedSeen = 0;

    for (const from of BAG_STATUSES) {
      for (const action of BAG_ACTIONS) {
        const r = applyBagAction(from, action);
        if (legal.has(`${from}|${action}`)) {
          expect(r.ok).toBe(true);
          legalSeen += 1;
        } else {
          expect(r.ok).toBe(false);
          if (r.ok === false) expect(r.code).toBe("BAG_ILLEGAL_TRANSITION");
          refusedSeen += 1;
        }
      }
    }

    // Rule 89: the counts are STATED, so that shrinking the matrix by
    // deleting a status or an action fails here loudly instead of silently
    // testing less.
    expect(legalSeen).toBe(4);
    expect(refusedSeen).toBe(12);
    expect(legalSeen + refusedSeen).toBe(16);
  });

  it("cannot skip 'undeclared' — the step that makes cash impossible to lose", () => {
    // If a bag could go straight from available to counted, the cash would be
    // out of the drawer and into the safe's total with nobody having counted
    // it in between. That gap is precisely where money disappears.
    expect(applyBagAction("available", "declare").ok).toBe(false);
    expect(applyBagAction("available", "seal").ok).toBe(false);
  });

  it("cannot seal the same bag twice, or top up a bag already counted", () => {
    expect(applyBagAction("deposited", "seal").ok).toBe(false);
    expect(applyBagAction("counted", "pull").ok).toBe(false);
  });
});

describe("books-98 · B — a register cannot close on an undeclared bag", () => {
  const bag = (bagNo: string, status: BagStatus) => ({ bagNo, status });

  it("lets the shift close when every bag has been counted in", () => {
    expect(
      blockCloseForUndeclaredBags([
        bag("GW-1", "counted"),
        bag("GW-2", "deposited"),
        bag("GW-3", "available"),
      ]),
    ).toBeNull();
  });

  it("blocks the close and NAMES the bag that is still undeclared", () => {
    const msg = blockCloseForUndeclaredBags([
      bag("GW-1", "counted"),
      bag("GW-2", "undeclared"),
    ]);
    expect(msg).not.toBeNull();
    expect(msg).toContain("GW-2");
    // It must not accuse the bag that was done correctly.
    expect(msg).not.toContain("GW-1");
  });

  it("names EVERY undeclared bag, not just the first one found", () => {
    // Stopping at the first would let the second bag of cash walk out the
    // door while the message claimed the problem was already described.
    const msg = blockCloseForUndeclaredBags([
      bag("GW-2", "undeclared"),
      bag("GW-7", "undeclared"),
    ]);
    expect(msg).toContain("GW-2");
    expect(msg).toContain("GW-7");
  });

  it("says nothing when there are no bags at all", () => {
    // Rule 135/136: no bags is a real answer (a quiet day), not a problem.
    expect(blockCloseForUndeclaredBags([])).toBeNull();
  });
});

describe("books-98 · A — the bag number is a real identifier", () => {
  it("trims, so one physical bag cannot become two ledger identities", () => {
    expect(normaliseBagNo("  GW-00412 ")).toBe("GW-00412");
  });

  it("treats blank, whitespace, null and undefined alike as NO id", () => {
    for (const v of ["", "   ", null, undefined]) {
      expect(normaliseBagNo(v)).toBeNull();
    }
  });

  it("refuses amounts that are not real money", () => {
    expect(validateBagAmount(16_750)).toBeNull();
    expect(validateBagAmount(0)?.code).toBe("BAG_AMOUNT_NOT_POSITIVE");
    expect(validateBagAmount(-500)?.code).toBe("BAG_AMOUNT_NOT_POSITIVE");
    expect(validateBagAmount(10.5)?.code).toBe("BAG_AMOUNT_NOT_WHOLE_CENTS");
  });
});

describe("books-98 · C — the deposit shape self-check", () => {
  // This is a MIRROR, not an accusation and not a refusal. It shows Michael
  // the same pattern a bank examiner would look at, so that if there is an
  // innocent reason for it — and there almost always is — it is written down
  // at the time rather than reconstructed under questioning two years later.

  it("says nothing about an ordinary deposit", () => {
    expect(checkDepositShape(150_000, 20_000)).toBeNull();
  });

  it("says nothing when a big deposit is made, however much is left", () => {
    expect(checkDepositShape(CTR_THRESHOLD_MINOR, 5_000_000)).toBeNull();
  });

  it("warns only when BOTH halves of the examiner's question are true", () => {
    // Under the threshold AND more than the threshold still sitting on hand.
    const n = checkDepositShape(CTR_THRESHOLD_MINOR - 1, CTR_THRESHOLD_MINOR + 1);
    expect(n).not.toBeNull();
    expect(n?.code).toBe("DEPOSIT_SHAPE_UNDER_THRESHOLD");
  });

  it("treats exactly $10,000 as NOT under the threshold", () => {
    // The CTR is filed AT $10,000.01 and above... the deposit at exactly the
    // threshold is not "kept under" anything. An off-by-one here would nag on
    // a perfectly normal deposit and train Michael to ignore the warning.
    expect(checkDepositShape(CTR_THRESHOLD_MINOR, CTR_THRESHOLD_MINOR + 1)).toBeNull();
  });

  it("treats exactly $10,000 remaining as NOT 'more than' on hand", () => {
    expect(checkDepositShape(CTR_THRESHOLD_MINOR - 1, CTR_THRESHOLD_MINOR)).toBeNull();
  });

  it("is a notice, never a refusal — the deposit always goes through", () => {
    // Rule: a warning that blocks work gets switched off. This one cannot
    // block anything, because it returns a notice and nothing else.
    const n = checkDepositShape(500_000, 2_000_000);
    expect(n).not.toBeNull();
    expect(n?.message).toMatch(/not an accusation|legitimate|explain/i);
  });
});
