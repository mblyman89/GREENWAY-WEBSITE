/**
 * tests/compliance/atm-sweep-core.test.ts   (books-69 step 2)
 *
 * THE SWEEP AS AN INTERCOMPANY PAIR — WHAT MUST NOT BE ALLOWED TO BREAK.
 *
 * Organised by RISK, not by function (standing rule 129: one assertion per
 * risk). Each section names the thing that would go wrong in Michael's books if
 * the code drifted, so a failure here reads as a consequence rather than as a
 * broken expectation.
 *
 * Every hard-coded uuid in this file was MEASURED — computed with Python's
 * `uuid.uuid5` over the frozen namespace, independently of the TypeScript that
 * produces it. An assertion that merely restates what the code does would pass
 * against a wrong implementation of v5; these do not.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import {
  ACCOUNT_ATM_VAULT,
  ACCOUNT_BANK_OPERATING,
  ACCOUNT_DUE_TO_FROM,
  ACCOUNT_SHAREHOLDER_DISTRIBUTIONS,
  BANK_ATM,
  BANK_CANNABIS,
  BANK_PERSONAL,
  SWEEP_WHY_NOT_AUTOMATIC,
  buildSweepProposal,
  buildSweepProposals,
  parseTransferDescription,
  summariseSweeps,
  sweepBalance,
  sweepNaturalKey,
  sweepRefUuid,
  sweepRefusal,
  withOccurrences,
  type SweepFacts,
} from "@/lib/atm/atm-sweep-core";
import {
  AUTOPOSTABLE_SOURCE_KINDS,
  NEVER_AUTOPOST_REASONS,
  buildIdempotencyKey,
} from "@/lib/accounting/posting-core";

// ---------------------------------------------------------------------------
// The real rows, measured from
// /workspace/Timberland Bank ATM Account 5.1.26-8.23.26.csv
// ---------------------------------------------------------------------------

/** 2026-08-21, $11,427.50 to the cannabis account. */
const SWEEP: SweepFacts = {
  processedDate: "2026-08-21",
  description: "TRANSFER FROM X6228 TO X6048",
  amountCents: 1_142_750,
  creditOrDebit: "Debit",
  occurrence: 1,
};

/** 2026-07-03, $5,242.50 to PERSONAL checking — the one row in sixty-seven. */
const PERSONAL: SweepFacts = {
  processedDate: "2026-07-03",
  description: "TRANSFER FROM X6228 TO X3557",
  amountCents: 524_250,
  creditOrDebit: "Debit",
  occurrence: 1,
};

// ===========================================================================
// §1  THE BOOKS MUST BALANCE — AND THE CHECK MUST BE CAPABLE OF FAILING
// ===========================================================================

describe("the sweep balances on both sets of books", () => {
  it("nets to zero on each side, and each side actually has lines", () => {
    const b = sweepBalance(buildSweepProposal(SWEEP));
    expect(b.a).toBe(0);
    expect(b.b).toBe(0);
    // WHY hasA/hasB EXIST. `[].reduce((s, l) => s + l, 0)` is 0, so a balance
    // assertion on an empty proposal passes for the wrong reason — an
    // assertion that cannot fail proves nothing (standing rule 39). These two
    // make the emptiness itself visible.
    expect(b.hasA).toBe(true);
    expect(b.hasB).toBe(true);
  });

  it("a refused row has no lines, so a bare balance check on it would be meaningless", () => {
    const b = sweepBalance(buildSweepProposal({ ...SWEEP, amountCents: 0 }));
    expect(b.a).toBe(0); // true, and worthless on its own
    expect(b.hasA).toBe(false); // this is the assertion that carries the meaning
    expect(b.hasB).toBe(false);
  });

  it("moves the money in the direction the bank says it moved", () => {
    const p = buildSweepProposal(SWEEP);
    const vault = p.linesA.find((l) => l.accountCode === ACCOUNT_ATM_VAULT);
    const operating = p.linesB.find((l) => l.accountCode === ACCOUNT_BANK_OPERATING);
    // Both accounts are DEBIT-normal (0173 seeded them contra by an argument
    // slip; migration 0178 corrected it). Cash leaving is a credit, cash
    // arriving is a debit. Reversing either would report Michael's cash
    // backwards.
    expect(vault?.amountCents).toBe(-SWEEP.amountCents);
    expect(operating?.amountCents).toBe(SWEEP.amountCents);
  });
});

// ===========================================================================
// §2  CONSOLIDATION MUST STILL NET TO ZERO
// ===========================================================================

describe("36000 nets to zero across the group", () => {
  it("puts equal and opposite legs on the two entities", () => {
    const p = buildSweepProposal(SWEEP);
    const a = p.linesA.find((l) => l.accountCode === ACCOUNT_DUE_TO_FROM)?.amountCents ?? 0;
    const b = p.linesB.find((l) => l.accountCode === ACCOUNT_DUE_TO_FROM)?.amountCents ?? 0;
    expect(a).not.toBe(0);
    expect(a + b).toBe(0);
    // The seed comment on 36000 in migration 0173 states the rule this
    // enforces: "Must net to ZERO across all four on consolidation — a
    // standing close check." Same-signed legs would leave a permanent
    // fictitious balance in the consolidated statements.
  });

  it("spans two DIFFERENT sets of books, which the database requires", () => {
    const p = buildSweepProposal(SWEEP);
    expect(p.entityA).toBe("atm");
    expect(p.entityB).toBe("greenway");
    // gl_submit_intercompany_pair raises GL_INTERCOMPANY_SAME_ENTITY when the
    // two entities match, so a proposal with one entity on both sides would be
    // rejected at the door.
    expect(p.entityA).not.toBe(p.entityB);
  });
});

// ===========================================================================
// §3  THE PERSONAL TRANSFER IS A DISTRIBUTION, ON ONE SET OF BOOKS
// ===========================================================================

describe("the transfer to personal checking", () => {
  it("is a distribution against 41000, never a debt through 36000", () => {
    const d = buildSweepProposal(PERSONAL);
    expect(d.kind).toBe("distribution");
    expect(d.linesA.map((l) => l.accountCode)).toContain(ACCOUNT_SHAREHOLDER_DISTRIBUTIONS);
    expect(d.linesA.map((l) => l.accountCode)).not.toContain(ACCOUNT_DUE_TO_FROM);
    // An undocumented "loan" to an owner is routinely re-characterised as a
    // distribution on examination. Having called it a loan first is worse than
    // having called it a distribution, so 36000 is the wrong answer here even
    // though `personal` is a valid entity and the pair would post cleanly.
  });

  it("DEBITS 41000, because it is contra-equity and therefore debit-normal", () => {
    const d = buildSweepProposal(PERSONAL);
    const line = d.linesA.find((l) => l.accountCode === ACCOUNT_SHAREHOLDER_DISTRIBUTIONS);
    expect(line?.amountCents).toBe(PERSONAL.amountCents);
    expect(line?.amountCents).toBeGreaterThan(0);
    // 0173 seeds 41000 as `equity` with is_contra = true, so gl_upsert_account
    // derives normal_balance = 'debit'. gl_trial_balance (0175) flags a
    // debit-normal account with a negative balance as is_abnormal, so a credit
    // here would raise a permanent false alarm on the trial balance.
  });

  it("is ONE entry, not an intercompany pair — the defect this replaced", () => {
    const d = buildSweepProposal(PERSONAL);
    expect(d.entityB).toBeNull();
    expect(d.linesB).toEqual([]);
    // THE DEFECT, RECORDED. The first draft of atm-sweep-core proposed a pair:
    // debit 41000 on the ATM books, credit 41000 on the personal books. 41000
    // is not entity-scoped, so those two legs SUM TO ZERO across the group and
    // the distribution would disappear from the consolidated equity statement.
    // Michael's S-corp basis and §1368 analysis are computed from
    // distributions; one that nets itself out understates both.
  });

  it("balances on its single side", () => {
    const b = sweepBalance(buildSweepProposal(PERSONAL));
    expect(b.a).toBe(0);
    expect(b.hasA).toBe(true);
    expect(b.hasB).toBe(false);
  });

  it("states the judgment out loud instead of burying it", () => {
    const d = buildSweepProposal(PERSONAL);
    expect(d.assumptionNote).toMatch(/re-characterised/i);
    expect(d.assumptionNote).toContain(ACCOUNT_DUE_TO_FROM);
  });
});

// ===========================================================================
// §4  NOTHING POSTS ITSELF
// ===========================================================================

describe("nothing posts itself", () => {
  it("marks every proposal unpostable", () => {
    for (const f of [SWEEP, PERSONAL, { ...SWEEP, amountCents: 0 }]) {
      expect(buildSweepProposal(f).postable).toBe(false);
    }
  });

  it("is unpostable because the LEDGER says so, not because this file says so", () => {
    // Asserted against posting-core itself rather than restated here, so the
    // rule cannot drift out of agreement with the ledger it describes.
    expect(AUTOPOSTABLE_SOURCE_KINDS).not.toContain("intercompany");
    expect(AUTOPOSTABLE_SOURCE_KINDS).not.toContain("atm");
  });

  it("shows Michael the ledger's own words, verbatim", () => {
    expect(SWEEP_WHY_NOT_AUTOMATIC).toBe(NEVER_AUTOPOST_REASONS.intercompany);
    expect(buildSweepProposal(SWEEP).whyNotAutomatic).toBe(NEVER_AUTOPOST_REASONS.intercompany);
  });
});

// ===========================================================================
// §5  THE REFERENCE MUST BE SOMETHING THE DATABASE WILL ACCEPT
// ===========================================================================

describe("the intercompany reference", () => {
  it("is a syntactically valid version-5 uuid", () => {
    const p = buildSweepProposal(SWEEP);
    // gl_journals.intercompany_ref is `uuid` (migration 0172) and
    // gl_submit_intercompany_pair takes `p_ref uuid`. THE DEFECT THIS CATCHES:
    // the first draft emitted "atm-sweep:2026-08-21:6048:1142750", which
    // Postgres would have rejected the first time Michael pressed the button.
    // No pure unit test would have noticed, because nothing pure meets the
    // column's type.
    expect(p.ref).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("matches the uuid measured independently in Python", () => {
    // uuid.uuid5(UUID("3f2a7c14-9b8e-4d55-a1c2-6e0f5b83d907"), key)
    expect(sweepRefUuid("atm-sweep:2026-08-21:6048:1142750#1")).toBe(
      "335bca7a-305d-5f60-9553-14432d1d49d1",
    );
    expect(sweepRefUuid("atm-sweep:2026-07-03:3557:524250#1")).toBe(
      "85d434d7-bf2c-59b0-8208-3348d9f2e641",
    );
    expect(sweepRefUuid("atm-sweep:2026-05-26:6048:352250#1")).toBe(
      "d4d8b054-af33-582a-87fa-1fef1f7c60d7",
    );
    expect(sweepRefUuid("atm-sweep:2026-05-26:6048:2061000#1")).toBe(
      "82641de9-5e07-5fb5-a306-99044556e621",
    );
  });

  it("is deterministic, so re-importing a statement keeps the halves tied together", () => {
    expect(buildSweepProposal(SWEEP).ref).toBe(buildSweepProposal(SWEEP).ref);
    // A random uuid would mint a new ref on every import and yesterday's two
    // halves would stop pointing at each other.
  });

  it("keeps a human-readable natural key for the auditor", () => {
    const p = buildSweepProposal(SWEEP);
    expect(p.naturalKey).toBe("atm-sweep:2026-08-21:6048:1142750#1");
    expect(p.sourceRefA).toBe("atm-sweep:2026-08-21:6048:1142750#1:atm");
    expect(p.sourceRefB).toBe("atm-sweep:2026-08-21:6048:1142750#1:greenway");
    // The uuid is only the join. The source_ref is what someone reads in the
    // ledger to find out WHICH bank line an entry came from.
  });

  it("gives the two halves different source refs, so neither swallows the other", () => {
    const p = buildSweepProposal(SWEEP);
    expect(p.sourceRefA).not.toBe(p.sourceRefB);
    // The halves are on different entities, so the keys differ anyway; this
    // asserts the belt as well as the braces.
    expect(buildIdempotencyKey("atm", "intercompany", p.sourceRefA)).not.toBe(
      buildIdempotencyKey("greenway", "intercompany", p.sourceRefB),
    );
  });
});

// ===========================================================================
// §6  TWO TRANSFERS ON ONE DAY — MONEY THAT WOULD OTHERWISE VANISH
// ===========================================================================

describe("same-day transfers", () => {
  it("distinguishes the two REAL sweeps on 2026-05-26", () => {
    // Both are in the statement: $3,522.50 and $20,610.00.
    const a = buildSweepProposal({
      processedDate: "2026-05-26",
      description: "TRANSFER FROM X6228 TO X6048",
      amountCents: 352_250,
      creditOrDebit: "Debit",
      occurrence: 1,
    });
    const b = buildSweepProposal({
      processedDate: "2026-05-26",
      description: "TRANSFER FROM X6228 TO X6048",
      amountCents: 2_061_000,
      creditOrDebit: "Debit",
      occurrence: 1,
    });
    expect(a.ref).not.toBe(b.ref);
    expect(a.sourceRefA).not.toBe(b.sourceRefA);
  });

  it("distinguishes two IDENTICAL transfers on one day", () => {
    const first = buildSweepProposal({ ...SWEEP, occurrence: 1 });
    const second = buildSweepProposal({ ...SWEEP, occurrence: 2 });
    expect(first.sourceRefA).not.toBe(second.sourceRefA);
    expect(first.ref).not.toBe(second.ref);
    // WHY THIS IS THE MOST IMPORTANT TEST IN THE FILE. gl_submit_journal keys
    // idempotency on entity:source_kind:source_ref. When the key already
    // exists with the same line fingerprint it returns GL_DUPLICATE_IGNORED
    // and writes NOTHING — correctly. So two identical same-day transfers
    // sharing a source_ref would post once, and the second one's money would
    // disappear from the books behind a cheerful "already recorded".
    expect(buildIdempotencyKey("atm", "intercompany", first.sourceRefA)).not.toBe(
      buildIdempotencyKey("atm", "intercompany", second.sourceRefA),
    );
  });

  it("refuses a row with no occurrence rather than defaulting it to 1", () => {
    expect(sweepRefusal({ ...SWEEP, occurrence: 0 })).toMatch(/position/i);
    // A default of 1 would make the dangerous case (a second identical row)
    // look exactly like the safe case at every call site.
  });

  it("numbers identical rows for the caller", () => {
    const rows = withOccurrences([
      { processedDate: "2026-05-26", description: "TRANSFER FROM X6228 TO X6048", amountCents: 100, creditOrDebit: "Debit" },
      { processedDate: "2026-05-26", description: "TRANSFER FROM X6228 TO X6048", amountCents: 100, creditOrDebit: "Debit" },
      { processedDate: "2026-05-26", description: "TRANSFER FROM X6228 TO X6048", amountCents: 200, creditOrDebit: "Debit" },
      { processedDate: "2026-05-27", description: "TRANSFER FROM X6228 TO X6048", amountCents: 100, creditOrDebit: "Debit" },
    ]);
    expect(rows.map((r) => r.occurrence)).toEqual([1, 2, 1, 1]);
  });
});

// ===========================================================================
// §7  REFUSALS — INCLUDING THE ONES NOVEMBER AND JANUARY WILL PRODUCE
// ===========================================================================

describe("what it refuses to guess at", () => {
  it("refuses an unrecognised destination instead of assuming a sweep", () => {
    const r = sweepRefusal({ ...SWEEP, description: "TRANSFER FROM X6228 TO X9999" });
    expect(r).not.toBeNull();
    expect(r).toContain("9999");
    // Michael starts paying vendors from 6228 on November 1 and payroll on
    // January 1. Those will arrive here as debits to destinations this module
    // has never seen. Surfacing them for classification is the whole point;
    // absorbing them into "sweep to the store" would overstate what the store
    // owes the ATM business by the whole amount.
  });

  it("refuses a credit, which is money arriving rather than leaving", () => {
    expect(sweepRefusal({ ...SWEEP, creditOrDebit: "Credit" })).toMatch(/reverse of a sweep/i);
  });

  it("refuses a transfer that does not leave the ATM account", () => {
    expect(sweepRefusal({ ...SWEEP, description: "TRANSFER FROM X6048 TO X6228" })).toContain(
      BANK_ATM,
    );
  });

  it("refuses impossible dates and amounts", () => {
    expect(sweepRefusal({ ...SWEEP, processedDate: "2026-02-30" })).not.toBeNull();
    expect(sweepRefusal({ ...SWEEP, processedDate: "not a date" })).not.toBeNull();
    expect(sweepRefusal({ ...SWEEP, amountCents: 0 })).not.toBeNull();
    expect(sweepRefusal({ ...SWEEP, amountCents: -100 })).not.toBeNull();
    expect(sweepRefusal({ ...SWEEP, amountCents: 1.5 })).not.toBeNull();
  });

  it("accepts the two real rows", () => {
    expect(sweepRefusal(SWEEP)).toBeNull();
    expect(sweepRefusal(PERSONAL)).toBeNull();
  });

  it("carries no lines at all when it refuses, so nothing half-formed can post", () => {
    const p = buildSweepProposal({ ...SWEEP, description: "TRANSFER FROM X6228 TO X9999" });
    expect(p.kind).toBe("unrecognised");
    expect(p.linesA).toEqual([]);
    expect(p.linesB).toEqual([]);
    expect(p.ref).toBe("");
    expect(p.naturalKey).toBe("");
  });
});

// ===========================================================================
// §8  THE POPULATION, WALKED
// ===========================================================================

describe("the statement's whole vocabulary", () => {
  it("recognises only transfers, and none of the other four descriptions", () => {
    // All five distinct descriptions in the 301-row statement, counted:
    //   230  DLY SETTLE MVNT - HG26499 CCD
    //    66  TRANSFER FROM X6228 TO X6048
    //     3  ACCOUNT ANALYSIS CHARGE
    //     1  EFTRANSACT PAYMENT ALLIANCE PPD
    //     1  TRANSFER FROM X6228 TO X3557
    expect(parseTransferDescription("TRANSFER FROM X6228 TO X6048")).toEqual({
      from: BANK_ATM,
      to: BANK_CANNABIS,
    });
    expect(parseTransferDescription("TRANSFER FROM X6228 TO X3557")).toEqual({
      from: BANK_ATM,
      to: BANK_PERSONAL,
    });
    expect(parseTransferDescription("DLY SETTLE MVNT - HG26499 CCD")).toBeNull();
    expect(parseTransferDescription("ACCOUNT ANALYSIS CHARGE")).toBeNull();
    expect(parseTransferDescription("EFTRANSACT PAYMENT ALLIANCE PPD")).toBeNull();
  });

  it("does not mine four digits out of the terminal id", () => {
    // A looser "find any four digits" pattern would match 6499 inside HG26499
    // and invent transfers that never happened.
    expect(parseTransferDescription("DLY SETTLE MVNT - HG26499 CCD")).toBeNull();
    expect(parseTransferDescription("TRANSFER HG26499 CCD 6048")).toBeNull();
  });

  it("filters non-transfers rather than refusing them one at a time", () => {
    const rows: SweepFacts[] = [
      SWEEP,
      PERSONAL,
      { ...SWEEP, description: "DLY SETTLE MVNT - HG26499 CCD" },
      { ...SWEEP, description: "ACCOUNT ANALYSIS CHARGE" },
      { ...SWEEP, description: "EFTRANSACT PAYMENT ALLIANCE PPD" },
    ];
    const out = buildSweepProposals(rows);
    expect(out.length).toBe(2);
    // 234 "this is not a transfer" refusals would bury the one row that
    // genuinely needs Michael's attention.
    expect(out.every((p) => p.refusal === null)).toBe(true);
  });

  it("keeps a transfer it cannot handle, with its reason", () => {
    const out = buildSweepProposals([
      SWEEP,
      { ...SWEEP, description: "TRANSFER FROM X6228 TO X9999" },
    ]);
    expect(out.length).toBe(2);
    expect(out.filter((p) => p.refusal !== null).length).toBe(1);
  });
});

// ===========================================================================
// §9  THE SUMMARY MICHAEL READS
// ===========================================================================

describe("the summary", () => {
  it("never merges a distribution into the sweep total", () => {
    const s = summariseSweeps(buildSweepProposals([SWEEP, PERSONAL]));
    expect(s.intercompany).toBe(1);
    expect(s.intercompanyCents).toBe(1_142_750);
    expect(s.distributions).toBe(1);
    expect(s.distributionCents).toBe(524_250);
    // Merged, the $5,242.50 would silently become part of what the store owes
    // the ATM business.
  });

  it("names the personal transfer in plain English and promises nothing posts", () => {
    const s = summariseSweeps(buildSweepProposals([SWEEP, PERSONAL]));
    expect(s.sentence).toContain("personal checking");
    expect(s.sentence).toContain("$5,242.50");
    expect(s.sentence).toMatch(/nothing posts until you approve it/i);
  });

  it("counts refusals separately from both", () => {
    const s = summariseSweeps(
      buildSweepProposals([SWEEP, PERSONAL, { ...SWEEP, description: "TRANSFER FROM X6228 TO X9999" }]),
    );
    expect(s.refused).toBe(1);
    expect(s.intercompany).toBe(1);
    expect(s.distributions).toBe(1);
  });

  it("says so plainly when there is nothing to report", () => {
    expect(summariseSweeps([]).sentence).toMatch(/no transfers/i);
  });
});

// ===========================================================================
// §10  THE KEY BUILDER, EXERCISED DIRECTLY
// ===========================================================================

describe("§11 the sweep core is reachable from the store", () => {
  // The books-69 recon's whole finding was that the ATM subsystem LOOKED wired
  // to the ledger and was not. A flawless sweep core that no store ever calls
  // would reproduce that situation with a better test suite attached — standing
  // rule 50, dead code wearing a green check.
  //
  // `atm/store.ts` is `server-only` and cannot be imported here, so its source
  // is read. That is weaker than calling the function and is chosen knowingly:
  // the alternative is a live database in the unit suite.
  const storeSrc = readFileSync(
    join(__dirname, "..", "..", "src", "lib", "atm", "store.ts"),
    "utf8",
  );

  it("the store imports the sweep core and exposes the proposals", () => {
    expect(storeSrc).toContain('from "@/lib/atm/atm-sweep-core"');
    expect(storeSrc).toContain("export async function listAtmSweepProposals");
    expect(storeSrc).toContain("buildSweepProposals(");
  });

  it("assigns occurrences at the store, or same-day duplicates lose money", () => {
    // The core REQUIRES an occurrence and refuses without one, so a store that
    // forgot this call would refuse every row rather than post a wrong one.
    // Asserted anyway, because "everything is refused" is a silent failure of a
    // different kind: the screen simply goes empty.
    expect(storeSrc).toContain("withOccurrences(");
  });

  it("sorts oldest-first before numbering, because Plaid returns newest-first", () => {
    // Numbering a same-day pair in reverse would keep the refs stable but swap
    // which bank row each one describes between imports.
    expect(storeSrc).toContain("rows.sort(");
  });
});

// ===========================================================================
// §12  THE KEY BUILDER, EXERCISED DIRECTLY
// ===========================================================================

describe("sweepNaturalKey", () => {
  it("carries all four distinguishing facts", () => {
    // Called directly rather than only through buildSweepProposal. MUTANT
    // LESSON from books-69 step 1: a normalisation asserted only through its
    // caller can be deleted from the function itself and every test stays
    // green, because the caller happened to do the same work.
    const k = sweepNaturalKey(SWEEP, BANK_CANNABIS);
    expect(k).toBe("atm-sweep:2026-08-21:6048:1142750#1");
    expect(sweepNaturalKey({ ...SWEEP, occurrence: 2 }, BANK_CANNABIS)).toBe(
      "atm-sweep:2026-08-21:6048:1142750#2",
    );
    expect(sweepNaturalKey(SWEEP, BANK_PERSONAL)).toBe("atm-sweep:2026-08-21:3557:1142750#1");
  });
});
