/**
 * src/lib/payroll/wa-quarterly-ui-core.ts   (books-41)
 *
 * EVERY DECISION THE WASHINGTON QUARTERLY SCREEN MAKES, IN A FILE A TEST CAN REACH.
 *
 * WHY THIS FILE EXISTS. A `page.tsx` cannot be unit tested in this repository -
 * the vitest include is `tests/compliance/` and a server component reaches the
 * database - so any rule that lives in JSX is a rule nothing checks. The page
 * that goes with this file is markup and nothing else: which badge colour,
 * which sentence, whether a button may be pressed, and what the screen says
 * when there is nothing to show, all live here.
 *
 * NOTHING HERE READS THE CLOCK, THE DATABASE, OR THE FILESYSTEM. Every input
 * arrives as an argument. A function that calls `new Date()` answers a
 * different question every day and cannot be pinned by a test - and on a screen
 * whose entire subject is deadlines, "what day is it" is precisely the input a
 * test needs to control.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MAKES THIS SCREEN DIFFERENT FROM THE 941 SCREEN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The 941 screen has ONE form going to ONE agency. This one has FOUR forms
 * going to THREE agencies, and they are not interchangeable:
 *
 *   Forms 5208A and 5208B  -> Employment Security, through EAMS, TOGETHER.
 *   Paid Leave / WA Cares  -> Employment Security, through a DIFFERENT system.
 *   L&I quarterly report   -> Labor & Industries, through its own portal.
 *
 * The two ESD filings are the trap. They go to the same agency and they do not
 * go to the same place, so "I filed with ESD" is not a statement that means
 * anything. `agencyGroups()` exists to force that split onto the screen: three
 * destinations, three confirmation numbers, three separate acts.
 *
 * The second difference is ownership. On the 941 everything is either withheld
 * or matched. Here, three legal relationships sit side by side on one screen:
 * money that is Greenway's own cost and MAY NOT be deducted from staff
 * (RCW 50.24.010), money that was withheld and is held in trust as the
 * employees' agent (RCW 50A.10.030(7)(b)), and money that is genuinely shared.
 * `ownershipSummary()` totals them separately, because a single "amount owed"
 * figure would blur a distinction the statutes draw in opposite directions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE COLOURS, AND WHY THERE ARE ONLY FOUR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   green   - the return is complete and it is not yet urgent.
 *   gold    - complete, but the deadline is close. Nothing is wrong.
 *   orange  - complete, and the deadline is very close.
 *   danger  - it cannot be produced, or the deadline has passed.
 *
 * Gold is the interesting one, and it is the same choice the 941 and pay-run
 * screens made: a state that is CORRECT but wants attention has to be visually
 * distinct from a state that is WRONG, or Michael learns to treat both the same
 * way. There is no `--admin-warning` token in this codebase; gold and orange are
 * the two intermediate tones that exist.
 */

import {
  type WaQuarterFormId,
  type WaQuarterLine,
  type WaQuarterRates,
  type WaQuarterRefusal,
  type WaQuarterResult,
  type WaQuarterReturn,
  type WhoseMoney,
  ALL_WA_QUARTER_REFUSAL_CODES,
  formatWaLineValue,
  waLinesForForm,
  waQuarterDueDate,
} from "@/lib/payroll/wa-quarterly-core";
import { type QuarterRef } from "@/lib/payroll/payroll-deposit-schedule-core";
import {
  type PayrollRateKey,
  type PayrollRateRegistry,
  type PayrollRateUnit,
  describeKey,
} from "@/lib/payroll/payroll-rate-registry-core";
import {
  boxExplainer,
  waFormGuide,
  waRefusalLesson,
} from "@/lib/payroll/wa-quarterly-mentor";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  HOW LONG IS LEFT
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WaQuarterTone = "green" | "gold" | "orange" | "danger" | "neutral";

/**
 * Whole days from `today` to `due`, both ISO dates. Negative means overdue.
 *
 * Computed in UTC from the date parts alone, never from a local `Date`, so that
 * the answer does not change with the server's timezone. A deadline screen that
 * says "3 days" in Seattle and "2 days" in UTC is a screen nobody can trust at
 * the only moment it matters.
 */
export function waDaysUntil(today: string, due: string): number {
  const parse = (iso: string): number => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) throw new Error(`wa-quarterly ui: "${iso}" is not an ISO date (YYYY-MM-DD).`);
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  return Math.round((parse(due) - parse(today)) / 86_400_000);
}

export type WaUrgencyBand = "overdue" | "due-now" | "due-soon" | "comfortable";

/**
 * Turn days-remaining into a band.
 *
 * THE BOUNDARIES ARE CHOSEN, NOT ARBITRARY, AND THEY MATCH THE 941 SCREEN.
 * Seven days is one full week - enough time to find a missing timesheet and
 * still file. Thirty days is roughly the whole filing window, since these
 * returns are due one month after the quarter ends. Using the same boundaries
 * as the federal screen is deliberate: Michael should not have to learn that
 * "gold" means one thing on one page and something else on another.
 */
export function waUrgencyBand(daysLeft: number): WaUrgencyBand {
  if (daysLeft < 0) return "overdue";
  if (daysLeft <= 7) return "due-now";
  if (daysLeft <= 30) return "due-soon";
  return "comfortable";
}

export function waUrgencyTone(band: WaUrgencyBand): WaQuarterTone {
  switch (band) {
    case "overdue":
      return "danger";
    case "due-now":
      return "orange";
    case "due-soon":
      return "gold";
    case "comfortable":
      return "green";
  }
}

/**
 * The deadline in words, phrased so the urgent cases cannot be misread as
 * reassurance.
 *
 * THE OVERDUE SENTENCE NAMES THE WASHINGTON TRAP ON PURPOSE. A reader who has
 * used the federal system knows that filing the 941 late can still be cured by
 * having deposited on time. Washington has no equivalent, and the moment that
 * matters is the moment the date has already passed.
 */
export function waUrgencyMeaning(band: WaUrgencyBand, daysLeft: number, due: string): string {
  const d = Math.abs(daysLeft);
  const dayWord = d === 1 ? "day" : "days";
  switch (band) {
    case "overdue":
      return (
        `These returns were due ${due} - ${d} ${dayWord} ago. File them today. Washington has ` +
        `no federal-style extension for having paid on time, so nothing you did earlier in the ` +
        `quarter cures a late report.`
      );
    case "due-now":
      return (
        `Due ${due}, in ${d} ${dayWord}. There are three separate submissions to make and each ` +
        `returns its own confirmation number, so start today rather than on the day.`
      );
    case "due-soon":
      return (
        `Due ${due}, in ${d} ${dayWord}. Nothing is wrong; this is the ordinary filing window. ` +
        `Work the checklist once and the three submissions take a few minutes each.`
      );
    case "comfortable":
      return (
        `Due ${due}, in ${d} ${dayWord}. The quarter has only just closed, so there is time to ` +
        `correct anything the checklist finds.`
      );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  THE STATE OF THE QUARTER
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WaQuarterStatus = "ready" | "blocked";

export function waStatusOf(result: WaQuarterResult): WaQuarterStatus {
  return result.ok ? "ready" : "blocked";
}

export function waStatusTone(status: WaQuarterStatus): WaQuarterTone {
  return status === "ready" ? "green" : "danger";
}

export function waStatusLabel(status: WaQuarterStatus): string {
  return status === "ready" ? "Figures ready" : "Cannot produce yet";
}

/**
 * What the status actually means, in a sentence that does not overclaim.
 *
 * "Figures ready" is carefully not "ready to file". The system has produced the
 * numbers; whether they are RIGHT still depends on the timesheets they came
 * from, which is what the checklist is for. Saying "ready to file" would invite
 * Michael to skip the one step that catches real errors.
 */
export function waStatusMeaning(status: WaQuarterStatus): string {
  if (status === "ready") {
    return (
      "Every figure below has been computed from your payroll for the quarter. That means the " +
      "arithmetic is done, not that the underlying hours and wages have been checked - work " +
      "the checklist before you submit anything."
    );
  }
  return (
    "Something in the payroll data prevents these returns from being produced. Each item below " +
    "says what happened, why the system refused rather than guessing, and the one thing to do " +
    "about it."
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE ONE NEXT ACTION
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WaNextAction = {
  /** The single sentence at the top of the page. */
  readonly headline: string;
  /** What to do, in the imperative. */
  readonly detail: string;
  /** Where to go, or null when the action is right here. */
  readonly href: string | null;
  readonly ctaLabel: string;
  readonly tone: WaQuarterTone;
};

/**
 * Collapse the whole screen into one instruction.
 *
 * PRIORITY ORDER, AND WHY IT IS THIS ORDER.
 *
 *   1. Refusals first, always. Returns that cannot be produced cannot usefully
 *      be late - "file these" is not actionable advice when there is nothing
 *      to file.
 *   2. Then overdue, because the meter is running and Washington offers no
 *      way to cure it after the fact.
 *   3. Then the ordinary "submit them" case.
 *
 * The order is deliberately NOT "most severe colour first". Overdue returns
 * that also cannot be produced should send Michael to the missing timesheet,
 * not to a deadline he cannot meet until the timesheet is found.
 */
export function waNextAction(result: WaQuarterResult, today: string): WaNextAction {
  if (!result.ok) {
    const first = result.refusals[0];
    const lesson = first ? waRefusalLesson(first.code) : undefined;
    return {
      headline:
        result.refusals.length === 1
          ? "One thing is missing before these returns can be produced."
          : `${result.refusals.length} things are missing before these returns can be produced.`,
      detail: lesson ? lesson.howToFix : (first?.fix ?? "Review the items listed below."),
      href: null,
      ctaLabel: "See what is missing",
      tone: "danger",
    };
  }

  const due = waQuarterDueDate(result.value.quarter);
  const daysLeft = waDaysUntil(today, due.dueDate);
  const band = waUrgencyBand(daysLeft);
  const label = waQuarterLabel(result.value.quarter);

  if (band === "overdue") {
    const d = Math.abs(daysLeft);
    return {
      headline: `${label} is overdue by ${d} ${d === 1 ? "day" : "days"}.`,
      detail:
        "Submit all three today. Employment Security charges an incomplete-report penalty per " +
        "quarter and L&I charges its own, and unlike the federal 941 there is no extension " +
        "earned by having paid on time. Filing now stops the meter even if a payment follows.",
      href: null,
      ctaLabel: "Work the checklist",
      tone: "danger",
    };
  }

  return {
    headline: `${label} figures are ready.`,
    detail: waUrgencyMeaning(band, daysLeft, due.dueDate),
    href: null,
    ctaLabel: "Work the checklist",
    tone: waUrgencyTone(band),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  MAY THE BUTTON BE PRESSED?
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WaSubmitButtonState = {
  readonly enabled: boolean;
  readonly label: string;
  /** Why it is disabled. Null when it is enabled. */
  readonly disabledReason: string | null;
  /**
   * The honest note that sits under the button whether or not it is enabled.
   *
   * THIS SYSTEM DOES NOT FILE ANYTHING. It prepares figures for a human being
   * to read, check and submit. Saying so under the button is not modesty - a
   * button labelled "File" that does not file is the single most dangerous
   * control we could ship, because the failure mode is Michael believing a
   * return went in when it did not.
   */
  readonly honestyNote: string;
};

export function waSubmitButtonState(result: WaQuarterResult): WaSubmitButtonState {
  const note =
    "This produces the figures for the returns. It does not transmit anything to Employment " +
    "Security or to Labor & Industries - nothing here files on your behalf, and nothing here " +
    "is a filing agent. Take these figures to EAMS, to the Paid Leave system and to the L&I " +
    "portal yourself, and keep the three confirmation numbers they give you.";

  if (!result.ok) {
    return {
      enabled: false,
      label: "Cannot produce these returns yet",
      disabledReason:
        result.refusals.length === 1
          ? "One item below has to be resolved first."
          : `${result.refusals.length} items below have to be resolved first.`,
      honestyNote: note,
    };
  }

  return {
    enabled: true,
    label: "Show the figures",
    disabledReason: null,
    honestyNote: note,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  THREE DESTINATIONS, NOT ONE
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WaAgencyGroup = {
  readonly key: "esd-eams" | "esd-paid-leave" | "lni";
  readonly agency: string;
  /** The system the submission is actually made in. */
  readonly destination: string;
  /** Which forms travel together to this destination. */
  readonly forms: readonly WaQuarterFormId[];
  readonly formTitles: readonly string[];
  readonly totalCents: number;
  readonly totalFormatted: string;
  /** Why this is a separate submission from the others. */
  readonly why: string;
};

/**
 * Split the quarter into the submissions Michael actually has to make.
 *
 * THE FIRST TWO GROUPS BOTH SAY "EMPLOYMENT SECURITY" AND THAT IS THE POINT.
 * Forms 5208A and 5208B are filed together in EAMS. Paid Leave and WA Cares go
 * to the same agency through an entirely separate system, on the same deadline.
 * A screen that showed one "ESD" block would teach Michael that one submission
 * discharges both duties, and the quarter he learns otherwise is the quarter he
 * gets a late notice for a report he believes he filed.
 */
export function waAgencyGroups(ret: WaQuarterReturn): readonly WaAgencyGroup[] {
  const titles = (forms: readonly WaQuarterFormId[]): readonly string[] =>
    forms.map((f) => waFormGuide(f)?.officialName ?? f);

  return [
    {
      key: "esd-eams",
      agency: "Employment Security Department",
      destination: "EAMS",
      forms: ["esd_5208a", "esd_5208b"],
      formTitles: titles(["esd_5208a", "esd_5208b"]),
      totalCents: ret.esdTotalCents,
      totalFormatted: formatMoneyCents(ret.esdTotalCents),
      why:
        "The tax report and the wage detail are two halves of one filing and go in together. " +
        "Filing one without the other is an incomplete report, which carries its own penalty.",
    },
    {
      key: "esd-paid-leave",
      agency: "Employment Security Department",
      destination: "the Paid Leave and WA Cares reporting system",
      forms: ["pfml_wa_cares"],
      formTitles: titles(["pfml_wa_cares"]),
      totalCents: ret.pfmlWaCaresTotalCents,
      totalFormatted: formatMoneyCents(ret.pfmlWaCaresTotalCents),
      why:
        "Same agency, same deadline, different system. This is the one people miss, because " +
        "having filed in EAMS feels like having filed with ESD. It is a separate submission " +
        "with its own confirmation number.",
    },
    {
      key: "lni",
      agency: "Department of Labor & Industries",
      destination: "the L&I online portal",
      forms: ["lni_quarterly"],
      formTitles: titles(["lni_quarterly"]),
      totalCents: ret.lniTotalCents,
      totalFormatted: formatMoneyCents(ret.lniTotalCents),
      why:
        "A different department entirely, charged on HOURS rather than wages, with its own " +
        "account number and its own portal.",
    },
  ];
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  WHOSE MONEY IS THIS?
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WaOwnershipBucket = {
  readonly whose: WhoseMoney;
  readonly label: string;
  readonly totalCents: number;
  readonly totalFormatted: string;
  /** The legal relationship, in one sentence, with the statute that creates it. */
  readonly meaning: string;
  readonly tone: WaQuarterTone;
};

/**
 * Total the quarter three ways, because the law treats the three differently.
 *
 * WHY NOT ONE NUMBER. A single "you owe $X" figure is the natural thing to put
 * on a screen and it would be actively misleading here. Part of that money is
 * Greenway's own cost and it is UNLAWFUL to recover it from staff. Another part
 * was already taken out of employees' pay and is held in trust. Presenting them
 * as one obligation invites exactly the mistake the statutes were written to
 * prevent.
 *
 * The hours box is excluded, since it is not money at all. That exclusion is
 * checked by `measure`, not by knowing which line id it happens to be.
 */
export function waOwnershipSummary(ret: WaQuarterReturn): readonly WaOwnershipBucket[] {
  const sum = (whose: WhoseMoney): number =>
    ret.lines
      .filter((l) => l.measure === "money" && l.whoseMoney === whose && !isTotalLine(l))
      .reduce((acc, l) => acc + l.amountCents, 0);

  const employer = sum("employer_cost");
  const employee = sum("employee_money");
  const shared = sum("shared");

  return [
    {
      whose: "employer_cost",
      label: "Greenway's own cost",
      totalCents: employer,
      totalFormatted: formatMoneyCents(employer),
      meaning:
        "This is the business's money and it may not be recovered from anyone's pay. " +
        "RCW 50.24.010 makes deducting unemployment taxes from a worker unlawful, and any " +
        "such deduction is a misdemeanour.",
      tone: "neutral",
    },
    {
      whose: "employee_money",
      label: "Held in trust for your staff",
      totalCents: employee,
      totalFormatted: formatMoneyCents(employee),
      meaning:
        "This was already withheld from wages. Under RCW 50A.10.030(7)(b) you hold it as the " +
        "employees' agent, and the premiums are held in trust for the State - it was never " +
        "Greenway's money to spend, even for a week.",
      tone: "gold",
    },
    {
      whose: "shared",
      label: "Shared between you and your staff",
      totalCents: shared,
      totalFormatted: formatMoneyCents(shared),
      meaning:
        "Workers' compensation is split by law between the business and the worker. The split " +
        "is set by the State, not chosen by you, and the employee half is the only payroll " +
        "deduction on this screen that the law positively permits.",
      tone: "neutral",
    },
  ];
}

/**
 * Is this line a TOTAL of other lines on the same screen?
 *
 * Needed so the ownership buckets do not double-count. The ESD total is the sum
 * of the two unemployment components and the L&I "amount owed" is the sum of the
 * two shares; adding all of them would report roughly twice the real figure.
 *
 * Identified by id rather than by arithmetic on purpose: a line that HAPPENS to
 * equal the sum of two others is not necessarily a total, and a rule based on
 * coincidence would start behaving differently the first quarter a component
 * came out at zero.
 */
function isTotalLine(line: WaQuarterLine): boolean {
  return line.id === "esd-total" || line.id === "lni-premium";
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §7  RENDERING THE PIECES
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WaRefusalCard = {
  readonly code: string;
  readonly title: string;
  readonly because: string;
  readonly fix: string;
  /** The mentor's longer explanation, when there is one. */
  readonly whyItRefuses: string | null;
  readonly subjectId: string | null;
  readonly tone: WaQuarterTone;
};

/**
 * One refusal, ready to render.
 *
 * The engine's own `because`/`fix` are kept even when a lesson exists, because
 * the engine's version names the actual person and figure while the lesson
 * explains the general principle. Michael needs both: which timesheet, and why
 * the system would rather stop than guess.
 */
export function waRefusalCard(refusal: WaQuarterRefusal): WaRefusalCard {
  const lesson = waRefusalLesson(refusal.code);
  return {
    code: refusal.code,
    title: lesson ? lesson.whatHappened : refusal.because,
    because: refusal.because,
    fix: refusal.fix,
    whyItRefuses: lesson ? lesson.whyItRefuses : null,
    subjectId: refusal.subjectId ?? null,
    tone: "danger",
  };
}

export type WaLineRow = {
  readonly id: string;
  readonly form: WaQuarterFormId;
  readonly boxLabel: string;
  /** Already formatted for its unit - dollars for money, a count for hours. */
  readonly value: string;
  readonly shownAs: string;
  readonly whoseMoney: WhoseMoney;
  readonly whoseMoneyLabel: string;
  /** True when this line is a sum of others shown above it. */
  readonly isTotal: boolean;
  /** The plain-English explainer for this box, when one exists. */
  readonly explains: {
    readonly whatGoesHere: string;
    readonly whereItComesFrom: string;
    readonly ifItIsWrong: string;
  } | null;
};

/**
 * The rows for one form, in the order the form prints them.
 *
 * VALUES ARE FORMATTED HERE, ONCE, BY THE ENGINE'S OWN FORMATTER. The hours box
 * carries `amountCents: 0`, so any screen that reached for `amountCents`
 * directly would print "$0.00" against a box that really says 3,558 hours.
 * Calling `formatWaLineValue` makes that mistake impossible to make by accident.
 */
export function waLineRows(ret: WaQuarterReturn, form: WaQuarterFormId): readonly WaLineRow[] {
  return waLinesForForm(ret, form).map((l) => {
    const ex = boxExplainer(l.id);
    return {
      id: l.id,
      form: l.form,
      boxLabel: l.boxLabel,
      value: formatWaLineValue(l),
      shownAs: l.shownAs,
      whoseMoney: l.whoseMoney,
      whoseMoneyLabel: whoseMoneyLabel(l.whoseMoney),
      isTotal: isTotalLine(l),
      explains: ex
        ? {
            whatGoesHere: ex.whatGoesHere,
            whereItComesFrom: ex.whereItComesFrom,
            ifItIsWrong: ex.ifItIsWrong,
          }
        : null,
    };
  });
}

export type WaWageDetailRow = {
  readonly subjectId: string;
  readonly displayName: string;
  readonly wagesFormatted: string;
  readonly hoursFormatted: string;
};

/**
 * The 5208B, which is the one form on this screen made of PEOPLE, not boxes.
 *
 * WHY THIS FUNCTION HAS TO EXIST. Every other form here is a short list of
 * boxes, and `waLineRows` renders them. Form 5208B has NO boxes at all - it is
 * one row per employee, carrying that person's wages and hours. The engine
 * reflects that by putting it in `wageDetail` rather than in `lines`, which
 * means a screen that only knew about `waLineRows` would render three forms and
 * silently omit the fourth.
 *
 * That omission would be invisible and expensive. The 5208A and the 5208B are
 * two halves of ONE filing: send the tax report without the wage detail and
 * Employment Security has an incomplete report, which carries its own penalty
 * even though a payment arrived. So the fourth form needs its own renderer, and
 * a test needs to prove the screen has one.
 */
export function waWageDetailRows(ret: WaQuarterReturn): readonly WaWageDetailRow[] {
  return ret.wageDetail.map((r) => ({
    subjectId: r.subjectId,
    displayName: r.displayName,
    wagesFormatted: formatMoneyCents(r.wagesCents),
    hoursFormatted: `${r.hours.toLocaleString("en-US")} ${r.hours === 1 ? "hour" : "hours"}`,
  }));
}

/**
 * Does every form on this screen have something to render?
 *
 * Exists so a test can prove the 5208B is not quietly missing. Three of the
 * four forms are answered by `waLineRows` and the fourth only by
 * `waWageDetailRows`; this reports per form which one covers it, so a future
 * refactor cannot drop a form without a test noticing.
 */
export function waFormRenderCoverage(
  ret: WaQuarterReturn,
): readonly { form: WaQuarterFormId; renderedBy: "boxes" | "wage-detail" | "nothing" }[] {
  const forms: readonly WaQuarterFormId[] = [
    "esd_5208a",
    "esd_5208b",
    "pfml_wa_cares",
    "lni_quarterly",
  ];
  return forms.map((form) => {
    if (waLineRows(ret, form).length > 0) return { form, renderedBy: "boxes" as const };
    if (form === "esd_5208b" && waWageDetailRows(ret).length > 0) {
      return { form, renderedBy: "wage-detail" as const };
    }
    return { form, renderedBy: "nothing" as const };
  });
}

/**
 * The short badge next to a box saying whose money it is.
 *
 * Deliberately three DIFFERENT vocabularies rather than three shades of the
 * same word, so the distinction survives being skim-read.
 */
export function whoseMoneyLabel(whose: WhoseMoney): string {
  switch (whose) {
    case "employer_cost":
      return "Your money";
    case "employee_money":
      return "Your staff's money";
    case "shared":
      return "Shared";
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §8  LABELS, EMPTY STATES AND COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

/** "Q2 2026". Kept here so every caption on the screen spells it the same way. */
export function waQuarterLabel(q: QuarterRef): string {
  return `Q${q.quarter} ${q.year}`;
}

/** Money from integer cents. Never used for the hours box - see `waLineRows`. */
export function formatMoneyCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * What the screen says when there is no payroll for the quarter at all.
 *
 * THIS IS NOT A COSMETIC MESSAGE. WAC 296-17-31023 says that when no report is
 * filed L&I "will estimate premiums and initiate legal action" - a quarter with
 * no payroll still requires a report saying so. An empty state that just said
 * "nothing to show" would quietly imply there is nothing to do.
 */
export function waEmptyStateFor(quarter: QuarterRef): { title: string; body: string } {
  const due = waQuarterDueDate(quarter);
  return {
    title: `No payroll recorded for ${waQuarterLabel(quarter)}`,
    body:
      `There are no paid hours or wages in this quarter yet, so there is nothing to compute. ` +
      `Note that a quarter with no payroll still has to be REPORTED as a no-payroll quarter by ` +
      `${due.dueDate}. If you do not file, L&I will estimate the premium and pursue it - an ` +
      `estimate you then have to argue your way out of. Filing a zero is far easier.`,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §9  GETTING THE SEVEN RATES, OR SAYING WHY NOT
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WaRatesResolution =
  | { readonly ok: true; readonly rates: WaQuarterRates }
  | {
      readonly ok: false;
      /** One entry per rate that could not be evidenced, in plain English. */
      readonly missing: readonly {
        readonly key: PayrollRateKey;
        readonly label: string;
        readonly message: string;
        readonly whatToDo: string;
      }[];
    };

/**
 * Collect the seven rates these returns need, on the date they applied.
 *
 * WHY THIS IS HERE AND NOT IN THE PAGE. The page cannot be tested, and this is
 * the function most likely to be quietly "fixed" by someone under deadline
 * pressure - one `?? 0` and a missing rate becomes a zero-premium return that
 * looks completely normal. Putting it in the tested layer means that shortcut
 * cannot be taken without a test noticing.
 *
 * WHY IT REPORTS ALL THE MISSING RATES AND NOT JUST THE FIRST. If Michael is
 * missing five rates, telling him about one, waiting for him to enter it and
 * then telling him about the next is five round trips. The ESD and L&I notices
 * that carry them arrive together, so he should be told the whole list at once.
 *
 * WHY THE UNIT IS DEMANDED ON EVERY LOOKUP. Every one of these is a small
 * integer, and 1_130 is plausible as milli-percent, as cents and as milli-cents
 * per hour. `lookupValue` refuses on a unit mismatch, which turns a silent
 * thousand-fold error into a message.
 *
 * WHICH DATE IS USED, AND WHY IT IS THE LAST DAY. A rate can change mid-quarter,
 * and Washington's do so on 1 January - which is the first day of Q1. Asking on
 * the quarter's LAST day gets the rate that was in force for the whole of it in
 * every real case, and asking on the first day would return December's rate for
 * a January quarter. This is the sort of off-by-one that produces a return that
 * is wrong by exactly one rate change.
 */
export function waResolveRates(
  registry: PayrollRateRegistry,
  onIsoDate: string,
): WaRatesResolution {
  const wanted: readonly [keyof WaQuarterRates, PayrollRateKey, PayrollRateUnit][] = [
    ["sutaUiMilliPct", "wa_suta_ui", "milli_percent"],
    ["sutaEafMilliPct", "wa_suta_eaf", "milli_percent"],
    ["pfmlTotalMilliPct", "pfml_total", "milli_percent"],
    ["pfmlEmployeeShareMilliPct", "pfml_employee_share_of_total", "milli_percent"],
    ["waCaresMilliPct", "wa_cares_total", "milli_percent"],
    ["lniEmployeeMilliCentsPerHour", "lni_employee_rate", "milli_cents_per_hour"],
    ["lniEmployerMilliCentsPerHour", "lni_employer_rate", "milli_cents_per_hour"],
  ];

  const got: Partial<Record<keyof WaQuarterRates, number>> = {};
  const missing: {
    key: PayrollRateKey;
    label: string;
    message: string;
    whatToDo: string;
  }[] = [];

  for (const [field, key, unit] of wanted) {
    const hit = registry.lookupValue(key, onIsoDate, unit);
    if (hit.ok) {
      got[field] = hit.value;
    } else {
      missing.push({
        key,
        label: describeKey(key),
        message: hit.refusal.message,
        whatToDo: hit.refusal.whatToDo,
      });
    }
  }

  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    rates: {
      sutaUiMilliPct: got.sutaUiMilliPct!,
      sutaEafMilliPct: got.sutaEafMilliPct!,
      pfmlTotalMilliPct: got.pfmlTotalMilliPct!,
      pfmlEmployeeShareMilliPct: got.pfmlEmployeeShareMilliPct!,
      waCaresMilliPct: got.waCaresMilliPct!,
      lniEmployeeMilliCentsPerHour: got.lniEmployeeMilliCentsPerHour!,
      lniEmployerMilliCentsPerHour: got.lniEmployerMilliCentsPerHour!,
    },
  };
}

/**
 * The date to ask the rate registry about for a given quarter.
 *
 * The quarter's last day, for the reason given on `waResolveRates`.
 */
export function waRateAsOfDate(q: QuarterRef): string {
  const lastMonth = q.quarter * 3;
  const lastDay = new Date(Date.UTC(q.year, lastMonth, 0)).getUTCDate();
  return `${q.year}-${String(lastMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

/**
 * Which refusal codes have a lesson attached.
 *
 * Exists so a test can prove the screen teaches every way it can say no.
 * A refusal Michael can trigger but cannot be taught about is a dead end, and
 * the point of this system is that there are none.
 */
export function waRefusalCoverage(): readonly { code: string; taught: boolean }[] {
  return ALL_WA_QUARTER_REFUSAL_CODES.map((code) => ({
    code,
    taught: waRefusalLesson(code) !== undefined,
  }));
}
