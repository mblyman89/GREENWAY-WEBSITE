/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STORE SAFE LAYER: the deposit bag, its lifecycle, and the money it moves.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS EXISTS
 * ---------------
 * books-96 keyed the undeposited pool on the BUSINESS DAY and said out loud
 * that "oldest first" was a CONVENTION, not a fact: nothing in a sealed bag
 * told us which day's money it held, so FIFO was a defensible guess. This file
 * removes the guess. A bag carries an ID, the ID goes on the deposit slip, and
 * the bank credit is matched to the BAG. A stated weakness is retired by
 * evidence rather than by argument.
 *
 * WHAT THE OWNER ASKED FOR, VERBATIM
 * ----------------------------------
 *   "we have three tills, one master till, and a store safe. The employee
 *    counts the till before opening, to verify it has 167.50 in it. At the end
 *    of the shift they count it out and enter the amount into the register.
 *    167.50 is left in the register and the rest goes into the safe. The end of
 *    the day, the safe money goes into the deposit bag with an id. Any over
 *    under is dealt with on the spot once the total till is reconciled."
 *
 *   "I like the enterprise grade solution regarding the store safe layer. I
 *    want to mirror this."
 *
 * WHERE THE DESIGN CAME FROM (not invented here)
 * ---------------------------------------------
 * Oracle Retail Xstore runs cash in THREE layers - Till -> Store Safe -> Bank
 * Deposit - and gives every safe bag a scannable ID with a four-state
 * lifecycle. Two of its rules are copied deliberately:
 *
 *   1. A BAG IS ATOMIC. Xstore: "All the money that is in a safe bag is used
 *      in the function... There is no option to use only half the money."
 *      A bag is therefore never partially deposited. This is what makes the
 *      bank match exact instead of approximate.
 *
 *   2. PULLED-BUT-UNCOUNTED CASH IS STILL THE DRAWER'S. Xstore holds a bag in
 *      `undeclared` until it is counted into the safe, because until then
 *      "that cash is still a part of the drawer" - and it refuses to let the
 *      register close while such a bag is outstanding. That single rule closes
 *      the most common cash-shrinkage hole in retail: pull cash, never declare
 *      it, and let the drawer's own over/short absorb the loss.
 *
 * THE STATES
 * ----------
 *      available  - an empty bag on the shelf, ready to be used.
 *      undeclared - cash was pulled from a drawer into this bag but NOBODY HAS
 *                   COUNTED IT YET. The money still belongs to the drawer.
 *      counted    - counted into the safe. The money is now the safe's, and
 *                   the bag is eligible to be sealed for the bank.
 *      deposited  - sealed and gone to the bank. Awaiting the bank's credit.
 *      available  - the physical bag came back from the night drop and is
 *                   reusable (Xstore calls this "Return Safe Bag").
 *
 * WHY `undeclared` CANNOT BE SKIPPED
 * ----------------------------------
 * It would be simpler to let a drop go straight to `counted`. That is exactly
 * the shortcut this file refuses: if pulling and counting are one step then a
 * pull is self-attesting, and nobody ever has to answer for a bag that went
 * into the safe light. The two-step shape is the control.
 *
 * DELIBERATE LIMIT (rule 133f): NO PARTIAL BAGS, NO MERGED BAGS
 * ------------------------------------------------------------
 * A bag cannot be split across two deposits, and two bags are not merged into
 * one. Both are refused rather than modelled. Cash is fungible in reality, so
 * a "half bag" would be an invention with no physical counterpart - and the
 * whole point of the bag is that it HAS a physical counterpart.
 *
 * DELIBERATE LIMIT (rule 133f): THIS FILE DOES NOT DECIDE WHO MAY DO WHAT
 * ----------------------------------------------------------------------
 * Xstore gates these actions by role. Permissions live in the service layer,
 * not here. This module is pure arithmetic and state; it will happily describe
 * a transition it is not this employee's business to perform.
 *
 * PURE: no I/O, no database, no clock. Money is always integer CENTS.
 */

/** The five lifecycle states a physical bag can occupy. */
export type BagStatus = "available" | "undeclared" | "counted" | "deposited";

export const BAG_STATUSES: readonly BagStatus[] = [
  "available",
  "undeclared",
  "counted",
  "deposited",
];

/**
 * The actions that move a bag between states. Named for what a person
 * physically does, not for the state they land in, because the point of the
 * lifecycle is to describe custody.
 */
export type BagAction =
  | "pull" // drawer cash goes into the bag (available  -> undeclared)
  | "declare" // counted into the safe       (undeclared -> counted)
  | "seal" // sealed for the bank         (counted    -> deposited)
  | "return"; // physical bag comes back     (deposited  -> available)

export const BAG_ACTIONS: readonly BagAction[] = [
  "pull",
  "declare",
  "seal",
  "return",
];

/**
 * THE ONLY LEGAL TRANSITIONS. Anything absent from this table is refused.
 *
 * This is written as data rather than as a chain of `if`s so that the set of
 * legal moves can be READ, and so a test can walk every illegal pair instead
 * of trusting that the branches were all written correctly.
 */
const TRANSITIONS: ReadonlyArray<{
  readonly from: BagStatus;
  readonly action: BagAction;
  readonly to: BagStatus;
}> = [
  { from: "available", action: "pull", to: "undeclared" },
  { from: "undeclared", action: "declare", to: "counted" },
  { from: "counted", action: "seal", to: "deposited" },
  { from: "deposited", action: "return", to: "available" },
];

export type BagRefusalCode =
  | "BAG_ILLEGAL_TRANSITION"
  | "BAG_AMOUNT_NOT_POSITIVE"
  | "BAG_AMOUNT_NOT_WHOLE_CENTS"
  | "BAG_NO_ID";

/**
 * A refusal, on its own. Named separately because some checks can ONLY refuse
 * or say nothing - they never produce a state change - and a function that
 * returns the full `BagTransition` union forces every caller to re-narrow a
 * success arm that cannot happen. That extra `.ok === false` dance is not
 * harmless: it reads as though success were possible, and the compiler cannot
 * tell the reader otherwise.
 */
export type BagRefusal = {
  readonly ok: false;
  readonly code: BagRefusalCode;
  readonly message: string;
};

export type BagTransition =
  | { readonly ok: true; readonly from: BagStatus; readonly to: BagStatus }
  | BagRefusal;

/** Format cents as dollars for a message a human has to act on. */
export function money(minor: number): string {
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(
    abs % 100,
  ).padStart(2, "0")}`;
}

/**
 * Can this bag do this thing right now? Returns the resulting state, or a
 * refusal that says what state the bag is actually in - because "illegal
 * transition" alone is useless to the person holding the bag.
 */
export function applyBagAction(
  from: BagStatus,
  action: BagAction,
): BagTransition {
  const hit = TRANSITIONS.find((t) => t.from === from && t.action === action);
  if (hit !== undefined) {
    return { ok: true, from, to: hit.to };
  }

  // Explain the refusal in terms of what CAN be done, so the message is
  // actionable rather than merely correct.
  const legal = TRANSITIONS.filter((t) => t.from === from).map((t) => t.action);
  const options =
    legal.length === 0
      ? "nothing"
      : legal.map((a) => `"${a}"`).join(" or ");
  return {
    ok: false,
    code: "BAG_ILLEGAL_TRANSITION",
    message:
      `This bag is "${from}", so it cannot be ${describeAction(action)}. ` +
      `From "${from}" the only thing that can happen is ${options}.`,
  };
}

/** Plain English for a refusal message. */
function describeAction(action: BagAction): string {
  switch (action) {
    case "pull":
      return "filled from a drawer again";
    case "declare":
      return "counted into the safe";
    case "seal":
      return "sealed for the bank";
    case "return":
      return "returned to the shelf";
  }
}

/**
 * THE CLOSE BLOCK (Xstore's rule, copied on purpose).
 *
 * A drawer session cannot be closed while any bag pulled from it is still
 * `undeclared`, because that cash is still, in the books' eyes, in the drawer.
 * Closing anyway would let the drawer's own over/short quietly absorb a
 * missing bag.
 *
 * Returns the reason to REFUSE, or null when the close may proceed.
 */
export function blockCloseForUndeclaredBags(
  bags: readonly { readonly bagNo: string; readonly status: BagStatus }[],
): string | null {
  const open = bags.filter((b) => b.status === "undeclared");
  if (open.length === 0) return null;
  const list = open.map((b) => b.bagNo).join(", ");
  return (
    `${open.length === 1 ? "Bag" : "Bags"} ${list} ` +
    `${open.length === 1 ? "was" : "were"} taken out of the drawer but never ` +
    `counted into the safe. Until that count happens the money still belongs ` +
    `to this drawer, so closing now would hide a shortage. Count ${
      open.length === 1 ? "it" : "them"
    } into the safe first.`
  );
}

/**
 * Validate the money going into a bag. Cents only, and never zero or negative:
 * a bag holding nothing is not a deposit, it is an empty bag, and it should
 * stay `available` rather than pretending to hold a drop.
 */
export function validateBagAmount(minor: number): BagRefusal | null {
  if (!Number.isFinite(minor) || !Number.isInteger(minor)) {
    return {
      ok: false,
      code: "BAG_AMOUNT_NOT_WHOLE_CENTS",
      message:
        `A bag has to hold a whole number of cents; got ${String(minor)}. ` +
        `This usually means a dollar amount was not converted to cents.`,
    };
  }
  if (minor <= 0) {
    return {
      ok: false,
      code: "BAG_AMOUNT_NOT_POSITIVE",
      message:
        `A bag cannot be filled with ${money(minor)}. An empty bag is not a ` +
        `drop - leave it on the shelf as "available" instead.`,
    };
  }
  return null;
}

/** A bag number must exist and mean something; whitespace is not an ID. */
export function normaliseBagNo(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const t = raw.trim();
  return t.length === 0 ? null : t;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE STRUCTURING SELF-CHECK (option C)
   ═══════════════════════════════════════════════════════════════════════════

   The owner asked whether splitting cash across several bags is a workaround
   for the $10,000 reporting threshold. It is not - a CTR is the BANK's
   paperwork, same-day transactions aggregate anyway (FinCEN Ruling 2003-1),
   and the offense is PURPOSE, not amount. So this is NOT a refusal and never
   will be. It is a mirror.

   The test below is the examiner's own, taken from IRM 4.26.13:
   "Does currency fluctuate to keep the deposit at or below $10,000?"
   The IRM also instructs examiners to "eliminate legitimate reasons for the
   pattern" and states plainly that "accounting entries are not evidence of a
   structuring violation."

   So: if a deposit lands just under the threshold while MORE than the
   threshold is still sitting in the safe, that is the shape that draws a
   question. The honest explanation (a missed bank run) is usually the true
   one - but the owner should hear it from his own books first, and be able to
   point at the reason. Silence is what looks deliberate over time.

   DELIBERATE LIMIT (rule 133f): this cannot detect structuring. Intent is not
   in the data. It detects the SHAPE an examiner looks for, nothing more, and
   it says so in its own message.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The federal currency-transaction reporting threshold, in cents. */
export const CTR_THRESHOLD_MINOR = 1_000_000; // $10,000.00

export type StructuringNotice = {
  readonly code: "DEPOSIT_SHAPE_UNDER_THRESHOLD";
  readonly message: string;
};

/**
 * Look at one deposit against the cash left behind. Returns a notice when the
 * deposit is under the threshold while more than the threshold remains on
 * hand, otherwise null.
 *
 * ZERO IS AN ANSWER (rule 135): a deposit of exactly the threshold is NOT
 * flagged - the rule is "more than $10,000" and being at it is not under it.
 */
export function checkDepositShape(
  depositMinor: number,
  remainingOnHandMinor: number,
): StructuringNotice | null {
  if (!Number.isInteger(depositMinor) || !Number.isInteger(remainingOnHandMinor)) {
    return null;
  }
  const under = depositMinor < CTR_THRESHOLD_MINOR;
  const plentyLeft = remainingOnHandMinor > CTR_THRESHOLD_MINOR;
  if (!under || !plentyLeft) return null;

  return {
    code: "DEPOSIT_SHAPE_UNDER_THRESHOLD",
    message:
      `This deposit is ${money(depositMinor)}, just under the ` +
      `${money(CTR_THRESHOLD_MINOR)} reporting line, while ` +
      `${money(remainingOnHandMinor)} is still in the safe. That is the ` +
      `pattern a Bank Secrecy Act examiner is trained to ask about. It is ` +
      `almost certainly just a missed bank run - a report over the line is ` +
      `the bank's routine paperwork and is nothing to avoid - but write down ` +
      `why the rest stayed behind, because an unexplained habit looks worse ` +
      `than a large deposit ever will.`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SELF-TESTS
   ═══════════════════════════════════════════════════════════════════════════ */

function ok(cond: boolean, what: string): void {
  if (!cond) throw new Error(`safe-bag-core self-test FAILED: ${what}`);
}

export function __runSafeBagTests(): void {
  // ── the happy loop, all the way round ──────────────────────────────────
  {
    let s: BagStatus = "available";
    const walk: BagAction[] = ["pull", "declare", "seal", "return"];
    const seen: BagStatus[] = [s];
    for (const a of walk) {
      const r = applyBagAction(s, a);
      ok(r.ok, `${a} from ${s} should be legal`);
      if (!r.ok) return;
      s = r.to;
      seen.push(s);
    }
    ok(
      seen.join(">") === "available>undeclared>counted>deposited>available",
      "the bag walks the full lifecycle and comes back to available",
    );
  }

  // ── EVERY illegal pair is refused ──────────────────────────────────────
  // Walking the whole matrix rather than a few examples: a transition table
  // is only a control if the gaps are actually closed.
  {
    let legal = 0;
    let refused = 0;
    for (const from of BAG_STATUSES) {
      for (const action of BAG_ACTIONS) {
        const expected = TRANSITIONS.some(
          (t) => t.from === from && t.action === action,
        );
        const r = applyBagAction(from, action);
        ok(r.ok === expected, `${from} + ${action} legality must match the table`);
        if (r.ok) legal += 1;
        else refused += 1;
      }
    }
    ok(legal === 4, `exactly 4 legal moves exist, saw ${legal}`);
    ok(refused === 12, `the other 12 combinations are refused, saw ${refused}`);
  }

  // ── the specific holes that matter, named ──────────────────────────────
  {
    // A sealed bag cannot be sealed twice: that is a double deposit.
    const twice = applyBagAction("deposited", "seal");
    ok(!twice.ok, "a deposited bag cannot be sealed again (double deposit)");

    // Cash cannot be added to a bag already counted into the safe: that is
    // how a declared total silently grows.
    const topUp = applyBagAction("counted", "pull");
    ok(!topUp.ok, "a counted bag cannot be topped up");

    // The undeclared step cannot be skipped.
    const skip = applyBagAction("available", "declare");
    ok(!skip.ok, "a bag cannot be declared before anything was pulled into it");

    // The refusal has to say where the bag actually is.
    if (!skip.ok) {
      ok(
        skip.message.includes("available") && skip.message.includes("pull"),
        "a refusal names the current state and the legal way out",
      );
    }
  }

  // ── the close block ────────────────────────────────────────────────────
  {
    ok(
      blockCloseForUndeclaredBags([]) === null,
      "no bags at all does not block a close",
    );
    ok(
      blockCloseForUndeclaredBags([
        { bagNo: "A1", status: "counted" },
        { bagNo: "A2", status: "deposited" },
      ]) === null,
      "counted and deposited bags do not block a close",
    );
    const blocked = blockCloseForUndeclaredBags([
      { bagNo: "A1", status: "counted" },
      { bagNo: "B7", status: "undeclared" },
    ]);
    ok(blocked !== null, "an undeclared bag BLOCKS the close");
    ok(
      blocked !== null && blocked.includes("B7"),
      "the block names the offending bag, not just the count",
    );
    ok(
      blocked !== null && !blocked.includes("A1"),
      "the block does not accuse a bag that was properly counted",
    );
    const two = blockCloseForUndeclaredBags([
      { bagNo: "B7", status: "undeclared" },
      { bagNo: "B8", status: "undeclared" },
    ]);
    ok(
      two !== null && two.includes("B7") && two.includes("B8"),
      "every undeclared bag is named, not only the first",
    );
  }

  // ── amounts ────────────────────────────────────────────────────────────
  {
    ok(validateBagAmount(16_750) === null, "$167.50 in whole cents is fine");
    const zero = validateBagAmount(0);
    ok(zero !== null && zero.code === "BAG_AMOUNT_NOT_POSITIVE", "zero refused");
    const neg = validateBagAmount(-1);
    ok(neg !== null && neg.code === "BAG_AMOUNT_NOT_POSITIVE", "negative refused");
    const frac = validateBagAmount(10.5);
    ok(
      frac !== null && frac.code === "BAG_AMOUNT_NOT_WHOLE_CENTS",
      "fractional cents refused",
    );
  }

  // ── bag numbers ────────────────────────────────────────────────────────
  {
    ok(normaliseBagNo("  B-104 ") === "B-104", "a bag number is trimmed");
    ok(normaliseBagNo("   ") === null, "whitespace is not a bag number");
    ok(normaliseBagNo(null) === null, "null is not a bag number");
    ok(normaliseBagNo(undefined) === null, "undefined is not a bag number");
  }

  // ── the structuring self-check ─────────────────────────────────────────
  {
    // The shape that draws a question: under the line, plenty left behind.
    const flagged = checkDepositShape(999_900, 5_000_000);
    ok(flagged !== null, "under the line with $50k left behind is flagged");
    ok(
      flagged !== null && flagged.message.includes("missed bank run"),
      "the notice offers the innocent explanation, not an accusation",
    );

    // A big deposit is never the problem.
    ok(
      checkDepositShape(5_000_000, 5_000_000) === null,
      "a deposit OVER the line is never flagged",
    );

    // Nothing meaningful left behind: no shape.
    ok(
      checkDepositShape(500_000, 100) === null,
      "a small deposit with almost nothing left is not the pattern",
    );

    // Exactly at the threshold is NOT under it (rule 135: the boundary is an
    // answer, not a judgement call).
    ok(
      checkDepositShape(CTR_THRESHOLD_MINOR, 9_000_000) === null,
      "a deposit of exactly $10,000 is not 'under' the line",
    );
    // One cent under, and it is.
    ok(
      checkDepositShape(CTR_THRESHOLD_MINOR - 1, CTR_THRESHOLD_MINOR + 1) !== null,
      "one cent under the line with more than the line left IS the shape",
    );
    // Remaining exactly at the threshold is not MORE than it.
    ok(
      checkDepositShape(100, CTR_THRESHOLD_MINOR) === null,
      "exactly $10,000 left behind is not MORE than $10,000",
    );
  }

  console.log("safe-bag-core self-tests: all passed");
}
