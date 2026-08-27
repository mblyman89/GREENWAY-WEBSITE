/**
 * tests/compliance/atm-posting-core.test.ts   (books-69 step 1)
 *
 * THE DAY THE ATM STARTED TOUCHING THE GENERAL LEDGER.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS GUARDING AGAINST
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The books-69 recon proved that the ATM subsystem had never written a journal
 * entry, and that `51000 ATM Surcharge Income` was referenced by zero lines of
 * application code. Three separate readers totalled `atm_settlements` directly
 * and showed Michael correct-looking figures that no journal supported.
 *
 * So the risk this file exists for is not "does the arithmetic add up". It is
 * that the FIRST money the ATM ever posts could land in the wrong books, with
 * the wrong tax character, or twice. Each of those is a real, expensive, and
 * entirely plausible mistake, and each gets its own assertion (rule 129 — one
 * assertion per risk).
 *
 *   §1  IT BALANCES        — the floor. Everything else is worthless without it.
 *   §2  THE RIGHT BOOKS    — atm, not greenway. This is the 280E question.
 *   §3  IDEMPOTENCE        — the same day twice must not post twice.
 *   §4  IT NEVER POSTS     — a person reconciles against a physical count.
 *   §5  REFUSALS           — a blank is not a zero.
 *   §6  THE POPULATION     — refused days are shown, not silently dropped.
 *
 * §1 comes first deliberately. A builder that returns no lines at all balances
 * perfectly and is useless, so the acceptance tests are what give the refusal
 * tests their meaning (rule 55).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ACCOUNT_ATM_SURCHARGE_INCOME,
  ACCOUNT_ATM_VAULT,
  ATM_WHY_NOT_AUTOMATIC,
  atmSettlementRefusal,
  atmSettlementSourceRef,
  buildAtmSettlementProposal,
  buildAtmSettlementProposals,
  proposalBalanceCents,
  summariseProposals,
  type AtmSettlementFacts,
} from "@/lib/atm/atm-posting-core";
import {
  AUTOPOSTABLE_SOURCE_KINDS,
  NEVER_AUTOPOST_REASONS,
  decidePosting,
} from "@/lib/accounting/posting-core";

/** A real-shaped settled day. Figures are plausible for HG26499. */
const DAY: AtmSettlementFacts = {
  settlementDate: "2026-07-15",
  terminalId: "HG26499",
  surchargeCents: 32_500,
  terminalTransactionCents: 1_250_00,
};

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  IT BALANCES
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("§1 the entry balances", () => {
  it("sums to exactly zero, and has lines to sum", () => {
    const p = buildAtmSettlementProposal(DAY);
    // The second half is the one that matters: an empty entry also sums to
    // zero, so asserting the balance alone would pass on a builder that had
    // quietly stopped producing anything (rule 39).
    expect(p.lines.length, "an empty loop proves nothing").toBeGreaterThan(0);
    expect(proposalBalanceCents(p)).toBe(0);
  });

  it("records the dispensed cash rather than netting it away", () => {
    const p = buildAtmSettlementProposal(DAY);
    const vault = p.lines.filter((l) => l.accountCode === ACCOUNT_ATM_VAULT);
    // Three legs: the fee arriving, the dispensed cash arriving, and the same
    // dispensed cash leaving. Netting the last two into nothing would balance
    // just as well and would erase the only record in the books of how much
    // cash the machine physically handed out.
    expect(vault.length, "the dispensed-cash legs were netted away").toBe(3);
    expect(vault.reduce((s, l) => s + l.amountCents, 0)).toBe(32_500);
  });

  it("a fee-only day is still a real entry", () => {
    const p = buildAtmSettlementProposal({ ...DAY, terminalTransactionCents: 0 });
    expect(p.refusal).toBeNull();
    expect(p.lines).toHaveLength(2);
    expect(proposalBalanceCents(p)).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE RIGHT BOOKS — this section is the 280E question
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("§2 the surcharge lands on the ATM books, not the cannabis books", () => {
  /**
   * The single most expensive assertion in this file.
   *
   * Surcharge income booked to `greenway` is cannabis income under IRC §280E,
   * where essentially no deduction survives. Booked to `atm`, it is a separate
   * trade or business under CHAMP v. Commissioner, 128 T.C. 173, and its
   * expenses are ordinarily deductible. The chart of accounts already encodes
   * this — 0173 seeds 51000 with `allowed_entity_codes = {atm}` and the comment
   * "Separate trade or business (CHAMP). Not cannabis revenue." — and this gate
   * makes sure the code that finally uses that account agrees with it.
   */
  it("posts to the atm entity, which is what keeps it outside 280E", () => {
    const p = buildAtmSettlementProposal(DAY);
    expect(
      p.entityCode,
      "surcharge income on the greenway books is cannabis income under 280E, where " +
        "essentially nothing is deductible. CHAMP is the authority for the separate " +
        "trade or business, and the separation is the entity code.",
    ).toBe("atm");
  });

  it("credits 51000 with the fee, and only the fee", () => {
    const p = buildAtmSettlementProposal(DAY);
    const income = p.lines.filter((l) => l.accountCode === ACCOUNT_ATM_SURCHARGE_INCOME);
    expect(income).toHaveLength(1);
    // Negative = credit. Income is credited; a debit here would reduce revenue.
    expect(income[0]?.amountCents).toBe(-32_500);
  });

  it("never treats dispensed cash as revenue", () => {
    const p = buildAtmSettlementProposal(DAY);
    const income = p.lines.filter((l) => l.accountCode === ACCOUNT_ATM_SURCHARGE_INCOME);
    const totalIncome = -income.reduce((s, l) => s + l.amountCents, 0);
    // The cardholder's $1,250 is not Michael's money. If it ever reached an
    // income account, the ATM business would appear to earn forty times what it
    // actually earns, and would be taxed on it.
    expect(
      totalIncome,
      "dispensed cash reached an income account. That is a stranger's withdrawal " +
        "being reported as earnings.",
    ).toBe(32_500);
  });

  it("touches only the two accounts the chart authorises for this", () => {
    const p = buildAtmSettlementProposal(DAY);
    const used = new Set(p.lines.map((l) => l.accountCode));
    expect([...used].sort()).toEqual([ACCOUNT_ATM_VAULT, ACCOUNT_ATM_SURCHARGE_INCOME].sort());
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  IDEMPOTENCE
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("§3 the same settled day cannot post twice", () => {
  it("re-running produces a byte-identical key", () => {
    const a = buildAtmSettlementProposal(DAY);
    const b = buildAtmSettlementProposal({ ...DAY });
    expect(b.idempotencyKey).toBe(a.idempotencyKey);
  });

  it("terminal casing and padding cannot mint a second key", () => {
    const a = buildAtmSettlementProposal(DAY);
    const messy = buildAtmSettlementProposal({ ...DAY, terminalId: " hg26499 " });
    // Without normalising, one machine on one day would carry two keys, and the
    // duplicate check would pass both.
    expect(messy.idempotencyKey).toBe(a.idempotencyKey);
  });

  it("a different day is a different key", () => {
    const a = buildAtmSettlementProposal(DAY);
    const b = buildAtmSettlementProposal({ ...DAY, settlementDate: "2026-07-16" });
    expect(b.idempotencyKey).not.toBe(a.idempotencyKey);
  });

  /**
   * The ref is built from terminal + date, which migration 0156 already makes
   * unique, and NOT from the row's uuid. A re-import that deletes and reinserts
   * the row mints a fresh uuid for the same economic day, and a uuid-keyed
   * entry would sail past the duplicate check and post the day a second time.
   */
  it("is derived from the day itself, not from a row id", () => {
    expect(atmSettlementSourceRef("HG26499", "2026-07-15")).toBe("atm-settle:HG26499:2026-07-15");
  });

  /**
   * This test exists because a mutation escaped.
   *
   * Removing `.trim().toUpperCase()` from `atmSettlementSourceRef` left the
   * whole suite green. The "terminal casing cannot mint a second key" test
   * above goes through `buildAtmSettlementProposal`, which happens to
   * upper-case the terminal itself before calling the ref builder — so the
   * ref's own normalisation was never being exercised, and the test that
   * appeared to cover it was covering the caller instead.
   *
   * That gap matters more than it sounds. `atmSettlementSourceRef` is exported,
   * step 2's sweep and step 3's cross-check will both reach for it, and the
   * first caller that passes a terminal straight off a CSV — where ` hg26499 `
   * is entirely ordinary — would mint a second key for a day already posted.
   * The duplicate check would pass it, and the money would post twice.
   *
   * So this one calls the function directly, which is the only way to hold it
   * to account (rule 129 — one assertion per risk, aimed at the real risk).
   */
  it("normalises at the ref itself, not only at its caller", () => {
    expect(atmSettlementSourceRef(" hg26499 ", "2026-07-15")).toBe(
      atmSettlementSourceRef("HG26499", "2026-07-15"),
    );
    expect(atmSettlementSourceRef("HG26499", " 2026-07-15 ")).toBe(
      atmSettlementSourceRef("HG26499", "2026-07-15"),
    );
  });

  it("refuses to invent an identity when one is missing", () => {
    expect(() => atmSettlementSourceRef("", "2026-07-15")).toThrow(/ATM_NO_SOURCE_REF/);
    expect(() => atmSettlementSourceRef("HG26499", "")).toThrow(/ATM_NO_SOURCE_REF/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  IT NEVER POSTS BY ITSELF
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("§4 a person reconciles the ATM against a physical count", () => {
  it("every proposal is marked not postable", () => {
    for (const p of buildAtmSettlementProposals([DAY, { ...DAY, terminalId: "" }])) {
      expect(p.postable).toBe(false);
    }
  });

  /**
   * This asserts against `posting-core` itself rather than restating its rule,
   * so the two cannot drift into disagreeing. If `atm` were ever added to the
   * autopostable list, this fails here — at the ATM, where the consequence is —
   * rather than silently becoming permission.
   */
  it("the ledger's own rules agree that atm is never automatic", () => {
    expect(AUTOPOSTABLE_SOURCE_KINDS).not.toContain("atm");
    expect(NEVER_AUTOPOST_REASONS.atm).toBe(ATM_WHY_NOT_AUTOMATIC);
  });

  it("the posting door sends it to a human, with a reason Michael can read", () => {
    const decision = decidePosting(
      {
        entityCode: "atm",
        journalDate: DAY.settlementDate,
        sourceKind: "atm",
        amountCents: 32_500,
        sourceRef: buildAtmSettlementProposal(DAY).sourceRef,
        // No template and nothing to match against. Stated rather than
        // omitted: `atm` is refused for being `atm`, long before the template
        // gates are reached, and that is the point being asserted.
        expectedCents: null,
        templateCode: null,
      },
      null,
    );
    expect(decision.disposition).toBe("draft");
    expect(decision.code).toBe("AUTOPOST_NOT_ELIGIBLE");
    expect(decision.reason).toBe(ATM_WHY_NOT_AUTOMATIC);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  REFUSALS — a blank is not a zero
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("§5 what it refuses to guess", () => {
  it("accepts the good day (rule 55 — refusals only mean something if this holds)", () => {
    expect(atmSettlementRefusal(DAY)).toBeNull();
  });

  /**
   * The D-22 lesson, one layer up. Migration 0183 states the rule for this
   * whole subsystem: "NULL means 'not reported' -- never zero." A day PAI did
   * not report is not a day the ATM earned nothing, and posting it as zero
   * would put a false fact in the ledger that looks exactly like a true one.
   */
  it("a day PAI did not report is refused, not read as zero", () => {
    const r = atmSettlementRefusal({
      ...DAY,
      surchargeCents: null,
      terminalTransactionCents: null,
    });
    expect(r).not.toBeNull();
    expect(r).toContain("A blank is not a zero");
  });

  it("refuses an impossible date", () => {
    expect(atmSettlementRefusal({ ...DAY, settlementDate: "2026-02-30" })).not.toBeNull();
    expect(atmSettlementRefusal({ ...DAY, settlementDate: "not-a-date" })).not.toBeNull();
  });

  it("refuses a day with no terminal, because it could not be identified", () => {
    expect(atmSettlementRefusal({ ...DAY, terminalId: "   " })).not.toBeNull();
  });

  it("refuses a genuinely zero day rather than writing an empty entry", () => {
    expect(
      atmSettlementRefusal({ ...DAY, surchargeCents: 0, terminalTransactionCents: 0 }),
    ).not.toBeNull();
  });

  it("refuses a negative figure and shows it instead", () => {
    const r = atmSettlementRefusal({ ...DAY, surchargeCents: -100 });
    expect(r).not.toBeNull();
    expect(r).toContain("negative");
  });

  it("refuses a fractional cent", () => {
    expect(atmSettlementRefusal({ ...DAY, surchargeCents: 1.5 })).not.toBeNull();
  });

  it("a refused day carries nothing that could be posted by accident", () => {
    const p = buildAtmSettlementProposal({ ...DAY, terminalId: "" });
    expect(p.refusal).not.toBeNull();
    expect(p.lines).toHaveLength(0);
    expect(p.idempotencyKey).toBe("");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  THE POPULATION — rule 43
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("§6 refused days are shown, never quietly dropped", () => {
  it("returns one proposal per day handed in, good or bad", () => {
    const facts = [DAY, { ...DAY, terminalId: "" }, { ...DAY, settlementDate: "2026-07-16" }];
    expect(buildAtmSettlementProposals(facts)).toHaveLength(facts.length);
  });

  it("the summary says the refusal count out loud", () => {
    const s = summariseProposals(buildAtmSettlementProposals([DAY, { ...DAY, terminalId: "" }]));
    expect(s.total).toBe(2);
    expect(s.ready).toBe(1);
    expect(s.refused).toBe(1);
    // "1 day ready" printed beside a silent refusal is the report that hides
    // the problem. The sentence has to carry both numbers.
    expect(s.sentence).toContain("1 day was not turned into an entry");
  });

  it("the summary totals real money, in dollars Michael can check", () => {
    const s = summariseProposals(buildAtmSettlementProposals([DAY, { ...DAY, settlementDate: "2026-07-16" }]));
    expect(s.surchargeCents).toBe(65_000);
    expect(s.sentence).toContain("$650.00");
  });

  it("says so honestly when there is nothing to post", () => {
    const s = summariseProposals([]);
    expect(s.total).toBe(0);
    expect(s.sentence).toContain("nothing to post");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * §7  IT IS ACTUALLY CONNECTED
 *
 * The entire books-69 recon finding was that the ATM subsystem looked wired to
 * the ledger and was not: fourteen modules, five test files, three migrations,
 * and `grep -rn "51000" src` returned nothing at all. A perfect posting core
 * that no store ever calls would reproduce that exact situation with a better
 * test suite attached — standing rule 50, dead code wearing a green check.
 *
 * `atm/store.ts` is `server-only`, so it cannot be imported here. Its source is
 * read instead. That is a weaker check than calling the function and is chosen
 * knowingly: the alternative is a database in the test suite, and the wiring
 * this guards is one call site.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("§7 the posting core is reachable from the store", () => {
  const storeSrc = readFileSync(
    join(__dirname, "..", "..", "src", "lib", "atm", "store.ts"),
    "utf8",
  );

  it("the store imports the posting core and exposes the proposals", () => {
    expect(storeSrc).toContain('from "@/lib/atm/atm-posting-core"');
    expect(storeSrc).toContain("export async function listAtmSettlementProposals");
    expect(storeSrc).toContain("buildAtmSettlementProposals(");
  });

  it("account 51000 is referenced by real code, which was the recon's finding", () => {
    // Before books-69 this account existed in the chart and in no source file.
    expect(ACCOUNT_ATM_SURCHARGE_INCOME).toBe("51000");
    expect(ACCOUNT_ATM_VAULT).toBe("10300");
  });
});
