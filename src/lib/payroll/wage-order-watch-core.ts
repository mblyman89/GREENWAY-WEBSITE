/**
 * wage-order-watch-core.ts   (books-40c - "the watchman")
 *
 * THE DEADLINE THAT NOBODY IS WATCHING.
 *
 * books-38 built two genuinely good pieces of arithmetic in
 * wage-order-entry-core.ts:
 *
 *   answerDeadlineFor()  - RCW 26.18.110(1), twenty days from SERVICE
 *   expiryOutlookFor()   - RCW 6.27.350(1), sixty days from the effective date
 *
 * Both are correct, both are statute-cited, and until this file existed both
 * were imported by exactly ONE module: WageOrderEntryForm.tsx. That means the
 * twenty-day clock and the sixty-day clock were computed while Michael typed a
 * new order, displayed for about thirty seconds, and then never evaluated
 * again for the entire life of the order. A deadline that is calculated once,
 * at the moment it is furthest away, and never re-checked is not a safeguard.
 * It is a decoration. (Standing rule 50: dead code wearing a green check.)
 *
 * This module is the missing half. It does NOT re-derive twenty or sixty --
 * re-deriving them would create a second copy of a legal rule that could drift
 * away from the first, which is exactly what standing rule 25 forbids. It
 * IMPORTS the existing functions and turns their output into a schedule of
 * escalating alerts that something else can act on every single day.
 *
 * ---------------------------------------------------------------------------
 * WHY AN ESCALATION LADDER AND NOT ONE FLAT ALERT
 * ---------------------------------------------------------------------------
 * A single "this is due" email has two failure modes and hits both. Sent early
 * it is forgotten; sent late it is useless. Worse, an alert that looks the same
 * on day 1 as it does on day 19 teaches the reader that the alert carries no
 * information, and a person who has learned to ignore an alert is in a WORSE
 * position than one who never had it, because he now believes something is
 * watching for him.
 *
 * So severity climbs as the runway shortens, and the wording changes with it:
 *
 *   day 0-9   quiet     - nothing. There is real time; noise here is what
 *                         destroys the credibility of the noise later.
 *   T-10      info      - "start this"
 *   T-5       warning   - "this needs to happen this week"
 *   T-2       critical  - "this needs to happen now"
 *   due day   critical  - "today is the last day"
 *   overdue   critical  - EVERY DAY, FOREVER
 *
 * The overdue rung never stops, and that is deliberate. Under
 * RCW 26.18.110(6)(b) the employer who fails to answer can be held liable for
 * one hundred percent of the support debt, plus costs, interest and the other
 * side's attorney fees. That exposure does not shrink with time and it is not
 * cured by withholding correctly. A reminder that gave up after a week would
 * be silent during precisely the period when the liability is largest.
 *
 * ---------------------------------------------------------------------------
 * WHY CREDITOR WRITS GET NO DUE DATE (AND STILL GET WATCHED)
 * ---------------------------------------------------------------------------
 * answerDeadlineFor() returns dueDate: null for creditor and consumer-debt
 * writs on purpose. RCW 6.27.200 measures that deadline as "the time
 * prescribed in the writ" -- it is printed on the paper and it is not always
 * twenty days. Inventing one would be inventing a default (rule 62d) about the
 * date on which a default judgment for somebody else's entire debt becomes
 * available against Greenway.
 *
 * This module honours that refusal absolutely: it NEVER manufactures a due
 * date the statute did not give it. But refusing to guess is not the same as
 * staying silent. A writ with an unknown deadline is MORE dangerous than one
 * with a known deadline, not less. So instead of a countdown it raises a
 * one-time "read the writ and diary the date" alert a few days after service,
 * which is an instruction Michael can actually complete.
 *
 * ---------------------------------------------------------------------------
 * THE OTHER DIRECTION: WITHHOLDING TOO LONG
 * ---------------------------------------------------------------------------
 * Every alert above is about not doing something in time. The sixty-day lien
 * is the opposite failure, and it is the one nobody expects. When a creditor
 * writ expires, the authority to take money from that paycheck expires with
 * it. Keep withholding and Greenway is no longer garnishing wages -- it is
 * simply taking them. RCW 49.52.050 treats wilful withholding of wages as a
 * misdemeanour and RCW 49.52.070 makes the offender liable for TWICE the
 * amount withheld, plus costs and attorney fees, and it reaches officers
 * personally. So expiry gets its own warnings at T-10 and T-3, and a critical
 * alert the moment the lien is past its last possible day.
 *
 * ---------------------------------------------------------------------------
 * PURITY
 * ---------------------------------------------------------------------------
 * Zero I/O. `today` is always an ARGUMENT, never the system clock, so every
 * rung of every ladder is reachable in a test by simply passing the date. The
 * only imports are the two pure cores this module deliberately reuses, so this
 * file is safe to import from a "use client" component AND from the server-only
 * reminder engine -- one arithmetic, two surfaces, no second copy.
 */
import type { WageOrderKind } from "@/lib/payroll/garnishment-core";
import {
  answerDeadlineFor,
  expiryOutlookFor,
  isSupportOrder,
  SUPPORT_ANSWER_DAYS,
} from "@/lib/payroll/wage-order-entry-core";

/** Deep-link target for every alert this module raises. */
export const GARNISHMENTS_PATH = "/admin/books/garnishments";

/**
 * Days after service at which an un-diarised creditor writ is flagged.
 *
 * Not a statutory number and never presented as one. It is a working habit:
 * three days is long enough that a writ served on Friday is not shouting on
 * Saturday, and short enough that even the shortest realistic return date on
 * the writ has not passed unnoticed.
 */
export const CREDITOR_DIARY_PROMPT_DAYS = 3;

/** The rungs of the answer ladder, in days remaining. */
export const ANSWER_INFO_DAYS = 10;
export const ANSWER_WARNING_DAYS = 5;
export const ANSWER_CRITICAL_DAYS = 2;

/** The rungs of the expiry ladder, in days remaining. */
export const EXPIRY_WARNING_DAYS = 10;
export const EXPIRY_CRITICAL_DAYS = 3;

export type WatchSeverity = "info" | "warning" | "critical";

/**
 * Every alert kind this module can raise. A closed union rather than a free
 * string so that a typo becomes a compile error, and so the mentor/report
 * gates can prove every kind is explained somewhere.
 */
export type WageOrderAlertKind =
  | "answer_due_soon"
  | "answer_due_today"
  | "answer_overdue"
  | "answer_deadline_unknown"
  | "lien_expiring"
  | "lien_expired";

export type WageOrderAlert = {
  readonly kind: WageOrderAlertKind;
  readonly severity: WatchSeverity;
  /** The order this is about, so a caller can link straight to it. */
  readonly wageOrderId: string;
  readonly caseNumber: string;
  readonly employeeName: string;
  /** Days remaining; negative once past. Null when no date is computable. */
  readonly daysRemaining: number | null;
  /** The ISO date in question, when there is one. */
  readonly dueDate: string | null;
  /** One line. What is happening. */
  readonly headline: string;
  /** What goes wrong if this is ignored. Never just the date. */
  readonly consequence: string;
  /** The next physical action. Must be completable today. */
  readonly whatToDoNow: string;
  /** The statute behind it, as an id the authority registry can resolve. */
  readonly authorityId: string;
};

/**
 * The facts about one wage order that the watchman needs.
 *
 * Deliberately a flat, primitive-only shape rather than the full WageOrder
 * row: it is built once by the store and consumed by both the board and the
 * cron, and keeping it narrow means neither surface can accidentally depend on
 * a column the other does not load.
 */
export type WageOrderWatchFacts = {
  readonly id: string;
  readonly caseNumber: string;
  readonly employeeName: string;
  readonly orderKind: WageOrderKind;
  /** ISO date of SERVICE. Null when it was never recorded. */
  readonly servedDate: string | null;
  /** ISO date withholding starts from. Null when unknown. */
  readonly effectiveFrom: string | null;
  readonly status: "active" | "suspended" | "terminated";
  /** ISO date the answer was filed, or null if it has not been. */
  readonly answerFiledAt: string | null;
  /** True when this order genuinely has no answer duty (tax levies). */
  readonly answerNotRequired: boolean;
};

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A date we are willing to do arithmetic on. Anything else is unknown. */
function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO_DATE_RE.test(v);
}

/**
 * Does this order carry an answer duty at all?
 *
 * Support orders (ch. 26.18) and creditor/consumer writs (ch. 6.27) do.
 * Federal and state tax levies do NOT -- an IRS Form 668-W is satisfied by
 * returning the exemption certificate and beginning to withhold, not by a
 * sworn affidavit to a Washington court. Student-loan administrative wage
 * garnishments likewise run under their own federal procedure.
 *
 * This is a statement about the LAW, which is why it lives next to the
 * arithmetic and not in a UI file where it could quietly diverge.
 */
export function hasAnswerDuty(kind: WageOrderKind): boolean {
  return (
    isSupportOrder(kind) || kind === "creditor" || kind === "consumer_debt"
  );
}

/**
 * Assess ONE wage order as of `today`, returning every alert it currently
 * deserves -- most severe first.
 *
 * Returns an empty array in the ordinary case, which is the whole point: a
 * watchman that says something every day is a watchman nobody listens to.
 */
export function assessWageOrder(
  facts: WageOrderWatchFacts,
  today: string,
): WageOrderAlert[] {
  const alerts: WageOrderAlert[] = [];

  // A malformed clock cannot be reasoned about. Refuse to plan rather than
  // produce alerts measured from a date that does not exist (rule 1).
  if (!isIsoDate(today)) return alerts;

  // A terminated order is finished. Its deadlines are history, and nagging
  // about them would be pure noise.
  if (facts.status === "terminated") return alerts;

  alerts.push(...assessAnswer(facts, today));
  alerts.push(...assessExpiry(facts, today));

  return sortBySeverity(alerts);
}

/** The answer ladder. */
function assessAnswer(
  facts: WageOrderWatchFacts,
  today: string,
): WageOrderAlert[] {
  // Already answered, or genuinely exempt: the duty is discharged. This is the
  // OFF SWITCH, and it is the reason migration 0202 exists. Without a way to
  // record that the answer was filed, everything below would nag forever and
  // would be muted within a week.
  if (facts.answerFiledAt !== null || facts.answerNotRequired) return [];

  // No answer duty under either chapter -- nothing to remind about.
  if (!hasAnswerDuty(facts.orderKind)) return [];

  // Never served, or service never recorded. We cannot compute a deadline
  // from a date we do not have, and we will not invent one. But an order
  // sitting here with no service date is itself a problem worth surfacing:
  // the twenty-day clock may already be running in the real world while this
  // system believes there is nothing to measure.
  if (!isIsoDate(facts.servedDate)) {
    return [
      {
        kind: "answer_deadline_unknown",
        severity: "warning",
        wageOrderId: facts.id,
        caseNumber: facts.caseNumber,
        employeeName: facts.employeeName,
        daysRemaining: null,
        dueDate: null,
        headline: `No service date recorded for case ${facts.caseNumber}, so no answer deadline can be calculated.`,
        consequence:
          "The answer deadline runs from the date the order was SERVED on Greenway. With that " +
          "date missing, this system cannot tell you when the answer is due - and the clock is " +
          "running anyway. Nothing here will warn you, because there is nothing to measure from.",
        whatToDoNow:
          "Find the delivery receipt, the envelope, or the process server's note, read the date " +
          "Greenway actually received it, and record it on the order. Do not use the date the " +
          "court signed it - that is a different and usually earlier date.",
        authorityId: "wage-order-rcw-26-18-110-answer",
      },
    ];
  }

  // REUSE. The twenty is not written here; it comes from books-38.
  const deadline = answerDeadlineFor(facts.orderKind, facts.servedDate, today);

  // Creditor / consumer writ: the statute points at the paper, so we do too.
  if (deadline.dueDate === null) {
    const sinceService = daysSince(facts.servedDate, today);
    if (sinceService < CREDITOR_DIARY_PROMPT_DAYS) return [];
    return [
      {
        kind: "answer_deadline_unknown",
        severity: "warning",
        wageOrderId: facts.id,
        caseNumber: facts.caseNumber,
        employeeName: facts.employeeName,
        daysRemaining: null,
        dueDate: null,
        headline: `Case ${facts.caseNumber}: the answer deadline is printed on the writ, and this system will not guess it.`,
        consequence: deadline.whatHappensIfMissed,
        whatToDoNow:
          "Take the writ out and read the return date off it. RCW 6.27.200 sets the deadline as " +
          '"the time prescribed in the writ", which is not always twenty days. Put that date in ' +
          "your calendar today, then answer it and record the answer here so this stops asking.",
        authorityId: deadline.authorityId,
      },
    ];
  }

  const left = deadline.daysRemaining ?? 0;

  // Overdue. Fires every day, forever, and says why it will not stop.
  if (left < 0) {
    const late = Math.abs(left);
    return [
      {
        kind: "answer_overdue",
        severity: "critical",
        wageOrderId: facts.id,
        caseNumber: facts.caseNumber,
        employeeName: facts.employeeName,
        daysRemaining: left,
        dueDate: deadline.dueDate,
        headline: `OVERDUE by ${late} day${late === 1 ? "" : "s"}: the answer for case ${facts.caseNumber} was due ${deadline.dueDate}.`,
        consequence: deadline.whatHappensIfMissed,
        whatToDoNow:
          "File the answer today. Late is far better than never - the exposure does not shrink " +
          "on its own, and filing now limits the argument that Greenway ignored the order. Send " +
          "the sworn affidavit to the address on the order, keep proof of the date you sent it, " +
          "then record it here so this alert stops.",
        authorityId: deadline.authorityId,
      },
    ];
  }

  // Due today.
  if (left === 0) {
    return [
      {
        kind: "answer_due_today",
        severity: "critical",
        wageOrderId: facts.id,
        caseNumber: facts.caseNumber,
        employeeName: facts.employeeName,
        daysRemaining: 0,
        dueDate: deadline.dueDate,
        headline: `TODAY is the last day to answer case ${facts.caseNumber}.`,
        consequence: deadline.whatHappensIfMissed,
        whatToDoNow:
          "Complete and send the sworn answer today. It states whether this person works at " +
          "Greenway, whether Greenway will honour the order, and whether any other support " +
          "attachment is already running against them. Then record it here.",
        authorityId: deadline.authorityId,
      },
    ];
  }

  // Approaching. Quiet until T-10, then climbing.
  if (left > ANSWER_INFO_DAYS) return [];

  const severity: WatchSeverity =
    left <= ANSWER_CRITICAL_DAYS
      ? "critical"
      : left <= ANSWER_WARNING_DAYS
        ? "warning"
        : "info";

  return [
    {
      kind: "answer_due_soon",
      severity,
      wageOrderId: facts.id,
      caseNumber: facts.caseNumber,
      employeeName: facts.employeeName,
      daysRemaining: left,
      dueDate: deadline.dueDate,
      headline: `${left} day${left === 1 ? "" : "s"} left to answer case ${facts.caseNumber} (due ${deadline.dueDate}).`,
      consequence: deadline.whatHappensIfMissed,
      whatToDoNow:
        `Served ${facts.servedDate}, so RCW 26.18.110(1) gives ${SUPPORT_ANSWER_DAYS} days. ` +
        "Complete the sworn answer, send it to the address on the order, keep proof of the " +
        "date, and record it here so these reminders stop.",
      authorityId: deadline.authorityId,
    },
  ];
}

/** The expiry ladder - the mistake that runs the other way. */
function assessExpiry(
  facts: WageOrderWatchFacts,
  today: string,
): WageOrderAlert[] {
  // Nothing is being withheld under a suspended order, so it cannot be
  // over-withheld. The answer duty above still applies; this does not.
  if (facts.status !== "active") return [];
  if (!isIsoDate(facts.effectiveFrom)) return [];

  // REUSE. The sixty is not written here either.
  const outlook = expiryOutlookFor(facts.orderKind, facts.effectiveFrom);
  if (!outlook.expires || !isIsoDate(outlook.latestPossibleEnd)) return [];

  const left = daysSince(today, outlook.latestPossibleEnd);

  if (left < 0) {
    const over = Math.abs(left);
    return [
      {
        kind: "lien_expired",
        severity: "critical",
        wageOrderId: facts.id,
        caseNumber: facts.caseNumber,
        employeeName: facts.employeeName,
        daysRemaining: left,
        dueDate: outlook.latestPossibleEnd,
        headline: `EXPIRED ${over} day${over === 1 ? "" : "s"} ago: the lien on case ${facts.caseNumber} ended ${outlook.latestPossibleEnd}.`,
        consequence:
          "The authority to take money from this paycheck has run out. Money withheld after the " +
          "lien expires is not garnished - it is simply taken. RCW 49.52.050 makes wilful " +
          "withholding of wages a misdemeanour and RCW 49.52.070 makes the offender liable for " +
          "TWICE the amount withheld plus costs and attorney fees, and it reaches officers " +
          "personally rather than stopping at the company.",
        whatToDoNow:
          "Stop withholding on this order before the next payroll runs. Terminate it here with a " +
          "note saying the sixty-day lien expired. If anything was withheld after " +
          `${outlook.latestPossibleEnd}, work out how much and return it to the employee.`,
        authorityId: outlook.authorityId,
      },
    ];
  }

  if (left > EXPIRY_WARNING_DAYS) return [];

  return [
    {
      kind: "lien_expiring",
      severity: left <= EXPIRY_CRITICAL_DAYS ? "critical" : "warning",
      wageOrderId: facts.id,
      caseNumber: facts.caseNumber,
      employeeName: facts.employeeName,
      daysRemaining: left,
      dueDate: outlook.latestPossibleEnd,
      headline: `Case ${facts.caseNumber}: this lien can run for at most ${left} more day${left === 1 ? "" : "s"} (ends ${outlook.latestPossibleEnd}).`,
      consequence:
        "Once the sixty days are up the authority to withhold is gone. Continuing to deduct " +
        "after that is taking wages without authority, which carries double damages plus costs " +
        "and attorney fees under RCW 49.52.070 and reaches officers personally.",
      whatToDoNow:
        "Check which payroll period is the last one ending on or before " +
        `${outlook.latestPossibleEnd}, make that the final deduction, and terminate the order ` +
        "here afterwards. Also stop early if the writ amount is collected, the employee leaves, " +
        "or the judgment is satisfied, vacated or dismissed.",
      authorityId: outlook.authorityId,
    },
  ];
}

const SEVERITY_RANK: Record<WatchSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * Most severe first, then soonest first.
 *
 * A stable, total ordering matters: the board renders this list top-down, and
 * a critical alert that sorts below an informational one is a critical alert
 * that gets scrolled past.
 */
function sortBySeverity(alerts: WageOrderAlert[]): WageOrderAlert[] {
  return [...alerts].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const ad = a.daysRemaining ?? Number.MAX_SAFE_INTEGER;
    const bd = b.daysRemaining ?? Number.MAX_SAFE_INTEGER;
    if (ad !== bd) return ad - bd;
    return a.caseNumber.localeCompare(b.caseNumber);
  });
}

/** Whole days from `fromIso` to `toIso`. Both arguments; no clock. */
function daysSince(fromIso: string, toIso: string): number {
  const a = Date.UTC(
    Number.parseInt(fromIso.slice(0, 4), 10),
    Number.parseInt(fromIso.slice(5, 7), 10) - 1,
    Number.parseInt(fromIso.slice(8, 10), 10),
  );
  const b = Date.UTC(
    Number.parseInt(toIso.slice(0, 4), 10),
    Number.parseInt(toIso.slice(5, 7), 10) - 1,
    Number.parseInt(toIso.slice(8, 10), 10),
  );
  return Math.round((b - a) / 86_400_000);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE PLANNER - what the reminder engine consumes
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One planned reminder, in the exact shape
 * src/lib/notifications/compliance-reminders.ts already normalises.
 *
 * Mirrors PosExceptionReminder deliberately, so the engine's fourth planner
 * block looks like its third and nobody has to learn a new contract.
 */
export type WageOrderReminder = {
  dedupeKey: string;
  stage: string;
  weekKey: null;
  subject: string;
  body: string;
  urgency: WatchSeverity;
  linkPath: string;
  linkLabel: string;
  footnote: string;
};

/**
 * How many alerts of one kind we will name individually in an email before
 * switching to a summary. Past this the message stops being readable, and an
 * unreadable email is an unread email.
 */
export const MAX_NAMED_IN_BODY = 5;

/**
 * Turn today's alerts across ALL orders into reminders the engine can send.
 *
 * DEDUPE STRATEGY, which is the whole difference between a useful reminder and
 * a muted one. compliance_reminder_log has a UNIQUE constraint on dedupe_key,
 * so the key decides the cadence:
 *
 *   - Critical alerts get the DAY in the key, so they re-fire every single day
 *     until the underlying fact changes. That is correct for an unfiled answer
 *     and for an expired lien; both are live, growing liabilities.
 *   - Info and warning alerts get the ORDER and the RUNG in the key, so each
 *     step of the ladder announces itself exactly once. Michael is told at
 *     T-10 and told again at T-5 because the message genuinely changed - he is
 *     not told the same thing ten mornings in a row.
 *
 * One reminder per severity band rather than per order, so five orders due the
 * same week produce one email listing five cases instead of five emails.
 */
export function planWageOrderReminders(
  todayIso: string,
  orders: readonly WageOrderWatchFacts[],
): WageOrderReminder[] {
  if (!isIsoDate(todayIso)) return [];
  if (!Array.isArray(orders) || orders.length === 0) return [];

  const alerts: WageOrderAlert[] = [];
  for (const o of orders) alerts.push(...assessWageOrder(o, todayIso));
  if (alerts.length === 0) return [];

  const out: WageOrderReminder[] = [];

  const critical = alerts.filter((a) => a.severity === "critical");
  if (critical.length > 0) {
    out.push(
      buildReminder(
        `wage-order-watch:critical:${todayIso}`,
        "wage_order_watch_critical",
        "critical",
        critical,
        todayIso,
      ),
    );
  }

  // Non-critical rungs announce once each. The key carries the order id and
  // the alert kind, so moving from info to warning is a NEW key and sends.
  const quieter = alerts.filter((a) => a.severity !== "critical");
  for (const a of quieter) {
    out.push(
      buildReminder(
        `wage-order-watch:${a.kind}:${a.wageOrderId}:${a.severity}`,
        `wage_order_watch_${a.kind}`,
        a.severity,
        [a],
        todayIso,
      ),
    );
  }

  return out;
}

function buildReminder(
  dedupeKey: string,
  stage: string,
  urgency: WatchSeverity,
  alerts: readonly WageOrderAlert[],
  todayIso: string,
): WageOrderReminder {
  const n = alerts.length;
  const named = alerts.slice(0, MAX_NAMED_IN_BODY);
  const rest = n - named.length;

  const subject =
    n === 1
      ? subjectFor(alerts[0])
      : `${n} wage-order deadlines need attention (${urgency.toUpperCase()})`;

  const lines: string[] = [];
  for (const a of named) {
    lines.push(
      `${a.employeeName} - ${a.headline} ${a.consequence} WHAT TO DO NOW: ${a.whatToDoNow}`,
    );
  }
  if (rest > 0) {
    lines.push(
      `...and ${rest} more of the same kind. Open the Garnishments page to see all of them.`,
    );
  }

  return {
    dedupeKey,
    stage,
    weekKey: null,
    subject,
    body: lines.join("\n\n"),
    urgency,
    linkPath: GARNISHMENTS_PATH,
    linkLabel: "Open Garnishments",
    footnote:
      urgency === "critical"
        ? "This is an automated Greenway payroll reminder. It repeats EVERY DAY until the " +
          "answer is recorded or the order is terminated, because the liability it is warning " +
          "about does not expire on its own."
        : "This is an automated Greenway payroll reminder. You will get one message per stage " +
          "as the deadline approaches, not one every day.",
  };
}

function subjectFor(a: WageOrderAlert): string {
  switch (a.kind) {
    case "answer_overdue":
      return `OVERDUE: answer not filed for case ${a.caseNumber}`;
    case "answer_due_today":
      return `TODAY: answer due for case ${a.caseNumber}`;
    case "answer_due_soon":
      return `${a.daysRemaining} days to answer case ${a.caseNumber}`;
    case "answer_deadline_unknown":
      return `Read the deadline off the writ: case ${a.caseNumber}`;
    case "lien_expired":
      return `STOP WITHHOLDING: lien expired on case ${a.caseNumber}`;
    case "lien_expiring":
      return `Lien ending soon on case ${a.caseNumber}`;
  }
}

/**
 * Every alert kind, exported so tests and mentor gates can prove that each one
 * is reachable and explained rather than merely declared (rule 43).
 */
export const ALL_WAGE_ORDER_ALERT_KINDS: readonly WageOrderAlertKind[] = [
  "answer_due_soon",
  "answer_due_today",
  "answer_overdue",
  "answer_deadline_unknown",
  "lien_expiring",
  "lien_expired",
];
