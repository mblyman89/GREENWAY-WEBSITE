/**
 * src/lib/payroll/eams-confirmation-core.ts   (books-66)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE 5208A AS MICHAEL IS USED TO SEEING IT — THE EAMS CONFIRMATION SCREEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael, books-66:
 *
 *   "I am just trying to mimic sage. they have an official form from esd
 *    through legal means, they get it directly from esd. is there a way for
 *    you to take the form 5208 I gave you that sage produces, and somehow use
 *    it like form 940 and 941? its only for visualization only, I just want to
 *    mimic sages ability to show me the form."
 *
 *   "however, I would not be opposed to the form looking like the one given
 *    after efiling, the example you have in the workspace folder,
 *    1st_quarter_form_5208a.pdf. that would actually be better in my opinion
 *    as thats what I am used to seeing."
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS ONE CAN BE A TRUE FACSIMILE WHEN books-65 SAID IT COULD NOT
 * ───────────────────────────────────────────────────────────────────────────
 *
 * books-65 refused to place figures on the 5208A paper, and that refusal still
 * stands for that document. The reasons were measured, not assumed:
 *
 *     esd5208a.pdf  pages 1  fields 0  /Annots 0   — zero rectangles
 *     the bundled artwork is "5208A-final-draft-4-2011" — wrong line numbers,
 *     wrong wage base ($37,300 against 2026's $78,200)
 *
 * Placing 2026 money on 2011 artwork by eye is guessing at the exact place
 * where a mistake is invisible. That has not changed.
 *
 * What changed is WHICH DOCUMENT Michael asked for. He asked for the thing he
 * actually recognises — the EAMS confirmation page produced after e-filing. And
 * that document is not scanned agency artwork at all. It is an HTML page that
 * EAMS renders in a browser and the browser prints to PDF. The evidence is in
 * the file he gave us: `1ST QUARTER FORM 5208A.pdf` carries a browser print
 * header and footer —
 *
 *     "3/19/26, 12:44 PM   Confirmation | File Unemployment Insurance
 *      Quarterly Report | EAMS"
 *     "https://portal.esd.wa.gov/UnemploymentInsuranceQuarterlyReports/
 *      Confirmation                                            1/2"
 *
 * A print-to-PDF of a web page has no fixed rectangles to reproduce, because it
 * never had any. It is a flow layout: headings, definition pairs, a table. So
 * rebuilding it in HTML is not "measuring the paper by eye" — it is the SAME
 * MEDIUM doing the SAME JOB. There is no geometry to guess, therefore rule 62d
 * is not engaged. That is the whole difference, and it is why this is honest
 * where painting the 5208A would not have been.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS NOT
 * ───────────────────────────────────────────────────────────────────────────
 *
 * It is NOT a filing, and it must never be mistaken for one. A real EAMS
 * confirmation exists because ESD received something; it carries a confirmation
 * code ESD issued and a "submitted on" date ESD stamped. We can produce neither
 * without lying. So this module models those two fields as ABSENT-BY-DESIGN and
 * the sheet prints a plain statement in their place. Michael already agreed the
 * form is not authoritative:
 *
 *   "I also did a little research on my own about the form 5208, and I agree
 *    that we cant use it authoritatively, and that I will for sure be uploading
 *    a file rather than mailing a physical copy."
 *
 * ───────────────────────────────────────────────────────────────────────────
 * READ-ONLY, LIKE EVERY OTHER SHEET
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   "the form should only have numbers on it based on records from the books,
 *    not something i snuck in last minute by erasing one and replacing
 *    another. if a correction is to be made, it needs to be a correcting
 *    journal entry with the proper audit trail."
 *
 * This module is pure. It takes a built quarter and a company profile and
 * returns a description of a page. It computes NO tax of its own — every money
 * figure is read from lines the engine already produced. The one exception is
 * documented at `deriveExcessWages` and it is a subtraction, not a rate.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  waLineOf,
  type WaQuarterReturn,
  type WageDetailRow,
} from "@/lib/payroll/wa-quarterly-core";
import { type QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";

/* ═════════════════════════════════════════════════════════════════════════
 * §1  WHAT THE REAL CONFIRMATION SHOWS
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Every field below was read off Michael's own filed Q1 2026 confirmation with
 * `pdftotext -layout`, not imagined. The extraction is quoted in the owner
 * report for this slice. Field order here is the order EAMS prints them.
 */

/** A labelled value in the business-information block. */
export type ConfirmationPair = {
  readonly label: string;
  readonly value: string;
  /**
   * True when the value could not be read from the books.
   *
   * Kept as a flag rather than letting `value` be null, because the sheet must
   * print SOMETHING in the slot — a missing EIN should look conspicuously empty,
   * not silently collapse the layout so nobody notices the box is gone. That is
   * D-15's lesson: a computed value with no box to land in reads as a zero.
   */
  readonly missing: boolean;
};

/** One row of the charges column on the right of the page. */
export type ChargeRow = {
  readonly label: string;
  /** Formatted money, e.g. "$61,531.21". Never null — see `moneyOrDash`. */
  readonly amount: string;
  /** The small grey line EAMS prints under some rows, e.g. the rate. */
  readonly note: string | null;
  /** Rendered heavier, as EAMS does for the two summed lines. */
  readonly emphasis: boolean;
};

/** One employee row in the wage table. */
export type ConfirmationWageRow = {
  readonly index: number;
  /** Always masked. See `maskSsn`. */
  readonly ssn: string;
  readonly lastName: string;
  readonly firstName: string;
  readonly hours: string;
  readonly wages: string;
  readonly socCode: string;
};

export type EamsConfirmationView = {
  readonly quarterLabel: string;
  readonly businessName: string;
  readonly esdAccount: string;
  readonly identity: readonly ConfirmationPair[];
  readonly preparer: readonly ConfirmationPair[];
  readonly charges: readonly ChargeRow[];
  readonly wageRows: readonly ConfirmationWageRow[];
  readonly totalEmployees: number;
  readonly totalHours: number;
  readonly totalWages: string;
  readonly monthlyCounts: readonly { readonly month: string; readonly count: string }[];
  /**
   * Why there is no confirmation code and no submitted-on date.
   *
   * Present ALWAYS, never conditional. A field that appears only sometimes is a
   * field a reader learns to stop seeing.
   */
  readonly notFiledNotice: string;
  /**
   * Why every figure on this form is an em dash, or null when there are figures.
   *
   * A blank form with no explanation is the defect Michael reported in a
   * different costume: the old behaviour told him "1 problem" and drew nothing,
   * and drawing a page of dashes without saying why would be no better. This
   * sentence is the difference between a form that is empty and a form that is
   * broken, and the reader cannot be expected to tell those apart unaided.
   */
  readonly emptyReason: string | null;
};

/* ═════════════════════════════════════════════════════════════════════════
 * §2  FORMATTING, EACH RULE FROM THE DOCUMENT IT CAME FROM
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Money as EAMS prints it: leading dollar sign, thousands separators, always
 * two decimals.
 *
 * Note the deliberate difference from the EAMS UPLOAD file, which is the same
 * agency and the opposite rule: the ICESA bulk spec says of every money field
 * "Do not enter decimal... decimal is assumed two places from right". That is
 * the machine-readable path. This is the human-readable one. Two formats for
 * one number is exactly the sort of thing that gets conflated, so they live in
 * different modules and each says which document it obeys.
 */
export function confirmationMoney(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = `$${grouped}.${String(remainder).padStart(2, "0")}`;
  return negative ? `-${body}` : body;
}

/**
 * Mask a social security number to the shape EAMS prints: `***-**-1883`.
 *
 * The real confirmation masks it, so a faithful copy masks it. That is a happy
 * coincidence rather than the reason: this page is a VISUALISATION Michael may
 * well print or screenshot, and there is no version of this feature where nine
 * live digits per employee belong on it. The upload route, which genuinely must
 * carry full SSNs, is books-gated and says so in its own header.
 *
 * Anything that is not a recognisable 9-digit number is refused rather than
 * partially masked — a half-masked malformed number invites the reader to
 * assume the rest is fine.
 */
export function maskSsn(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 9) return "***-**-????";
  return `***-**-${digits.slice(5)}`;
}

/**
 * Hours, as a whole number.
 *
 * The confirmation prints "451", "490", "3027" — never a fraction. Three
 * separate ESD documents now say why, and they agree:
 *
 *   Employer Tax Handbook (April 2026): "When reporting hours, round up to the
 *   next whole number. We don't accept any fractions of hours. For example, if
 *   an employee worked 9.75 hours, you should report 10 hours."
 *
 *   EAMS bulk filing specifications: "Whole numbers only. No fractions. No
 *   decimal amounts. Actual fractional hours should be rounded to the next
 *   higher whole number."
 *
 *   ICESA Washington bulk format: "Whole numbers... No decimal... should be
 *   rounded [to the next higher] whole number."
 *
 * This function does NOT round. It asserts. The rounding already happened, once,
 * in `eamsHours` (esd-eams-csv-core.ts) — the ceiling that goes into the upload
 * file. If this display rounded independently, the number Michael SEES and the
 * number he UPLOADS could differ by an hour and nothing would catch it. Standing
 * rule 25: one computation, one place. So a fractional value arriving here is a
 * bug upstream and is reported as one rather than quietly tidied.
 */
export function confirmationHours(hours: number): string {
  if (!Number.isFinite(hours)) return "—";
  if (!Number.isInteger(hours)) {
    throw new Error(
      `eams-confirmation: hours reached the confirmation sheet as ${hours}, which is ` +
        `not a whole number. ESD does not accept fractional hours, and the ceiling is ` +
        `applied once in eamsHours() so that the displayed figure and the uploaded ` +
        `figure cannot disagree. Rounding here would hide which of the two is wrong.`,
    );
  }
  return String(hours);
}

/**
 * Excess wages, by subtraction.
 *
 * This is the ONE arithmetic operation in this module, and it is here rather
 * than in the engine because the engine already exposes both operands and the
 * confirmation is the only surface that shows the difference as its own line.
 *
 * The definition is the agency's, quoted from the ICESA bulk format
 * specification's own field name:
 *
 *   "Total Taxable Wages for this Employer (total gross wages – total excess
 *    wages)"
 *
 * Rearranged: excess = gross − taxable. That is a subtraction of two figures the
 * engine already computed, not a second opinion about either one. Notably it is
 * NOT re-derived from the wage base per employee here — doing that would be a
 * second implementation of the excess-wage walk that `buildWaQuarter` already
 * performs, and the two could drift. Michael's own Q1 confirmation shows
 * "$0.00" excess with the note "As calculated by ESD", which is the same
 * relationship from the other side.
 */
export function deriveExcessWagesCents(grossCents: number, taxableCents: number): number {
  return grossCents - taxableCents;
}

/* ═════════════════════════════════════════════════════════════════════════
 * §3  BUILDING THE VIEW
 * ═════════════════════════════════════════════════════════════════════════ */

export type ConfirmationProfile = {
  readonly legalName: string | null;
  readonly tradeName: string | null;
  readonly ein: string | null;
  readonly esdAccount: string | null;
  readonly ubi: string | null;
  readonly businessStructure: string | null;
  readonly mailingCityStateZip: string | null;
  readonly preparerName: string | null;
  readonly preparerPhone: string | null;
  readonly preparerEmail: string | null;
};

/**
 * Mask an EIN the way the confirmation does: `**-***7016`.
 *
 * Michael's filed copy prints exactly that for 46-4217016 — first seven
 * characters replaced, last four shown.
 */
export function maskEin(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 9) return "**-***????";
  return `**-***${digits.slice(5)}`;
}

function pair(label: string, value: string | null): ConfirmationPair {
  const clean = typeof value === "string" ? value.trim() : "";
  return clean === ""
    ? { label, value: "not on file", missing: true }
    : { label, value: clean, missing: false };
}

/**
 * The quarter caption EAMS prints, e.g. "Q1, 2026 (JAN — MAR)".
 *
 * Month names come from a fixed table rather than `toLocaleString`, because the
 * caption must not change with the server's locale. A confirmation that says
 * "1er trimestre" because a container had a different LANG is a support ticket
 * nobody will diagnose quickly.
 */
const QUARTER_MONTHS: Record<1 | 2 | 3 | 4, string> = {
  1: "JAN \u2014 MAR",
  2: "APR \u2014 JUN",
  3: "JUL \u2014 SEP",
  4: "OCT \u2014 DEC",
};

export function confirmationQuarterLabel(q: QuarterRef): string {
  return `Q${q.quarter}, ${q.year} (${QUARTER_MONTHS[q.quarter]})`;
}

/**
 * Read a money line the engine produced, by id.
 *
 * Returns null rather than 0 when the line is absent. A zero on a Washington
 * return is a positive claim that nothing was paid; an absent line means the
 * engine did not produce a figure. The sheet renders those differently.
 */
function lineCents(ret: WaQuarterReturn, id: string): number | null {
  const line = waLineOf(ret, id);
  return line === undefined ? null : line.amountCents;
}

function moneyOrDash(cents: number | null): string {
  return cents === null ? "\u2014" : confirmationMoney(cents);
}

/**
 * The rate note EAMS prints beneath the UI and EAF lines.
 *
 * EAMS shows "Unemployment Insurance - Rate 0.37%" and "Employment
 * Administration Fund - Rate 0.03%". Rates arrive here already resolved for the
 * quarter, in milli-percent, which is the house unit (divisor 100,000).
 */
export function rateNote(prefix: string, milliPct: number | null): string | null {
  if (milliPct === null) return null;
  const pct = milliPct / 1000;
  const text = Number.isInteger(pct) ? String(pct) : String(Number(pct.toFixed(3)));
  return `${prefix} - Rate ${text}%`;
}

export type BuildConfirmationInput = {
  readonly quarter: QuarterRef;
  /**
   * The quarter's figures, or NULL when the engine honestly has none yet.
   *
   * ═══ WHY NULL IS ACCEPTED HERE (books-67) ═══
   *
   * Michael, on finding the page refusing: *"the esd form page says it refuses
   * to draw the form because there is 1 problem, no payroll yet. I just want to
   * make sure this is correct behavior, or if I should still be able to see the
   * form without payroll data in it? Ideally I'd like to see the form like all
   * the others, even with no payroll data to fill it with."*
   *
   * He is right, and the repository already agreed with him before he asked.
   * `form-sheet-core.test.ts` records the books-49 finding in as many words:
   * "hiding a teaching surface behind `result.ok` made it invisible for a year."
   * The `sheet` route learned that lesson and falls back to a blank specimen;
   * this route shipped in books-66 without it, so the same defect class
   * recurred on a new surface. Standing rule 23: fix the class.
   *
   * NULL IS NOT ZERO, AND THAT DISTINCTION IS THE WHOLE DESIGN. An empty
   * quarter must not print `$0.00` in the tax boxes, because a zero on a
   * Washington return is an assertion that nothing was owed. Every figure
   * derived from `ret` therefore becomes an em dash when `ret` is null, using
   * the same `moneyOrDash` the filled path already uses for a missing line.
   *
   * ONE BUILDER, NOT TWO. The alternative — a separate `buildEmptyConfirmation`
   * — would be a second layout free to drift from the first, so the blank form
   * Michael studies would slowly stop resembling the filled form he files.
   * Rule 25: extend, never duplicate.
   */
  readonly ret: WaQuarterReturn | null;
  readonly profile: ConfirmationProfile;
  /** UI rate in milli-percent, already resolved for this quarter. */
  readonly uiRateMilliPct: number | null;
  /** EAF rate in milli-percent, already resolved for this quarter. */
  readonly eafRateMilliPct: number | null;
  /** Annual ESD taxable wage base, in cents, for the quarter's year. */
  readonly wageBaseCents: number | null;
  /**
   * SOC code per subject id. Michael, books-66: "all of my employees are and
   * will be the same 41-2031 soc code." It is still read per employee rather
   * than assumed, because he also said he is correcting one in Sage — the day
   * a second code appears, this must show it.
   */
  readonly socCodeBySubject: Readonly<Record<string, string>>;
  /** SSN per subject id, masked on the way in. */
  readonly ssnBySubject: Readonly<Record<string, string>>;
  /** Headcount per month of the quarter, as EAMS prints it. */
  readonly monthlyHeadcount: readonly (number | null)[];
};

/**
 * The notice that replaces the confirmation code and the submitted-on date.
 *
 * Deliberately long and specific. The failure mode this guards against is
 * Michael, or an accountant, filing this in a folder next year and reading it as
 * proof of a filing. The real article's most distinctive feature is a green
 * "Quarterly report was successfully filed!" banner and a 16-character code;
 * their absence must be as loud as their presence would be.
 */
export const NOT_FILED_NOTICE =
  "This is not a filing and not a receipt. It is a preview of what your Q$Q $Y " +
  "unemployment report will look like, drawn from your books. A real EAMS " +
  "confirmation carries a code that ESD issues and a date ESD stamps when it " +
  "receives your report; neither exists until you actually file. Use the EAMS " +
  "wage file download on the Washington screen to file, then keep the confirmation " +
  "EAMS gives you back \u2014 that one is the record copy, and this one never is.";

export function buildEamsConfirmation(input: BuildConfirmationInput): EamsConfirmationView {
  const { quarter, ret, profile } = input;

  /*
   * Every figure below is `number | null`, and null means "the books have not
   * produced this yet" — never zero. `moneyOrDash` turns null into an em dash,
   * so a blank form is visibly blank rather than quietly claiming that no wages
   * were paid and no tax was owed.
   */
  const grossCents = ret === null ? null : ret.grossWagesCents;
  const taxableCents = ret === null ? null : ret.subjectsEsdTaxableCents;
  const excessCents =
    ret === null ? null : deriveExcessWagesCents(ret.grossWagesCents, ret.subjectsEsdTaxableCents);

  const uiCents = ret === null ? null : lineCents(ret, "esd-ui");
  const eafCents = ret === null ? null : lineCents(ret, "esd-eaf");
  const totalCents = ret === null ? null : lineCents(ret, "esd-total");

  /*
   * The charges column, in EAMS's own order and wording.
   *
   * "Late report penalty" is shown as $0.00 rather than omitted, because the
   * real page always shows it and its absence would be the most alarming kind
   * of difference — the reader would wonder whether a penalty had been hidden.
   * It is hard-zero here and that is honest: this preview is never late,
   * because it is never filed. The note says so.
   */
  const charges: readonly ChargeRow[] = [
    { label: "Gross wages", amount: moneyOrDash(grossCents), note: null, emphasis: false },
    {
      label: "Excess wages",
      amount: moneyOrDash(excessCents),
      note: "As calculated from your books, not by ESD",
      emphasis: false,
    },
    {
      label: "Total taxable wages",
      amount: moneyOrDash(taxableCents),
      note:
        input.wageBaseCents === null
          ? "Based on excess wages calculation"
          : `Annual taxable wage base: ${confirmationMoney(input.wageBaseCents)}`,
      emphasis: false,
    },
    {
      label: "UI tax due",
      amount: moneyOrDash(uiCents),
      note: rateNote("Unemployment Insurance", input.uiRateMilliPct),
      emphasis: false,
    },
    {
      label: "EAF tax due",
      amount: moneyOrDash(eafCents),
      note: rateNote("Employment Administration Fund", input.eafRateMilliPct),
      emphasis: false,
    },
    {
      label: "UI and EAF charges",
      amount: moneyOrDash(totalCents),
      note: null,
      emphasis: true,
    },
    {
      label: "Late report penalty",
      /*
       * Hard zero when there ARE figures (the real page always prints this line,
       * and a preview is never late). An em dash when there are none, because on
       * a blank form a lone $0.00 among em dashes reads as a computed result.
       */
      amount: ret === null ? "\u2014" : confirmationMoney(0),
      note: "A preview is never late. EAMS will show any real penalty when you file.",
      emphasis: false,
    },
    {
      label: "Charges this quarter",
      amount: moneyOrDash(totalCents),
      note: null,
      emphasis: true,
    },
  ];

  const wageRows: readonly ConfirmationWageRow[] = (ret === null ? [] : ret.wageDetail).map(
    (row: WageDetailRow, i: number) => {
      /*
       * EAMS prints last and first name in separate columns. The engine carries
       * one `displayName`. Splitting on the last space is a GUESS about human
       * names and would mangle "Van Dyke" and "De La Cruz", so it is not done:
       * the whole name goes in the last-name column and the first-name column
       * is left empty. A visualisation that shows the right name in a slightly
       * wrong column is better than one that silently truncates somebody's
       * surname. Noted in DEFECTS as a known cosmetic gap rather than papered
       * over.
       */
      const ssnRaw = input.ssnBySubject[row.subjectId] ?? "";
      const soc = input.socCodeBySubject[row.subjectId] ?? "";
      return {
        index: i + 1,
        ssn: ssnRaw === "" ? "not on file" : maskSsn(ssnRaw),
        lastName: row.displayName,
        firstName: "",
        hours: confirmationHours(row.hours),
        wages: confirmationMoney(row.wagesCents),
        socCode: soc === "" ? "missing" : soc,
      };
    },
  );

  const identity: readonly ConfirmationPair[] = [
    pair("LEGAL ENTITY NAME", profile.legalName),
    pair("DOING BUSINESS AS", profile.tradeName),
    pair("ESD#", profile.esdAccount),
    pair("EIN", profile.ein === null ? null : maskEin(profile.ein)),
    pair("UBI", profile.ubi),
    pair("BUSINESS STRUCTURE", profile.businessStructure),
    pair("MAILING ADDRESS", profile.mailingCityStateZip),
  ];

  const preparer: readonly ConfirmationPair[] = [
    pair("NAME", profile.preparerName),
    pair("PHONE", profile.preparerPhone),
    pair("EMAIL", profile.preparerEmail),
  ];

  const monthNames = QUARTER_MONTHS[quarter.quarter].split(" \u2014 ");
  const spanMonths =
    monthNames.length === 2
      ? [monthNames[0]!, "", monthNames[1]!]
      : ["", "", ""];
  const allMonths = ((): readonly string[] => {
    const base: Record<1 | 2 | 3 | 4, readonly string[]> = {
      1: ["JANUARY", "FEBRUARY", "MARCH"],
      2: ["APRIL", "MAY", "JUNE"],
      3: ["JULY", "AUGUST", "SEPTEMBER"],
      4: ["OCTOBER", "NOVEMBER", "DECEMBER"],
    };
    return base[quarter.quarter];
  })();
  void spanMonths;

  const monthlyCounts = allMonths.map((month, i) => {
    /*
     * ═══ D-19, FOUND BY THE books-67 VISUAL CHECK ═══
     *
     * `monthlyHeadcount` arrives as its own input, independent of `ret`. When
     * `ret` is null the wage table is empty and "Total employees" reads 0 — but
     * the monthly counts kept rendering whatever they were handed, so the first
     * screenshot of an empty quarter showed TOTAL EMPLOYEES 0 directly above
     * JANUARY 10, FEBRUARY 11, MARCH 9.
     *
     * A form that contradicts itself is worse than one that admits it does not
     * know, and this one contradicted itself on the two figures ESD cross-checks
     * against each other. Both halves were individually correct — the totals
     * honestly reported an empty table, the monthly counts honestly echoed their
     * input — and the defect lived in the space between them, which is where the
     * expensive ones live (D-15, same shape).
     *
     * With no quarter to count, there is no headcount to report, whatever the
     * caller passed.
     */
    const c = ret === null ? null : input.monthlyHeadcount[i];
    return {
      month,
      /*
       * A month with no determined headcount shows an em dash, not 0. Zero
       * employees in a month is a real and meaningful state (it changes benefit
       * charging); "we did not determine it" is a different state entirely.
       */
      count: c === null || c === undefined ? "\u2014" : String(c),
    };
  });

  return {
    quarterLabel: confirmationQuarterLabel(quarter),
    businessName: profile.tradeName ?? profile.legalName ?? "not on file",
    esdAccount: profile.esdAccount ?? "not on file",
    identity,
    preparer,
    charges,
    wageRows,
    totalEmployees: ret === null ? 0 : ret.headcount,
    totalHours: ret === null ? 0 : ret.totalHours,
    /*
     * `totalEmployees` and `totalHours` are counts of rows actually present, so
     * 0 is the honest answer for an empty table — there genuinely are no rows.
     * `totalWages` is MONEY and gets a dash, because "$0.00 of wages" is a claim
     * about the quarter while "no rows" is a statement about the table.
     */
    totalWages: moneyOrDash(grossCents),
    monthlyCounts,
    emptyReason:
      ret === null
        ? "This form is blank because no pay run has reached this quarter yet — not " +
          "because anything is wrong. It is the real layout, with every box in the place " +
          "ESD prints it, so you can see what will be reported before there is anything " +
          "to report. Every amount shows a dash rather than $0.00 on purpose: a zero on " +
          "an unemployment report is a statement that no wages were paid, and that is a " +
          "claim this page will not make on your behalf. Run payroll for the quarter and " +
          "the same boxes fill in. If nobody is paid all quarter, that is still a return " +
          "— file it marked 'no payroll'."
        : null,
    notFiledNotice: NOT_FILED_NOTICE.replace("$Q", String(quarter.quarter)).replace(
      "$Y",
      String(quarter.year),
    ),
  };
}
