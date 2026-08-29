/**
 * src/lib/accounting/deposit-fifo-core.ts
 *
 * WHICH DAYS DID THIS DEPOSIT COVER?
 *
 * books-95 built the entry that clears `10400 Undeposited Funds` against the
 * POOL: it proved the money arrived and that the total was not more than what
 * had been counted, but it could not say WHICH day's takings the bank had
 * received. That was recorded as a deliberate limit, not an oversight.
 *
 * This file removes that limit, because Michael changed the operating
 * procedure so the question now has an answer worth computing:
 *
 *   "I will keep cash at the shop and start doing daily deposit bags. Even if
 *    I don't make it to the bank for 15 days, each deposit will still match
 *    the day it came from."
 *
 * One sealed bag per business day means a bank credit usually corresponds to
 * exactly one counted day. But he also said, and it is the more important
 * half:
 *
 *   "You are right about us not being perfect, we never are, ever. So baking
 *    in flexibility for our misbehavior is always wise."
 *
 * So this allocates OLDEST FIRST across however many days a deposit happens to
 * cover, and reports the days it consumed. One-to-one is the procedure;
 * many-to-one is the capability.
 *
 * WHY OLDEST FIRST, AND WHY THAT IS A CHOICE AND NOT A FACT
 * --------------------------------------------------------
 * Cash is fungible. When a $9,000 deposit lands against three counted days,
 * nothing in the bank feed says which physical notes were in the bag. FIFO is
 * an ASSUMPTION, chosen because it matches how the money actually moves (bags
 * are banked in the order they are made) and because it makes aging honest:
 * the cash that has been waiting longest is the cash that clears. It is not a
 * measurement, and the explanations say so rather than implying the software
 * knows something it cannot know.
 *
 * WHAT THIS FILE FIXES (D-76)
 * ---------------------------
 * The pool's "oldest uncleared date" used to be the minimum date over every
 * line that ever ADDED to 10400, for all time, because nothing retired a debit
 * once its cash had been banked. After one month of real use that date is
 * always older than the 30-day window, so every deposit would have been
 * refused - a finished, tested, wired feature that is unusable in practice
 * (rule 50). Running the debits and credits through FIFO produces the date of
 * the oldest day still genuinely OPEN, which is what the aging figure was
 * always supposed to mean.
 *
 * PURE. No I/O, no clock, no `server-only`. Self-tested at the bottom.
 */

/** A day's counted cash sitting in 10400, oldest-first once sorted. */
export type UndepositedDay = {
  /** The business day the till was counted for. ISO `YYYY-MM-DD`. */
  readonly date: string;
  /** What was counted into 10400 that day, in cents. Always positive. */
  readonly amountMinor: number;
  /** The close entry's source ref, so a day can be traced to its journal. */
  readonly sourceRef: string;
};

/** How much of one day a deposit consumed. */
export type DayAllocation = {
  readonly date: string;
  readonly sourceRef: string;
  /** What this deposit took from that day. */
  readonly appliedMinor: number;
  /** What that day had before this deposit touched it. */
  readonly dayTotalMinor: number;
  /** True when the deposit took the whole day, not part of it. */
  readonly full: boolean;
};

export type FifoAllocation = {
  /** Days consumed, oldest first. Never empty when `ok` is true. */
  readonly days: readonly DayAllocation[];
  /** Sum of `appliedMinor`. Equals the deposit when it fits. */
  readonly appliedMinor: number;
  /** What is still open in 10400 after this deposit. */
  readonly remainingMinor: number;
  /**
   * The oldest day STILL OPEN after this deposit, or null when the pool is
   * empty. This is the D-76 fix: it retires days that have been fully banked.
   */
  readonly oldestOpenDate: string | null;
  /** True when the deposit covered more than one counted day. */
  readonly spansMultipleDays: boolean;
};

/**
 * HOW A CLEARING CREDIT NAMES THE DAY IT CLEARED.
 *
 * A close entry is dated on its business day, so a DEBIT already carries the
 * day it belongs to on the journal header. A clearing CREDIT does not: it is
 * dated when the bank received the money, which is precisely the date that
 * differs. If credits were folded by journal date they would never cancel the
 * debits they paid off, every day would look permanently open, and D-76 would
 * survive the fix meant to remove it.
 *
 * The first version of this file had exactly that bug. Its own self-test
 * caught it before anything shipped, which is why the day is now carried
 * explicitly on each credit line rather than inferred from the journal.
 *
 * So a deposit emits ONE CREDIT PER DAY it clears, and each line's description
 * begins with this marker. It is a stable machine-readable prefix, not prose,
 * and `parseClearedDay` is the single place that reads it back.
 */
export const CLEARED_DAY_PREFIX = "Cleared business day ";

/** Build the description that carries the cleared day. */
export function clearedDayDescription(date: string): string {
  return `${CLEARED_DAY_PREFIX}${date}`;
}

/**
 * Read the cleared day back off a credit line's description.
 *
 * Returns null when the description does not carry one. Rule 46: null here
 * means "this line does not say", which is a QUESTION, not a date.
 *
 * `undefined` IS ACCEPTED AND IT IS NOT THE SAME QUESTION. A null description
 * is a column that exists and is empty; an undefined one is a key that was
 * never selected. Both come back null from here, because this function's only
 * job is "does this text name a day", and neither names one. Telling those two
 * apart is the CALLER's job and the caller must do it - see the missing-column
 * guard in `deposit-clearing-service.ts`, which returns a failed read rather
 * than a fallback. This function threw a TypeError on undefined until its own
 * test suite hit it, which on a real deposit would have been a 500 page instead
 * of a sentence.
 */
export function parseClearedDay(
  description: string | null | undefined,
): string | null {
  if (description === null || description === undefined) return null;
  if (!description.startsWith(CLEARED_DAY_PREFIX)) return null;
  const rest = description.slice(CLEARED_DAY_PREFIX.length, CLEARED_DAY_PREFIX.length + 10);
  // Strict shape. A loose parse would happily accept "2026-13-45" and then
  // sort it into the middle of the pool.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rest)) return null;
  return rest;
}

/**
 * Fold the raw 10400 lines into per-day open balances.
 *
 * Debits (positive) are cash counted IN on that day. Credits (negative) are
 * previous deposits that already cleared some of it. Netting them per day is
 * what makes a fully-banked day disappear from the pool instead of ageing it
 * forever.
 *
 * A day that nets to ZERO is dropped: it is closed, not open-with-nothing-in-
 * it, and leaving it in would keep reporting a stale oldest date, which is
 * exactly D-76.
 *
 * A day that nets NEGATIVE is NOT dropped and NOT silently clamped. More was
 * cleared against that day than was ever counted into it, which should be
 * impossible, and hiding it would hide the very thing worth seeing (rule 135:
 * zero is an answer, missing is a question). It is returned so the caller can
 * refuse rather than quietly bank a number that does not add up.
 */
export function foldDaysFromLines(
  lines: readonly { date: string; amountMinor: number; sourceRef: string }[],
): { days: UndepositedDay[]; negativeDays: UndepositedDay[] } {
  const byDate = new Map<string, { amount: number; sourceRef: string }>();

  for (const l of lines) {
    const prev = byDate.get(l.date);
    if (prev === undefined) {
      byDate.set(l.date, { amount: l.amountMinor, sourceRef: l.sourceRef });
    } else {
      // Keep the FIRST source ref seen for the day: it is the close entry that
      // opened it. A clearing credit's ref describes the deposit, not the day.
      prev.amount += l.amountMinor;
    }
  }

  const days: UndepositedDay[] = [];
  const negativeDays: UndepositedDay[] = [];

  for (const [date, v] of byDate) {
    if (v.amount === 0) continue; // closed, not open
    const day = { date, amountMinor: v.amount, sourceRef: v.sourceRef };
    if (v.amount < 0) negativeDays.push(day);
    else days.push(day);
  }

  // Oldest first. ISO dates sort correctly as strings, which is why the format
  // is pinned to `YYYY-MM-DD` rather than parsed into Date objects here.
  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  negativeDays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { days, negativeDays };
}

/**
 * Apply a deposit across counted days, oldest first.
 *
 * The caller has ALREADY established that the deposit is not larger than the
 * pool. This function does not re-decide that; it splits a known-good total.
 * If it is handed more than the days can cover it returns what it could apply
 * and a negative-free remainder of zero, and the caller's own guard is what
 * catches the discrepancy - one decision, one place (rule 25).
 */
export function allocateDepositFifo(
  depositMinor: number,
  days: readonly UndepositedDay[],
): FifoAllocation {
  const applied: DayAllocation[] = [];
  let left = depositMinor;

  for (const day of days) {
    if (left <= 0) break;
    const take = Math.min(left, day.amountMinor);
    applied.push({
      date: day.date,
      sourceRef: day.sourceRef,
      appliedMinor: take,
      dayTotalMinor: day.amountMinor,
      full: take === day.amountMinor,
    });
    left -= take;
  }

  const appliedMinor = applied.reduce((a, d) => a + d.appliedMinor, 0);
  const poolMinor = days.reduce((a, d) => a + d.amountMinor, 0);
  const remainingMinor = poolMinor - appliedMinor;

  // The oldest day still open AFTER this deposit. A day is still open if the
  // deposit did not take all of it, or did not reach it at all. This is the
  // number that was wrong in D-76.
  let oldestOpenDate: string | null = null;
  for (const day of days) {
    const hit = applied.find((a) => a.date === day.date);
    const stillOpen = hit === undefined || !hit.full;
    if (stillOpen) {
      oldestOpenDate = day.date;
      break; // days are already oldest-first
    }
  }

  return {
    days: applied,
    appliedMinor,
    remainingMinor,
    oldestOpenDate,
    spansMultipleDays: applied.length > 1,
  };
}

/**
 * The oldest day genuinely open right now, ignoring any deposit.
 *
 * This is what the end-of-day panel should show, and it is the value that
 * feeds the age warning. Separate from `allocateDepositFifo` because the panel
 * asks the question without a deposit in hand.
 */
export function oldestOpenDate(days: readonly UndepositedDay[]): string | null {
  return days.length === 0 ? null : days[0].date;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SELF-TESTS
 * ══════════════════════════════════════════════════════════════════════════ */

function expect(what: string, cond: boolean): void {
  if (!cond) throw new Error(`deposit-fifo-core self-test FAILED: ${what}`);
}

function line(date: string, amountMinor: number, sourceRef = `till-close:${date}`) {
  return { date, amountMinor, sourceRef };
}

export function __runDepositFifoTests(): void {
  // ── folding ────────────────────────────────────────────────────────────
  const simple = foldDaysFromLines([
    line("2026-11-03", 500_00),
    line("2026-11-01", 300_00),
    line("2026-11-02", 400_00),
  ]);
  expect("folding sorts oldest first", simple.days[0].date === "2026-11-01");
  expect("folding keeps every open day", simple.days.length === 3);
  expect("no negative days here", simple.negativeDays.length === 0);

  // D-76 itself: a fully cleared day must LEAVE the pool. Note the credit is
  // folded under the day it CLEARED (Jan 5), not the day the bank received it
  // (Jan 20) - that distinction is the whole fix.
  const cleared = foldDaysFromLines([
    line("2026-01-05", 500_00),
    line("2026-01-05", -500_00, "deposit-clear:t1"),
    line("2026-03-15", 300_00),
  ]);
  expect("a fully banked day is retired", cleared.days.length === 1);
  expect("D-76: the oldest open day is the RECENT one",
    oldestOpenDate(cleared.days) === "2026-03-15");

  // Partly cleared days stay, with the balance.
  const partial = foldDaysFromLines([
    line("2026-11-01", 500_00),
    line("2026-11-01", -200_00, "deposit-clear:t2"),
  ]);
  expect("a partly cleared day remains open", partial.days.length === 1);
  expect("with only the unbanked remainder", partial.days[0].amountMinor === 300_00);

  // Over-cleared days are surfaced, never hidden.
  const over = foldDaysFromLines([
    line("2026-11-01", 100_00),
    line("2026-11-01", -150_00, "deposit-clear:t3"),
  ]);
  expect("an over-cleared day is reported", over.negativeDays.length === 1);
  expect("and is not counted as open", over.days.length === 0);

  // ── allocation ─────────────────────────────────────────────────────────
  const days = foldDaysFromLines([
    line("2026-11-01", 300_00),
    line("2026-11-02", 400_00),
    line("2026-11-03", 500_00),
  ]).days;

  // The everyday case under the new procedure: one bag, one day.
  const oneDay = allocateDepositFifo(300_00, days);
  expect("one bag clears exactly one day", oneDay.days.length === 1);
  expect("named as the oldest", oneDay.days[0].date === "2026-11-01");
  expect("and it is a full day", oneDay.days[0].full);
  expect("not flagged as spanning", !oneDay.spansMultipleDays);
  expect("the next open day moves forward", oneDay.oldestOpenDate === "2026-11-02");
  expect("remainder is the other two days", oneDay.remainingMinor === 900_00);

  // The forgiving case: a trip covering several bags.
  const many = allocateDepositFifo(700_00, days);
  expect("a multi-day deposit names both days", many.days.length === 2);
  expect("oldest first", many.days[0].date === "2026-11-01");
  expect("flagged as spanning", many.spansMultipleDays);
  expect("nothing of those days is left", many.oldestOpenDate === "2026-11-03");

  // A partial day: the deposit stops mid-day.
  const part = allocateDepositFifo(450_00, days);
  expect("a partial deposit still names the day it reached", part.days.length === 2);
  expect("the last day touched is partial", !part.days[1].full);
  expect("it applied only what was left", part.days[1].appliedMinor === 150_00);
  expect("and reports the day it was taken from", part.days[1].dayTotalMinor === 400_00);
  expect("the partly-taken day is STILL the oldest open",
    part.oldestOpenDate === "2026-11-02");

  // Clearing everything empties the pool.
  const all = allocateDepositFifo(1_200_00, days);
  expect("clearing everything leaves nothing", all.remainingMinor === 0);
  expect("and no oldest open date", all.oldestOpenDate === null);
  expect("naming every day", all.days.length === 3);

  // Arithmetic that must always hold, whatever the split.
  for (const amount of [1_00, 299_99, 300_00, 300_01, 700_00, 1_199_99, 1_200_00]) {
    const a = allocateDepositFifo(amount, days);
    expect(`applied never exceeds the deposit (${amount})`, a.appliedMinor <= amount);
    expect(`applied plus remaining is the pool (${amount})`,
      a.appliedMinor + a.remainingMinor === 1_200_00);
    expect(`no day is over-applied (${amount})`,
      a.days.every((d) => d.appliedMinor <= d.dayTotalMinor));
    expect(`no day is applied zero or less (${amount})`,
      a.days.every((d) => d.appliedMinor > 0));
  }

  // ── the cleared-day marker ─────────────────────────────────────────────
  expect("a built description round-trips",
    parseClearedDay(clearedDayDescription("2026-11-01")) === "2026-11-01");
  expect("prose without the marker yields null",
    parseClearedDay("Till cash cleared out of Undeposited Funds") === null);
  expect("a null description yields null", parseClearedDay(null) === null);
  expect("an undefined description yields null, it does not throw",
    parseClearedDay(undefined) === null);
  expect("a malformed date is refused, not half-read",
    parseClearedDay(`${CLEARED_DAY_PREFIX}2026-1-1`) === null);
  expect("an empty marker is refused", parseClearedDay(CLEARED_DAY_PREFIX) === null);

  // An empty pool allocates nothing rather than throwing.
  const none = allocateDepositFifo(100_00, []);
  expect("an empty pool applies nothing", none.appliedMinor === 0);
  expect("and reports no open date", none.oldestOpenDate === null);
  expect("and names no days", none.days.length === 0);

  console.log("deposit-fifo-core self-tests: all passed");
}
