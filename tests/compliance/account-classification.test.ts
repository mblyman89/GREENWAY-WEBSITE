/**
 * account-classification.test.ts — WHOSE ACCOUNT, AND WHOSE BOOKS (books-101).
 *
 * Covers D-79 (the role tag was a global unique key) and D-80 (nothing said
 * whose account it was, so the merchant rule decided the entity).
 *
 * These tests are written against BEHAVIOUR, not against the source text: they
 * call the functions and read the answers, so a change of implementation that
 * keeps the answers right leaves them green and a change that moves a number
 * turns them red.
 */
import { describe, expect, it } from "vitest";
import {
  OWNER_CODES,
  BOOKS_ENTITY_CODES,
  isOwnerCode,
  isBusinessBooks,
  ownerCodeLabel,
  booksEntityLabel,
  validateOwnerCode,
  validateBooksEntity,
  decideEntityForAccount,
  roleMustBeUnique,
  UNIQUE_ROLES,
  __runAccountClassificationTests,
} from "@/lib/plaid/account-classification-core";
import { ENTITY_CODES } from "@/lib/accounting/coa-core";
import { ACCOUNT_ROLES } from "@/lib/plaid/plaid-core";

describe("account classification: self-tests", () => {
  it("passes its own registered self-tests", () => {
    expect(() => __runAccountClassificationTests()).not.toThrow();
  });
});

describe("owner: exactly the two people, and 'joint' is deliberately absent", () => {
  // Michael: "it is just my wife and I ... There are no other names or trusts."
  it("knows Michael and Alyssa, and nobody else", () => {
    expect([...OWNER_CODES].sort()).toEqual(["alyssa", "michael"]);
  });

  // Rule 133f: a deliberate dead end must SAY SO. Michael: "We don't share
  // accounts right now because the banks and card issuers have closed several
  // of my accounts in the past ... We will have joint accounts at some point
  // when it's allowed." So this asserts the ABSENCE is intentional, and it is
  // the test that will fail the day somebody adds 'joint' without also
  // deciding what a joint account means for the books.
  it("has no 'joint' owner yet, on purpose", () => {
    expect(isOwnerCode("joint")).toBe(false);
    expect(validateOwnerCode("joint").ok).toBe(false);
  });

  it("treats blank, 'none' and 'unassigned' as clearing rather than refusing", () => {
    for (const blank of ["", "   ", "none", "unassigned", "NULL"]) {
      const r = validateOwnerCode(blank);
      expect(r, `"${blank}" should clear`).toEqual({ ok: true, owner: null });
    }
    expect(validateOwnerCode(null)).toEqual({ ok: true, owner: null });
  });

  it("normalises case and whitespace instead of refusing a good answer", () => {
    expect(validateOwnerCode("  MICHAEL  ")).toEqual({ ok: true, owner: "michael" });
    expect(validateOwnerCode("Alyssa")).toEqual({ ok: true, owner: "alyssa" });
  });

  it("refuses an unknown name rather than coercing it to somebody", () => {
    const r = validateOwnerCode("grandpa");
    expect(r.ok).toBe(false);
    // Rule 26: the refusal has to say what to do instead.
    if (!r.ok) expect(r.error).toContain("Michael");
  });

  it("labels an unset owner as Unassigned, not as a blank", () => {
    expect(ownerCodeLabel(null)).toBe("Unassigned");
    expect(ownerCodeLabel("michael")).toBe("Michael");
  });
});

describe("books: the SAME vocabulary as the ledger, not a copy of it", () => {
  // A fifth spelling of an entity is a second source of truth. coa-core.ts:80
  // records what that already cost: 18 accounts tagged 'GRWNY' instead of
  // 'GRNWY' silently vanished from every entity-filtered report.
  it("is exactly gl_entities' four codes", () => {
    expect([...BOOKS_ENTITY_CODES].sort()).toEqual([...ENTITY_CODES].sort());
  });

  it("counts personal as NOT a business", () => {
    expect(isBusinessBooks("personal")).toBe(false);
    for (const biz of ["greenway", "atm", "landholding"] as const) {
      expect(isBusinessBooks(biz), `${biz} is a business`).toBe(true);
    }
  });

  it("refuses an invented set of books", () => {
    expect(validateBooksEntity("household").ok).toBe(false);
    expect(validateBooksEntity("business").ok).toBe(false);
  });

  it("accepts each real code and clears on blank", () => {
    for (const code of BOOKS_ENTITY_CODES) {
      expect(validateBooksEntity(code)).toEqual({ ok: true, books: code });
    }
    expect(validateBooksEntity("")).toEqual({ ok: true, books: null });
  });
});

describe("the posting decision (D-80): the ACCOUNT decides, not the merchant", () => {
  // THE CASE THAT PROVES ONE FIELD COULD NEVER WORK. Michael's own card, on
  // Greenway's books: it "stays with me always and is only used for greenway
  // marijuana purchases."
  it("posts Michael's Citi Mastercard to GREENWAY though the card is his", () => {
    const d = decideEntityForAccount({ ownerCode: "michael", booksEntity: "greenway" });
    expect(d.kind).toBe("post");
    if (d.kind === "post") expect(d.entity).toBe("greenway");
  });

  // Rule 129, one assertion per risk: the risk here is that somebody "improves"
  // this by reading the owner, which would push the Citi card into personal.
  it("gives the same answer whoever owns the account", () => {
    const answers = (["michael", "alyssa", null] as const).map((o) =>
      decideEntityForAccount({ ownerCode: o, booksEntity: "greenway" }),
    );
    for (const a of answers) {
      expect(a.kind).toBe("post");
      if (a.kind === "post") expect(a.entity).toBe("greenway");
    }
  });

  it("keeps a personal account out of the business ledgers", () => {
    const d = decideEntityForAccount({ ownerCode: "alyssa", booksEntity: "personal" });
    expect(d.kind).toBe("personal");
  });

  // A personal account is CORRECT, not broken. If this reported the same thing
  // as "unclassified", the obvious way to silence the warning would be to tag
  // the personal card as Greenway -- which is D-80 again, entered by hand.
  it("reports personal as a decision, distinct from an unclassified account", () => {
    const personal = decideEntityForAccount({ ownerCode: "michael", booksEntity: "personal" });
    const unset = decideEntityForAccount({ ownerCode: "michael", booksEntity: null });
    expect(personal.kind).not.toBe(unset.kind);
    expect(unset.kind).toBe("unclassified");
  });

  it("names the missing field so the fix is obvious", () => {
    const d = decideEntityForAccount({ ownerCode: "michael", booksEntity: null });
    expect(d.kind).toBe("unclassified");
    if (d.kind === "unclassified") {
      expect(d.missing).toBe("books");
      expect(d.explanation).toContain("Plaid screen");
    }
  });

  // Rule 135: missing is a question, not a zero. A missing OWNER is a gap in
  // reporting; a missing BOOKS is a gap in the accounting. Only one blocks.
  it("does not let a missing OWNER block posting", () => {
    const d = decideEntityForAccount({ ownerCode: null, booksEntity: "greenway" });
    expect(d.kind).toBe("post");
  });

  it("routes each business entity to itself", () => {
    for (const biz of ["greenway", "atm", "landholding"] as const) {
      const d = decideEntityForAccount({ ownerCode: "michael", booksEntity: biz });
      expect(d.kind).toBe("post");
      if (d.kind === "post") expect(d.entity).toBe(biz);
    }
  });
});

describe("role uniqueness (D-79): only `main`", () => {
  it("keeps main unique", () => {
    expect(roleMustBeUnique("main")).toBe(true);
    expect(UNIQUE_ROLES).toEqual(["main"]);
  });

  // The defect. Michael is linking his card, Alyssa's cards, two investment
  // portfolios and their debt across up to twenty connections.
  it("lets every other canonical role repeat", () => {
    for (const role of ACCOUNT_ROLES) {
      if (role === "main") continue;
      expect(roleMustBeUnique(role), `"${role}" must repeat`).toBe(false);
    }
  });

  it("lets a custom typed role repeat", () => {
    expect(roleMustBeUnique("escrow")).toBe(false);
    expect(roleMustBeUnique("petty cash")).toBe(false);
  });

  it("normalises before deciding, so ' MAIN ' is still the unique one", () => {
    expect(roleMustBeUnique("  MAIN  ")).toBe(true);
    expect(roleMustBeUnique("Main")).toBe(true);
  });

  it("treats unassigned as no role at all", () => {
    expect(roleMustBeUnique(null)).toBe(false);
    expect(roleMustBeUnique("")).toBe(false);
    expect(roleMustBeUnique("   ")).toBe(false);
  });

  // WHY main is the exception, asserted rather than commented: two reconcilers
  // filter on role==="main" and LOOP over every match, so a second main account
  // starts dragging its transactions into vendor and payroll reconciliation.
  it("labels every books entity, so no picker can render a blank option", () => {
    for (const code of BOOKS_ENTITY_CODES) {
      expect(booksEntityLabel(code).length).toBeGreaterThan(0);
      expect(booksEntityLabel(code)).not.toBe("Unassigned");
    }
    expect(booksEntityLabel(null)).toBe("Unassigned");
  });
});
