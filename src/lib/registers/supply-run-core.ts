/**
 * src/lib/registers/supply-run-core.ts  (Fix Phase 2.7c · G-11 · F-02-11 · owner D17)
 *
 * PURE rules for the supply-run screen. Zero I/O.
 *
 * Owner, verbatim:
 *   books-98 "Sometimes my employees need to run to the store and buy some
 *             supplies, so they take cash from the master, and replace it with
 *             a receipt. How do we account for this and replace the receipt
 *             with cash again?" (register-cash-journal-core.ts L474-476)
 *   books-99 "I don't want to use the master till any more for petty cash."
 *             (card-payment-core.ts L7-8)
 *   D17      "Q-02-4- id like the supply run screen built"
 *
 * The design is the one G-11 recorded (05-GAP-REGISTER.md, G-11): "a cash-out
 * record (who, amount, approver PIN) -> buildSupplyAdvanceJournal; a settle
 * record (receipt amount, change, expense account) -> buildSupplySettleJournal;
 * an open-advances list for the owner." The fields are paper form 8.4's
 * (SOP-02): Taken by, Amount out, Approved by, Why not the shop card,
 * Receipt total, Change returned, and the taker's and receiver's signatures.
 *
 * WHO
 *   - Taken by: the employee whose PIN is entered.
 *   - Approved by: a manager or lead PIN, not the taker. The same rule as a
 *     register safe swap (src/app/api/pos/till/route.ts SWAP_APPROVER_ROLES,
 *     "every trip into the safe needs a manager/lead approval PIN").
 *   - Received by (settle): the employee whose PIN is entered, not the taker
 *     (form 8.4 has two signatures, taker and receiver).
 *
 * THE BOOKS (books-98)
 *   cash out  DR 12100 Employee Advances Receivable / CR 10100 Vault
 *   settle    DR expense (receipt) / DR 10100 (change) / CR 12100 (amount out)
 * The builders do the cash legs and hard-code cost class "none" on every
 * line. The chart marks every supply expense account requires_cost_class with
 * default 'nondeductible_280e' (0173 L671-723), and the ledger refuses an
 * expense line with class none (0172 check 7, GL_COST_CLASS_REQUIRED). So
 * settleLinesWithCostClass below puts the account's class on the expense line
 * only; the 10100 and 12100 lines stay "none" (0172 refuses a class on a
 * balance-sheet line).
 */

import { formatCents } from "@/lib/registers/cash";
import { SAFE_TARGET_MINOR } from "@/lib/registers/safe-core";

/** PIN throttle scope for the supply-run screen (separate from every other pad). */
export const SUPPLY_RUN_PIN_SCOPE = "backoffice-supply-run";

/** Approver roles: the same set as a register safe swap (till route SWAP_APPROVER_ROLES). */
export const SUPPLY_APPROVER_ROLES: readonly string[] = ["manager", "lead"];

/**
 * At most the whole master till: $1,000.00 (safe-core SAFE_TARGET_MINOR,
 * owner D11 "The master till has 1000"). The 0318 check says the same.
 */
export const MAX_SUPPLY_RUN_MINOR = SAFE_TARGET_MINOR;

export const SUPPLY_TEXT_MAX_LEN = 500;

/**
 * The expense accounts a supply receipt may go to. Each is an active expense
 * account in the chart (0173_chart_of_accounts.sql), requires a cost class,
 * and defaults to 'nondeductible_280e'. The 0318 check lists the same six.
 * The first is books-99's own example ("buys $15 of bags" ... "DEBIT   Store
 * supplies", docs/MICHAEL-books-99-the-shop-card.md L12, L17).
 */
export type SupplyExpenseAccount = {
  readonly code: string;
  readonly name: string;
  readonly costClass: "nondeductible_280e";
  /** The chart's own note, quoted, where it has one. */
  readonly note: string | null;
  /** Where the account is defined. */
  readonly pin: string;
};

export const SUPPLY_EXPENSE_ACCOUNTS: readonly SupplyExpenseAccount[] = [
  {
    code: "76020",
    name: "Packaging & Store Supplies",
    costClass: "nondeductible_280e",
    note: "CAUTION: packaging that becomes part of the product sold may be inventoriable under Reg. 1.471-3(b). Route those to 60800/60000 instead.",
    pin: "0173_chart_of_accounts.sql L713-714",
  },
  { code: "76010", name: "Office Supplies", costClass: "nondeductible_280e", note: null, pin: "0173_chart_of_accounts.sql L712" },
  { code: "70060", name: "Janitorial & Waste Removal", costClass: "nondeductible_280e", note: null, pin: "0173_chart_of_accounts.sql L674" },
  { code: "70030", name: "Repairs & Maintenance", costClass: "nondeductible_280e", note: null, pin: "0173_chart_of_accounts.sql L671" },
  { code: "77010", name: "Fuel", costClass: "nondeductible_280e", note: null, pin: "0173_chart_of_accounts.sql L723" },
  {
    code: "76030",
    name: "Postage & Shipping (outbound)",
    costClass: "nondeductible_280e",
    note: "Outbound only. Inbound freight is 60800 and capitalises.",
    pin: "0173_chart_of_accounts.sql L715",
  },
];

export function supplyExpenseAccount(code: string): SupplyExpenseAccount | null {
  return SUPPLY_EXPENSE_ACCOUNTS.find((a) => a.code === code) ?? null;
}

/** Idempotency keys for the two books entries (a retry returns "duplicate"). */
export function advanceSourceRef(runId: string): string {
  return `supply-advance:${runId}`;
}
export function settleSourceRef(runId: string): string {
  return `supply-settle:${runId}`;
}

/** "$12.50" typed into a box -> 1250. null for blank, junk, negatives or sub-cent. Zero is allowed (a run where nothing was bought). */
export function parseCashMinor(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").replace(/[$,\s]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export type PinPerson = { id: string; name: string; role: string };

export type CashOutInput = {
  amountRaw: string;
  reason: string;
  taker: PinPerson;
  approver: PinPerson;
};

export type CashOut = { amountMinor: number; reason: string; takerId: string; approverId: string };

/** Form 8.4 top half. Every refusal ends "Nothing was saved." */
export function checkCashOut(input: CashOutInput): { ok: true; run: CashOut } | { ok: false; error: string } {
  const amount = parseCashMinor(input.amountRaw);
  if (amount === null || amount <= 0) {
    return { ok: false, error: "Enter the cash taken from the master till, in dollars and cents, more than $0.00. Nothing was saved." };
  }
  if (amount > MAX_SUPPLY_RUN_MINOR) {
    return {
      ok: false,
      error: `${formatCents(amount)} is more than the whole master till (${formatCents(MAX_SUPPLY_RUN_MINOR)}). Check the amount. Nothing was saved.`,
    };
  }
  const reason = input.reason.trim();
  if (reason === "") {
    return {
      ok: false,
      error: "Write why the shop card was not used. The store rule is the shop card (SOP-02 §4.13), so a cash run needs a reason. Nothing was saved.",
    };
  }
  if (reason.length > SUPPLY_TEXT_MAX_LEN) {
    return { ok: false, error: `The reason must be ${SUPPLY_TEXT_MAX_LEN} characters or fewer. Nothing was saved.` };
  }
  if (!SUPPLY_APPROVER_ROLES.includes(input.approver.role)) {
    return {
      ok: false,
      error: `${input.approver.name} is not a manager or lead. Cash out of the master till needs a manager or lead to approve it. Nothing was saved.`,
    };
  }
  if (input.approver.id === input.taker.id) {
    return {
      ok: false,
      error: "The person taking the cash cannot approve their own supply run. A different manager or lead must enter their PIN. Nothing was saved.",
    };
  }
  return { ok: true, run: { amountMinor: amount, reason, takerId: input.taker.id, approverId: input.approver.id } };
}

export type SettleInput = {
  amountMinor: number;
  takerId: string | null;
  alreadySettled: boolean;
  receiptRaw: string;
  changeRaw: string;
  expenseAccount: string;
  note: string;
  receiver: PinPerson;
};

export type Settle = {
  receiptMinor: number;
  changeMinor: number;
  expenseAccount: string | null;
  note: string | null;
  receiverId: string;
};

/** Form 8.4 bottom half. Receipt + change must be exactly the cash taken. */
export function checkSettle(input: SettleInput): { ok: true; settle: Settle } | { ok: false; error: string } {
  if (input.alreadySettled) {
    return { ok: false, error: "This supply run is already settled. Nothing was saved." };
  }
  const receipt = parseCashMinor(input.receiptRaw);
  if (receipt === null) {
    return { ok: false, error: "Enter the receipt total in dollars and cents (0.00 if nothing was bought). Nothing was saved." };
  }
  const change = parseCashMinor(input.changeRaw);
  if (change === null) {
    return { ok: false, error: "Enter the change handed back in dollars and cents (0.00 if none). Nothing was saved." };
  }
  if (receipt > input.amountMinor) {
    return {
      ok: false,
      error:
        `The receipt (${formatCents(receipt)}) is more than the cash taken (${formatCents(input.amountMinor)}), so ` +
        `${formatCents(receipt - input.amountMinor)} came out of the employee's own pocket. That is a reimbursement owed TO the employee, ` +
        "not a settlement; give the receipt to the owner to pay as a bill (books-98). Nothing was saved.",
    };
  }
  if (receipt + change !== input.amountMinor) {
    const gap = input.amountMinor - receipt - change;
    return {
      ok: false,
      error:
        `Receipt ${formatCents(receipt)} + change ${formatCents(change)} = ${formatCents(receipt + change)}, but ${formatCents(input.amountMinor)} was taken ` +
        `(${gap > 0 ? `${formatCents(gap)} is missing` : `${formatCents(-gap)} too much`}). Recount the change and check the receipt. ` +
        "If money really is missing, give the receipt and change to the owner the same day and write it on form 8.4. Nothing was saved.",
    };
  }
  let expenseAccount: string | null = null;
  if (receipt > 0) {
    const acct = supplyExpenseAccount(input.expenseAccount.trim());
    if (!acct) {
      return { ok: false, error: "Pick what the receipt was for (the expense account). Nothing was saved." };
    }
    expenseAccount = acct.code;
  }
  if (input.takerId !== null && input.receiver.id === input.takerId) {
    return {
      ok: false,
      error: "The person who took the cash cannot also receive it back. A different employee counts the change and enters their PIN (form 8.4: taker and receiver). Nothing was saved.",
    };
  }
  const note = input.note.trim();
  if (note.length > SUPPLY_TEXT_MAX_LEN) {
    return { ok: false, error: `The note must be ${SUPPLY_TEXT_MAX_LEN} characters or fewer. Nothing was saved.` };
  }
  return { ok: true, settle: { receiptMinor: receipt, changeMinor: change, expenseAccount, note: note || null, receiverId: input.receiver.id } };
}

/**
 * Put the expense account's 280E class on the expense line. Every other line
 * (10100, 12100) keeps "none". Returns null when an expense line's account is
 * not on the supply list, so a caller cannot post an unclassified expense.
 */
export function settleLinesWithCostClass<L extends { accountCode: string; costClass?: string }>(
  lines: readonly L[],
  expenseAccount: string | null,
): L[] | null {
  const acct = expenseAccount === null ? null : supplyExpenseAccount(expenseAccount);
  if (expenseAccount !== null && !acct) return null;
  return lines.map((l) => (acct && l.accountCode === acct.code ? { ...l, costClass: acct.costClass } : { ...l }));
}

/** The row as the screen sees it. */
export type SupplyRunRow = {
  id: string;
  businessDay: string;
  takenBy: string | null;
  approvedBy: string | null;
  amountMinor: number;
  reason: string;
  takenAt: string;
  advanceJournalId: string | null;
  settledBy: string | null;
  settledAt: string | null;
  settledDay: string | null;
  receiptMinor: number | null;
  changeMinor: number | null;
  expenseAccount: string | null;
  receiptNote: string | null;
  settleJournalId: string | null;
};

export function isOpen(r: Pick<SupplyRunRow, "settledAt">): boolean {
  return r.settledAt === null;
}

/** Cash out with named people right now: the sum of every open run. */
export function openAdvanceMinor(rows: readonly Pick<SupplyRunRow, "settledAt" | "amountMinor">[]): number {
  return rows.filter(isOpen).reduce((s, r) => s + r.amountMinor, 0);
}

/** Whole days a run has been open (Pacific business days). */
export function daysOpen(businessDay: string, today: string): number {
  const a = Date.UTC(+businessDay.slice(0, 4), +businessDay.slice(5, 7) - 1, +businessDay.slice(8, 10));
  const b = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** A run whose books entry did not post (shown NOT POSTED with a retry). */
export function notPosted(r: SupplyRunRow): { advance: boolean; settle: boolean } {
  return { advance: r.advanceJournalId === null, settle: r.settledAt !== null && r.settleJournalId === null };
}

/**
 * The master till count is short by every open run's cash (books-98: "A
 * receipt is **evidence, not cash** — so the till really is short",
 * docs/MICHAEL-books-98-the-store-safe.md L84-85). One sentence for the
 * safe page and the variance check.
 */
export function openRunsNotice(rows: readonly Pick<SupplyRunRow, "settledAt" | "amountMinor">[]): string | null {
  const open = rows.filter(isOpen);
  if (open.length === 0) return null;
  return (
    `${open.length} supply run${open.length === 1 ? " is" : "s are"} open: ${formatCents(openAdvanceMinor(open))} is out of the master till with ` +
    `${open.length === 1 ? "an employee" : "employees"}. The master till counts short by that until the receipt and change come back (SOP-02 §4.13).`
  );
}

/* ── self-tests (rule 26) ─────────────────────────────────────────────── */

export function __runSupplyRunTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`FAIL supply-run-core: ${m}`);
    }
  };
  const alyssa: PinPerson = { id: "e1", name: "Alyssa", role: "sales" };
  const mgr: PinPerson = { id: "e2", name: "Dana", role: "manager" };
  const lead: PinPerson = { id: "e3", name: "Lee", role: "lead" };
  const sales2: PinPerson = { id: "e4", name: "Sam", role: "sales" };

  // parseCashMinor
  ok(parseCashMinor("15") === 1500, "15 -> 1500");
  ok(parseCashMinor("$1,000.5") === 100050, "$1,000.5 -> 100050");
  ok(parseCashMinor("0") === 0, "0 -> 0");
  ok(parseCashMinor("") === null, "blank -> null");
  ok(parseCashMinor("1.234") === null, "sub-cent -> null");
  ok(parseCashMinor("-5") === null, "negative -> null");
  ok(parseCashMinor("abc") === null, "junk -> null");
  ok(parseCashMinor("0.07") === 7, "0.07 -> 7");

  // cash out
  const good = checkCashOut({ amountRaw: "20", reason: "  card declined  ", taker: alyssa, approver: mgr });
  ok(good.ok && good.run.amountMinor === 2000 && good.run.reason === "card declined" && good.run.approverId === "e2", "good cash out");
  ok(checkCashOut({ amountRaw: "20", reason: "x", taker: alyssa, approver: lead }).ok, "a lead may approve");
  const zero = checkCashOut({ amountRaw: "0", reason: "x", taker: alyssa, approver: mgr });
  ok(!zero.ok && /more than \$0\.00/.test(zero.error), "zero refused");
  const big = checkCashOut({ amountRaw: "1000.01", reason: "x", taker: alyssa, approver: mgr });
  ok(!big.ok && /more than the whole master till/.test(big.error), "over $1,000 refused");
  ok(checkCashOut({ amountRaw: "1000", reason: "x", taker: alyssa, approver: mgr }).ok, "exactly $1,000 allowed");
  const noWhy = checkCashOut({ amountRaw: "20", reason: "   ", taker: alyssa, approver: mgr });
  ok(!noWhy.ok && /shop card/.test(noWhy.error), "no reason refused");
  const longWhy = checkCashOut({ amountRaw: "20", reason: "x".repeat(501), taker: alyssa, approver: mgr });
  ok(!longWhy.ok && /500 characters/.test(longWhy.error), "long reason refused");
  const salesAppr = checkCashOut({ amountRaw: "20", reason: "x", taker: alyssa, approver: sales2 });
  ok(!salesAppr.ok && /not a manager or lead/.test(salesAppr.error), "sales approver refused");
  const self = checkCashOut({ amountRaw: "20", reason: "x", taker: mgr, approver: mgr });
  ok(!self.ok && /cannot approve their own/.test(self.error), "self approval refused");

  // settle
  const base: SettleInput = { amountMinor: 2000, takerId: "e1", alreadySettled: false, receiptRaw: "13.87", changeRaw: "6.13", expenseAccount: "76020", note: "", receiver: mgr };
  const s1 = checkSettle(base);
  ok(s1.ok && s1.settle.receiptMinor === 1387 && s1.settle.changeMinor === 613 && s1.settle.expenseAccount === "76020" && s1.settle.note === null, "good settle");
  const s0 = checkSettle({ ...base, receiptRaw: "0", changeRaw: "20", expenseAccount: "" });
  ok(s0.ok && s0.settle.expenseAccount === null, "nothing bought: all change back, no account");
  const sAll = checkSettle({ ...base, receiptRaw: "20", changeRaw: "0" });
  ok(sAll.ok && sAll.settle.changeMinor === 0, "spent it all: no change");
  const over = checkSettle({ ...base, receiptRaw: "21", changeRaw: "0" });
  ok(!over.ok && /reimbursement owed TO the employee/.test(over.error), "receipt over advance refused");
  const gap = checkSettle({ ...base, receiptRaw: "13.87", changeRaw: "6.00" });
  ok(!gap.ok && /\$0\.13 is missing/.test(gap.error), "missing change refused and named");
  const extra = checkSettle({ ...base, receiptRaw: "13.87", changeRaw: "7.00" });
  ok(!extra.ok && /\$0\.87 too much/.test(extra.error), "too much change refused and named");
  const noAcct = checkSettle({ ...base, expenseAccount: "" });
  ok(!noAcct.ok && /expense account/.test(noAcct.error), "receipt without account refused");
  const badAcct = checkSettle({ ...base, expenseAccount: "50100" });
  ok(!badAcct.ok && /expense account/.test(badAcct.error), "account not on the supply list refused");
  const sameP = checkSettle({ ...base, receiver: alyssa });
  ok(!sameP.ok && /cannot also receive/.test(sameP.error), "taker cannot receive");
  ok(checkSettle({ ...base, takerId: null, receiver: alyssa }).ok, "taker unknown (deleted employee): any receiver");
  const done = checkSettle({ ...base, alreadySettled: true });
  ok(!done.ok && /already settled/.test(done.error), "second settle refused");
  const noRec = checkSettle({ ...base, receiptRaw: "" });
  ok(!noRec.ok && /receipt total/.test(noRec.error), "blank receipt refused");
  const noCh = checkSettle({ ...base, changeRaw: "" });
  ok(!noCh.ok && /change handed back/.test(noCh.error), "blank change refused");
  const longNote = checkSettle({ ...base, note: "y".repeat(501) });
  ok(!longNote.ok && /500 characters/.test(longNote.error), "long note refused");

  // cost class on the expense line only
  const lines = [
    { accountCode: "76020", amountCents: 1387, costClass: "none" },
    { accountCode: "10100", amountCents: 613, costClass: "none" },
    { accountCode: "12100", amountCents: -2000, costClass: "none" },
  ];
  const cl = settleLinesWithCostClass(lines, "76020");
  ok(cl !== null && cl[0].costClass === "nondeductible_280e", "expense line gets nondeductible_280e");
  ok(cl !== null && cl[1].costClass === "none" && cl[2].costClass === "none", "cash and advance lines stay none");
  ok(lines[0].costClass === "none", "input lines not mutated");
  ok(settleLinesWithCostClass(lines, "50100") === null, "unknown account -> null");
  const cl0 = settleLinesWithCostClass(lines.slice(1), null);
  ok(cl0 !== null && cl0.every((l) => l.costClass === "none"), "no expense: all none");

  // list + chart
  ok(SUPPLY_EXPENSE_ACCOUNTS.length === 6 && SUPPLY_EXPENSE_ACCOUNTS[0].code === "76020", "six accounts, store supplies first");
  ok(SUPPLY_EXPENSE_ACCOUNTS.every((a) => /^7\d{4}$/.test(a.code) && a.costClass === "nondeductible_280e"), "all 7xxxx expense, 280E");
  ok(advanceSourceRef("r1") === "supply-advance:r1" && settleSourceRef("r1") === "supply-settle:r1", "source refs");

  // open runs
  const rows = [
    { settledAt: null, amountMinor: 2000 },
    { settledAt: "2026-11-01T10:00:00Z", amountMinor: 5000 },
    { settledAt: null, amountMinor: 1500 },
  ];
  ok(openAdvanceMinor(rows) === 3500, "open total counts only unsettled");
  ok(openRunsNotice([]) === null, "no open runs, no notice");
  const n = openRunsNotice(rows);
  ok(n !== null && /2 supply runs are open: \$35\.00/.test(n), "notice names count and total");
  ok(daysOpen("2026-11-01", "2026-11-04") === 3 && daysOpen("2026-11-04", "2026-11-04") === 0, "days open");
  const r: SupplyRunRow = {
    id: "r", businessDay: "2026-11-01", takenBy: "e1", approvedBy: "e2", amountMinor: 2000, reason: "x", takenAt: "", advanceJournalId: null,
    settledBy: null, settledAt: null, settledDay: null, receiptMinor: null, changeMinor: null, expenseAccount: null, receiptNote: null, settleJournalId: null,
  };
  ok(notPosted(r).advance && !notPosted(r).settle, "open run with no advance id: advance NOT POSTED");
  ok(notPosted({ ...r, advanceJournalId: "j", settledAt: "t" }).settle, "settled with no settle id: settle NOT POSTED");

  return { passed, failed };
}
