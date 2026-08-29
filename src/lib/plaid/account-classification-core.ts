/**
 * account-classification-core.ts — WHOSE ACCOUNT IS THIS, AND WHOSE BOOKS.
 * ============================================================================
 *
 * PURE. No database, no Plaid client, no React. Everything here is a function
 * of its arguments so it can be executed in a self-test and mutated in a probe.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Michael (verbatim): "I want to make sure we are very deliberate and clear
 * about what accounts are for business and which ones are my wife and my
 * personal accounts."
 *
 * Before books-101 there was one field, `role`, doing three unrelated jobs:
 *
 *   1. WHICH chart account does money here move?   (main -> 10200)
 *   2. WHAT is this account for?                   ("savings", "escrow")
 *   3. WHOSE money is it, and whose books?         (nothing — D-80)
 *
 * Job 3 was simply absent, so the ENTITY of a posted expense came from the
 * merchant rule alone: classifyExpense({merchant:'AMAZON'}) returns entity
 * 'greenway' whoever swiped, so Alyssa's Amazon order posted into a 280E
 * business. And jobs 1 and 2 fought each other, because role was a GLOBAL
 * UNIQUE KEY, so a second credit card could not be tagged at all (D-79).
 *
 * Michael's own Citi Mastercard is the case that proves one field cannot work.
 * He said it "stays with me always and is only used for greenway marijuana
 * purchases." That is:
 *
 *      owner   = michael     (a fact: whose name is on it)
 *      books   = greenway    (an accounting decision: whose ledger)
 *      role    = credit      (a mapping: which chart account, 33000)
 *
 * Three different answers. Any single field has to lie about two of them.
 *
 * THE RULE THIS FILE ENFORCES
 * ---------------------------
 * BOOKS decides the entity. Not the merchant. An account on `personal` books
 * never posts into a business ledger, and it is never OFFERED the chance —
 * see decideEntityForAccount, which returns a distinct outcome for "this is
 * personal" rather than an error that reads like something broke.
 */
import type { EntityCode } from "@/lib/accounting/ledger-core";
import { ENTITY_CODES } from "@/lib/accounting/coa-core";

// ---------------------------------------------------------------------------
// 1) Owner — whose account is it
// ---------------------------------------------------------------------------

/**
 * The people who own accounts here. Mirrors the check constraint in migration
 * 0213; both exist on purpose, because a TypeScript union is erased at runtime
 * and a string arriving from a form or a CSV would sail straight past it.
 *
 * THERE IS NO 'joint' VALUE, AND ITS ABSENCE IS DELIBERATE (rule 133f).
 * Michael (verbatim): "it is just my wife and I, we each have our own accounts
 * and our own plaid connection to separate the two. We don't share accounts
 * right now because the banks and card issuers have closed several of my
 * accounts in the past, and I don't want my name on my wife's accounts just in
 * case they decide to shut hers down too. We will have joint accounts at some
 * point when it's allowed. There are no other names or trusts."
 *
 * So 'joint' is a real future value that does not exist yet. It is one entry in
 * this list plus one word in the 0213 constraint — no restructure — precisely
 * because owner is stored ON THE ACCOUNT rather than inferred from which Plaid
 * credential set happened to fetch it. Inferring it from the credential set
 * would have made a joint account unrepresentable, since a joint account has
 * one owner value and could arrive through either set.
 */
export const OWNER_CODES = ["michael", "alyssa"] as const;

export type OwnerCode = (typeof OWNER_CODES)[number];

export function isOwnerCode(v: string): v is OwnerCode {
  return (OWNER_CODES as readonly string[]).includes(v);
}

/** Human label for an owner, or "Unassigned" when nobody has said yet. */
export function ownerCodeLabel(code: string | null | undefined): string {
  switch (code) {
    case "michael":
      return "Michael";
    case "alyssa":
      return "Alyssa";
    default:
      return "Unassigned";
  }
}

/**
 * Validate an owner code off a form. Blank / "none" / "unassigned" means the
 * owner is CLEARING the field, which is allowed and returns null. An unknown
 * non-blank string is refused rather than coerced — a typo must not silently
 * become somebody's account.
 */
export function validateOwnerCode(
  input: string | null | undefined,
): { ok: true; owner: OwnerCode | null } | { ok: false; error: string } {
  const v = (input ?? "").trim().toLowerCase();
  if (v === "" || v === "none" || v === "null" || v === "unassigned") {
    return { ok: true, owner: null };
  }
  if (isOwnerCode(v)) return { ok: true, owner: v };
  return {
    ok: false,
    error:
      `"${input}" is not one of the people this system knows about. ` +
      `Choose ${OWNER_CODES.map(ownerCodeLabel).join(" or ")}, or leave it unassigned. ` +
      `Nothing was changed.`,
  };
}

// ---------------------------------------------------------------------------
// 2) Books — which ledger the account's activity belongs to
// ---------------------------------------------------------------------------

/**
 * The books an account can belong to. These are the SAME four codes as
 * gl_entities (migration 0172) and EntityCode in ledger-core — deliberately not
 * a parallel list. A fifth spelling of "personal" would be a second source of
 * truth, and coa-core.ts:80 already records what that costs: 18 accounts in the
 * live Sage chart were tagged 'GRWNY' instead of 'GRNWY' and simply vanished
 * from entity-filtered reports without anything complaining.
 *
 * Derived from ENTITY_CODES rather than retyped, so the two cannot drift.
 */
export const BOOKS_ENTITY_CODES: readonly EntityCode[] = ENTITY_CODES;

/**
 * Is this entity a BUSINESS entity — one whose ledger a bank feed may post to?
 *
 * greenway, atm and landholding are Michael's businesses. `personal` is his and
 * Alyssa's own money. It is a first-class entity in the chart (since 0172) so
 * that his "one set of books that I can give my grandfather to use to fill out
 * my tax returns" is reachable, but personal activity must never land inside a
 * 280E business return, which is the whole of D-80.
 */
export function isBusinessBooks(entity: EntityCode): boolean {
  return entity !== "personal";
}

export function booksEntityLabel(code: string | null | undefined): string {
  switch (code) {
    case "greenway":
      return "Greenway Marijuana";
    case "atm":
      return "ATM business";
    case "landholding":
      return "Land holding";
    case "personal":
      return "Personal (Michael & Alyssa)";
    default:
      return "Unassigned";
  }
}

export function validateBooksEntity(
  input: string | null | undefined,
): { ok: true; books: EntityCode | null } | { ok: false; error: string } {
  const v = (input ?? "").trim().toLowerCase();
  if (v === "" || v === "none" || v === "null" || v === "unassigned") {
    return { ok: true, books: null };
  }
  const match = BOOKS_ENTITY_CODES.find((c) => c === v);
  if (match) return { ok: true, books: match };
  return {
    ok: false,
    error:
      `"${input}" is not one of the sets of books this system keeps. ` +
      `Choose ${BOOKS_ENTITY_CODES.map(booksEntityLabel).join(", ")}, or leave it unassigned. ` +
      `Nothing was changed.`,
  };
}

// ---------------------------------------------------------------------------
// 3) The decision the posting path actually asks for
// ---------------------------------------------------------------------------

/**
 * The classification as stored on a Plaid account. Both fields nullable,
 * because a newly linked account genuinely has not been classified yet and
 * NULL is a question, not a zero (rule 135).
 */
export type AccountClassification = {
  readonly ownerCode: OwnerCode | null;
  readonly booksEntity: EntityCode | null;
};

/**
 * What the books should do with money moving through this account.
 *
 * Three outcomes, and the middle one is the point of the type:
 *
 *   post        — a business account; here is the entity to stamp on the entry.
 *   personal    — classified, understood, and deliberately NOT posted to a
 *                 business ledger. This is a DECISION, not a failure, so it
 *                 gets its own kind. Folding it into `unclassified` would tell
 *                 Michael to go and fix something that is already correct, and
 *                 he would eventually "fix" it by tagging his personal card as
 *                 Greenway to make the warning go away.
 *   unclassified— nobody has said yet. Refuse, and say which field is missing.
 */
export type AccountPostingDecision =
  | { kind: "post"; entity: EntityCode; explanation: string }
  | { kind: "personal"; explanation: string }
  | { kind: "unclassified"; missing: "books"; explanation: string };

/**
 * Decide the entity for anything posted out of this account.
 *
 * THE ENTITY COMES FROM THE ACCOUNT, NOT THE MERCHANT. That inversion is the
 * fix for D-80. The merchant rule still chooses WHICH expense account (76010
 * Office supplies, say) and the cost class; it no longer gets a vote on WHOSE
 * business the expense is, because it cannot know — the same Amazon charge is
 * Greenway's on the Citi card and Michael's own on his personal card, and the
 * merchant text is identical in both.
 *
 * Note what is NOT consulted here: ownerCode. Whose name is on the account has
 * no bearing on which ledger the activity belongs to — Michael's own Citi
 * Mastercard is owner=michael, books=greenway, and posts to Greenway. Reading
 * owner here is exactly the mistake that would put his card's expenses in the
 * personal pile. Owner exists for reporting, net worth, and knowing who to ask.
 */
export function decideEntityForAccount(c: AccountClassification): AccountPostingDecision {
  if (c.booksEntity === null) {
    return {
      kind: "unclassified",
      missing: "books",
      explanation:
        "This account has not been told which set of books it belongs to yet. Open the Plaid screen " +
        "and set its Books to Greenway, ATM, Land holding, or Personal. Until then it will keep " +
        "downloading transactions and balances, but nothing from it will be written to the ledger. " +
        "Nothing was written.",
    };
  }
  if (!isBusinessBooks(c.booksEntity)) {
    return {
      kind: "personal",
      explanation:
        "This is a personal account, so its spending is tracked for net worth and personal budgeting " +
        "but is deliberately kept out of the business ledgers. Nothing here belongs on a business " +
        "tax return, so nothing was written to one.",
    };
  }
  return {
    kind: "post",
    entity: c.booksEntity,
    explanation:
      `This account belongs to the ${booksEntityLabel(c.booksEntity)} books, so entries from it are ` +
      `stamped with that entity regardless of which shop the money went to.`,
  };
}

// ---------------------------------------------------------------------------
// 4) Which roles may repeat (the D-79 half)
// ---------------------------------------------------------------------------

/**
 * Roles that may be held by only ONE account at a time.
 *
 * `main` is the only one, and it is not a matter of taste. Two places read it
 * and then LOOP over every match to pull bank withdrawals for reconciliation:
 *
 *   src/lib/payments/vendor-reconcile-store.ts:110
 *   src/lib/payroll/payroll-store.ts:595
 *
 * both exactly `accounts.filter((a) => a.role === "main" && a.active)`. So the
 * code TOLERATES several main accounts — it just starts trawling every one of
 * them for vendor payments and payroll withdrawals. Tag a personal checking
 * account `main` and Michael's grocery shopping arrives in the payroll
 * reconciler as unmatched withdrawals. That is the reason to keep it singular,
 * and it is a better reason than the one uniqueness was originally built on.
 *
 * Every other role repeats, because repeating costs nothing: two business cards
 * both credit 33000, and 0173 seeds that account saying "WHICH card is a
 * dimension." Michael is about to link his card, Alyssa's cards, two investment
 * portfolios and their debt across up to twenty connections; a model that
 * allows one of each makes the true state of his finances unenterable.
 */
export const UNIQUE_ROLES: readonly string[] = ["main"] as const;

export function roleMustBeUnique(role: string | null | undefined): boolean {
  const key = (role ?? "").trim().toLowerCase();
  if (key === "") return false;
  return UNIQUE_ROLES.includes(key);
}

// ---------------------------------------------------------------------------
// Self-tests (run by scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runAccountClassificationTests(): void {
  const failures: string[] = [];
  const ok = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  // --- owner ---------------------------------------------------------------
  ok(OWNER_CODES.length === 2, `expected 2 owners, got ${OWNER_CODES.length}`);
  ok(
    !(OWNER_CODES as readonly string[]).includes("joint"),
    "'joint' must NOT be an owner yet — Michael keeps his name off Alyssa's accounts on purpose",
  );
  ok(validateOwnerCode("michael").ok, "michael is an owner");
  ok(validateOwnerCode("  ALYSSA ").ok, "owner input is trimmed and lower-cased");
  const cleared = validateOwnerCode("");
  ok(cleared.ok && cleared.owner === null, "blank owner clears rather than refusing");
  const badOwner = validateOwnerCode("grandpa");
  ok(!badOwner.ok, "an unknown name is refused, not coerced");
  ok(ownerCodeLabel(null) === "Unassigned", "null owner reads as Unassigned");

  // --- books ---------------------------------------------------------------
  ok(BOOKS_ENTITY_CODES.length === 4, `expected 4 books, got ${BOOKS_ENTITY_CODES.length}`);
  ok(
    BOOKS_ENTITY_CODES.every((c) => (ENTITY_CODES as readonly string[]).includes(c)) &&
      ENTITY_CODES.every((c) => (BOOKS_ENTITY_CODES as readonly string[]).includes(c)),
    "books vocabulary must BE the ledger's entity vocabulary, not a copy of it",
  );
  ok(isBusinessBooks("greenway"), "greenway is a business");
  ok(isBusinessBooks("atm"), "atm is a business");
  ok(isBusinessBooks("landholding"), "landholding is a business");
  ok(!isBusinessBooks("personal"), "personal is NOT a business");
  const badBooks = validateBooksEntity("household");
  ok(!badBooks.ok, "an invented books name is refused");

  // --- the decision --------------------------------------------------------
  const unclassified = decideEntityForAccount({ ownerCode: "michael", booksEntity: null });
  ok(unclassified.kind === "unclassified", "no books yet -> unclassified, not a guess");

  const personal = decideEntityForAccount({ ownerCode: "alyssa", booksEntity: "personal" });
  ok(personal.kind === "personal", "personal books -> its own outcome, not an error");

  // THE CITI MASTERCARD. Michael's own card, Greenway's books.
  const citi = decideEntityForAccount({ ownerCode: "michael", booksEntity: "greenway" });
  ok(citi.kind === "post", "the Citi Mastercard posts");
  ok(citi.kind === "post" && citi.entity === "greenway", "...to Greenway, though the card is Michael's");

  // Owner must not leak into the entity: same books, different owner, same answer.
  const alyssaOnGreenway = decideEntityForAccount({ ownerCode: "alyssa", booksEntity: "greenway" });
  ok(
    alyssaOnGreenway.kind === "post" && alyssaOnGreenway.entity === "greenway",
    "owner must not change the entity — books decides, owner is for reporting",
  );
  const noOwnerOnGreenway = decideEntityForAccount({ ownerCode: null, booksEntity: "greenway" });
  ok(
    noOwnerOnGreenway.kind === "post",
    "a missing OWNER must not block posting — only missing BOOKS does",
  );

  // --- unique roles --------------------------------------------------------
  ok(roleMustBeUnique("main"), "main is unique — two reconcilers trawl every main account");
  ok(!roleMustBeUnique("credit"), "credit repeats — Michael has more than one card");
  ok(!roleMustBeUnique("savings"), "savings repeats");
  ok(!roleMustBeUnique("mortgage"), "mortgage repeats");
  ok(!roleMustBeUnique("escrow"), "a custom typed role repeats");
  ok(roleMustBeUnique("  MAIN "), "uniqueness check normalises before comparing");
  ok(!roleMustBeUnique(null), "unassigned is not a role and never collides");
  ok(UNIQUE_ROLES.length === 1, `expected exactly 1 unique role, got ${UNIQUE_ROLES.length}`);

  if (failures.length > 0) {
    throw new Error(`account-classification-core self-tests failed:\n  - ${failures.join("\n  - ")}`);
  }
}
