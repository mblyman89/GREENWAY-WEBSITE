/**
 * tests/compliance/register-cash.test.ts
 *
 * books-93 / D-39 — the cash drawer's accounting half.
 *
 * Michael asked four questions about till cash. Two of the four answers are
 * "no entry", and those are the dangerous ones: a system that quietly does
 * nothing looks exactly like a system that is broken. So this file asserts
 * the YESes are correct AND that the NOs are stated out loud (rule 134).
 *
 * It also enforces reachability (rule 133): a builder nothing renders is a
 * finished feature nobody can find, which is the shape of D-39 in the first
 * place.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  VAULT_ACCOUNT,
  TILLS_ACCOUNT,
  UNDEPOSITED_ACCOUNT,
  OVER_SHORT_ACCOUNT,
  reconcileDenominations,
  buildTillOpenJournal,
  buildTillCloseJournal,
  buildBillSwapJournal,
  buildSealBagJournal,
  buildSupplyAdvanceJournal,
  buildSupplySettleJournal,
  EMPLOYEE_ADVANCE_ACCOUNT,
  SALES_POST_PER_SALE,
  SALES_POSTING_EXPLANATION,
  __runRegisterCashJournalTests,
  type RegisterCashResult,
} from "@/lib/accounting/register-cash-journal-core";
import {
  SPECIMEN_TILL_COUNTS,
  SPECIMEN_MASTER_COUNTS,
  SPECIMEN_TILL_COUNT,
  SPECIMEN_CASH_SALES_MINOR,
  SPECIMEN_SHORTAGE_MINOR,
  buildRegisterCashSpecimen,
  __runRegisterCashSpecimenTests,
} from "@/lib/accounting/register-cash-specimen-core";
import { TILL_ACCOUNT } from "@/lib/accounting/sale-journal-core";
import { denomTotalMinor, type DenomCounts } from "@/lib/registers/cash";
import type { JournalDraft } from "@/lib/accounting/ledger-core";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const CORE = "src/lib/accounting/register-cash-journal-core.ts";
const PANEL = "src/app/admin/registers/eod/RegisterCashSpecimen.tsx";
const EOD_PAGE = "src/app/admin/registers/eod/page.tsx";

/** Sum of a draft's lines. Zero means debits equal credits. */
function sum(j: JournalDraft): number {
  return j.lines.reduce((s, l) => s + l.amountCents, 0);
}

/**
 * Rule 48: a helper that cannot classify must FAIL, not return a soft value.
 * These narrow a RegisterCashResult and blow up if the kind is wrong, so a
 * refusal can never masquerade as a passing assertion about a journal.
 */
function mustPost(r: RegisterCashResult): JournalDraft {
  if (r.kind !== "journal") {
    throw new Error(`expected a journal, got ${r.kind}: ${r.explanation}`);
  }
  return r.journal;
}
function mustNotPost(r: RegisterCashResult, kind: "no_entry" | "refused"): string {
  if (r.kind !== kind) {
    throw new Error(`expected ${kind}, got ${r.kind}`);
  }
  return r.explanation;
}

/** The durable outcome code. Throws on a journal, which has no code. */
function codeOf(r: RegisterCashResult): string {
  if (r.kind === "journal") throw new Error("a posted journal has no outcome code");
  return r.code;
}

/** Amount on a given account, or undefined when the account is absent. */
function amountOn(j: JournalDraft, account: string): number | undefined {
  const hits = j.lines.filter((l) => l.accountCode === account);
  if (hits.length > 1) throw new Error(`${account} appears ${hits.length} times`);
  return hits[0]?.amountCents;
}

/** Strip // and block comments so prose in a doc-block cannot satisfy a check. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const FLOAT_MINOR = 16_750;
const MASTER_MINOR = 100_000;

/* ══════════════════════════════════════════════════════════════════════════
 * 0) The self-tests actually run here too
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-93 · self-tests", () => {
  it("the journal core's own self-test passes inside vitest", () => {
    expect(() => __runRegisterCashJournalTests()).not.toThrow();
  });

  it("the specimen core's own self-test passes inside vitest", () => {
    expect(() => __runRegisterCashSpecimenTests()).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1) MICHAEL'S FLOAT — the arithmetic, checked against what he wrote
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-93 · Michael's stated float", () => {
  it("a drawer of 5 tens, 10 fives, 50 ones and one roll each of coin is $167.50", () => {
    expect(denomTotalMinor(SPECIMEN_TILL_COUNTS)).toBe(FLOAT_MINOR);
  });

  it("the corrected master till (100 nickels) is exactly $1,000.00", () => {
    expect(denomTotalMinor(SPECIMEN_MASTER_COUNTS)).toBe(MASTER_MINOR);
  });

  it("the ORIGINAL master mix of 90 nickels is caught as 50 cents short", () => {
    // This is not hypothetical: Michael's first message said 90 nickels, the
    // reconciler flagged it, and he corrected it. The test keeps that catch.
    const original: Partial<DenomCounts> = { ...SPECIMEN_MASTER_COUNTS, nickels: 90 };
    const rec = reconcileDenominations(original, MASTER_MINOR);
    expect(rec.agrees).toBe(false);
    expect(rec.differenceMinor).toBe(-50);
  });

  it("three drawers plus the master till is $1,502.50 of cash on hand before a single sale", () => {
    expect(SPECIMEN_TILL_COUNT * FLOAT_MINOR + MASTER_MINOR).toBe(150_250);
    expect(buildRegisterCashSpecimen().totalFloatMinor).toBe(150_250);
  });

  it("reconcileDenominations agrees when the coins and the dollars match", () => {
    const rec = reconcileDenominations(SPECIMEN_TILL_COUNTS, FLOAT_MINOR);
    expect(rec.agrees).toBe(true);
    expect(rec.differenceMinor).toBe(0);
    expect(rec.countedMinor).toBe(FLOAT_MINOR);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2) Q1 — OPENING A TILL
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-93 · Q1 opening a till", () => {
  const openFromVault = () =>
    buildTillOpenJournal({
      journalDate: "2026-11-02",
      registerName: "Register 1",
      floatMinor: FLOAT_MINOR,
      counts: SPECIMEN_TILL_COUNTS,
      fromVault: true,
    });

  it("moving the float out of the vault posts a two-line transfer", () => {
    const j = mustPost(openFromVault());
    expect(j.lines).toHaveLength(2);
    expect(sum(j)).toBe(0);
  });

  it("the till is DEBITED and the vault CREDITED the same float", () => {
    const j = mustPost(openFromVault());
    expect(amountOn(j, TILLS_ACCOUNT)).toBe(FLOAT_MINOR);
    expect(amountOn(j, VAULT_ACCOUNT)).toBe(-FLOAT_MINOR);
  });

  it("opening a till never touches an income account — it is a transfer, not a sale", () => {
    const j = mustPost(openFromVault());
    expect(amountOn(j, OVER_SHORT_ACCOUNT)).toBeUndefined();
    expect(amountOn(j, UNDEPOSITED_ACCOUNT)).toBeUndefined();
  });

  it("a float that stayed in the drawer overnight posts NOTHING and says why", () => {
    const why = mustNotPost(
      buildTillOpenJournal({
        journalDate: "2026-11-02",
        registerName: "Register 1",
        floatMinor: FLOAT_MINOR,
        fromVault: false,
      }),
      "no_entry",
    );
    // Rule 134: the silence has to be written down somewhere a human sees it.
    expect(why).toMatch(/no cash moved/i);
    expect(why).toMatch(/nothing to book/i);
    // And it must be SPECIFIC. A generic sentence that could describe any
    // drawer on any day tells Michael nothing, so it has to name the register
    // and the amount that deliberately did not move.
    expect(why).toContain("Register 1");
    expect(why).toContain("$167.50");
  });

  it("denominations that disagree with the stated float REFUSE the open", () => {
    const why = mustNotPost(
      buildTillOpenJournal({
        journalDate: "2026-11-02",
        registerName: "Register 1",
        floatMinor: FLOAT_MINOR,
        counts: { ...SPECIMEN_TILL_COUNTS, nickels: 0 },
        fromVault: true,
      }),
      "refused",
    );
    expect(why).toMatch(/recount/i);
  });

  it("a negative float is refused rather than booked as a credit to the till", () => {
    mustNotPost(
      buildTillOpenJournal({
        journalDate: "2026-11-02",
        registerName: "R1",
        floatMinor: -1,
        fromVault: true,
      }),
      "refused",
    );
  });

  it("an empty drawer is no_entry, not a refusal — zero is an answer (rule 135)", () => {
    const r = buildTillOpenJournal({
      journalDate: "2026-11-02",
      registerName: "R1",
      floatMinor: 0,
      fromVault: true,
    });
    mustNotPost(r, "no_entry");
    // The code is the durable handle rule 134 relies on. If it drifts, the
    // outcome stops being greppable in manifest_events and the refusal
    // effectively did not happen.
    expect(codeOf(r)).toBe("TILL_OPEN_NO_FLOAT");
  });

  it("each opening outcome carries its own stable code", () => {
    const stays = buildTillOpenJournal({
      journalDate: "2026-11-02",
      registerName: "R1",
      floatMinor: FLOAT_MINOR,
      fromVault: false,
    });
    expect(codeOf(stays)).toBe("TILL_OPEN_FLOAT_STAYS");

    const bad = buildTillOpenJournal({
      journalDate: "2026-11-02",
      registerName: "R1",
      floatMinor: -1,
      fromVault: true,
    });
    expect(codeOf(bad)).toBe("TILL_OPEN_BAD_FLOAT");

    const mism = buildTillOpenJournal({
      journalDate: "2026-11-02",
      registerName: "R1",
      floatMinor: FLOAT_MINOR,
      counts: { ...SPECIMEN_TILL_COUNTS, nickels: 0 },
      fromVault: true,
    });
    expect(codeOf(mism)).toBe("TILL_OPEN_DENOM_MISMATCH");

    // Four distinct outcomes must stay four distinct codes.
    expect(
      new Set([codeOf(stays), codeOf(bad), codeOf(mism), "TILL_OPEN_NO_FLOAT"]).size,
    ).toBe(4);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3) Q2 — CLOSING A TILL (the entry that matters)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-93 · Q2 closing a till", () => {
  const close = (over: Partial<Parameters<typeof buildTillCloseJournal>[0]> = {}) =>
    buildTillCloseJournal({
      journalDate: "2026-11-02",
      registerName: "Register 1",
      openingFloatMinor: FLOAT_MINOR,
      cashSalesMinor: 50_000,
      dropsMinor: 0,
      countedMinor: FLOAT_MINOR + 50_000,
      floatStaysInDrawer: true,
      ...over,
    });

  it("a drawer that counts right sends exactly the takings to the SAFE", () => {
    const j = mustPost(close());
    expect(amountOn(j, VAULT_ACCOUNT)).toBe(50_000);
  });

  it("and relieves the till by exactly the same amount, so the entry balances", () => {
    const j = mustPost(close());
    expect(amountOn(j, TILLS_ACCOUNT)).toBe(-50_000);
    expect(sum(j)).toBe(0);
  });

  it("a drawer that counts right never touches Cash Over / (Short)", () => {
    expect(amountOn(mustPost(close()), OVER_SHORT_ACCOUNT)).toBeUndefined();
  });

  it("a $5 SHORTAGE debits 50920 — a short drawer is a loss", () => {
    const j = mustPost(close({ countedMinor: FLOAT_MINOR + 50_000 - 500 }));
    expect(amountOn(j, OVER_SHORT_ACCOUNT)).toBe(500);
    expect(sum(j)).toBe(0);
  });

  it("a $5 OVERAGE credits 50920 — the sign is not cosmetic", () => {
    const j = mustPost(close({ countedMinor: FLOAT_MINOR + 50_000 + 500 }));
    expect(amountOn(j, OVER_SHORT_ACCOUNT)).toBe(-500);
    expect(sum(j)).toBe(0);
  });

  it("the over/short line SAYS 'over' when it is over, and 'short' when short", () => {
    // A correct number under a wrong word is worse than a wrong number: the
    // ledger balances, the report reads backwards, and nobody re-checks it.
    const overLine = mustPost(close({ countedMinor: FLOAT_MINOR + 50_500 })).lines.find(
      (l) => l.accountCode === OVER_SHORT_ACCOUNT,
    );
    expect(overLine?.description).toContain("over by $5.00");
    expect(overLine?.description).not.toMatch(/short/i);

    const shortLine = mustPost(close({ countedMinor: FLOAT_MINOR + 49_500 })).lines.find(
      (l) => l.accountCode === OVER_SHORT_ACCOUNT,
    );
    expect(shortLine?.description).toContain("short by $5.00");
    expect(shortLine?.description).not.toMatch(/ over /i);
  });

  it("the close memo names the direction too, since that is what prints", () => {
    expect(mustPost(close({ countedMinor: FLOAT_MINOR + 50_500 })).memo).toMatch(/OVER by/);
    expect(mustPost(close({ countedMinor: FLOAT_MINOR + 49_500 })).memo).toMatch(/SHORT by/);
  });

  it("a short drawer still moves only the cash that is physically there", () => {
    // The shortage is NOT sent to the safe: only $495 of the $500 exists.
    const j = mustPost(close({ countedMinor: FLOAT_MINOR + 50_000 - 500 }));
    expect(amountOn(j, VAULT_ACCOUNT)).toBe(49_500);
    expect(amountOn(j, TILLS_ACCOUNT)).toBe(-50_000);
  });

  it("when the whole drawer goes to the safe, the float travels with it", () => {
    const j = mustPost(close({ floatStaysInDrawer: false }));
    expect(amountOn(j, VAULT_ACCOUNT)).toBe(FLOAT_MINOR + 50_000);
    expect(sum(j)).toBe(0);
  });

  it("mid-shift drops already out of the drawer are not removed a second time", () => {
    const j = mustPost(
      close({ dropsMinor: 20_000, countedMinor: FLOAT_MINOR + 50_000 - 20_000 }),
    );
    expect(amountOn(j, OVER_SHORT_ACCOUNT)).toBeUndefined();
    expect(amountOn(j, VAULT_ACCOUNT)).toBe(30_000);
  });

  it("the close does NOT re-book the cash sales — that would count them twice", () => {
    // Sales already debited 10110 one entry per sale. If the close credited
    // 10110 AND credited a revenue account, the day's income would double.
    const j = mustPost(close());
    const accounts = j.lines.map((l) => l.accountCode);
    expect(accounts).toEqual(expect.arrayContaining([VAULT_ACCOUNT, TILLS_ACCOUNT]));
    expect(accounts).toHaveLength(2);
  });

  it("a drawer counted below its own float is refused and escalated, not booked", () => {
    const why = mustNotPost(
      close({ cashSalesMinor: 0, countedMinor: 1_000 }),
      "refused",
    );
    expect(why).toMatch(/manager/i);
  });

  it("a shift with no sales that counts exactly its float is no_entry, and says so", () => {
    const why = mustNotPost(
      close({ cashSalesMinor: 0, countedMinor: FLOAT_MINOR }),
      "no_entry",
    );
    expect(why).toMatch(/nothing to record/i);
  });

  it("counted denominations that disagree with the counted total refuse the close", () => {
    const why = mustNotPost(
      close({ countedMinor: FLOAT_MINOR, counts: { ...SPECIMEN_TILL_COUNTS, tens: 4 } }),
      "refused",
    );
    expect(why).toMatch(/recount/i);
  });

  it("a non-integer amount is refused — cents are integers, never floats", () => {
    mustNotPost(close({ cashSalesMinor: 50_000.5 }), "refused");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4) Q3 — SWAPPING BILLS AT THE MASTER TILL
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-93 · Q3 breaking large bills", () => {
  it("an equal swap posts no entry at all", () => {
    mustNotPost(
      buildBillSwapJournal({
        amountMinor: 10_000,
        given: { hundreds: 1 },
        received: { twenties: 2, tens: 4, fives: 2, ones: 10 },
      }),
      "no_entry",
    );
  });

  it("and it states the amount it deliberately did not book, on both sides", () => {
    const why = mustNotPost(buildBillSwapJournal({ amountMinor: 10_000 }), "no_entry");
    // "Trading $100.00 of large bills for the same $100.00 in small bills."
    // Naming the figure once leaves it ambiguous which side is unchanged;
    // naming it twice is what makes the sentence an argument rather than a
    // label. Both halves must survive an edit.
    expect(why).toMatch(/Trading \$100\.00/);
    expect(why).toMatch(/same \$100\.00/);
    expect(why.split("$100.00").length - 1).toBe(2);
    expect(why).toMatch(/does not change how much cash/i);
  });

  it("an UNEQUAL exchange is refused — that is a cash movement wearing a swap's clothes", () => {
    const why = mustNotPost(
      buildBillSwapJournal({
        amountMinor: 10_000,
        given: { hundreds: 1 },
        received: { twenties: 2 },
      }),
      "refused",
    );
    expect(why).toContain("$60.00");
  });

  it("a swap with only one side given cannot be checked, so it stays no_entry", () => {
    mustNotPost(buildBillSwapJournal({ amountMinor: 5_000, given: { fifties: 1 } }), "no_entry");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5) Q4 — EVERY SALE ALREADY POSTS
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-93 · Q4 one entry per sale", () => {
  it("the till account named here is the SAME constant the sale poster debits", () => {
    // Rule 39: do not re-implement the fact, import it from both sides.
    expect(TILLS_ACCOUNT).toBe(TILL_ACCOUNT);
  });

  it("sale-journal-core really does debit the till, once, per sale", () => {
    const src = stripComments(read("src/lib/accounting/sale-journal-core.ts"));
    expect(src).toContain("accountCode: TILL_ACCOUNT");
  });

  it("the comment stripper actually strips, so the check above cannot pass on prose", () => {
    expect(stripComments("// accountCode: TILL_ACCOUNT\n")).not.toContain("TILL_ACCOUNT");
    expect(stripComments("/* accountCode: TILL_ACCOUNT */")).not.toContain("TILL_ACCOUNT");
    expect(stripComments("const a = 1; // x\n")).toContain("const a = 1;");
  });

  it("the answer is recorded as a value, not only as prose", () => {
    expect(SALES_POST_PER_SALE).toBe(true);
    expect(SALES_POSTING_EXPLANATION).toContain("10110");
    expect(SALES_POSTING_EXPLANATION).toMatch(/no second entry/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6) ACCOUNTS EXIST IN THE CHART
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-93 · the accounts are real", () => {
  it("every account these builders use is seeded in the chart of accounts", () => {
    const chart = read("supabase/migrations/0173_chart_of_accounts.sql");
    for (const code of [VAULT_ACCOUNT, TILLS_ACCOUNT, UNDEPOSITED_ACCOUNT, OVER_SHORT_ACCOUNT]) {
      expect(chart).toContain(`'${code}'`);
    }
  });

  it("Cash Over / (Short) is an income account, so over is a credit", () => {
    const chart = read("supabase/migrations/0173_chart_of_accounts.sql");
    const line = chart.split("\n").find((l) => l.includes(`'${OVER_SHORT_ACCOUNT}'`));
    expect(line).toBeDefined();
    expect(line).toContain("'income'");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7) REACHABILITY (rule 133) — the door has to be open
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-93 · reachability", () => {
  it("the specimen panel imports the specimen builder", () => {
    expect(stripComments(read(PANEL))).toContain("buildRegisterCashSpecimen");
  });

  it("the EOD page imports the specimen panel", () => {
    expect(stripComments(read(EOD_PAGE))).toContain(
      'import { RegisterCashSpecimen } from "./RegisterCashSpecimen"',
    );
  });

  it("and RENDERS it — an import alone shows nothing to Michael", () => {
    const page = stripComments(read(EOD_PAGE));
    const renders = page.split("<RegisterCashSpecimen />").length - 1;
    // Two: the Supabase-unconfigured branch AND the normal report path.
    // A single render would leave one of the two screens blank.
    expect(renders).toBe(2);
  });

  it("the unconfigured branch renders it too, so the answers survive a cold environment", () => {
    const page = stripComments(read(EOD_PAGE));
    const cut = page.indexOf("Supabase not configured");
    expect(cut).toBeGreaterThan(-1);
    const branch = page.slice(cut, cut + 400);
    expect(branch).toContain("<RegisterCashSpecimen />");
  });

  it("the panel answers all four of Michael's questions on screen", () => {
    const panel = read(PANEL);
    expect(panel).toContain("1. Do we post to the ledger when a till is opened?");
    expect(panel).toContain("2. Is there an entry for closing the till?");
    expect(panel).toContain("3. Is there an entry for swapping large bills for small?");
    expect(panel).toContain(
      "4. Does every sale get its own entry, or one at the end of the shift?",
    );
  });

  it("the panel shows the no_entry explanations, not just the journals", () => {
    // If it only rendered `kind === "journal"`, Q3's answer would be a blank
    // space — which is precisely the failure rule 134 exists to prevent.
    expect(read(PANEL)).toContain("No journal entry");
  });

  it("the panel computes its numbers instead of hard-coding dollar figures", () => {
    const code = stripComments(read(PANEL));
    expect(code).not.toMatch(/\$1,502\.50|\$167\.50|\$1,000\.00/);
    expect(code).toContain("formatCents(s.totalFloatMinor)");
  });

  it("both cores are registered in the pure self-test runner", () => {
    const runner = stripComments(read("scripts/compliance/run-pure-selftests.ts"));
    // Calls, not just imports — an unreferenced import runs nothing.
    expect(runner).toContain("__runRegisterCashJournalTests()");
    expect(runner).toContain("__runRegisterCashSpecimenTests()");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8) THE UNFINISHED HALF IS STATED, NOT HIDDEN (rule 133f)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-93 · the deliberate limit", () => {
  it("the core says in writing that nothing posts these entries yet", () => {
    const src = read(CORE);
    expect(src).toContain("DELIBERATE LIMIT");
    expect(src).toContain("D-39");
  });

  it("no builder in this slice actually writes to the ledger", () => {
    const src = stripComments(read(CORE));
    expect(src).not.toContain("submitJournal");
    expect(src).not.toContain("supabase");
  });

  it("the panel tells Michael on screen that nothing shown has been posted", () => {
    const s = buildRegisterCashSpecimen();
    expect(s.notice).toMatch(/not your books/i);
    expect(s.notice).toMatch(/no entry .* has been posted/i);
    expect(stripComments(read(PANEL))).toContain("s.notice");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9) THE SPECIMEN ITSELF
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-93 · the worked example", () => {
  const s = buildRegisterCashSpecimen();

  it("shows a real posting for the open", () => {
    expect(sum(mustPost(s.open))).toBe(0);
  });

  it("shows the ordinary morning where nothing posts", () => {
    mustNotPost(s.openStays, "no_entry");
  });

  it("shows a close that is short, so 50920 is visible rather than theoretical", () => {
    const j = mustPost(s.close);
    expect(amountOn(j, OVER_SHORT_ACCOUNT)).toBe(SPECIMEN_SHORTAGE_MINOR);
    expect(amountOn(j, VAULT_ACCOUNT)).toBe(
      SPECIMEN_CASH_SALES_MINOR - SPECIMEN_SHORTAGE_MINOR,
    );
    expect(sum(j)).toBe(0);
  });

  it("shows the swap answering with no entry", () => {
    mustNotPost(s.swap, "no_entry");
  });

  it("every specimen figure is derived from the denominations, not typed in", () => {
    expect(s.tillFloatMinor).toBe(denomTotalMinor(SPECIMEN_TILL_COUNTS));
    expect(s.masterFloatMinor).toBe(denomTotalMinor(SPECIMEN_MASTER_COUNTS));
    expect(s.totalFloatMinor).toBe(s.tillCount * s.tillFloatMinor + s.masterFloatMinor);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * books-98 — THE SAFE LAYER, THE BAG, AND THE SUPPLY RUN
 * ══════════════════════════════════════════════════════════════════════════ */

describe("books-98 · closing a till lands in the SAFE, not in a deposit", () => {
  // D-77. The close line always SAID "to safe" while debiting 10400
  // Undeposited Funds. The words and the account disagreed, and the account
  // was the wrong one: cash pulled from a drawer sits in the store safe for
  // hours, mixed with two other drawers, before anyone seals a bag. Calling
  // that "undeposited funds" claims a deposit exists that nobody has counted.
  const close = () =>
    buildTillCloseJournal({
      journalDate: "2026-11-02",
      registerName: "Register 1",
      openingFloatMinor: 16_750,
      cashSalesMinor: 50_000,
      dropsMinor: 0,
      countedMinor: 16_750 + 50_000,
      floatStaysInDrawer: true,
    });

  it("debits the vault, and does NOT touch Undeposited Funds", () => {
    const j = mustPost(close());
    expect(amountOn(j, VAULT_ACCOUNT)).toBe(50_000);
    // The whole point of the fix: 10400 must not appear until a bag is sealed.
    expect(amountOn(j, UNDEPOSITED_ACCOUNT)).toBeUndefined();
  });

  it("keeps Michael's $167.50 float in the drawer, per his own workflow", () => {
    // "167.50 is left in the register and the rest goes into the safe."
    const j = mustPost(close());
    expect(amountOn(j, TILLS_ACCOUNT)).toBe(-50_000);
    expect(sum(j)).toBe(0);
  });
});

describe("books-98 · sealing a numbered deposit bag", () => {
  const seal = (over: Partial<Parameters<typeof buildSealBagJournal>[0]> = {}) =>
    buildSealBagJournal({
      journalDate: "2026-11-02",
      bagNo: "GW-00412",
      amountMinor: 150_000,
      ...over,
    });

  it("moves money out of the safe and into Undeposited Funds", () => {
    const j = mustPost(seal());
    expect(amountOn(j, UNDEPOSITED_ACCOUNT)).toBe(150_000);
    expect(amountOn(j, VAULT_ACCOUNT)).toBe(-150_000);
    expect(sum(j)).toBe(0);
  });

  it("writes the bag number onto the lines AND the memo, because that is what is matched later", () => {
    const j = mustPost(seal());
    expect(j.memo).toContain("GW-00412");
    for (const l of j.lines) expect(l.description).toContain("GW-00412");
  });

  it("refuses a bag with no id rather than posting an untraceable deposit", () => {
    // A bag with no number cannot be matched to the bank credit that arrives
    // four days later. Posting it anyway would create exactly the guesswork
    // the bag id exists to remove.
    for (const bagNo of [null, undefined, "", "   "]) {
      const why = mustNotPost(seal({ bagNo }), "refused");
      expect(why).toMatch(/no id/i);
      expect(why).toMatch(/nothing was recorded/i);
    }
  });

  it("trims a bag number rather than storing two different ids for one bag", () => {
    const j = mustPost(seal({ bagNo: "  GW-00412  " }));
    expect(j.memo).toContain("Seal deposit bag GW-00412");
    expect(j.memo).not.toContain("  GW-00412");
  });

  it("refuses an empty or fractional bag, and says which", () => {
    expect(mustNotPost(seal({ amountMinor: 0 }), "refused")).toMatch(/cannot be filled/i);
    expect(mustNotPost(seal({ amountMinor: -1 }), "refused")).toMatch(/cannot be filled/i);
    expect(mustNotPost(seal({ amountMinor: 10.5 }), "refused")).toMatch(/whole number/i);
  });
});

describe("books-98 · the supply run (Michael's question)", () => {
  // "Sometimes my employees need to run to the store and buy some supplies, so
  // they take cash from the master, and replace it with a receipt."
  const advance = (over: Partial<Parameters<typeof buildSupplyAdvanceJournal>[0]> = {}) =>
    buildSupplyAdvanceJournal({
      journalDate: "2026-11-02",
      employeeName: "Dana",
      amountMinor: 5_000,
      ...over,
    });

  it("books cash out as a RECEIVABLE, not an expense — nothing has been bought yet", () => {
    const j = mustPost(advance());
    expect(amountOn(j, EMPLOYEE_ADVANCE_ACCOUNT)).toBe(5_000);
    expect(amountOn(j, VAULT_ACCOUNT)).toBe(-5_000);
    expect(sum(j)).toBe(0);
  });

  it("puts the employee's name on the entry, since the balance is a claim on a person", () => {
    const j = mustPost(advance());
    expect(j.memo).toContain("Dana");
    expect(mustNotPost(advance({ employeeName: "   " }), "refused")).toMatch(/no name/i);
  });

  it("says out loud that this is not yet an expense", () => {
    const r = advance();
    if (r.kind !== "journal") throw new Error("expected a journal");
    expect(r.explanation).toMatch(/NOT an expense/);
  });

  it("settles the advance: expense at the receipt amount, change back to the safe", () => {
    const j = mustPost(
      buildSupplySettleJournal({
        journalDate: "2026-11-02",
        employeeName: "Dana",
        advancedMinor: 5_000,
        receiptMinor: 4_387,
        expenseAccount: "60400",
      }),
    );
    expect(amountOn(j, "60400")).toBe(4_387);
    expect(amountOn(j, VAULT_ACCOUNT)).toBe(613);
    // 12100 goes back to zero for this trip. That is the test that the
    // receivable is actually cleared rather than left dangling forever.
    expect(amountOn(j, EMPLOYEE_ADVANCE_ACCOUNT)).toBe(-5_000);
    expect(sum(j)).toBe(0);
  });

  it("handles the exact-change case without inventing a zero line", () => {
    const j = mustPost(
      buildSupplySettleJournal({
        journalDate: "2026-11-02",
        employeeName: "Dana",
        advancedMinor: 5_000,
        receiptMinor: 5_000,
        expenseAccount: "60400",
      }),
    );
    expect(amountOn(j, VAULT_ACCOUNT)).toBeUndefined();
    expect(amountOn(j, EMPLOYEE_ADVANCE_ACCOUNT)).toBe(-5_000);
    expect(sum(j)).toBe(0);
  });

  it("refuses when the receipt exceeds the advance — that is a reimbursement OWED to the employee", () => {
    // Silently flipping the sign here would hide the fact that the business
    // now owes the employee money, and would book a negative "change" line.
    const why = mustNotPost(
      buildSupplySettleJournal({
        journalDate: "2026-11-02",
        employeeName: "Dana",
        advancedMinor: 5_000,
        receiptMinor: 6_200,
        expenseAccount: "60400",
      }),
      "refused",
    );
    expect(why).toMatch(/own pocket/i);
    expect(why).toMatch(/reimbursement/i);
    expect(why).toMatch(/nothing was recorded/i);
  });
});
