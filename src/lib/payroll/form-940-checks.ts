/**
 * src/lib/payroll/form-940-checks.ts   (books-47, slice D)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE CHECK TAB FOR FORM 940 — THE FORM PROVING ITSELF
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael asked for three tabs: see the form, learn the box, check the work.
 * The first two shipped with the explorer. The third rendered "There is
 * nothing to reconcile on this form yet." on every screen, because no page
 * ever passed it any rows. A tab that always says the same thing is not a
 * feature, it is a promise (standing rule 50).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY FORM 940 IS THE RIGHT PLACE TO START
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Because this return contains its own proof. Most reconciliations compare a
 * form against something OUTSIDE it — the W-3 against four filed 941s, the
 * bank against the ledger — and those need data the software does not yet
 * hold. Form 940 has three identities that are true on the face of the return
 * itself, checkable today with nothing but the return:
 *
 *   line 3 − line 6 = line 7      the wage base actually foots
 *   line 8 + 9 + 10 + 11 = 12     the tax is the sum of its adjustments
 *   line 17 = line 12             Part 5 foots to the annual tax
 *
 * The third of these is not our invention. The IRS instructions say "Your
 * total tax liability for the year must equal line 12", and the return is
 * checked against that arithmetic automatically when it is filed. Finding a
 * mismatch here costs a minute. Finding it by notice costs a correspondence.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE FOURTH CHECK IS THE ONE THAT SAVES MONEY
 * ───────────────────────────────────────────────────────────────────────────
 *
 * The three above are arithmetic. The fourth is judgement, and it is the one
 * that matters financially: does line 12 equal line 8?
 *
 * If it does, the full 5.4% state credit was earned and Greenway paid FUTA at
 * 0.6% — the lowest rate the law allows. If it does not, the gap is the price
 * of something that went wrong at the state level, usually a late payment to
 * ESD. It is not an error in the form. The return is correct; the YEAR was
 * expensive. So this row is deliberately NOT toned as a failure when the two
 * differ — it is reported as a finding with the cost named in dollars, which
 * is the only way it becomes actionable next year.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THE ROWS ARE BUILT HERE AND NOT IN THE PAGE
 * ───────────────────────────────────────────────────────────────────────────
 *
 * A page component cannot be unit-tested without rendering it. These rows
 * carry arithmetic and wording that must be provably right, so they are built
 * by a PURE function over the return the engine already produced, and the page
 * only displays what comes back. No `node:fs`, no `server-only`, no Supabase.
 */

import type { Form940Return } from "./form-940-core";
import { checkRow, type CheckRow } from "./form-box-ui-core";

/**
 * Pull one line's amount off the return.
 *
 * Returns `null` — never 0 — when the line is absent or deliberately blank.
 * That distinction is the whole reason `cannot_check` exists as an outcome. A
 * blank line 10 means "no late state payments", and turning it into a zero
 * here would be harmless; but a line the engine never emitted means the return
 * is not what this module thinks it is, and reporting THAT as a zero would
 * manufacture a passing check out of missing data (rule 62d).
 */
function lineCents(ret: Form940Return, line: string): number | null {
  const found = ret.lines.find((l) => l.line === line);
  if (found === undefined) return null;
  return found.amountCents;
}

/**
 * A NOTE ON BLANK LINES, BECAUSE IT IS COUNTER-INTUITIVE.
 *
 * `Form940Line.amountCents` is a plain `number` — never null. Lines 9, 10 and
 * 11 on a clean return carry 0 with `blank: true`, because the IRS reads an
 * empty box and a box containing 0.00 as different statements and the flag is
 * what keeps them apart when the return is printed.
 *
 * For FOOTING purposes an intentionally blank line contributes exactly zero,
 * which is what `amountCents` already holds. So no special handling is needed
 * here, and an earlier version of this file that added some was carrying a
 * branch that could never execute (standing rule 50). The only genuinely
 * unknown case is a line the engine never emitted at all, and `lineCents`
 * returns null for precisely that.
 */

/** Sum a set of lines, refusing if any single one is unavailable. */
function sumOrNull(values: readonly (number | null)[]): number | null {
  let total = 0;
  for (const v of values) {
    if (v === null) return null;
    total += v;
  }
  return total;
}

/**
 * Every reconciliation Form 940 can perform on itself.
 *
 * Pure. Given the same return it returns the same rows, which is what lets the
 * gate assert the wording as well as the arithmetic.
 */
export function form940Checks(ret: Form940Return): readonly CheckRow[] {
  const line3 = lineCents(ret, "3");
  const line6 = lineCents(ret, "6");
  const line7 = lineCents(ret, "7");
  const line8 = lineCents(ret, "8");
  const line12 = lineCents(ret, "12");
  const line17 = lineCents(ret, "17");

  const adjustments = sumOrNull([
    line8,
    lineCents(ret, "9"),
    lineCents(ret, "10"),
    lineCents(ret, "11"),
  ]);

  const rows: CheckRow[] = [];

  /* ── 1. The wage base foots ─────────────────────────────────────────── */
  rows.push(
    checkRow({
      title: "The taxable wage base foots",
      question:
        "Line 7 is supposed to be everything you paid (line 3) less the payments that are exempt " +
        "or above the $7,000-a-head ceiling (line 6). Does the subtraction actually work out?",
      leftLabel: "Line 3 minus line 6",
      leftCents: line3 !== null && line6 !== null ? line3 - line6 : null,
      rightLabel: "Line 7 as reported",
      rightCents: line7,
      agreesMeaning:
        "The wage base is internally consistent. Every dollar of FUTA on this return is charged " +
        "on line 7, so this is the figure worth checking against your own headcount: divide it " +
        "by $7,000 and you should get roughly the number of people you employed for a full year.",
      disagreesMeaning:
        "The subtraction does not work, which means one of the three lines is wrong and the tax " +
        "below is therefore wrong too. Fix this before reading anything further down the form — " +
        "every figure under line 7 inherits the error.",
      missingMeaning:
        "One of lines 3, 6 or 7 has not been computed, so the wage base cannot be verified yet.",
    }),
  );

  /* ── 2. The tax is the sum of its adjustments ───────────────────────── */
  rows.push(
    checkRow({
      title: "The annual tax is the sum of its parts",
      question:
        "Line 12 should be line 8 plus every adjustment on lines 9, 10 and 11. On this form the " +
        "adjustments only ever ADD — there is no line that reduces the tax. Do they add up?",
      leftLabel: "Lines 8 + 9 + 10 + 11",
      leftCents: adjustments,
      rightLabel: "Line 12 as reported",
      rightCents: line12,
      agreesMeaning:
        "Line 12 is the honest total of the best case plus whatever credit was clawed back. This " +
        "is your real federal unemployment tax for the year.",
      disagreesMeaning:
        "The adjustments do not add to the total. Since line 12 is what you actually pay, this " +
        "gap is either an overpayment or an underpayment — neither is acceptable to leave.",
      missingMeaning:
        "One of lines 8 through 12 has not been computed, so the addition cannot be verified.",
    }),
  );

  /* ── 3. The IRS's own stated identity ───────────────────────────────── */
  rows.push(
    checkRow({
      title: "Part 5 foots to the annual tax",
      question:
        'The instructions say plainly: "Your total tax liability for the year must equal line 12." ' +
        "Line 17 adds up the four quarterly liabilities. Does it match?",
      leftLabel: "Line 17, the four quarters added",
      leftCents: line17,
      rightLabel: "Line 12, the annual tax",
      rightCents: line12,
      agreesMeaning:
        "Part 5 foots exactly, which is what the IRS checks automatically on receipt. Note that " +
        "the quarters record what you INCURRED, not what you deposited — the two legitimately " +
        "differ whenever a deposit is made in the quarter after the one that generated it.",
      disagreesMeaning:
        "The four quarters do not add to the annual tax. Line 12 is computed by the engine and " +
        "the quarterly split is supplied by you, so the quarters are the side to correct. This " +
        "is the mismatch the IRS notices immediately, so it is worth a minute now.",
      missingMeaning:
        "The quarterly liability split has not been supplied, so Part 5 cannot be checked. The " +
        "engine will not guess it, because the split depends on the date each person crossed the " +
        "$7,000 ceiling and only the pay records know that.",
    }),
  );

  /* ── 4. The expensive one ───────────────────────────────────────────── */
  rows.push(
    checkRow({
      title: "Was the full state credit earned?",
      question:
        "Line 8 charges FUTA at 0.6%, which assumes you earned the whole 5.4% state credit. Line " +
        "12 is what you actually owe. If they are equal the assumption held. If line 12 is " +
        "larger, the difference is credit that was lost.",
      leftLabel: "Line 8, the best case at 0.6%",
      leftCents: line8,
      rightLabel: "Line 12, what is actually owed",
      rightCents: line12,
      agreesMeaning:
        "The full credit was earned. Greenway paid federal unemployment tax at 0.6% rather than " +
        "6.0% — a tenth of the headline rate — and that was won entirely by paying Washington's " +
        "state unemployment tax on time. This is the outcome to repeat every year.",
      disagreesMeaning:
        "Some of the 5.4% state credit was lost, and the difference between these two figures is " +
        "exactly what it cost. This is NOT an error on the return; the form is correct and the " +
        "year was expensive. The cause is upstream — usually a state unemployment payment made " +
        "after its due date — and it is worth knowing the number, because it is the amount a " +
        "calendar reminder would have saved.",
      missingMeaning:
        "Line 8 or line 12 is not available, so the credit position cannot be assessed.",
    }),
  );

  return rows;
}
