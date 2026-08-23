/**
 * src/lib/payroll/pay-run-ui-core.ts   (books-39 phase G)
 *
 * THE PAY RUN SCREEN, AS PURE FUNCTIONS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS, VERBATIM (standing rule 1)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   "I want check lists and blockers if things are right. I want it to tell me
 *    how to do it properly if I mess it up. I love the colors and presentation.
 *    Keep making it blatantly obvious how to proceed."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS IN HERE AND WHAT IS NOT
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything on the pay-run screen that involves a DECISION lives here, as a
 * pure function of its arguments: which of the three states an employee is in,
 * what colour that state is, what the single next action is, whether the
 * "Approve" button may be pressed at all, and what the page says when there is
 * nothing to show.
 *
 * The page component itself is then only markup. That split is not tidiness —
 * it is the difference between logic that can be tested and logic that can
 * only be looked at. A `page.tsx` cannot be unit tested in this repository
 * (the vitest include is `tests/compliance/` and a server component reaches
 * the database), so any rule that lives in JSX is a rule nothing checks.
 *
 * NOTHING HERE READS THE CLOCK, THE DATABASE, OR THE FILESYSTEM. Every input
 * arrives as an argument. `payDateReadiness` in the sibling net-pay UI core
 * made the same choice for the same reason: a function that calls `new Date()`
 * answers a different question every day and cannot be pinned by a test.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE DESIGN RULE ON THIS SCREEN
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * THERE IS EXACTLY ONE NEXT ACTION, AND IT IS THE LOUDEST THING ON THE PAGE.
 *
 * A payroll screen that shows eleven problems with equal weight is a screen
 * that gets scrolled past. `nextAction()` below collapses the entire state of
 * the run into ONE sentence and ONE destination, chosen by a strict priority
 * order, and the page renders that at the top before anything else. The other
 * ten problems are still on screen, underneath, in their own cards — but the
 * question "what do I do right now" always has a single answer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `attention` IS A COLOUR AND NOT A FOOTNOTE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `pay-run-core.ts` explains at length why there are three line states rather
 * than two: an employee with no W-4 produces a perfectly valid, legally
 * required cheque, so it cannot be `blocked` — but calling it `ready` is how
 * that person ends up over-withheld for eleven months while everyone assumes
 * the software would have said something.
 *
 * That reasoning only pays off if the screen actually renders the third state
 * differently. If `attention` and `ready` were both green, the three-state
 * design would be an elaborate way of writing a two-state design. So
 * `statusTone()` maps the three states onto three genuinely different colours,
 * and there is a test that no two of them collide.
 */

import type {
  PayRunLine,
  PayRunLineStatus,
  PayRunRefusalCode,
  PayRunResult,
  W4Provenance,
} from "@/lib/payroll/pay-run-core";
import type {
  PayRunLoadResult,
  PayRunStoreFailureCode,
} from "@/lib/payroll/pay-run-store";
import {
  PAY_RUN_CHECKS,
  payRunRefusalLesson,
  w4ProvenanceLesson,
  type PayRunCheck,
} from "@/lib/payroll/pay-run-mentor";
import { formatCentsPlain } from "@/lib/payroll/payroll-withholding-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) COLOUR
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The tones this screen is allowed to use.
 *
 * Deliberately the SAME union the shared `Badge` component accepts, minus
 * "outline" which renders identically to "neutral" and would therefore let two
 * different meanings share a colour without anybody noticing.
 */
export type PayRunTone = "green" | "gold" | "orange" | "danger" | "neutral";

/**
 * Line status to colour.
 *
 * green  = ready       — computed, nothing outstanding, pay it.
 * gold   = attention   — the cheque is CORRECT and payable, and there is
 *                        something to fix. Gold rather than orange because
 *                        orange in this admin reads as "something is wrong
 *                        with this number", and nothing is wrong with this
 *                        number. The paperwork is what needs attention.
 * danger = blocked     — no honest figure exists, so none is shown.
 */
export function statusTone(status: PayRunLineStatus): PayRunTone {
  switch (status) {
    case "ready":
      return "green";
    case "attention":
      return "gold";
    case "blocked":
      return "danger";
  }
}

/**
 * The word next to the colour.
 *
 * Colour alone is not an accessible signal and never has been — roughly one man
 * in twelve cannot reliably separate the green chip from the gold one. Every
 * place the tone is used, this label is used with it.
 */
export function statusLabel(status: PayRunLineStatus): string {
  switch (status) {
    case "ready":
      return "Ready to pay";
    case "attention":
      return "Payable — needs a fix";
    case "blocked":
      return "Cannot be paid";
  }
}

/**
 * One sentence explaining what the status MEANS, for the card body.
 *
 * The `attention` sentence is the important one and it leads with the
 * reassurance, because the failure mode being designed against is Michael
 * seeing a coloured chip and holding somebody's wages over it. Withholding
 * pay because paperwork is missing is unlawful; the sentence says so before it
 * says anything else.
 */
export function statusMeaning(status: PayRunLineStatus): string {
  switch (status) {
    case "ready":
      return "This cheque is computed and nothing is outstanding.";
    case "attention":
      return (
        "Pay this cheque — it is correct and it is legally required. There is also " +
        "something to fix, listed below, and fixing it does not change this cheque."
      );
    case "blocked":
      return (
        "No honest figure can be produced for this person, so none is shown. " +
        "Nothing is guessed and nothing is part-paid."
      );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) THE SINGLE NEXT ACTION
 * ═══════════════════════════════════════════════════════════════════════════ */

export type NextAction = {
  /** The banner heading. Short enough to read at a glance. */
  readonly headline: string;
  /** What to do, in one sentence, naming a place. Never "review the data". */
  readonly detail: string;
  /** Where to go. Null only when the action is "press the button on this page". */
  readonly href: string | null;
  /** The words on the link or button. */
  readonly cta: string;
  readonly tone: PayRunTone;
  /**
   * May money move right now?
   *
   * Drives whether the Approve control renders as a real button or as a
   * disabled one with a reason attached. It is NOT the same as
   * `result.canPay`: a run can be perfectly computable and still not approvable
   * because the period is already locked.
   */
  readonly canApprove: boolean;
};

/**
 * PRIORITY ORDER — the whole point of this function.
 *
 * Read top to bottom; the first condition that matches wins and the rest are
 * not consulted. The order is not arbitrary and each step is justified:
 *
 *   1. The load FAILED.            Nothing else on screen means anything if the
 *                                  data could not be read. A missing rate here
 *                                  is not "one employee has a problem", it is
 *                                  "no cheque in this period can be computed".
 *   2. The period is LOCKED.       Already paid. The action is to look, not to
 *                                  approve, and offering an approve button on a
 *                                  locked period invites a double payment.
 *   3. Something is BLOCKED.       A partial payroll is its own kind of wrong —
 *                                  the person left out finds out on payday — so
 *                                  one blocked line stops the whole run.
 *   4. A W-4 could not be READ.    Ranked above ordinary attention because a
 *                                  corrupted row and a missing form look
 *                                  identical on screen and are opposite
 *                                  problems. This one needs a database look,
 *                                  not a form.
 *   5. There are no EMPLOYEES.     An empty run is not a successful run.
 *   6. Something needs ATTENTION.  Payable, so this is an approve-and-then-fix,
 *                                  and the wording says so in that order.
 *   7. Everything is READY.        Approve.
 *
 * Note what is NOT in this list: "some rates are missing but only for some
 * people". That cannot happen — rates are per pay DATE, not per employee, so a
 * missing rate is always case 1.
 */
export function nextAction(load: PayRunLoadResult): NextAction {
  // ── 1. The load failed ──────────────────────────────────────────────────
  if (!load.ok) {
    return {
      headline: storeFailureHeadline(load.code),
      detail: `${load.message} ${load.whatToDo}`,
      href: storeFailureHref(load.code),
      cta: storeFailureCta(load.code),
      tone: "danger",
      canApprove: false,
    };
  }

  const { result, periodStatus, unreadableW4EmployeeIds, periodLabel } = load;

  // ── 2. Already paid ─────────────────────────────────────────────────────
  if (periodStatus === "locked") {
    return {
      headline: "This pay period is closed",
      detail:
        `${periodLabel} has been paid and locked, so nothing here can be changed. ` +
        "If something in it was wrong, the fix depends on how far the money has " +
        "already travelled — the recovery ladder further down this page walks " +
        "through each stage, from an unapproved run to a W-2 that has already gone out.",
      href: null,
      cta: "Read the recovery ladder",
      tone: "neutral",
      canApprove: false,
    };
  }

  // ── 3. Somebody is blocked ──────────────────────────────────────────────
  if (result.blockedCount > 0) {
    const names = blockedNames(result);
    const who =
      names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    return {
      headline:
        result.blockedCount === 1
          ? "One person cannot be paid yet, so the run is stopped"
          : `${result.blockedCount} people cannot be paid yet, so the run is stopped`,
      detail:
        `${who} ${result.blockedCount === 1 ? "has" : "have"} a problem that makes an ` +
        "honest cheque impossible, and the whole run waits rather than paying everybody " +
        "else and leaving them out. Each card below says exactly what is wrong and where " +
        "to fix it. Nothing has been written to your books.",
      href: null,
      cta: "Fix the blocked cards below",
      tone: "danger",
      canApprove: false,
    };
  }

  // ── 4. A stored W-4 could not be read ───────────────────────────────────
  if (unreadableW4EmployeeIds.length > 0) {
    return {
      headline: "A W-4 on file could not be read",
      detail:
        `${unreadableW4EmployeeIds.length} employee ` +
        `${unreadableW4EmployeeIds.length === 1 ? "record has" : "records have"} a stored W-4 ` +
        "that could not be understood. That is NOT the same as having no W-4: a missing " +
        "form is a new hire who needs to fill one in, while an unreadable row is a damaged " +
        "record. Treating the second like the first would send a real, signed election " +
        "quietly down the single-with-no-adjustments path and over-withhold that person " +
        "every cheque. Open Payroll setup → W-4 on file and re-enter the certificate from " +
        "the paper copy in the employee's file.",
      href: "/admin/books/payroll-setup",
      cta: "Open Payroll setup",
      tone: "orange",
      canApprove: false,
    };
  }

  // ── 5. Nobody in the run ────────────────────────────────────────────────
  if (result.lines.length === 0) {
    return {
      headline: "There is nobody in this pay run",
      detail:
        "No employee produced a line for this period. An empty payroll is almost never " +
        "correct — the usual cause is that timesheets have not been computed for the " +
        "period yet, so there are no hours to pay. Open Timesheets, compute the period, " +
        "then come back.",
      href: "/admin/books/timesheets",
      cta: "Open Timesheets",
      tone: "orange",
      canApprove: false,
    };
  }

  // ── 6. Payable, with something to fix ───────────────────────────────────
  if (result.attentionCount > 0) {
    return {
      headline:
        result.attentionCount === 1
          ? "Ready to approve — and one thing to fix afterwards"
          : `Ready to approve — and ${result.attentionCount} things to fix afterwards`,
      detail:
        `Every cheque in ${periodLabel} is computed and payable, totalling ` +
        `${formatCentsPlain(result.totalNetPayCents)} in net pay. ` +
        `${result.attentionCount === 1 ? "One line has" : `${result.attentionCount} lines have`} ` +
        "a paperwork problem marked in gold below. None of them makes a cheque wrong and " +
        "none of them is a reason to hold anybody's pay. Approve the run, then work the " +
        "gold cards.",
      href: null,
      cta: "Approve this pay run",
      tone: "gold",
      canApprove: true,
    };
  }

  // ── 7. Clean ────────────────────────────────────────────────────────────
  return {
    headline: "This pay run is ready",
    detail:
      `All ${result.lines.length} ${result.lines.length === 1 ? "person is" : "people are"} ` +
      `computed with nothing outstanding, totalling ${formatCentsPlain(result.totalNetPayCents)} ` +
      `in net pay on ${result.payDateIso}. Approving records the run; it does not move money ` +
      "by itself.",
    href: null,
    cta: "Approve this pay run",
    tone: "green",
    canApprove: true,
  };
}

/** The employees who cannot be paid, by name, in the order the run produced them. */
export function blockedNames(result: PayRunResult): readonly string[] {
  return result.lines.filter((l) => l.status === "blocked").map((l) => l.employeeName);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) STORE FAILURES, TRANSLATED
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A heading for each way the read can fail.
 *
 * Written as four separate sentences rather than one generic "could not load"
 * because these four have four different fixes, and a shared heading would
 * send Michael looking in the wrong place three times out of four.
 *
 * The `switch` is exhaustive over the union with no `default`, so adding a
 * fifth failure code is a compile error here rather than a silent fall-through
 * to a vague banner (standing rule 62d — never invent a default).
 */
export function storeFailureHeadline(code: PayRunStoreFailureCode): string {
  switch (code) {
    case "NOT_CONFIGURED":
      return "This server has no database connection";
    case "READ_FAILED":
      return "The pay run could not be read";
    case "NO_SUCH_PERIOD":
      return "That pay period does not exist";
    case "RATES_NOT_ON_FILE":
      return "A rate this pay date needs is not on file yet";
  }
}

/** Where to go for each failure. Null when there is nowhere useful to send him. */
export function storeFailureHref(code: PayRunStoreFailureCode): string | null {
  switch (code) {
    case "NOT_CONFIGURED":
      return null;
    case "READ_FAILED":
      return null;
    case "NO_SUCH_PERIOD":
      return "/admin/books/timesheets";
    case "RATES_NOT_ON_FILE":
      return "/admin/books/payroll-setup";
  }
}

export function storeFailureCta(code: PayRunStoreFailureCode): string {
  switch (code) {
    case "NOT_CONFIGURED":
      return "Nothing to do here";
    case "READ_FAILED":
      return "Try again";
    case "NO_SUCH_PERIOD":
      return "Pick a pay period";
    case "RATES_NOT_ON_FILE":
      return "Open Payroll setup";
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4) THE PRE-FLIGHT CHECKLIST
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A checklist row: the mentor's question, plus whether THIS run answers it.
 *
 * `answered` is deliberately a three-way value and not a boolean.
 *
 * Some of the seven checks can be settled by looking at the run — if every line
 * computed, the rates are plainly on file. Others cannot be settled by software
 * at all. Nothing in this database can tell whether Michael has read three
 * cheques end to end, and a tick box that claims he has is a lie the screen
 * tells on his behalf. Those rows render as "you have to confirm this one" and
 * are never auto-ticked.
 *
 * This matters more than it looks. A checklist that ticks itself is a checklist
 * nobody reads, and its ticks are worth nothing in an audit.
 */
export type ChecklistAnswer = "yes" | "no" | "you-must-confirm";

export type ChecklistRow = {
  readonly check: PayRunCheck;
  readonly answered: ChecklistAnswer;
  /** What the run actually shows for this question. Never blank. */
  readonly evidence: string;
  readonly tone: PayRunTone;
};

/**
 * Build the checklist for a loaded run.
 *
 * Pure. Takes the load result rather than reaching for it, so a test can pin
 * every row against a hand-built run.
 */
export function checklistFor(load: PayRunLoadResult): readonly ChecklistRow[] {
  const ordered = [...PAY_RUN_CHECKS].sort((a, b) => a.order - b.order);
  return ordered.map((check) => {
    const { answered, evidence } = answerFor(check, load);
    return {
      check,
      answered,
      evidence,
      tone: answered === "yes" ? "green" : answered === "no" ? "danger" : "gold",
    };
  });
}

function answerFor(
  check: PayRunCheck,
  load: PayRunLoadResult,
): { answered: ChecklistAnswer; evidence: string } {
  // Every check is unanswerable when the read itself failed. Saying "no" to
  // all seven would be misleading — we do not know that they are wrong, we know
  // that we cannot see.
  if (!load.ok) {
    return {
      answered: "no",
      evidence:
        "This run could not be read, so this question cannot be answered yet. " +
        "Clear the problem at the top of the page first.",
    };
  }

  const { result, unreadableW4EmployeeIds } = load;

  switch (check.key) {
    case "rates-on-file":
      // If the store had found a missing rate it would have refused the whole
      // read, so reaching here with ok:true IS the evidence.
      return {
        answered: "yes",
        evidence:
          `Every rate needed for ${result.payDateIso} has an evidenced row covering that ` +
          "date. The run would have refused to load otherwise, rather than reusing last " +
          "year's figure.",
      };

    case "punches-clean": {
      const noHours = countRefusal(result, "NO_HOURS");
      return noHours === 0
        ? {
            answered: "yes",
            evidence: "Every person in this run produced payable hours from their punches.",
          }
        : {
            answered: "no",
            evidence:
              `${noHours} ${noHours === 1 ? "person has" : "people have"} no usable hours. ` +
              "The usual cause is an open punch — somebody clocked in and never clocked out.",
          };
    }

    case "w4-on-file": {
      const defaulted = result.lines.filter(
        (l) => l.w4Provenance !== "furnished",
      ).length;
      if (unreadableW4EmployeeIds.length > 0) {
        return {
          answered: "no",
          evidence:
            `${unreadableW4EmployeeIds.length} stored W-4 ` +
            `${unreadableW4EmployeeIds.length === 1 ? "row" : "rows"} could not be read. ` +
            "That is a damaged record, not a missing form, and it needs re-entering from " +
            "the paper copy.",
        };
      }
      return defaulted === 0
        ? {
            answered: "yes",
            evidence: "Everybody in this run has a signed W-4 and it was used as written.",
          }
        : {
            answered: "no",
            evidence:
              `${defaulted} ${defaulted === 1 ? "person is" : "people are"} being withheld as ` +
              "single with no adjustments because no signed W-4 is on file. That is the " +
              "lawful treatment and those cheques are correct — but it is usually more tax " +
              "than the person would have chosen, so chase the form.",
          };
    }

    case "pay-frequency-right": {
      const wrong = countRefusal(result, "NO_PAY_FREQUENCY");
      return wrong === 0
        ? {
            answered: "yes",
            evidence:
              "Every person has a pay frequency, which is what tells the withholding tables " +
              "how much of the year this cheque represents.",
          }
        : {
            answered: "no",
            evidence: `${wrong} ${wrong === 1 ? "person has" : "people have"} no pay frequency set.`,
          };
    }

    case "orders-current":
      return result.totalGarnishedCents > 0
        ? {
            answered: "you-must-confirm",
            evidence:
              `${formatCentsPlain(result.totalGarnishedCents)} is being withheld under court ` +
              "or agency orders in this run. The software applies every order on file and " +
              "caps it correctly, but it cannot know that an order was released or that a " +
              "new envelope is sitting unopened on your desk. Check the post.",
          }
        : {
            answered: "you-must-confirm",
            evidence:
              "No garnishment is being withheld in this run. That is only correct if no " +
              "order is in force — the software cannot see an envelope that was never " +
              "entered. Confirm nothing has arrived.",
          };

    case "ytd-carried-in":
      return {
        answered: "you-must-confirm",
        evidence:
          "Year-to-date figures decide when Social Security stops and when Additional " +
          "Medicare starts, so a wrong opening balance is wrong for the rest of the year " +
          "and shows up on the W-2. For the first run after a conversion, this is the " +
          "single highest-value thing to check by hand against Sage.",
      };

    case "read-three-cheques":
      return {
        answered: "you-must-confirm",
        evidence:
          "Nothing in this system can tick this one for you, and it will not pretend to. " +
          "Pick three people — ideally one hourly, one with overtime, one with a " +
          "garnishment — and read their cheques line by line before you approve.",
      };
  }
}

/** How many lines were blocked by a particular refusal code. */
export function countRefusal(result: PayRunResult, code: PayRunRefusalCode): number {
  return result.lines.filter((l) => l.refusals.some((r) => r.code === code)).length;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 5) PER-EMPLOYEE CARDS
 * ═══════════════════════════════════════════════════════════════════════════ */

export type CardProblem = {
  /** What is wrong, in one line. */
  readonly headline: string;
  /** Why the software stops or speaks up rather than carrying on. */
  readonly why: string;
  /** The exact next thing to do. Never "check your configuration". */
  readonly whatToDo: string;
  /** What guessing would have cost. Empty when there is nothing to add. */
  readonly costOfGuessing: string;
  readonly tone: PayRunTone;
};

export type EmployeeCard = {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly status: PayRunLineStatus;
  readonly tone: PayRunTone;
  readonly statusLabel: string;
  readonly statusMeaning: string;
  /** "$1,234.56", or null when nothing can honestly be shown. */
  readonly netPay: string | null;
  readonly grossWages: string | null;
  readonly garnished: string | null;
  /** How this person's withholding was decided, in Michael's words. */
  readonly w4Headline: string;
  readonly w4WhatItMeans: string;
  readonly w4WhatToDo: string;
  /** Blockers first, then attention notes, then engine commentary. */
  readonly problems: readonly CardProblem[];
  /** The gross-to-net walk, when there is one. */
  readonly explanation: readonly string[];
};

/**
 * One employee's card.
 *
 * ORDERING IS LOAD-BEARING. `problems` puts refusals first, then attention
 * notes, then engine commentary, because that is descending order of "will
 * this stop me being paid". A card that led with "L&I rate note" and buried
 * "this person has no hours" underneath would be technically complete and
 * practically useless.
 *
 * MONEY IS NULL WHEN BLOCKED, NEVER ZERO. `$0.00` is a number Michael could
 * read as a real cheque for nothing; null renders as a dash and a sentence.
 * This is the same reasoning `readRate` uses when it refuses to substitute `0`
 * for a missing rate.
 */
export function employeeCard(line: PayRunLine): EmployeeCard {
  const problems: CardProblem[] = [];

  for (const refusal of line.refusals) {
    const lesson = payRunRefusalLesson(refusal.code);
    problems.push({
      headline: lesson?.headline ?? refusal.message,
      why: lesson?.whyWeStop ?? "",
      // The refusal's own `whatToDo` wins over the lesson's. The refusal was
      // built from THIS run and can name this employee and this period; the
      // lesson is written once for everybody.
      whatToDo: refusal.whatToDo || (lesson?.whatToDo ?? ""),
      costOfGuessing: lesson?.costOfGuessing ?? "",
      tone: "danger",
    });
  }

  for (const note of line.attentionNotes) {
    problems.push({
      headline: note,
      why:
        "This does not make the cheque wrong and it is not a reason to hold anybody's " +
        "pay. It is something to put right.",
      whatToDo: "",
      costOfGuessing: "",
      tone: "gold",
    });
  }

  for (const note of line.engineNotes) {
    problems.push({
      headline: note,
      why: "Reported by the calculation for the record.",
      whatToDo: "",
      costOfGuessing: "",
      tone: "neutral",
    });
  }

  const w4 = w4ProvenanceLesson(line.w4Provenance);

  return {
    employeeId: line.employeeId,
    employeeName: line.employeeName,
    status: line.status,
    tone: statusTone(line.status),
    statusLabel: statusLabel(line.status),
    statusMeaning: statusMeaning(line.status),
    netPay: line.netPayCents === null ? null : formatCentsPlain(line.netPayCents),
    grossWages:
      line.grossWagesCents === null ? null : formatCentsPlain(line.grossWagesCents),
    garnished:
      line.totalGarnishedCents > 0 ? formatCentsPlain(line.totalGarnishedCents) : null,
    w4Headline: w4?.headline ?? describeProvenanceFallback(line.w4Provenance),
    w4WhatItMeans: w4?.whatItMeans ?? "",
    w4WhatToDo: w4?.whatToDo ?? "",
    problems,
    explanation: line.breakdown?.explanation ?? [],
  };
}

/**
 * Used only if a provenance ever exists with no lesson written for it.
 *
 * There is a gate (`assertEveryW4ProvenanceIsTaught`) that makes that state a
 * failing test, so this should be unreachable. It exists anyway because the
 * alternative when a lesson is missing is rendering an empty heading, and a
 * blank space on a payroll screen is indistinguishable from "nothing to say".
 */
function describeProvenanceFallback(p: W4Provenance): string {
  return `Withholding basis: ${p.replace(/_/g, " ")}`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 6) THE MONEY SUMMARY
 * ═══════════════════════════════════════════════════════════════════════════ */

export type MoneyRow = {
  readonly label: string;
  readonly amount: string;
  /** Why this number is what it is. Shown small, under the figure. */
  readonly note: string;
};

/**
 * The three totals, each with the sentence that stops it being misread.
 *
 * The net-pay note is the one that matters. `totalNetPayCents` sums only the
 * lines that can actually be paid, so on a run with a blocked line it is NOT
 * what will leave the bank when the blockage clears. Showing that figure
 * without saying so is how a cash position gets planned against a number that
 * was never going to be the number.
 */
export function moneyRows(result: PayRunResult): readonly MoneyRow[] {
  const partial = result.blockedCount > 0;
  return [
    {
      label: "Gross wages",
      amount: formatCentsPlain(result.totalGrossWagesCents),
      note: partial
        ? "Covers only the lines that computed. The blocked people are not in this figure."
        : "Everything earned this period, before anything comes off.",
    },
    {
      label: "Withheld under orders",
      amount: formatCentsPlain(result.totalGarnishedCents),
      note:
        result.totalGarnishedCents > 0
          ? "Taken under court or agency orders and capped at the legal ceiling."
          : "No garnishment applied in this run.",
    },
    {
      label: "Net pay",
      amount: formatCentsPlain(result.totalNetPayCents),
      note: partial
        ? `This is NOT the full cost of the period. ${result.blockedCount} ` +
          `${result.blockedCount === 1 ? "person is" : "people are"} blocked and excluded, so ` +
          "the real total will be higher once they are fixed. Do not plan your cash against " +
          "this figure."
        : "The total that will reach your employees.",
    },
  ];
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 7) COUNTS FOR THE HEADER
 * ═══════════════════════════════════════════════════════════════════════════ */

export type StatusCount = {
  readonly status: PayRunLineStatus;
  readonly label: string;
  readonly count: number;
  readonly tone: PayRunTone;
};

/**
 * The three counts, ALWAYS all three, even when a count is zero.
 *
 * Hiding a zero would be a mistake here. "0 cannot be paid" is one of the most
 * reassuring things this screen can say, and it can only say it by being
 * present. A row that appears only when there is bad news trains the reader to
 * scan for its absence, which is a slower and less reliable read than a number.
 */
export function statusCounts(result: PayRunResult): readonly StatusCount[] {
  return [
    {
      status: "ready",
      label: statusLabel("ready"),
      count: result.readyCount,
      tone: statusTone("ready"),
    },
    {
      status: "attention",
      label: statusLabel("attention"),
      count: result.attentionCount,
      tone: statusTone("attention"),
    },
    {
      status: "blocked",
      label: statusLabel("blocked"),
      count: result.blockedCount,
      tone: statusTone("blocked"),
    },
  ];
}
