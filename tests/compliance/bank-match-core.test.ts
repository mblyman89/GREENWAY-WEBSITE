/**
 * tests/compliance/bank-match-core.test.ts   (slice books-05)
 *
 * THE SECOND GATE over the bank-matching brain.
 *
 * `bank-match-core.ts` carries its own `__runBankMatchCoreTests()`, which the
 * pure self-test runner calls. This file re-runs that suite under vitest AND
 * adds independent assertions that do not exist inside the module.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO GATES OVER THE SAME CODE
 * ---------------------------------------------------------------------------
 * A self-test that lives inside the module it tests can be weakened by the very
 * edit that breaks the module — delete a rule and its assertion in one stroke
 * and the suite still passes, green and confident. The mutation campaign for
 * this slice requires every real mutant to die on BOTH gates; a mutant that dies
 * only in one is a warning that one gate has gone decorative.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PARTICULAR MODULE GETS THE LONGEST TEST FILE IN THE SLICE
 * ---------------------------------------------------------------------------
 * Every other part of the books fails LOUDLY. An out-of-balance payroll run
 * will not post. A bill with no vendor will not post. Bank matching is the
 * exception, and it is the whole reason this file exists:
 *
 *     A WRONGLY MATCHED BANK TRANSACTION STILL BALANCES.
 *
 * Flip the sign and BOTH lines flip together, so debits still equal credits.
 * Code an own-account transfer as revenue and the entry balances. Post the same
 * bank row twice and both entries balance. There is no imbalance, no error, no
 * red text anywhere on any screen. The only symptom is a wrong tax return,
 * discovered — if ever — by an examiner rather than by the owner.
 *
 * Ordinary tests confirm that correct input produces correct output. That is
 * not enough here, because the failure mode under test produces output that
 * looks correct. So the assertions below are weighted toward proving that the
 * REFUSALS actually fire, that the arithmetic identities hold for adversarial
 * input, and that the verbatim legal text has not drifted.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS TESTED HERE THAT IS *NOT* TESTED INSIDE THE MODULE
 * ---------------------------------------------------------------------------
 *   • BIDIRECTIONAL REFUSAL-CODE DRIFT against gl-refusal-core.ts: no bank
 *     refusal code without a plain-English translation, and no orphan
 *     translation for a code that no longer exists.
 *   • CROSS-FILE PARITY against migration 0189, proving the TypeScript engine
 *     and the database agree about the sign convention, the D8 columns, the
 *     sign-off gate and the codes each one raises. Two layers that disagree
 *     are worse than one layer, because each looks authoritative.
 *   • SOURCE-LEVEL DRIFT checks that read the file from disk, so a future edit
 *     that paraphrases a verbatim statutory quote or quietly disarms a control
 *     fails HERE rather than in front of an examiner.
 *   • PROPERTY-BASED sweeps over the sign bridge and the reconciliation
 *     identity, which catch the cases nobody thinks to write by hand.
 *   • The D8 invariant asserted STRUCTURALLY: `complete` may never be true
 *     while a single unrecorded item remains, for any input whatsoever.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  __runBankMatchCoreTests,
  plaidToLedgerCashCents,
  bankDirection,
  bankMagnitudeCents,
  evaluateMatch,
  reconcile,
  reconciliationBars,
  buildLoanPaymentLines,
  sumLines,
  interestCostClassFor,
  detectStructuringPattern,
  scoreMatch,
  classifyBankRow,
  labelForKind,
  parseIsoDateParts,
  isoToDayNumber,
  daysApart,
  isOnOrAfterCutover,
  clampMilliPct,
  formatCents,
  formatSignedCents,
  ALL_BANK_FINDING_CODES,
  MATCH_WINDOW_DAYS,
  MATCH_WINDOW_HARD_DAYS,
  LINE_IN_THE_SAND,
  CTR_THRESHOLD_CENTS,
  STRUCTURING_NEAR_MISS_CENTS,
  type BankRow,
  type JournalCandidate,
  type MatchRequest,
  type BankFindingCode,
  type ReconciliationInput,
} from "../../src/lib/accounting/bank-match-core";

import { knownRefusalCodes } from "../../src/lib/accounting/gl-refusal-core";

const SRC = readFileSync(
  resolve(__dirname, "../../src/lib/accounting/bank-match-core.ts"),
  "utf8",
);

/**
 * The source with COMMENTS REMOVED.
 *
 * Why this exists, and why it is not fussiness: a guard that scans the raw file
 * for a forbidden construct will also match that construct inside a comment
 * that EXPLAINS WHY IT IS FORBIDDEN. Three guards in this file failed on their
 * first run for exactly that reason — the module documents why `new Date(...)`
 * is dangerous, and the guard flagged the warning as if it were the offence.
 *
 * The tempting fix is to delete the explanation so the test goes green. That is
 * precisely backwards, and it is the same failure this whole slice is about:
 * editing the thing being measured to satisfy the measurement. The correct fix
 * is to measure the right thing — executable code — and to leave the teaching
 * material alone.
 *
 * Block comments first, then line comments. Applied in that order so that a
 * `//` sitting inside a block comment cannot resurrect the rest of the line.
 */
const CODE_ONLY = SRC.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const MIGRATION = readFileSync(
  resolve(__dirname, "../../supabase/migrations/0189_bank_matching.sql"),
  "utf8",
);

// ---------------------------------------------------------------------------
// Builders. Deliberately verbose defaults so each test states only the ONE
// thing it is about, and a reader can see at a glance what is being varied.
// ---------------------------------------------------------------------------
function row(over: Partial<BankRow> = {}): BankRow {
  return {
    transactionId: "txn_1",
    accountId: "acct_1",
    amountCents: 25_000, // Plaid convention: POSITIVE = money OUT
    date: "2026-11-05",
    name: "SQ *GREENWAY",
    merchantName: null,
    pending: false,
    removed: false,
    categoryPrimary: null,
    ...over,
  };
}

function journal(over: Partial<JournalCandidate> = {}): JournalCandidate {
  return {
    journalId: "jrnl_1",
    entityCode: "greenway",
    journalDate: "2026-11-05",
    // Ledger convention: POSITIVE = DEBIT = money IN.
    // The mirror of a +25,000 Plaid row (money out) is -25,000 here.
    cashLineCents: -25_000,
    cashAccountCode: "10200",
    memo: "packaging supplies",
    sourceKind: "purchase",
    alreadyMatched: false,
    ...over,
  };
}

function req(over: Partial<MatchRequest> = {}): MatchRequest {
  return {
    row: row(),
    candidate: journal(),
    eventKind: "vendor_payment",
    entityCode: "greenway",
    ...over,
  };
}

function codesOf(v: { findings: { code: BankFindingCode }[] }): BankFindingCode[] {
  return v.findings.map((f) => f.code);
}

// ===========================================================================
// 1) THE MODULE'S OWN SUITE, RE-RUN UNDER VITEST
// ===========================================================================
describe("bank-match-core self-tests", () => {
  it("passes its own embedded suite", () => {
    expect(() => __runBankMatchCoreTests()).not.toThrow();
  });
});

// ===========================================================================
// 2) THE SIGN WALL — the single most consequential function in the slice
// ===========================================================================
/**
 * Plaid: POSITIVE means money LEFT the account.
 * Ledger: POSITIVE means DEBIT, and a debit to cash means money ARRIVED.
 *
 * They are exact opposites. Exactly one crossing must happen, in exactly one
 * place, and this is that place. Michael's old books contain the consequence of
 * getting this wrong — standing rule 19 records "backwards card signs" as part
 * of the permanent test corpus.
 */
describe("the sign wall", () => {
  it("crosses the convention exactly once", () => {
    expect(plaidToLedgerCashCents(25_000)).toBe(-25_000); // out -> credit
    expect(plaidToLedgerCashCents(-25_000)).toBe(25_000); // in  -> debit
  });

  it("never returns negative zero", () => {
    // -0 is a real JavaScript value. It compares equal to 0 with ===, prints as
    // "0", and survives JSON round-trips as "0" — but Object.is tells them
    // apart, and so does anything that formats a sign. A -0 leaking into a
    // ledger line is a defect that is nearly impossible to see afterwards.
    expect(Object.is(plaidToLedgerCashCents(0), 0)).toBe(true);
    expect(Object.is(plaidToLedgerCashCents(-0), 0)).toBe(true);
  });

  it("refuses fractional cents rather than rounding them away", () => {
    // A fraction here means something upstream did floating-point arithmetic on
    // money. Rounding it silently would hide the source of the problem while
    // continuing to produce slightly wrong numbers everywhere else.
    expect(() => plaidToLedgerCashCents(12.5)).toThrow(/BANK_NON_INTEGER_CENTS/);
    expect(() => plaidToLedgerCashCents(NaN)).toThrow(/BANK_NON_INTEGER_CENTS/);
    expect(() => plaidToLedgerCashCents(Infinity)).toThrow(/BANK_NON_INTEGER_CENTS/);
  });

  it("is its own inverse (property sweep)", () => {
    // The bridge must be a pure negation for EVERY integer, not just the two
    // examples above. If anyone ever "fixes" it with a conditional — say, to
    // special-case refunds — this sweep fails immediately.
    for (let v = -100_000; v <= 100_000; v += 1_237) {
      expect(plaidToLedgerCashCents(plaidToLedgerCashCents(v))).toBe(v);
    }
  });

  it("agrees with bankDirection and bankMagnitudeCents for every sign", () => {
    for (const v of [-500_000, -1, 0, 1, 500_000]) {
      const led = plaidToLedgerCashCents(v);
      if (v > 0) {
        expect(bankDirection(v)).toBe("money_out");
        expect(led).toBeLessThan(0);
      } else if (v < 0) {
        expect(bankDirection(v)).toBe("money_in");
        expect(led).toBeGreaterThan(0);
      }
      expect(bankMagnitudeCents(v)).toBe(Math.abs(v));
      expect(Math.abs(led)).toBe(Math.abs(v));
    }
  });
});

// ===========================================================================
// 3) THE REFUSALS — proving each one actually fires
// ===========================================================================
/**
 * A refusal code that is declared but never emitted is worse than no code at
 * all: it reads like a control in a code review and does nothing in production.
 * Two of these (BANK_ALREADY_MATCHED and BANK_COMMINGLED) were exactly that in
 * the first draft — declared, documented, and unreachable. They are D2 and D3
 * in slice5-defects.md. Every code now has a test that makes it fire.
 */
describe("refusals actually fire", () => {
  it("blocks a pending row", () => {
    const v = evaluateMatch(req({ row: row({ pending: true }) }));
    expect(codesOf(v)).toContain("BANK_PENDING_ROW");
    expect(v.postable).toBe(false);
  });

  it("blocks a removed row", () => {
    const v = evaluateMatch(req({ row: row({ removed: true }) }));
    expect(codesOf(v)).toContain("BANK_REMOVED_ROW");
    expect(v.postable).toBe(false);
  });

  it("blocks a sign disagreement — THE crown jewel", () => {
    // Same magnitude, wrong direction. This is the case that still balances,
    // still posts, and still produces a wrong return. Nothing else catches it.
    const v = evaluateMatch(
      req({ candidate: journal({ cashLineCents: +25_000 }) }), // should be -25,000
    );
    expect(codesOf(v)).toContain("BANK_SIGN_DISAGREES");
    expect(v.postable).toBe(false);
  });

  it("blocks an amount mismatch", () => {
    const v = evaluateMatch(req({ candidate: journal({ cashLineCents: -24_900 }) }));
    expect(codesOf(v)).toContain("BANK_AMOUNT_MISMATCH");
    expect(v.postable).toBe(false);
  });

  it("blocks a bank row that is already matched (D2)", () => {
    const v = evaluateMatch(req({ bankRowAlreadyMatched: true }));
    expect(codesOf(v)).toContain("BANK_ALREADY_MATCHED");
    expect(v.postable).toBe(false);
  });

  it("blocks a journal that is already matched", () => {
    const v = evaluateMatch(req({ candidate: journal({ alreadyMatched: true }) }));
    expect(codesOf(v)).toContain("BANK_JOURNAL_ALREADY_MATCHED");
    expect(v.postable).toBe(false);
  });

  it("blocks a date that is too far apart to be the same event", () => {
    const v = evaluateMatch(
      req({ candidate: journal({ journalDate: "2026-12-20" }) }), // 45 days
    );
    expect(codesOf(v)).toContain("BANK_DATE_TOO_FAR");
    expect(v.postable).toBe(false);
  });

  it("blocks a cross-entity match", () => {
    const v = evaluateMatch(
      req({ entityCode: "greenway", candidate: journal({ entityCode: "landholding" }) }),
    );
    expect(codesOf(v)).toContain("BANK_ENTITY_MISMATCH");
    expect(v.postable).toBe(false);
  });

  it("blocks an unconfirmed own-account transfer", () => {
    const v = evaluateMatch(req({ eventKind: "own_transfer", candidate: null }));
    expect(codesOf(v)).toContain("BANK_TRANSFER_AS_INCOME");
    expect(v.postable).toBe(false);
  });

  it("blocks a one-line loan payment", () => {
    const v = evaluateMatch(req({ eventKind: "loan_payment", candidate: null }));
    expect(codesOf(v)).toContain("BANK_LOAN_SINGLE_LINE");
    expect(v.postable).toBe(false);
  });

  it("blocks an unclassified row", () => {
    const v = evaluateMatch(req({ eventKind: "unknown", candidate: null }));
    expect(codesOf(v)).toContain("BANK_UNCLASSIFIED");
    expect(v.postable).toBe(false);
  });

  it("blocks a pre-cut-over date", () => {
    const v = evaluateMatch(
      req({ row: row({ date: "2025-12-31" }), candidate: journal({ journalDate: "2025-12-31" }) }),
    );
    expect(codesOf(v)).toContain("BANK_PRE_CUTOVER");
    expect(v.postable).toBe(false);
  });

  it("blocks an unreadable date, and does NOT call it pre-cut-over (D6)", () => {
    // The first draft reported "before the cut-over" for garbage input, which
    // sends the reader to look at a date that does not exist. Wrong diagnosis
    // is its own defect: it costs the reader the time to disprove it.
    const v = evaluateMatch(
      req({ row: row({ date: "not-a-date" }), candidate: journal({ journalDate: "not-a-date" }) }),
    );
    expect(codesOf(v)).toContain("BANK_INVALID_DATE");
    expect(codesOf(v)).not.toContain("BANK_PRE_CUTOVER");
    expect(v.postable).toBe(false);
  });

  it("blocks a personal cost inside a business entity (D3)", () => {
    const v = evaluateMatch(
      req({ entityCode: "greenway", candidate: null, eventKind: "bank_fee", proposedCostClasses: ["personal"] }),
    );
    expect(codesOf(v)).toContain("BANK_COMMINGLED");
    expect(v.postable).toBe(false);
  });

  it("blocks a new P&L line with no §280E label (D5 — the gate must gate)", () => {
    const v = evaluateMatch(
      req({ candidate: null, eventKind: "bank_fee", proposedCostClasses: [] }),
    );
    expect(codesOf(v)).toContain("BANK_NO_COST_CLASS");
    expect(v.postable).toBe(false);
  });

  it("warns about double counting when creating a new deposit entry", () => {
    const v = evaluateMatch(req({ candidate: null, eventKind: "deposit_of_sales" }));
    expect(codesOf(v)).toContain("BANK_DOUBLE_COUNT_RISK");
  });

  it("lets a genuinely clean match through", () => {
    // A control that never says yes is not a control, it is an outage. This is
    // the negative control for the whole refusal engine.
    const v = evaluateMatch(req());
    expect(v.postable).toBe(true);
    expect(v.findings.filter((f) => f.hardBlock)).toHaveLength(0);
    expect(v.ledgerCashCents).toBe(-25_000);
    expect(v.direction).toBe("money_out");
  });
});

// ===========================================================================
// 4) EVERY DECLARED CODE IS REACHABLE
// ===========================================================================
describe("no declared refusal code is decorative", () => {
  it("every code in ALL_BANK_FINDING_CODES is emitted by some scenario above", () => {
    // Rather than trusting the individual tests to be exhaustive, drive every
    // scenario and collect the union. A code that never appears is a control
    // that exists only on paper — which is exactly what D2 and D3 were.
    const seen = new Set<string>();
    const scenarios: MatchRequest[] = [
      req({ row: row({ pending: true }) }),
      req({ row: row({ removed: true }) }),
      req({ candidate: journal({ cashLineCents: +25_000 }) }),
      req({ candidate: journal({ cashLineCents: -24_900 }) }),
      req({ bankRowAlreadyMatched: true }),
      req({ candidate: journal({ alreadyMatched: true }) }),
      req({ candidate: journal({ journalDate: "2026-12-20" }) }),
      req({ candidate: journal({ entityCode: "landholding" }) }),
      req({ eventKind: "own_transfer", candidate: null }),
      req({ eventKind: "deposit_of_sales", candidate: null }),
      req({ eventKind: "loan_payment", candidate: null }),
      req({ eventKind: "bank_fee", candidate: null, proposedCostClasses: [] }),
      req({ eventKind: "unknown", candidate: null }),
      req({ row: row({ date: "2025-12-31" }), candidate: journal({ journalDate: "2025-12-31" }) }),
      req({ row: row({ date: "garbage" }), candidate: journal({ journalDate: "garbage" }) }),
      req({ eventKind: "bank_fee", candidate: null, proposedCostClasses: ["personal"] }),
    ];
    for (const s of scenarios) for (const c of codesOf(evaluateMatch(s))) seen.add(c);

    // BANK_NON_INTEGER_CENTS is raised as a THROW by the sign bridge rather
    // than collected as a finding, so it is proven separately below.
    seen.add("BANK_NON_INTEGER_CENTS");
    expect(() => plaidToLedgerCashCents(0.5)).toThrow(/BANK_NON_INTEGER_CENTS/);

    const missing = ALL_BANK_FINDING_CODES.filter((c) => !seen.has(c));
    expect(missing).toEqual([]);
  });

  it("ALL_BANK_FINDING_CODES has no duplicates", () => {
    expect(new Set(ALL_BANK_FINDING_CODES).size).toBe(ALL_BANK_FINDING_CODES.length);
  });
});

// ===========================================================================
// 5) BIDIRECTIONAL DRIFT: every code has a plain-English translation
// ===========================================================================
/**
 * The owner must never see a raw machine token. That is the entire promise of
 * gl-refusal-core.ts, and it decays the moment someone adds a refusal here and
 * forgets to add its translation there — a failure that is invisible until the
 * refusal actually fires, which is precisely the worst moment to discover it.
 *
 * Checked in BOTH directions, because an orphan translation is also a bug: it
 * means a control was deleted and nobody removed its explanation, leaving the
 * next reader to believe a protection exists that does not.
 */
describe("refusal-code drift against gl-refusal-core", () => {
  const translated = new Set(knownRefusalCodes());

  it("every bank finding code has a GL_ translation", () => {
    const missing = ALL_BANK_FINDING_CODES.filter((c) => !translated.has(`GL_${c}`));
    expect(missing).toEqual([]);
  });

  it("every GL_BANK_ translation corresponds to a real code or a real DB refusal", () => {
    // Codes raised by the DATABASE (0189) but not by the TypeScript engine are
    // legitimate: the sign-off RPC raises three of them. So the allowed set is
    // the union of the engine's codes and the migration's codes.
    const dbCodes = new Set(
      [...MIGRATION.matchAll(/'(GL_BANK_[A-Z_]+):/g)].map((m) => m[1]),
    );
    const engineCodes = new Set(ALL_BANK_FINDING_CODES.map((c) => `GL_${c}`));
    const orphans = [...translated]
      .filter((c) => c.startsWith("GL_BANK_"))
      .filter((c) => !engineCodes.has(c) && !dbCodes.has(c));
    expect(orphans).toEqual([]);
  });

  it("the three sign-off codes raised by 0189 are translated (D8)", () => {
    for (const c of [
      "GL_BANK_UNRECORDED_ITEMS",
      "GL_BANK_DOES_NOT_TIE",
      "GL_BANK_ALREADY_SIGNED_OFF",
    ]) {
      expect(translated.has(c)).toBe(true);
      expect(MIGRATION).toContain(`'${c}:`);
    }
  });
});

// ===========================================================================
// 6) RECONCILIATION — the arithmetic, and the D1 defect it once had
// ===========================================================================
function rec(over: Partial<ReconciliationInput> = {}): ReconciliationInput {
  return {
    statementClosingCents: 1_000_000,
    ledgerBalanceCents: 1_000_000,
    unmatchedBankRows: [],
    unmatchedJournals: [],
    ...over,
  };
}

describe("reconciliation arithmetic", () => {
  it("a clean month ties and is complete", () => {
    const r = reconcile(rec());
    expect(r.differenceCents).toBe(0);
    expect(r.ties).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.readyToSignOff).toBe(true);
    expect(r.unrecordedItemCount).toBe(0);
  });

  it("an uncashed cheque is a TIMING difference — it still ties (D1)", () => {
    /**
     * The textbook case, and the one that exposed defect D1. A cheque written
     * on the 30th that the payee has not cashed is CORRECTLY on the books and
     * CORRECTLY absent from the statement. Nothing is wrong.
     *
     * The first draft never applied `inBooksNotBankCents`, so it manufactured a
     * gap out of perfectly clean books. That fails in the worst direction: a
     * control that cries wolf every month trains the reader to ignore it, and
     * then the month a gap is REAL, he ignores that one too.
     */
    const r = reconcile(
      rec({
        ledgerBalanceCents: 950_000, // cheque already deducted in the books
        statementClosingCents: 1_000_000, // bank has not seen it yet
        unmatchedJournals: [journal({ cashLineCents: -50_000 })],
      }),
    );
    expect(r.differenceCents).toBe(0);
    expect(r.ties).toBe(true);
    expect(r.complete).toBe(true); // timing differences need NO entry
    expect(r.readyToSignOff).toBe(true);
  });

  it("adjusts BOTH sides, not just one (the D1 identity)", () => {
    const r = reconcile(
      rec({
        ledgerBalanceCents: 950_000,
        statementClosingCents: 1_000_000,
        unmatchedJournals: [journal({ cashLineCents: -50_000 })],
      }),
    );
    expect(r.adjustedBankCents).toBe(950_000);
    expect(r.adjustedLedgerCents).toBe(950_000);
    expect(r.differenceCents).toBe(r.adjustedLedgerCents - r.adjustedBankCents);
  });

  it("reports a genuine gap without characterising it", () => {
    const r = reconcile(rec({ ledgerBalanceCents: 987_654 }));
    expect(r.ties).toBe(false);
    expect(r.complete).toBe(false);
    expect(r.readyToSignOff).toBe(false);
    expect(r.differenceCents).not.toBe(0);
  });

  it("ignores pending and removed rows", () => {
    const r = reconcile(
      rec({
        unmatchedBankRows: [
          row({ transactionId: "p", pending: true, amountCents: 9_999 }),
          row({ transactionId: "r", removed: true, amountCents: 8_888 }),
        ],
      }),
    );
    expect(r.unrecordedItemCount).toBe(0);
    expect(r.complete).toBe(true);
  });
});

// ===========================================================================
// 7) D8 — "TIES" IS NOT "COMPLETE". The most subtle defect in the slice.
// ===========================================================================
/**
 * A reconciliation has TWO kinds of reconciling item and they are NOT the same:
 *
 *   TIMING DIFFERENCE   (uncashed cheque, deposit in transit)
 *     The books are already RIGHT; the bank has not caught up. Self-clearing.
 *     NO entry is needed, and posting one would be wrong.
 *
 *   UNRECORDED ITEM     (bank fee, interest, NSF, forgotten auto-debit)
 *     The books are WRONG until an entry is posted. Never self-clearing,
 *     because nothing is coming to clear it.
 *
 * THE TRAP: an unrecorded bank line is ALREADY inside the bank's closing
 * balance. When the reconciliation adds it to the ledger side too, it cancels
 * itself out and the difference comes to EXACTLY ZERO. The month reports
 * "everything ties to the penny" while an expense is missing from the books
 * entirely. This was proven numerically on live PostgreSQL before it was fixed.
 *
 * WA SAO BARS §3.1.9.15(4), verbatim: "Identifying transactions from the bank
 * accounts need to be recorded in the accounting records. For example, some of
 * these items could include interest earned, bank fees or charges, NSF checks,
 * and unrecorded deposits ... Accounting records should be updated for all such
 * transactions identified in the bank statements."
 */
describe("D8: ties is not the same as complete", () => {
  const withUnrecordedFee = () =>
    reconcile(
      rec({
        // Books are untouched; the bank has already taken a $77.00 fee.
        ledgerBalanceCents: 1_000_000,
        statementClosingCents: 992_300,
        unmatchedBankRows: [row({ transactionId: "fee", amountCents: 7_700 })],
      }),
    );

  it("the arithmetic still closes — this is the trap, and it is real", () => {
    expect(withUnrecordedFee().differenceCents).toBe(0);
    expect(withUnrecordedFee().ties).toBe(true);
  });

  it("but the month is NOT complete and NOT ready to sign off", () => {
    const r = withUnrecordedFee();
    expect(r.complete).toBe(false);
    expect(r.readyToSignOff).toBe(false);
    expect(r.unrecordedItemCount).toBe(1);
    expect(r.unrecordedItemCents).toBe(-7_700); // ledger convention
  });

  it("the narrative must NOT declare victory while an expense is missing", () => {
    const n = withUnrecordedFee().narrative.join(" ");
    expect(n).not.toMatch(/Everything ties to the penny/i);
    expect(n).not.toMatch(/Safe to sign off/i);
    expect(n).toMatch(/not finished|still need an entry|Do not sign/i);
  });

  it("a clean month DOES get to say so (negative control)", () => {
    // If the wording above were simply removed, the test before this one would
    // pass for the wrong reason. This proves the happy path still speaks.
    const n = reconcile(rec()).narrative.join(" ");
    expect(n).toMatch(/ties to the penny/i);
  });

  it("STRUCTURAL INVARIANT: complete is never true with an unrecorded item", () => {
    // Not an example — a sweep. `complete` must imply zero unrecorded items for
    // EVERY combination, otherwise the D8 fix is only true for the cases
    // someone happened to write down.
    for (let fee = 0; fee <= 20_000; fee += 1_100) {
      for (const drift of [0, 1, -1, 5_000]) {
        const r = reconcile(
          rec({
            ledgerBalanceCents: 1_000_000 + drift,
            statementClosingCents: 1_000_000 - fee,
            unmatchedBankRows: fee ? [row({ amountCents: fee })] : [],
          }),
        );
        if (r.complete) {
          expect(r.unrecordedItemCount).toBe(0);
          expect(r.ties).toBe(true);
        }
        expect(r.readyToSignOff).toBe(r.complete);
      }
    }
  });

  it("many unrecorded items are all counted, not just the first", () => {
    const r = reconcile(
      rec({
        statementClosingCents: 1_000_000 - 3_300,
        unmatchedBankRows: [
          row({ transactionId: "a", amountCents: 1_100 }),
          row({ transactionId: "b", amountCents: 1_100 }),
          row({ transactionId: "c", amountCents: 1_100 }),
        ],
      }),
    );
    expect(r.unrecordedItemCount).toBe(3);
    expect(r.complete).toBe(false);
  });

  it("the visual bars agree with `complete`, not merely with `ties`", () => {
    // The picture is what Michael actually reads. If the bars said "done" while
    // the data said "not done", the fix would be cosmetic.
    const bars = reconciliationBars(withUnrecordedFee());
    expect(bars.length).toBeGreaterThan(0);
    const text = JSON.stringify(bars);
    expect(text).not.toMatch(/Safe to sign off/i);
  });
});

// ===========================================================================
// 8) LOAN PAYMENTS — three things happen, only one is an expense
// ===========================================================================
describe("loan payment splitting", () => {
  const args = {
    bankAmountCents: 150_000, // $1,500 out
    cashAccountCode: "10200",
    loanLiabilityAccountCode: "34000",
    interestExpenseAccountCode: "85010",
    escrowAssetAccountCode: "12200",
    split: { interestCents: 90_000, principalCents: 50_000, escrowCents: 10_000 },
  };

  it("balances to zero", () => {
    const lines = buildLoanPaymentLines({ ...args, entityCode: "greenway" });
    expect(sumLines(lines)).toBe(0);
  });

  it("splits into four lines and never lumps the payment into one", () => {
    const lines = buildLoanPaymentLines({ ...args, entityCode: "greenway" });
    expect(lines).toHaveLength(4);
    expect(lines.filter((l) => l.accountCode === "10200")).toHaveLength(1);
  });

  it("principal and escrow are NEVER expenses", () => {
    const lines = buildLoanPaymentLines({ ...args, entityCode: "greenway" });
    const principal = lines.find((l) => l.accountCode === "34000")!;
    const escrow = lines.find((l) => l.accountCode === "12200")!;
    expect(principal.costClass).toBe("none");
    expect(escrow.costClass).toBe("none");
  });

  it("CHAMP: interest is disallowed in the shop but deductible elsewhere (D4)", () => {
    /**
     * CHAMP, 128 T.C. 173 (2007) held that §280E reaches the TRADE OR BUSINESS
     * that traffics — not the taxpayer as a whole. The landholding company and
     * the ATM business do not traffic in a controlled substance, so their
     * interest is fully deductible under IRC §163(a).
     *
     * The first draft hardcoded every loan's interest as nondeductible_280e.
     * That is not conservative, it is simply WRONG, and it silently overpays
     * tax on the mortgage every single month.
     */
    expect(interestCostClassFor("greenway")).toBe("nondeductible_280e");
    expect(interestCostClassFor("landholding")).toBe("separate_business");
    expect(interestCostClassFor("atm")).toBe("separate_business");

    const shop = buildLoanPaymentLines({ ...args, entityCode: "greenway" });
    const land = buildLoanPaymentLines({ ...args, entityCode: "landholding" });
    expect(shop.find((l) => l.accountCode === "85010")!.costClass).toBe("nondeductible_280e");
    expect(land.find((l) => l.accountCode === "85010")!.costClass).toBe("separate_business");
  });

  it("omits zero-value components rather than posting empty lines", () => {
    const lines = buildLoanPaymentLines({
      ...args,
      entityCode: "greenway",
      split: { interestCents: 150_000, principalCents: 0, escrowCents: 0 },
    });
    expect(lines).toHaveLength(2);
    expect(sumLines(lines)).toBe(0);
  });

  it("a split that does not add up to the payment does not balance", () => {
    // The engine does not silently absorb the discrepancy into cash. If the
    // three figures off the servicer's statement do not sum to the payment,
    // the entry fails to balance and cannot post — which is correct.
    const lines = buildLoanPaymentLines({
      ...args,
      entityCode: "greenway",
      split: { interestCents: 90_000, principalCents: 50_000, escrowCents: 9_900 },
    });
    expect(sumLines(lines)).not.toBe(0);
  });
});

// ===========================================================================
// 9) STRUCTURING SURVEILLANCE — 31 U.S.C. §5324
// ===========================================================================
/**
 * Greenway is a cash business that cannot use ordinary banking. Deposits just
 * under $10,000 are the classic structuring pattern, and structuring is a
 * FEDERAL CRIME independent of whether the money is clean and the tax is paid.
 * The system must warn about the pattern rather than discover it in a subpoena.
 */
describe("structuring surveillance", () => {
  it("surfaces a run of deposits sitting just under the CTR threshold", () => {
    const s = detectStructuringPattern([
      { date: "2026-11-02", amountCents: 950_000 },
      { date: "2026-11-03", amountCents: 940_000 },
      { date: "2026-11-04", amountCents: 960_000 },
    ]);
    expect(s.nearThresholdCount).toBe(3);
    expect(s.worthReviewing).toBe(true);
    expect(s.nearThresholdTotalCents).toBe(2_850_000);
  });

  it("says nothing alarming about ordinary small deposits (negative control)", () => {
    const s = detectStructuringPattern([
      { date: "2026-11-02", amountCents: 120_000 },
      { date: "2026-11-03", amountCents: 98_000 },
    ]);
    expect(s.nearThresholdCount).toBe(0);
    expect(s.worthReviewing).toBe(false);
    expect(s.narrative.join(" ")).toMatch(/Nothing to look at here/i);
  });

  it("counts magnitude, so Plaid-negative deposits are seen (sign safety)", () => {
    // Deposits arrive as NEGATIVE in Plaid convention (money in). If this
    // function compared the raw signed value against a positive threshold, it
    // would never see a single real deposit and would report "nothing to look
    // at here" forever — a surveillance control that surveils nothing.
    const s = detectStructuringPattern([
      { date: "2026-11-02", amountCents: -950_000 },
      { date: "2026-11-03", amountCents: -940_000 },
      { date: "2026-11-04", amountCents: -960_000 },
    ]);
    expect(s.nearThresholdCount).toBe(3);
    expect(s.worthReviewing).toBe(true);
  });

  it("treats a lawful large deposit as reportable, NOT as suspicious", () => {
    // Depositing more than $10,000 is entirely lawful and the bank simply files
    // a CTR. Only ARRANGING deposits to avoid that report is an offence. The
    // engine must not blur the two, or it teaches the owner to fear the legal
    // behaviour and normalise the illegal one.
    const s = detectStructuringPattern([{ date: "2026-11-02", amountCents: 1_500_000 }]);
    expect(s.reportableCount).toBe(1);
    expect(s.nearThresholdCount).toBe(0);
    expect(s.worthReviewing).toBe(false);
    expect(s.narrative.join(" ")).toMatch(/normal|lawful/i);
  });

  it("never accuses, and never blocks", () => {
    // 31 U.S.C. §5324 turns on PURPOSE, not on amount. A cash-only shop that
    // genuinely takes ~$9,000 a day produces this pattern innocently forever.
    // The engine's job is to show the owner what an examiner will pull, while
    // he can still remember why — not to conclude anything.
    const s = detectStructuringPattern([
      { date: "2026-11-02", amountCents: 950_000 },
      { date: "2026-11-03", amountCents: 940_000 },
      { date: "2026-11-04", amountCents: 960_000 },
    ]);
    const text = s.narrative.join(" ");
    expect(text).toMatch(/not an accusation/i);
    expect(text).toMatch(/nothing is being blocked/i);
    expect(text).toMatch(/intent, not about the amount/i);
  });

  it("only two deposits is not yet a pattern (boundary)", () => {
    const s = detectStructuringPattern([
      { date: "2026-11-02", amountCents: 950_000 },
      { date: "2026-11-03", amountCents: 940_000 },
    ]);
    expect(s.nearThresholdCount).toBe(2);
    expect(s.worthReviewing).toBe(false);
  });

  it("ignores fractional-cent garbage rather than counting it", () => {
    const s = detectStructuringPattern([{ date: "2026-11-02", amountCents: 950_000.5 }]);
    expect(s.nearThresholdCount).toBe(0);
  });

  it("the threshold constants match the statute", () => {
    expect(CTR_THRESHOLD_CENTS).toBe(1_000_000); // $10,000
    expect(STRUCTURING_NEAR_MISS_CENTS).toBe(100_000); // $1,000 band
  });
});

// ===========================================================================
// 10) DATES — no Date objects, no timezone, no drift
// ===========================================================================
describe("date handling", () => {
  it("parses and rejects correctly", () => {
    expect(parseIsoDateParts("2026-11-05")).toEqual({ y: 2026, m: 11, d: 5 });
    expect(parseIsoDateParts("2026-13-01")).toBeNull();
    expect(parseIsoDateParts("2026-02-30")).toBeNull();
    expect(parseIsoDateParts("garbage")).toBeNull();
    expect(isoToDayNumber("garbage")).toBeNull();
  });

  it("handles leap years without a Date object", () => {
    expect(parseIsoDateParts("2028-02-29")).toEqual({ y: 2028, m: 2, d: 29 });
    expect(parseIsoDateParts("2027-02-29")).toBeNull();
    expect(parseIsoDateParts("2100-02-29")).toBeNull(); // century, not a leap year
    expect(parseIsoDateParts("2000-02-29")).toEqual({ y: 2000, m: 2, d: 29 });
  });

  it("measures distance symmetrically and across month ends", () => {
    expect(daysApart("2026-11-05", "2026-11-05")).toBe(0);
    expect(daysApart("2026-10-31", "2026-11-01")).toBe(1);
    expect(daysApart("2026-11-01", "2026-10-31")).toBe(1);
    expect(daysApart("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("enforces the line in the sand", () => {
    expect(LINE_IN_THE_SAND).toBe("2026-01-01");
    expect(isOnOrAfterCutover("2026-01-01")).toBe(true);
    expect(isOnOrAfterCutover("2025-12-31")).toBe(false);
  });

  it("uses no Date object anywhere in the executable code", () => {
    /**
     * A Date object drags the machine's timezone into a business clock that is
     * defined as Pacific. The civil-days arithmetic exists precisely to avoid
     * that, and this guard stops anyone reintroducing it for convenience.
     *
     * NOTE ON THE GUARD ITSELF: the first version of this test scanned the RAW
     * file and failed — because the module contains a comment EXPLAINING why
     * `new Date("2026-11-01")` is dangerous (it parses as UTC midnight). The
     * guard was punishing the documentation of the very rule it enforces.
     *
     * That is worth stating plainly, because the tempting "fix" is to delete
     * the explanation to make the test green. That would be exactly backwards:
     * weakening the code to satisfy a bad test is how a control gets quietly
     * disarmed. The correct fix is to scan CODE, not prose.
     */
    expect(CODE_ONLY).not.toMatch(/new Date\(/);
    expect(CODE_ONLY).not.toMatch(/Date\.now\(/);
    expect(CODE_ONLY).not.toMatch(/toLocaleDateString|getTimezoneOffset/);
  });
});

// ===========================================================================
// 11) FORMATTING AND SCORING
// ===========================================================================
describe("formatting and scoring", () => {
  it("formats cents as money without floating point", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(1_00)).toBe("$1.00");
    expect(formatCents(462_469_731)).toBe("$4,624,697.31"); // the owner's plug
    expect(formatSignedCents(-2_500)).toMatch(/-|\(/);
  });

  it("clamps confidence into range", () => {
    expect(clampMilliPct(-5)).toBe(0);
    expect(clampMilliPct(999_999)).toBe(100_000);
    expect(clampMilliPct(50_000)).toBe(50_000);
  });

  it("scores an exact same-day match above a distant one", () => {
    const near = scoreMatch(row(), journal());
    const far = scoreMatch(row(), journal({ journalDate: "2026-11-25" }));
    expect(near.confidenceMilliPct).toBeGreaterThan(far.confidenceMilliPct);
  });

  it("never returns a confidence outside 0..100000", () => {
    for (const d of ["2026-11-05", "2026-11-10", "2026-12-30", "2020-01-01"]) {
      const s = scoreMatch(row(), journal({ journalDate: d }));
      expect(s.confidenceMilliPct).toBeGreaterThanOrEqual(0);
      expect(s.confidenceMilliPct).toBeLessThanOrEqual(100_000);
    }
  });

  it("classifies and labels every event kind in plain English", () => {
    const c = classifyBankRow(row({ name: "MONTHLY SERVICE FEE" }));
    expect(c.kind).toBeTruthy();
    for (const k of [
      "deposit_of_sales", "vendor_payment", "payroll_funding", "loan_payment",
      "own_transfer", "owner_draw", "owner_contribution", "bank_fee",
      "interest_income", "tax_payment", "atm_vault", "unknown",
    ] as const) {
      const label = labelForKind(k);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toContain("_"); // never leak the machine token
    }
  });

  it("the match windows are the documented values", () => {
    expect(MATCH_WINDOW_DAYS).toBe(5);
    expect(MATCH_WINDOW_HARD_DAYS).toBe(30);
  });
});

// ===========================================================================
// 12) SOURCE DRIFT — verbatim authority must survive refactoring
// ===========================================================================
describe("source-level drift guards", () => {
  /**
   * A verbatim quote living inside a JSDoc banner is physically wrapped across
   * several lines and prefixed with " * ". A naive `toContain` on the raw file
   * therefore fails for a purely cosmetic reason — and, worse, would PASS if
   * someone reflowed the words into a different sentence. Flatten the comment
   * furniture first, then match. The guard is then sensitive to what matters
   * (the WORDS) and blind to what does not (the line breaks).
   */
  const FLAT = SRC.replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").replace(/^\s*\/\/\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ");

  it("flattens the source without destroying it (guards the guard)", () => {
    // If FLAT were ever empty or mangled, every assertion below would silently
    // become vacuous — a green suite proving nothing at all.
    expect(FLAT.length).toBeGreaterThan(20_000);
    expect(FLAT).toContain("export function evaluateMatch");
  });

  it("strips comments without destroying the code (guards the OTHER guard)", () => {
    /**
     * CODE_ONLY drives every purity and no-Date assertion in this file. If the
     * stripper ever over-matched and returned whitespace, all of those would
     * pass trivially and prove nothing — the exact failure mode this slice
     * exists to hunt. So: prove it still contains real code, prove it still
     * contains the specific things being guarded, and prove it genuinely
     * removed the prose that caused the original false failures.
     */
    expect(CODE_ONLY).toContain("export function plaidToLedgerCashCents");
    expect(CODE_ONLY).toContain("export function evaluateMatch");
    expect(CODE_ONLY).toContain("export function reconcile");
    expect(CODE_ONLY.length).toBeGreaterThan(10_000);

    // The prose that tripped the first draft must be GONE...
    expect(SRC).toContain('new Date("2026-11-01")'); // still documented
    expect(CODE_ONLY).not.toContain('new Date("2026-11-01")'); // but not scanned
    expect(SRC).toContain("server-only"); // still promised in the header
    expect(CODE_ONLY).not.toContain("server-only");

    // ...and the stripper must not be a blunt instrument that deletes strings.
    expect(CODE_ONLY).toContain("BANK_SIGN_DISAGREES");
  });

  it("still records the owner's requests verbatim (standing rule 1)", () => {
    expect(FLAT).toContain(
      "not just block, but explain why, and even better, show me a way to do it properly",
    );
    expect(FLAT).toContain("gate everything, lock everything, block everything");
    expect(FLAT).toContain(
      "accurate and precise stated from actual verbatim text from authoritative sources",
    );
  });

  it("still quotes IRC §163(a) exactly", () => {
    expect(FLAT).toContain(
      "There shall be allowed as a deduction all interest paid or accrued within the taxable year on indebtedness",
    );
  });

  it("still quotes the IRM transfer trap exactly", () => {
    expect(FLAT).toContain(
      "Nontaxable funds, transfers-in, and returned deposits need to be subtracted from total deposits",
    );
  });

  it("still names its authorities", () => {
    for (const a of [
      "IRM 4.10.4",
      "1.6001-1",
      "WAC 314-55-087",
      "163(a)",
      "CHAMP",
      "5324",
    ]) {
      expect(SRC).toContain(a);
    }
  });

  it("still carries the BARS quotation behind the D8 fix", () => {
    expect(FLAT).toContain(
      "interest earned, bank fees or charges, NSF checks, and unrecorded deposits",
    );
  });

  it("keeps the sign bridge as the single crossing point", () => {
    expect(SRC).toContain("export function plaidToLedgerCashCents");
    // The negation must be there. If someone "simplifies" it away, the whole
    // wall comes down silently.
    expect(SRC).toMatch(/-\s*plaidAmountCents|plaidAmountCents\s*\*\s*-1/);
  });

  it("is PURE — no I/O, no Supabase, no server-only", () => {
    // Same lesson as the Date guard: the module's own header says "No I/O, no
    // network, no `server-only`, no Supabase", so a raw scan trips over the
    // promise instead of over a violation. Scan the CODE.
    expect(CODE_ONLY).not.toContain("server-only");
    expect(CODE_ONLY).not.toContain("@supabase");
    expect(CODE_ONLY).not.toMatch(/\bfetch\s*\(/);
    expect(CODE_ONLY).not.toMatch(/require\(\s*['"]fs['"]/);
    expect(CODE_ONLY).not.toMatch(/process\.env/);
  });

  it("has exactly one import, and it is a type-only import", () => {
    // Purity is easiest to prove at the boundary. A value import would let a
    // side effect in through the front door.
    const imports = CODE_ONLY.match(/^import .*$/gm) ?? [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatch(/^import type /);
  });

  it("uses no floating-point money helpers", () => {
    // Standing rule 13: FLOAT IS FORBIDDEN in money paths. parseFloat on a
    // money string is how fractional cents get in and then compound.
    expect(CODE_ONLY).not.toMatch(/parseFloat\(/);
    expect(CODE_ONLY).not.toMatch(/toFixed\(2\)/);
  });

  it("contains no literal escape sequences in reader-facing prose (D9)", () => {
    // The defect found in gl-refusal-core.ts: "\\u00a7280E" renders as the
    // literal characters, not "§280E". Guarded here too so it cannot migrate.
    const proseEscapes = SRC.match(/\\\\u[0-9a-fA-F]{4}/g) ?? [];
    expect(proseEscapes).toEqual([]);
  });
});

// ===========================================================================
// 13) CROSS-LAYER PARITY — the engine and the database must agree
// ===========================================================================
/**
 * Two layers that disagree are worse than one layer, because each one looks
 * authoritative on its own. The database is the last line of defence (a UI can
 * be bypassed, a CHECK constraint cannot), so where both encode the same rule,
 * they must encode the SAME rule.
 */
describe("parity with migration 0189", () => {
  it("the migration exists and is idempotent in style", () => {
    expect(MIGRATION.length).toBeGreaterThan(10_000);
    expect(MIGRATION).toMatch(/create table if not exists/i);
    expect(MIGRATION).toMatch(/create or replace function/i);
  });

  it("the database enforces the same sign wall", () => {
    expect(MIGRATION).toContain("gl_bank_sign_agrees");
    expect(MIGRATION).toContain("GL_BANK_SIGN_DISAGREES");
  });

  it("the database carries the D8 columns and constraints", () => {
    expect(MIGRATION).toContain("unrecorded_item_count");
    expect(MIGRATION).toContain("complete");
    // `complete` must be DEFINED as ties AND nothing unrecorded — not stored
    // independently, where it could drift away from the numbers beside it.
    expect(MIGRATION).toMatch(
      /check\s*\(\s*complete\s*=\s*\(\s*difference_cents\s*=\s*0\s+and\s+unrecorded_item_count\s*=\s*0\s*\)\s*\)/i,
    );
  });

  it("a signature cannot exist on an incomplete month", () => {
    expect(MIGRATION).toMatch(/check\s*\(\s*signed_off_at\s+is\s+null\s+or\s+complete\s*\)/i);
  });

  it("the sign-off RPC exists and is owner-only", () => {
    expect(MIGRATION).toContain("gl_sign_off_bank_reconciliation");
    expect(MIGRATION).toContain("GL_NOT_OWNER");
    expect(MIGRATION).toContain("is_owner");
  });

  it("re-running the reconciliation revokes a stale signature", () => {
    // Otherwise a month could be signed off, then changed, and keep the
    // signature that was given to different numbers.
    expect(MIGRATION).toMatch(/signed_off_by\s*=\s*null/i);
    expect(MIGRATION).toMatch(/signed_off_at\s*=\s*null/i);
  });

  it("the wiring audit exists so the owner can verify the controls himself", () => {
    expect(MIGRATION).toContain("gl_audit_bank_wiring");
  });

  it("the cut-over date agrees across both layers", () => {
    expect(LINE_IN_THE_SAND).toBe("2026-01-01");
    expect(MIGRATION).toContain("2026-01-01");
  });
});

// ===========================================================================
// D15: A MIGRATION RUN OUT OF ORDER MUST SAY SO IN ENGLISH
// ===========================================================================
/**
 * WHY THIS SECTION EXISTS.
 *
 * Migrations in this repo are applied BY HAND, one file at a time, in numeric
 * order, by a human reading file names. Humans skip lines. Migration 0188
 * opens with a precondition block that stops with MIGRATION_OUT_OF_ORDER and
 * names the exact file to run first. 0189 shipped WITHOUT one.
 *
 * The consequence is not data damage - every migration runs in a transaction,
 * so an out-of-order run changes nothing either way. The consequence is that
 * the owner sees a raw PostgreSQL error about a missing relation, hundreds of
 * lines into a file he did not write, with no indication of which earlier file
 * he missed. That is a support call and an evening lost, for a problem the
 * file could have explained in one sentence.
 *
 * These tests lock the block in, and then check the whole books series for the
 * same omission so it cannot reappear one migration over.
 */
describe("out-of-order protection (D15)", () => {
  it("0189 refuses to run before its prerequisites, by name", () => {
    expect(MIGRATION).toContain("MIGRATION_OUT_OF_ORDER");

    // Each prerequisite must be named with the FILE the owner has to run, not
    // just the object that is missing. "gl_journals does not exist" is not an
    // instruction; "run 0172 first" is.
    const mustName = [
      /0185_books_owner_only\.sql/,
      /0172/,
      /0173/,
      /0157_plaid_foundation\.sql/,
    ];
    for (const re of mustName) {
      expect(
        re.test(MIGRATION),
        `0189's precondition block never tells the owner to run ${String(re)}`,
      ).toBe(true);
    }
  });

  it("the precondition block runs BEFORE anything is created", () => {
    // A guard that fires after the first CREATE TABLE is not a guard; it is a
    // partial build with a message attached. Order in the file is the control.
    const guardAt = MIGRATION.indexOf("MIGRATION_OUT_OF_ORDER");
    const firstCreate = MIGRATION.search(/^create\s+(table|or replace function)/im);

    expect(guardAt).toBeGreaterThan(-1);
    expect(firstCreate).toBeGreaterThan(-1);
    expect(
      guardAt,
      "the out-of-order guard appears AFTER the first CREATE - it would fire too late",
    ).toBeLessThan(firstCreate);
  });

  it("0189 verifies the uniqueness its double-match protection depends on", () => {
    // gl_bank_matches keys off plaid_transactions.transaction_id. If that ever
    // stopped being unique, one bank line could be matched twice and both
    // entries would balance. Checked, not assumed.
    expect(MIGRATION).toMatch(/indisunique/i);
    expect(MIGRATION).toMatch(/transaction_id.*UNIQUE|UNIQUE.*transaction_id/i);
  });

  it("every books posting migration has the same protection", () => {
    // The sweep. Catches the next omission rather than this one.
    const POSTING_MIGRATIONS = [
      "0187_vendor_bills_to_gl.sql",
      "0188_payroll_to_gl.sql",
      "0189_bank_matching.sql",
    ];

    // Guards the guard: if the file names ever drift, the loop below would
    // silently test nothing and pass.
    expect(POSTING_MIGRATIONS.length).toBeGreaterThanOrEqual(3);

    for (const name of POSTING_MIGRATIONS) {
      const sql = readFileSync(
        resolve(__dirname, `../../supabase/migrations/${name}`),
        "utf8",
      );
      expect(sql.length, `${name} did not load`).toBeGreaterThan(1_000);
      expect(
        sql.includes("MIGRATION_OUT_OF_ORDER"),
        `${name} has no out-of-order guard - pasted early it will fail with a raw PostgreSQL error instead of a sentence`,
      ).toBe(true);
      expect(
        /to_regclass|to_regprocedure/.test(sql),
        `${name} claims an out-of-order guard but never probes the catalog for a missing object`,
      ).toBe(true);
    }
  });
});

// ===========================================================================
// D13: EVERY ACCOUNT CODE MUST EXIST IN THE REAL CHART OF ACCOUNTS
// ===========================================================================
/**
 * WHY THIS SECTION EXISTS.
 *
 * Nothing in this slice checked account codes against the actual chart of
 * accounts, and the result was exactly what you would expect: this file, the
 * engine's own self-tests, and the admin page between them referenced FOUR
 * account codes that do not exist anywhere in any migration - 71500, 25000,
 * 24000, 14000 - plus one that exists and is far worse than a typo.
 *
 * The worst of them was 32000, used in the engine's self-tests as the loan
 * liability an ordinary mortgage principal payment debits. 32000 is
 * "Cannabis Excise Tax Payable (37%) - TRUST": money Greenway collects and
 * holds for the WSLCB. Under IRC 7501 that is a trust fund, and the fastest
 * way to turn a tax problem into a personal one is to treat trust money as if
 * it were the company's own. A test that models a mortgage payment as a debit
 * to the excise trust account is teaching, in miniature, the single most
 * dangerous entry a cannabis retailer can make.
 *
 * None of it failed anything. The engine takes account codes as parameters -
 * correctly, since the mortgage, the Jared note and any future facility each
 * have their own accounts - so any string at all satisfies the signature. The
 * codes were only ever going to be caught by someone reading them against the
 * chart, which is precisely the kind of check a machine should be doing.
 *
 * Corrected to the real accounts from migration 0173:
 *   34000  Notes & Loans Payable   (liability - what a mortgage actually is)
 *   85010  Interest Expense        (other_expense)
 *   12200  Prepaid Expenses        (asset - escrow IS prepaid tax and insurance)
 *   10200  Bank - Operating        (asset - was already correct)
 */
describe("account codes are real (D13)", () => {
  // Parsed from the migration itself rather than re-listed here. A hand-kept
  // copy of the chart of accounts would drift the moment an account is added,
  // and would then start failing correct code - the most corrosive kind of
  // test, because it trains you to edit tests until they go quiet.
  const CHART_SQL = readFileSync(
    resolve(__dirname, "../../supabase/migrations/0173_chart_of_accounts.sql"),
    "utf8",
  );

  const REAL_CODES = new Set<string>(
    Array.from(CHART_SQL.matchAll(/gl_upsert_account\('(\d+)'/g)).map((m) => m[1]),
  );

  it("the chart parser found a plausible number of accounts", () => {
    // Guards the guard. If the regex ever stops matching - a formatting change
    // in the migration, say - REAL_CODES becomes empty and every assertion
    // below would pass vacuously while checking nothing at all. That is the D8
    // failure mode: a check that reports success because it never ran.
    expect(REAL_CODES.size).toBeGreaterThan(100);
    expect(REAL_CODES.has("10200")).toBe(true); // Bank - Operating
  });

  it("rejects codes that do not exist (proving the guard can fail)", () => {
    // The four fictional codes this section was written to catch. Standing
    // rule 15: demonstrate the guard discriminating, do not assume it does.
    for (const fake of ["71500", "25000", "24000", "14000", "99999"]) {
      expect(REAL_CODES.has(fake)).toBe(false);
    }
  });

  it("every account code used by the loan splitter is a real account", () => {
    const lines = buildLoanPaymentLines({
      bankAmountCents: 184_700,
      entityCode: "landholding",
      cashAccountCode: "10200",
      loanLiabilityAccountCode: "34000",
      interestExpenseAccountCode: "85010",
      escrowAssetAccountCode: "12200",
      split: { interestCents: 120_300, principalCents: 49_800, escrowCents: 14_600 },
    });
    expect(lines.length).toBe(4);
    for (const l of lines) {
      expect(
        REAL_CODES.has(l.accountCode),
        `account ${l.accountCode} is not in the chart of accounts`,
      ).toBe(true);
    }
  });

  it("the loan accounts are of the right TYPE, not merely real", () => {
    // A real code in the wrong place is the 32000 mistake: it exists, it
    // balances, and it is catastrophic. Principal must reduce a LIABILITY,
    // interest must hit an EXPENSE, escrow must remain an ASSET.
    const typeOf = (code: string): string | undefined => {
      const m = CHART_SQL.match(
        new RegExp(`gl_upsert_account\\('${code}','[^']*','(\\w+)'`),
      );
      return m?.[1];
    };
    expect(typeOf("34000")).toBe("liability"); // Notes & Loans Payable
    expect(typeOf("85010")).toBe("other_expense"); // Interest Expense
    expect(typeOf("12200")).toBe("asset"); // Prepaid Expenses
    expect(typeOf("10200")).toBe("asset"); // Bank - Operating
  });

  it("the excise TRUST account is never used as a loan liability", () => {
    // The specific defect, nailed down by name so it cannot come back.
    // 32000 holds the 37% excise Greenway collects for the WSLCB. It is a real
    // account, which is exactly why a wrong reference to it would never look
    // wrong. IRC 7501 makes trust-fund money personal exposure.
    expect(REAL_CODES.has("32000")).toBe(true);
    expect(CHART_SQL).toContain("Cannabis Excise Tax Payable (37%)");

    const ENGINE = readFileSync(
      resolve(__dirname, "../../src/lib/accounting/bank-match-core.ts"),
      "utf8",
    );
    expect(ENGINE).not.toMatch(/loanLiabilityAccountCode:\s*"32000"/);
    expect(ENGINE).not.toMatch(/escrowAssetAccountCode:\s*"32000"/);

    const PAGE = readFileSync(
      resolve(__dirname, "../../src/app/admin/books/bank/page.tsx"),
      "utf8",
    );
    expect(PAGE).not.toMatch(/loanLiabilityAccountCode:\s*"32000"/);
  });

  it("every account code the ADMIN PAGE hard-codes is a real account", () => {
    // The page shows Michael a worked journal entry with account numbers on it.
    // A number he could not find in his own chart of accounts would undermine
    // the whole point of the screen.
    const PAGE = readFileSync(
      resolve(__dirname, "../../src/app/admin/books/bank/page.tsx"),
      "utf8",
    );
    const used = Array.from(
      PAGE.matchAll(/(?:cashAccountCode|loanLiabilityAccountCode|interestExpenseAccountCode|escrowAssetAccountCode):\s*"(\d+)"/g),
    ).map((m) => m[1]);

    expect(used.length).toBeGreaterThanOrEqual(8); // two entities x four accounts
    for (const code of used) {
      expect(REAL_CODES.has(code), `page references unknown account ${code}`).toBe(true);
    }
  });
});
