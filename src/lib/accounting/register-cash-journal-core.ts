/**
 * src/lib/accounting/register-cash-journal-core.ts
 *
 * books-93 / D-39 — the accounting half of the cash drawer.
 *
 * Michael asked four questions, in his words:
 *
 *   "Do we post to the ledger opening a till? Do we have a journal entry for
 *    the closing of the till? Is there a journal entry for exchanging large
 *    bills for small bills from the master till? Does every sale get its own
 *    journal entry, or is there just one at the end of the shift?"
 *
 * Two of those four answers are NO, and the NOs matter as much as the YESes.
 * A system that silently does nothing looks identical to a system that is
 * broken (rule 134), so each "no entry" case here returns an explicit reason
 * that the screen can show, instead of returning nothing at all.
 *
 * ── THE FOUR ANSWERS ──────────────────────────────────────────────────────
 *
 * 1. OPENING a till: an entry, but NOT new money. Cash moves from the vault
 *    (10100) to a till (10110). Total cash on hand does not change by a cent.
 *    If the float simply lives in the drawers and never goes back to the
 *    vault overnight, this is booked ONCE at cutover, not every morning.
 *
 * 2. CLOSING a till: YES, and this is the one that actually matters. The
 *    counted cash leaves the drawer for the safe/deposit (10400 Undeposited
 *    Funds), the float either stays or returns to the vault, and any
 *    difference between what the drawer SHOULD hold and what it DOES hold
 *    lands in 50920 Cash Over / (Short). Without this entry 10110 is debited
 *    by every cash sale forever and never credited by anything, so the books
 *    would claim the tills hold more money every single day.
 *
 * 3. SWAPPING large bills for small from the master till: NO ENTRY, ever.
 *    Five twenties for a hundred is the same account, the same drawer, and
 *    the same hundred dollars. Denominations are an operational fact, not an
 *    economic one. Booking it would create two meaningless entries a day.
 *
 * 4. EVERY SALE: already its own entry, and that is not new work.
 *    `sale-journal-core.ts` debits TILL_ACCOUNT = "10110" per sale
 *    ("Cash to till, tax-inclusive, as paid"). The shift-end entry is the
 *    CLOSE, not a summary of the sales. Both would be double-counting.
 *
 * ── WHY OVER/SHORT IS A REAL ACCOUNT AND NOT A ROUNDING PLUG ──────────────
 * 50920 is the earliest signal of both honest error and theft, and in a
 * cash-heavy regulated business the till-to-bank trail is the first thing an
 * examiner asks for. A close that "balances" by forcing the numbers to agree
 * destroys exactly the evidence the account exists to preserve.
 *
 * ── DELIBERATE LIMIT (rule 133f) ─────────────────────────────────────────
 * This module BUILDS the entries and the EOD screen SHOWS them, but nothing
 * calls `submitJournal` with them yet: closing a shift still does not post.
 * That is D-39, it is not fixed here, and saying so out loud is the point —
 * an unstated gap is indistinguishable from a bug. What this slice settles is
 * WHICH entry each event produces, and which events produce none at all, so
 * the poster that follows has nothing left to invent.
 *
 * PURE: no I/O, no database, no clock, no `server-only` import. Money is
 * always integer CENTS. Positive amountCents = debit, negative = credit.
 */
import type { JournalDraft, JournalLineDraft } from "./ledger-core";
import { denomTotalMinor, type DenomCounts } from "@/lib/registers/cash";

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) ACCOUNTS
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Cash on Hand — Vault. The safe / master till. */
export const VAULT_ACCOUNT = "10100";
/** Cash on Hand — Tills. Debited by every cash sale in sale-journal-core. */
export const TILLS_ACCOUNT = "10110";
/** Undeposited Funds. Counted cash on its way to the bank. */
export const UNDEPOSITED_ACCOUNT = "10400";
/** Cash Over / (Short). Income-type: over = credit, short = debit. */
export const OVER_SHORT_ACCOUNT = "50920";

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) RESULT SHAPE — an entry, or a REASON there is none
 * ═══════════════════════════════════════════════════════════════════════════ */

export type RegisterCashResult =
  | { readonly kind: "journal"; readonly journal: JournalDraft; readonly explanation: string }
  /**
   * A deliberate dead end (rule 133f). The operation is legitimate and
   * complete; it simply has no accounting consequence. The screen MUST show
   * `explanation` so that "nothing happened" never looks like a failure.
   */
  | { readonly kind: "no_entry"; readonly code: string; readonly explanation: string }
  /** The operation could not be trusted. Nothing was recorded. */
  | { readonly kind: "refused"; readonly code: string; readonly explanation: string };

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) DENOMINATIONS MUST AGREE WITH THE DOLLARS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A counted drawer states a total twice: once as a pile of denominations and
 * once as a dollar figure. If those two disagree, one of them is wrong and we
 * do not know which — so we refuse rather than pick a winner.
 *
 * This exists because of the very first thing that happened in this slice:
 * Michael's stated master-till mix (32 tens, 64 fives, 318 ones, 95 quarters,
 * 120 dimes, 90 nickels, 125 pennies) totalled $999.50, not the $1,000.00 he
 * intended. He corrected it to 100 nickels. Arithmetic caught what eyes did
 * not, which is precisely the job.
 */
export function reconcileDenominations(
  counts: Partial<DenomCounts>,
  statedTotalMinor: number,
): { readonly agrees: boolean; readonly countedMinor: number; readonly differenceMinor: number } {
  const countedMinor = denomTotalMinor(counts);
  const differenceMinor = countedMinor - Math.round(statedTotalMinor);
  return { agrees: differenceMinor === 0, countedMinor, differenceMinor };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4) Q1 — OPENING A TILL
 * ═══════════════════════════════════════════════════════════════════════════ */

export type OpenTillInput = {
  readonly journalDate: string;
  readonly registerName: string;
  /** The float placed in the drawer, in cents. */
  readonly floatMinor: number;
  /** Optional denomination breakdown; when given it MUST match floatMinor. */
  readonly counts?: Partial<DenomCounts>;
  /**
   * TRUE when this float came out of the vault today. FALSE when the drawer
   * simply keeps its float overnight — in which case the money never moved
   * and there is nothing to book.
   */
  readonly fromVault: boolean;
  readonly sourceRef?: string | null;
};

export function buildTillOpenJournal(input: OpenTillInput): RegisterCashResult {
  if (!Number.isInteger(input.floatMinor) || input.floatMinor < 0) {
    return {
      kind: "refused",
      code: "TILL_OPEN_BAD_FLOAT",
      explanation:
        "The opening float must be a whole number of cents and cannot be negative. " +
        "Nothing was recorded.",
    };
  }

  if (input.counts) {
    const rec = reconcileDenominations(input.counts, input.floatMinor);
    if (!rec.agrees) {
      return {
        kind: "refused",
        code: "TILL_OPEN_DENOM_MISMATCH",
        explanation:
          `The bills and coins counted come to ${fmt(rec.countedMinor)}, but the ` +
          `float was entered as ${fmt(input.floatMinor)} — a difference of ` +
          `${fmt(Math.abs(rec.differenceMinor))}. One of the two is wrong and the ` +
          `system will not guess which. Recount, then open the till again.`,
      };
    }
  }

  if (input.floatMinor === 0) {
    return {
      kind: "no_entry",
      code: "TILL_OPEN_NO_FLOAT",
      explanation:
        "The drawer opened with nothing in it, so no money moved and there is " +
        "nothing to record.",
    };
  }

  if (!input.fromVault) {
    return {
      kind: "no_entry",
      code: "TILL_OPEN_FLOAT_STAYS",
      explanation:
        `The ${input.registerName} drawer kept its own float of ` +
        `${fmt(input.floatMinor)} overnight, so no cash moved between the vault ` +
        `and the till and there is nothing to book. The float was recorded on ` +
        `the ledger once, when it was first placed in the drawer.`,
    };
  }

  return {
    kind: "journal",
    explanation:
      `${fmt(input.floatMinor)} moved from the vault into ${input.registerName}. ` +
      `This is a transfer, not income — total cash on hand is exactly the same ` +
      `before and after.`,
    journal: {
      entityCode: "greenway",
      journalDate: input.journalDate,
      sourceKind: "bank",
      sourceRef: input.sourceRef ?? null,
      memo: `Open ${input.registerName} — float from vault`,
      lines: [
        line(1, TILLS_ACCOUNT, input.floatMinor, `Float into ${input.registerName}`),
        line(2, VAULT_ACCOUNT, -input.floatMinor, "Float out of vault"),
      ],
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 5) Q2 — CLOSING A TILL (the one that matters)
 * ═══════════════════════════════════════════════════════════════════════════ */

export type CloseTillInput = {
  readonly journalDate: string;
  readonly registerName: string;
  /** What the drawer started with. */
  readonly openingFloatMinor: number;
  /**
   * Cash sales rung on this drawer during the shift. These have ALREADY been
   * debited to 10110 one entry per sale by sale-journal-core, which is why
   * this close does not re-book them: it only moves what is physically there.
   */
  readonly cashSalesMinor: number;
  /** Mid-shift drops to the safe, already removed from the drawer. */
  readonly dropsMinor: number;
  /** What was actually counted at close, in cents. */
  readonly countedMinor: number;
  /** Optional denomination breakdown; when given it MUST match countedMinor. */
  readonly counts?: Partial<DenomCounts>;
  /**
   * TRUE when the float is left in the drawer for tomorrow (only the takings
   * are removed). FALSE when the entire drawer goes to the safe.
   */
  readonly floatStaysInDrawer: boolean;
  readonly sourceRef?: string | null;
};

export function buildTillCloseJournal(input: CloseTillInput): RegisterCashResult {
  for (const [label, v] of [
    ["opening float", input.openingFloatMinor],
    ["cash sales", input.cashSalesMinor],
    ["drops", input.dropsMinor],
    ["counted cash", input.countedMinor],
  ] as const) {
    if (!Number.isInteger(v) || v < 0) {
      return {
        kind: "refused",
        code: "TILL_CLOSE_BAD_AMOUNT",
        explanation:
          `The ${label} must be a whole number of cents and cannot be negative. ` +
          "Nothing was recorded.",
      };
    }
  }

  if (input.counts) {
    const rec = reconcileDenominations(input.counts, input.countedMinor);
    if (!rec.agrees) {
      return {
        kind: "refused",
        code: "TILL_CLOSE_DENOM_MISMATCH",
        explanation:
          `The bills and coins counted come to ${fmt(rec.countedMinor)}, but the ` +
          `count was entered as ${fmt(input.countedMinor)} — a difference of ` +
          `${fmt(Math.abs(rec.differenceMinor))}. Recount before closing: a close ` +
          `that guesses which number is right destroys the over/short evidence.`,
      };
    }
  }

  // What the drawer SHOULD hold: what it started with, plus what was rung,
  // less what was already dropped to the safe.
  const expectedMinor = input.openingFloatMinor + input.cashSalesMinor - input.dropsMinor;
  // Positive = OVER (more cash than expected), negative = SHORT.
  const overShortMinor = input.countedMinor - expectedMinor;

  // How much physically leaves the drawer for the safe / deposit.
  const removedMinor = input.floatStaysInDrawer
    ? input.countedMinor - input.openingFloatMinor
    : input.countedMinor;

  if (removedMinor < 0) {
    return {
      kind: "refused",
      code: "TILL_CLOSE_BELOW_FLOAT",
      explanation:
        `The drawer counted ${fmt(input.countedMinor)}, which is less than its ` +
        `${fmt(input.openingFloatMinor)} float, so there is nothing to take to the ` +
        `safe and the float itself is short. This needs a manager to look at the ` +
        `drawer before anything is recorded.`,
    };
  }

  const lines: JournalLineDraft[] = [];
  let n = 1;

  if (removedMinor > 0) {
    lines.push(
      line(n++, UNDEPOSITED_ACCOUNT, removedMinor, `Cash from ${input.registerName} to safe`),
    );
  }

  // The till is relieved of everything that left it: the takings that went to
  // the safe, AND the shortage that never existed in the first place.
  const tillCredit = removedMinor - overShortMinor;
  if (tillCredit !== 0) {
    lines.push(line(n++, TILLS_ACCOUNT, -tillCredit, `Relieve ${input.registerName}`));
  }

  if (overShortMinor !== 0) {
    // 50920 is an income account. A drawer that is OVER is a credit (a small
    // gain); a drawer that is SHORT is a debit (a small loss).
    lines.push(
      line(
        n++,
        OVER_SHORT_ACCOUNT,
        -overShortMinor,
        overShortMinor > 0
          ? `${input.registerName} over by ${fmt(overShortMinor)}`
          : `${input.registerName} short by ${fmt(Math.abs(overShortMinor))}`,
      ),
    );
  }

  if (lines.length === 0) {
    return {
      kind: "no_entry",
      code: "TILL_CLOSE_NOTHING_MOVED",
      explanation:
        `${input.registerName} took no cash and counted exactly its float, so no ` +
        `money moved and there is nothing to record. The shift still closed.`,
    };
  }

  const overShortText =
    overShortMinor === 0
      ? "the drawer counted exactly right"
      : overShortMinor > 0
        ? `the drawer was OVER by ${fmt(overShortMinor)}`
        : `the drawer was SHORT by ${fmt(Math.abs(overShortMinor))}`;

  return {
    kind: "journal",
    explanation:
      `${fmt(removedMinor)} went from ${input.registerName} to the safe, and ` +
      `${overShortText}. The cash sales themselves were already recorded one ` +
      `entry per sale as they were rung; this entry only moves the money that ` +
      `is physically in the drawer.`,
    journal: {
      entityCode: "greenway",
      journalDate: input.journalDate,
      sourceKind: "bank",
      sourceRef: input.sourceRef ?? null,
      memo: `Close ${input.registerName} — ${overShortText}`,
      lines,
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 6) Q3 — SWAPPING BILLS AT THE MASTER TILL
 * ═══════════════════════════════════════════════════════════════════════════ */

export type BillSwapInput = {
  readonly amountMinor: number;
  /** Denominations handed TO the master till. */
  readonly given?: Partial<DenomCounts>;
  /** Denominations taken FROM the master till. */
  readonly received?: Partial<DenomCounts>;
};

/**
 * Michael: "Is there a journal entry for exchanging large bills for small
 * bills from the master till?"
 *
 * No — and this function exists to SAY no, loudly and in one place, rather
 * than leave a silence somebody later mistakes for a missing feature.
 */
export function buildBillSwapJournal(input: BillSwapInput): RegisterCashResult {
  if (input.given && input.received) {
    const g = denomTotalMinor(input.given);
    const r = denomTotalMinor(input.received);
    if (g !== r) {
      return {
        kind: "refused",
        code: "SWAP_NOT_EQUAL",
        explanation:
          `That is not a swap. ${fmt(g)} went in and ${fmt(r)} came out, a ` +
          `difference of ${fmt(Math.abs(g - r))}. A change exchange must be equal ` +
          `on both sides; if cash genuinely moved, record it as a drop or a ` +
          `payout instead.`,
      };
    }
  }

  return {
    kind: "no_entry",
    code: "SWAP_NO_ACCOUNTING_EFFECT",
    explanation:
      `No journal entry, and none is needed. Trading ${fmt(input.amountMinor)} of ` +
      `large bills for the same ${fmt(input.amountMinor)} in small bills and coin ` +
      `does not change how much cash the business has, which account it sits in, ` +
      `or what it is worth. Denominations are an operational detail, not an ` +
      `economic event. The swap is still worth logging for drawer accountability ` +
      `— it just never reaches the ledger.`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 7) Q4 — DOES EVERY SALE GET AN ENTRY?
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Answered in code, not in prose: `sale-journal-core.ts` sets
 * TILL_ACCOUNT = "10110" and debits it once per sale. This constant re-states
 * that fact next to the till accounting so the two cannot drift apart, and a
 * test asserts the two files still agree.
 */
export const SALES_POST_PER_SALE = true;

export const SALES_POSTING_EXPLANATION =
  "Every sale posts its own journal entry the moment it is rung, debiting " +
  "10110 Cash on Hand — Tills for the cash taken. There is no second entry at " +
  "the end of the shift that repeats the sales — that would count the same " +
  "money twice. The shift-end entry is the CLOSE: it moves the physical cash " +
  "out of the drawer and records any over or short.";

/* ═══════════════════════════════════════════════════════════════════════════
 * 8) small helpers
 * ═══════════════════════════════════════════════════════════════════════════ */

function line(
  lineNo: number,
  accountCode: string,
  amountCents: number,
  description: string,
): JournalLineDraft {
  return { lineNo, accountCode, entityCode: "greenway", amountCents, costClass: "none", description };
}

/** $#,##0.00 from integer cents. Local so this module stays dependency-light. */
function fmt(minor: number): string {
  const neg = minor < 0;
  const s = (Math.abs(minor) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${neg ? "-" : ""}$${s}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 9) SELF-TEST (rule 26)
 * ═══════════════════════════════════════════════════════════════════════════ */

export function __runRegisterCashJournalTests(): void {
  const ok = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`register-cash-journal-core: ${msg}`);
  };
  const sum = (j: JournalDraft) => j.lines.reduce((s, l) => s + l.amountCents, 0);

  /* Michael's real till: 5 tens, 10 fives, 50 ones, one roll each of
     quarters/dimes/nickels/pennies = $167.50. */
  const till: Partial<DenomCounts> = {
    tens: 5, fives: 10, ones: 50, quarters: 40, dimes: 50, nickels: 40, pennies: 50,
  };
  ok(denomTotalMinor(till) === 16_750, "Michael's stated till mix is $167.50");

  /* His master till, as corrected to 100 nickels. */
  const master: Partial<DenomCounts> = {
    tens: 32, fives: 64, ones: 318, quarters: 95, dimes: 120, nickels: 100, pennies: 125,
  };
  ok(denomTotalMinor(master) === 100_000, "the corrected master mix is exactly $1,000.00");

  /* The ORIGINAL master mix (90 nickels) was 50 cents short. The reconciler
     must catch that, because it did. */
  const bad = { ...master, nickels: 90 };
  const rec = reconcileDenominations(bad, 100_000);
  ok(!rec.agrees && rec.differenceMinor === -50, "90 nickels is caught as 50 cents short");

  /* Q1 — open from the vault. */
  const open = buildTillOpenJournal({
    journalDate: "2026-11-02", registerName: "Register 1",
    floatMinor: 16_750, counts: till, fromVault: true,
  });
  ok(open.kind === "journal", "opening from the vault posts a transfer");
  if (open.kind === "journal") {
    ok(sum(open.journal) === 0, "the open entry balances");
    ok(open.journal.lines.length === 2, "vault to till is two lines");
    const till10110 = open.journal.lines.find((l) => l.accountCode === TILLS_ACCOUNT);
    ok(!!till10110 && till10110.amountCents === 16_750, "10110 is DEBITED the float");
    const vault = open.journal.lines.find((l) => l.accountCode === VAULT_ACCOUNT);
    ok(!!vault && vault.amountCents === -16_750, "10100 is CREDITED the float");
  }

  /* Q1 — float that never moved books nothing, and says so. */
  const stays = buildTillOpenJournal({
    journalDate: "2026-11-02", registerName: "Register 1",
    floatMinor: 16_750, fromVault: false,
  });
  ok(stays.kind === "no_entry", "a float that stayed in the drawer posts nothing");
  ok(stays.explanation.length > 40, "and it explains why, rather than going quiet");

  /* Q1 — denominations that disagree are refused, not averaged. */
  const mism = buildTillOpenJournal({
    journalDate: "2026-11-02", registerName: "Register 1",
    floatMinor: 16_750, counts: { ...till, nickels: 0 }, fromVault: true,
  });
  ok(mism.kind === "refused", "a denomination mismatch refuses the open");

  /* Q2 — a clean close: $167.50 float, $500 cash sales, no drops, counts right. */
  const clean = buildTillCloseJournal({
    journalDate: "2026-11-02", registerName: "Register 1",
    openingFloatMinor: 16_750, cashSalesMinor: 50_000, dropsMinor: 0,
    countedMinor: 66_750, floatStaysInDrawer: true,
  });
  ok(clean.kind === "journal", "a clean close posts");
  if (clean.kind === "journal") {
    ok(sum(clean.journal) === 0, "the close entry balances");
    const und = clean.journal.lines.find((l) => l.accountCode === UNDEPOSITED_ACCOUNT);
    ok(!!und && und.amountCents === 50_000, "exactly the takings go to 10400");
    const tl = clean.journal.lines.find((l) => l.accountCode === TILLS_ACCOUNT);
    ok(!!tl && tl.amountCents === -50_000, "10110 is relieved of the takings");
    ok(
      !clean.journal.lines.some((l) => l.accountCode === OVER_SHORT_ACCOUNT),
      "a drawer that counts right never touches 50920",
    );
  }

  /* Q2 — SHORT by $5. 50920 must be DEBITED (a loss). */
  const short = buildTillCloseJournal({
    journalDate: "2026-11-02", registerName: "Register 1",
    openingFloatMinor: 16_750, cashSalesMinor: 50_000, dropsMinor: 0,
    countedMinor: 66_250, floatStaysInDrawer: true,
  });
  ok(short.kind === "journal", "a short close still posts");
  if (short.kind === "journal") {
    ok(sum(short.journal) === 0, "the short close balances");
    const os = short.journal.lines.find((l) => l.accountCode === OVER_SHORT_ACCOUNT);
    ok(!!os && os.amountCents === 500, "a $5 shortage DEBITS 50920");
  }

  /* Q2 — OVER by $5. 50920 must be CREDITED (a gain). */
  const over = buildTillCloseJournal({
    journalDate: "2026-11-02", registerName: "Register 1",
    openingFloatMinor: 16_750, cashSalesMinor: 50_000, dropsMinor: 0,
    countedMinor: 67_250, floatStaysInDrawer: true,
  });
  if (over.kind === "journal") {
    const os = over.journal.lines.find((l) => l.accountCode === OVER_SHORT_ACCOUNT);
    ok(!!os && os.amountCents === -500, "a $5 overage CREDITS 50920");
    ok(sum(over.journal) === 0, "the over close balances");
  }

  /* Q2 — whole drawer to the safe: the float goes too. */
  const whole = buildTillCloseJournal({
    journalDate: "2026-11-02", registerName: "Register 1",
    openingFloatMinor: 16_750, cashSalesMinor: 50_000, dropsMinor: 0,
    countedMinor: 66_750, floatStaysInDrawer: false,
  });
  if (whole.kind === "journal") {
    const und = whole.journal.lines.find((l) => l.accountCode === UNDEPOSITED_ACCOUNT);
    ok(!!und && und.amountCents === 66_750, "the whole drawer, float included, goes to 10400");
    ok(sum(whole.journal) === 0, "it still balances");
  }

  /* Q2 — drops already removed are not taken out twice. */
  const dropped = buildTillCloseJournal({
    journalDate: "2026-11-02", registerName: "Register 1",
    openingFloatMinor: 16_750, cashSalesMinor: 50_000, dropsMinor: 20_000,
    countedMinor: 46_750, floatStaysInDrawer: true,
  });
  if (dropped.kind === "journal") {
    ok(
      !dropped.journal.lines.some((l) => l.accountCode === OVER_SHORT_ACCOUNT),
      "a drawer that dropped $200 mid-shift and counts right is not short",
    );
    ok(sum(dropped.journal) === 0, "the dropped-shift close balances");
  }

  /* Q3 — a swap posts nothing, and explains itself. */
  const swap = buildBillSwapJournal({
    amountMinor: 10_000,
    given: { hundreds: 1 },
    received: { twenties: 2, tens: 4, fives: 2, ones: 10 },
  });
  ok(swap.kind === "no_entry", "an equal swap posts nothing");
  ok(swap.explanation.includes("$100.00"), "and it states the amount it did not book");

  /* Q3 — an UNEQUAL swap is not a swap at all. */
  const badSwap = buildBillSwapJournal({
    amountMinor: 10_000, given: { hundreds: 1 }, received: { twenties: 2 },
  });
  ok(badSwap.kind === "refused", "an unequal exchange is refused, not booked as a swap");

  /* Guard rails. */
  ok(
    buildTillOpenJournal({
      journalDate: "2026-11-02", registerName: "R1", floatMinor: -1, fromVault: true,
    }).kind === "refused",
    "a negative float is refused",
  );
  ok(
    buildTillCloseJournal({
      journalDate: "2026-11-02", registerName: "R1", openingFloatMinor: 16_750,
      cashSalesMinor: 0, dropsMinor: 0, countedMinor: 1_000, floatStaysInDrawer: true,
    }).kind === "refused",
    "a drawer counted below its own float needs a manager, not an entry",
  );
}
