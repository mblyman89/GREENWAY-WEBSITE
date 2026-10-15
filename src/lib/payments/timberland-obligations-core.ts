/**
 * src/lib/payments/timberland-obligations-core.ts  (R41 S10, PURE: no I/O, no clock)
 *
 * The Timberland communications log (migration 0277) and the obligation
 * clocks it starts, the "STOP: call Timberland" card and the fees card.
 * Every rule is quoted from the signed agreement mirror
 * (docs/authorities/ach/timberland-ach-agreement-2026-10-09.redacted.txt) or
 * Brenda's emails (timberland-brenda-2026-10.txt); the numbers come from
 * timberland-profile-core, never typed again here. Tests check each quote
 * against its mirror, whitespace-normalised.
 *
 * Strict readings (NOT legal advice; each is the earlier of two readings):
 *   - "banking days" forward (sections 5, 22) count every FedACH banking day,
 *     including the Q9 Fridays the upload deadline treats as unusable. Counting
 *     more days as banking days makes a forward deadline EARLIER.
 *   - "at least 2 banking days prior" (section 26) counts back over USABLE days
 *     only (Q9 Fridays skipped), which makes the ask-by date EARLIER.
 *   - "within 1 calendar day of verbal notice" (Schedule F) is 24 hours from
 *     the phone call, not the end of the next day.
 *   - Reversal (section 21): the earlier of 24 hours from discovery and
 *     4:00 pm Pacific (Timberland's upload cutoff) on the 5th banking day after
 *     the original settlement. Greenway's Timberland setup has NO debit files
 *     (Schedule C, $0 debit limits), so Greenway cannot send a reversal itself:
 *     the action is to phone Timberland.
 *   - NOC (section 7) says "whichever is later"; the app's apply-by date
 *     (ach-authorization-core nocApplyBy, 0258) is the EARLIER of 6 banking
 *     days and the next payment. Kept: it is never late under either reading.
 *   - Statement (section 17): 30 calendar days "after Company receives a
 *     periodic statement". The date you log is the clock's start; logging the
 *     statement date (never later than receipt) is never late.
 */
import { addBankingDays, addCalendarDays } from "@/lib/payments/ach-authorization-core";
import { subUsableDays } from "@/lib/payments/timberland-deadline-core";
import {
  ACCOUNT_LAST4,
  AUTH_COPY_BANKING_DAYS,
  COMPROMISE_WRITTEN_CONFIRM_CALENDAR_DAYS,
  CONTRACT_LEGAL_NAME,
  DEBITS_ALLOWED,
  FEES,
  OVER_LIMIT_REQUEST_LEAD_BANKING_DAYS,
  REFUSED_NOC_CALENDAR_DAYS,
  RESERVE_BANKING_DAYS,
  REVERSAL_BANKING_DAYS,
  REVERSAL_HOURS_FROM_DISCOVERY,
  STATEMENT_REVIEW_CALENDAR_DAYS,
  TERMINATION_NOTICE_CALENDAR_DAYS,
  TIMBERLAND_PHONE,
  UPLOAD_CUTOFF,
} from "@/lib/payments/timberland-profile-core";
import { pacificWallTimeToUtcISO } from "@/lib/reports/timezone";

export const AGREEMENT_FILE = "ach/timberland-ach-agreement-2026-10-09.redacted.txt";
export const BRENDA_FILE = "ach/timberland-brenda-2026-10.txt";

export type Quote = { file: string; section: string; text: string };

// ─────────────────────────────────────────────────────────────── entry types ──

export const COMMS_TYPES = [
  "amendment_notice",
  "fee_notice",
  "reserve_demand",
  "auth_copy_request",
  "over_limit_request",
  "prefunding_notice",
  "termination_notice",
  "compromise_reported",
  "reversal_needed",
  "statement_received",
  "dual_approval_on",
  "schedule_g_email_corrected",
  "access_ready",
  "countersigned_received",
  "other",
] as const;
export type CommsType = (typeof COMMS_TYPES)[number];
/** The 0277 list also has 'done' (closes an item); it is not offered as a type. */
export type CommsRowType = CommsType | "done";

export type CommsTypeSpec = {
  label: string;
  /** What starts the clock, in plain words, for the form. */
  hint: string;
  /** Does it have a clock (can be closed with Done)? Mirrors the 0277 guard list. */
  clock: boolean;
  needsTime: boolean;
  needsSecondDate: boolean;
  secondDateLabel: string | null;
  needsAmount: boolean;
  quote: Quote | null;
};

const A = (section: string, text: string): Quote => ({ file: AGREEMENT_FILE, section, text });

export const COMMS_TYPE_SPECS: Readonly<Record<CommsType, CommsTypeSpec>> = {
  amendment_notice: {
    label: "Amendment notice from Timberland",
    hint: "A change to the agreement takes effect when you receive it. Read it the same day.",
    clock: true, needsTime: false, needsSecondDate: false, secondDateLabel: null, needsAmount: false,
    quote: A("\u00a728 Amendments to Agreement (p.5)", "Such amendments shall become effective upon receipt of notice by Company or such later date as may be stated in Financial Institution's notice to Company."),
  },
  fee_notice: {
    label: "Fee change notice from Timberland",
    hint: "Timberland may change fees by written notice. Read it the same day and update the fees card with your developer.",
    clock: true, needsTime: false, needsSecondDate: false, secondDateLabel: null, needsAmount: false,
    quote: A("\u00a724 Fees (p.4)", "Financial Institution may change its fees from time to time upon written notice to Company."),
  },
  reserve_demand: {
    label: "Reserve demand from Timberland",
    hint: `Fund the reserve within ${RESERVE_BANKING_DAYS} banking days of receiving the letter, or Timberland may suspend ACH.`,
    clock: true, needsTime: false, needsSecondDate: false, secondDateLabel: null, needsAmount: true,
    quote: A("\u00a722 Reserves (p.4)", "Company agrees to establish reserves as required by Financial Institution within 10 banking days after receipt of a communication from Financial Institution"),
  },
  auth_copy_request: {
    label: "Timberland asked for a payee's authorization",
    hint: `Send Timberland a copy of that payee's signed authorization within ${AUTH_COPY_BANKING_DAYS} banking days. Open it from Documents to review.`,
    clock: true, needsTime: false, needsSecondDate: false, secondDateLabel: null, needsAmount: false,
    quote: A("\u00a75 Authorizations (p.2)", "Company, upon request, must present a copy of the Customer's authorization to Financial Institution within 5 banking days."),
  },
  over_limit_request: {
    label: "A file over the limit is needed (ask Timberland first)",
    hint: `Ask Timberland at least ${OVER_LIMIT_REQUEST_LEAD_BANKING_DAYS} banking days before the date of the bigger file. Timberland may say no.`,
    clock: true, needsTime: false, needsSecondDate: true, secondDateLabel: "Date of the bigger file", needsAmount: true,
    quote: A("\u00a726 Exposure Limits (p.5)", "Company must submit its request at least 2 banking days prior to the date on which Company wishes to initiate the Entry that otherwise would be an Over limit Entry."),
  },
  prefunding_notice: {
    label: "Pre-funding notice from Timberland",
    hint: "From now on, the money must be in the account BEFORE you upload a file. Fund first, every time, until Timberland says otherwise.",
    clock: true, needsTime: false, needsSecondDate: false, secondDateLabel: null, needsAmount: false,
    quote: A("\u00a715 Pre-Funding (p.3)", "Financial Institution will communicate directly to Company if pre-funding is required"),
  },
  termination_notice: {
    label: "Termination notice (either side)",
    hint: `Either side may end the agreement with ${TERMINATION_NOTICE_CALENDAR_DAYS} calendar days' written notice; Timberland may end it at once for a violation. From the end date, pay by check.`,
    clock: true, needsTime: false, needsSecondDate: true, secondDateLabel: "Last day ACH may be used", needsAmount: false,
    quote: A("\u00a730 Termination of Agreement (p.5)", "Either party may terminate this Agreement upon 3 calendar days written notice to the other"),
  },
  compromise_reported: {
    label: "I phoned Timberland about a stolen or lost password, code, phone or token",
    hint: `Phone first (${TIMBERLAND_PHONE}). Then confirm in writing within ${COMPROMISE_WRITTEN_CONFIRM_CALENDAR_DAYS} calendar day of the call. Enter the time of the call.`,
    clock: true, needsTime: true, needsSecondDate: false, secondDateLabel: null, needsAmount: false,
    quote: A("Schedule F - Security Procedures (p.11)", "Company will verbally notify Financial Institution immediately, followed by written confirmation within 1 calendar day of verbal notice."),
  },
  reversal_needed: {
    label: "A wrong or duplicate payment went out (reversal)",
    hint: `Phone Timberland (${TIMBERLAND_PHONE}) at once: within ${REVERSAL_HOURS_FROM_DISCOVERY} hours of finding it and within ${REVERSAL_BANKING_DAYS} banking days of the original payment. Enter when you found it and the original settlement date.`,
    clock: true, needsTime: true, needsSecondDate: true, secondDateLabel: "Settlement date of the wrong payment", needsAmount: false,
    quote: A("\u00a721 Reversals (p.4)", "within 5 banking days of the original Entry or Entries and within 24 hours of discovery of the error"),
  },
  statement_received: {
    label: "Monthly statement received",
    hint: `Report any difference to Timberland within ${STATEMENT_REVIEW_CALENDAR_DAYS} calendar days. Use the statement date if you are not sure when it arrived.`,
    clock: true, needsTime: false, needsSecondDate: false, secondDateLabel: null, needsAmount: false,
    quote: A("\u00a717 Settlement Discrepancies (p.3)", "Company agrees to notify Financial Institution within a reasonable time not to exceed 30 calendar days"),
  },
  dual_approval_on: {
    label: "Dual approval turned on at Timberland",
    hint: "Only if you choose it. Write the second Timberland user's name in the summary.",
    clock: false, needsTime: false, needsSecondDate: false, secondDateLabel: null, needsAmount: false,
    quote: A("Schedule F - Security Procedures (p.11)", "Timberland Bank also recommends dual control approval for all file originations."),
  },
  schedule_g_email_corrected: {
    label: "Brenda confirmed the Schedule G email is corrected",
    hint: "Closes the go-live item. Write who confirmed it.",
    clock: false, needsTime: false, needsSecondDate: false, secondDateLabel: null, needsAmount: false,
    quote: null,
  },
  access_ready: {
    label: "Brenda says the cash management access is ready",
    hint: "Closes the go-live item.",
    clock: false, needsTime: false, needsSecondDate: false, secondDateLabel: null, needsAmount: false,
    quote: { file: BRENDA_FILE, section: "Email 1", text: "This is a totally different online access and I will communicate with you when I have things set up." },
  },
  countersigned_received: {
    label: "Countersigned agreement received from Timberland",
    hint: "Closes the go-live item. Keep the copy privately, never in the website's code.",
    clock: false, needsTime: false, needsSecondDate: false, secondDateLabel: null, needsAmount: false,
    quote: null,
  },
  other: {
    label: "Something else Timberland said",
    hint: "A record only (no clock).",
    clock: false, needsTime: false, needsSecondDate: false, secondDateLabel: null, needsAmount: false,
    quote: null,
  },
};

export function isCommsType(v: unknown): v is CommsType {
  return typeof v === "string" && (COMMS_TYPES as readonly string[]).includes(v);
}

// ─────────────────────────────────────────────────────────────── the honest notes ──

/** Section 18, verbatim: a file cannot be called back after upload. */
export const NO_CANCEL_QUOTE = A("\u00a718 Cancellation or Amendment of Entries (p.4)", "Financial Institution shall have no liability if it fails to effect the cancellation.");
/** Brenda, verbatim: a reversal may not bring the money back. */
export const REVERSAL_NO_REFUND_QUOTE: Quote = { file: BRENDA_FILE, section: "Email 1", text: "This does not mean that you would get your money back." };
/** Section 21, verbatim: the payee must be told before the reversal settles. */
export const PAYEE_NOTICE_QUOTE = A("\u00a721 Reversals (p.4)", "Company also warrants that the account holder of a reversing Entry has been notified of the reversal, and the reason for the reversal, no later than the settlement day of the reversal.");
/** Schedule G, verbatim: lost token fee. */
export const LOST_TOKEN_QUOTE = A("Schedule G: Token or Text Security (p.12)", "The replacement fee for a lost token is $25.00.");

// ─────────────────────────────────────────────────────────────── forms ──

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** 0277: how far back a date may be typed (a typo guard). */
export const COMMS_MAX_AGE_DAYS = 400;

function realDate(s: string): boolean {
  if (!ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function daysApart(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** "$1,234.56" -> cents; blank -> null; bad -> NaN. */
export function dollarsToCents(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!s) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return Number.NaN;
  const [w, f = ""] = s.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}

/** 0277 summary rule, in the app: 5-1000 characters, no run of 7+ digits. */
export function checkSummary(raw: string | null | undefined): { ok: true; summary: string } | { ok: false; error: string } {
  const summary = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (summary.length < 5) return { ok: false, error: "Write a short summary (at least 5 characters): who, what, and how it arrived." };
  if (summary.length > 1000) return { ok: false, error: "Keep the summary under 1,000 characters." };
  if (/[0-9]{7,}/.test(summary)) return { ok: false, error: "Please do not put account or routing numbers in the summary (no run of 7 or more digits)." };
  return { ok: true, summary };
}

export type CommsInsert = {
  entryType: CommsType;
  receivedOn: string;
  occurredAtUtc: string | null;
  effectiveOn: string | null;
  amountCents: number | null;
  summary: string;
};

/**
 * Check the log form the way 0277 will, so the owner sees a plain sentence
 * instead of a database error. `time` is HH:MM Pacific on the received date.
 */
export function checkCommsForm(
  get: (k: string) => string | null | undefined,
  todayIso: string,
  nowUtc: Date,
): { ok: true; row: CommsInsert } | { ok: false; error: string } {
  const type = String(get("entry_type") ?? "").trim();
  if (!isCommsType(type)) return { ok: false, error: "Pick what kind of message it was." };
  const spec = COMMS_TYPE_SPECS[type];
  const receivedOn = String(get("received_on") ?? "").trim();
  if (!realDate(receivedOn)) return { ok: false, error: "Enter the date it arrived (or happened) as YYYY-MM-DD." };
  if (receivedOn > todayIso) return { ok: false, error: "The date cannot be in the future." };
  if (daysApart(receivedOn, todayIso) > COMMS_MAX_AGE_DAYS) return { ok: false, error: `The date is more than ${COMMS_MAX_AGE_DAYS} days ago. Check the year.` };

  let occurredAtUtc: string | null = null;
  const time = String(get("time") ?? "").trim();
  if (spec.needsTime || time) {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
    if (!m) return { ok: false, error: type === "reversal_needed" ? "Enter the time you found the mistake (HH:MM, Pacific)." : "Enter the time of the phone call (HH:MM, Pacific)." };
    occurredAtUtc = pacificWallTimeToUtcISO(receivedOn, { h: Number(m[1]), m: Number(m[2]), s: 0, ms: 0 });
    if (Date.parse(occurredAtUtc) > nowUtc.getTime() + 5 * 60_000) return { ok: false, error: "The time cannot be in the future." };
  }

  let effectiveOn: string | null = null;
  const second = String(get("effective_on") ?? "").trim();
  if (spec.needsSecondDate || second) {
    if (!realDate(second)) return { ok: false, error: `Enter the ${(spec.secondDateLabel ?? "second date").toLowerCase()} as YYYY-MM-DD.` };
    if (type === "termination_notice" && second < receivedOn) return { ok: false, error: "The last day cannot be before the notice arrived." };
    if (type === "reversal_needed" && second > receivedOn) return { ok: false, error: "The wrong payment's settlement date cannot be after the day you found it." };
    effectiveOn = second;
  }

  let amountCents: number | null = null;
  const amt = dollarsToCents(get("amount"));
  if (spec.needsAmount || amt !== null) {
    if (amt === null || Number.isNaN(amt)) return { ok: false, error: type === "reserve_demand" ? "Enter the reserve amount Timberland asked for, like 5,000.00." : "Enter the amount, like 75,000.00." };
    amountCents = amt;
  }

  const s = checkSummary(get("summary"));
  if (!s.ok) return s;
  return { ok: true, row: { entryType: type, receivedOn, occurredAtUtc, effectiveOn, amountCents, summary: s.summary } };
}

export function checkCloseForm(
  get: (k: string) => string | null | undefined,
  todayIso: string,
): { ok: true; closesId: string; summary: string; receivedOn: string } | { ok: false; error: string } {
  const id = String(get("comms_id") ?? "").trim().toLowerCase();
  if (!UUID.test(id)) return { ok: false, error: "That item could not be found. Reload the page." };
  const s = checkSummary(get("summary"));
  if (!s.ok) return { ok: false, error: s.error.replace("who, what, and how it arrived", "what you did") };
  return { ok: true, closesId: id, summary: s.summary, receivedOn: todayIso };
}

// ─────────────────────────────────────────────────────────────── clocks ──

export type CommsRow = {
  id: string;
  entry_type: CommsRowType;
  received_on: string;
  occurred_at: string | null;
  effective_on: string | null;
  amount_cents: number | null;
  summary: string;
  closes_id: string | null;
  created_at: string;
};

export type NoticeClockRow = { id: string; notice_kind: "return" | "noc"; code: string; received_on: string; apply_by: string | null; payee: string };

export type ClockTone = "danger" | "gold" | "neutral";

export type Clock = {
  key: string;
  /** The comms row to close, when it is a log item. */
  commsId: string | null;
  title: string;
  /** Due: a Pacific date, or an exact instant. */
  dueDate: string | null;
  dueUtc: string | null;
  dueText: string;
  tone: ClockTone;
  action: string;
  section: string;
};

/** ISO instant -> "Wed Oct 21, 3:05 pm Pacific". */
export function pacificInstantText(iso: string): string {
  const d = new Date(iso);
  const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  const p = Object.fromEntries(f.formatToParts(d).filter((x) => x.type !== "literal").map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.month} ${p.day}, ${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()} Pacific`;
}

function dateTone(due: string, todayIso: string): ClockTone {
  if (due < todayIso) return "danger";
  return daysApart(todayIso, due) <= 2 ? "gold" : "neutral";
}

function dateText(due: string, todayIso: string): string {
  const n = daysApart(todayIso, due);
  if (n < 0) return `Overdue: was due ${due}`;
  if (n === 0) return `Due today (${due})`;
  return `Due ${due} (${n} day${n === 1 ? "" : "s"})`;
}

function instantTone(dueUtc: string, nowUtc: Date): ClockTone {
  return Date.parse(dueUtc) < nowUtc.getTime() ? "danger" : "gold";
}

function instantText(dueUtc: string, nowUtc: Date): string {
  const left = Date.parse(dueUtc) - nowUtc.getTime();
  if (left < 0) return `Overdue: was due ${pacificInstantText(dueUtc)}`;
  const h = Math.floor(left / 3_600_000);
  return `Due ${pacificInstantText(dueUtc)} (${h < 1 ? "under 1 hour" : `${h} hour${h === 1 ? "" : "s"}`} left)`;
}

/** Section 21 (strict): the earlier of discovery + 24 h and 4:00 pm Pacific on the 5th banking day after settlement. */
export function reversalDueUtc(discoveredAtUtc: string, originalSettlement: string): { dueUtc: string; lastDay: string; windowClosed: boolean } {
  const lastDay = addBankingDays(originalSettlement, REVERSAL_BANKING_DAYS);
  const dayCut = pacificWallTimeToUtcISO(lastDay, { h: UPLOAD_CUTOFF.hour, m: UPLOAD_CUTOFF.minute, s: 0, ms: 0 });
  const hours = new Date(Date.parse(discoveredAtUtc) + REVERSAL_HOURS_FROM_DISCOVERY * 3_600_000).toISOString();
  const dueUtc = Date.parse(hours) < Date.parse(dayCut) ? hours : dayCut;
  return { dueUtc, lastDay, windowClosed: Date.parse(discoveredAtUtc) >= Date.parse(dayCut) };
}

/** Schedule F (strict): 24 hours from the phone call. */
export function compromiseDueUtc(calledAtUtc: string): string {
  return new Date(Date.parse(calledAtUtc) + COMPROMISE_WRITTEN_CONFIRM_CALENDAR_DAYS * 86_400_000).toISOString();
}

/** Which log items are closed (by a 'done' row). */
export function closedIds(rows: readonly CommsRow[]): Set<string> {
  return new Set(rows.filter((r) => r.entry_type === "done" && r.closes_id).map((r) => r.closes_id as string));
}

function commsClock(r: CommsRow, todayIso: string, nowUtc: Date): Clock | null {
  const base = { key: `comms:${r.id}`, commsId: r.id };
  const t = r.entry_type;
  if (t === "amendment_notice" || t === "fee_notice") {
    const due = r.received_on;
    return { ...base, title: COMMS_TYPE_SPECS[t].label, dueDate: due, dueUtc: null, dueText: dateText(due, todayIso), tone: dateTone(due, todayIso), action: "Read it the same day. If anything changed, tell your developer so the app follows it, then press Done.", section: t === "fee_notice" ? "\u00a724" : "\u00a728" };
  }
  if (t === "reserve_demand") {
    const due = addBankingDays(r.received_on, RESERVE_BANKING_DAYS);
    const amt = r.amount_cents !== null ? ` of $${(r.amount_cents / 100).toFixed(2)}` : "";
    return { ...base, title: `Reserve demand${amt}`, dueDate: due, dueUtc: null, dueText: dateText(due, todayIso), tone: dateTone(due, todayIso), action: "Fund the reserve Timberland asked for, then press Done. If it is not funded in time, Timberland may suspend ACH.", section: "\u00a722" };
  }
  if (t === "auth_copy_request") {
    const due = addBankingDays(r.received_on, AUTH_COPY_BANKING_DAYS);
    return { ...base, title: "Send Timberland a payee's authorization", dueDate: due, dueUtc: null, dueText: dateText(due, todayIso), tone: dateTone(due, todayIso), action: "Open the payee's signed authorization in Documents to review, send Timberland a copy, then press Done.", section: "\u00a75" };
  }
  if (t === "over_limit_request" && r.effective_on) {
    const due = subUsableDays(r.effective_on, OVER_LIMIT_REQUEST_LEAD_BANKING_DAYS);
    return { ...base, title: `Ask Timberland for a one-time higher limit (file on ${r.effective_on})`, dueDate: due, dueUtc: null, dueText: dateText(due, todayIso), tone: dateTone(due, todayIso), action: `Ask by 4:00 pm Pacific on ${due}. Timberland may say no: without a yes, the file over the limit is not processed. Press Done when Timberland answers.`, section: "\u00a726" };
  }
  if (t === "prefunding_notice") {
    return { ...base, title: "Pre-funding required", dueDate: null, dueUtc: null, dueText: "Before every upload, until Timberland says it has ended", tone: "gold", action: "Put the money in the account before each upload, not just by settlement day. Press Done only when Timberland says pre-funding has ended.", section: "\u00a715" };
  }
  if (t === "termination_notice" && r.effective_on) {
    const ended = r.effective_on < todayIso;
    return { ...base, title: ended ? `ACH with Timberland ended ${r.effective_on}` : `ACH with Timberland ends ${r.effective_on}`, dueDate: r.effective_on, dueUtc: null, dueText: ended ? "Ended: pay by check" : dateText(r.effective_on, todayIso), tone: "danger", action: "Plan every payment after that day by check. Press Done only if the notice is withdrawn in writing.", section: "\u00a730" };
  }
  if (t === "compromise_reported" && r.occurred_at) {
    const due = compromiseDueUtc(r.occurred_at);
    return { ...base, title: "Written confirmation of the security report", dueDate: null, dueUtc: due, dueText: instantText(due, nowUtc), tone: instantTone(due, nowUtc), action: "Send Timberland the written confirmation (the STOP card has a letter ready), then press Done.", section: "Schedule F" };
  }
  if (t === "reversal_needed" && r.occurred_at && r.effective_on) {
    const rv = reversalDueUtc(r.occurred_at, r.effective_on);
    const how = DEBITS_ALLOWED ? "Send the reversal file" : `Phone Timberland at ${TIMBERLAND_PHONE}: your setup has no debit files (Schedule C), so you cannot send a reversal yourself`;
    return {
      ...base,
      title: `Reversal of a payment that settled ${r.effective_on}`,
      dueDate: null,
      dueUtc: rv.dueUtc,
      dueText: rv.windowClosed ? `Too late for a reversal (the window closed ${rv.lastDay})` : instantText(rv.dueUtc, nowUtc),
      tone: rv.windowClosed ? "danger" : instantTone(rv.dueUtc, nowUtc),
      action: `${how}. Tell the payee before the reversal settles (letter below). A reversal may not get the money back. Press Done when it is handled.`,
      section: "\u00a721",
    };
  }
  if (t === "statement_received") {
    const due = addCalendarDays(r.received_on, STATEMENT_REVIEW_CALENDAR_DAYS);
    return { ...base, title: `Check the statement received ${r.received_on}`, dueDate: due, dueUtc: null, dueText: dateText(due, todayIso), tone: dateTone(due, todayIso), action: "Match every ACH line and fee (see the fees card). Report any difference to Timberland, then press Done.", section: "\u00a717" };
  }
  return null;
}

function noticeClocks(n: NoticeClockRow, todayIso: string): Clock[] {
  if (n.notice_kind === "return") {
    return [{ key: `notice:${n.id}`, commsId: null, title: `Return ${n.code} for ${n.payee}`, dueDate: null, dueUtc: null, dueText: "No contract deadline: the payee stays on hold until you resolve it", tone: "neutral", action: "Call the payee at a number on file, then resolve the notice in Returns and bank corrections.", section: "\u00a720" }];
  }
  const out: Clock[] = [];
  if (n.apply_by) out.push({ key: `notice:${n.id}`, commsId: null, title: `Apply bank correction ${n.code} for ${n.payee}`, dueDate: n.apply_by, dueUtc: null, dueText: dateText(n.apply_by, todayIso), tone: dateTone(n.apply_by, todayIso), action: "Apply the corrected details before this date (or before the next payment, if that is sooner), then resolve the notice.", section: "\u00a77" });
  const refuse = addCalendarDays(n.received_on, REFUSED_NOC_CALENDAR_DAYS);
  out.push({ key: `refuse:${n.id}`, commsId: null, title: `Only if correction ${n.code} for ${n.payee} is WRONG: refuse it`, dueDate: refuse, dueUtc: null, dueText: dateText(refuse, todayIso), tone: "neutral", action: "If the correction is wrong, tell Timberland in writing before this date and ask how they want the Refused NOC sent. Otherwise ignore this line.", section: "\u00a77" });
  return out;
}

/** Every open clock, most urgent first. Closed log items and fact entries have no clock. */
export function obligationClocks(input: { todayIso: string; nowUtc: Date; comms: readonly CommsRow[]; notices: readonly NoticeClockRow[] }): Clock[] {
  const closed = closedIds(input.comms);
  const out: Clock[] = [];
  for (const r of input.comms) {
    if (r.entry_type === "done" || closed.has(r.id)) continue;
    const c = commsClock(r, input.todayIso, input.nowUtc);
    if (c) out.push(c);
  }
  for (const n of input.notices) out.push(...noticeClocks(n, input.todayIso));
  const rank: Record<ClockTone, number> = { danger: 0, gold: 1, neutral: 2 };
  const when = (c: Clock): number => (c.dueUtc ? Date.parse(c.dueUtc) : c.dueDate ? Date.parse(`${c.dueDate}T23:59:59Z`) : Number.MAX_SAFE_INTEGER);
  return out.sort((a, b) => rank[a.tone] - rank[b.tone] || when(a) - when(b) || a.key.localeCompare(b.key));
}

/** An open termination notice: the Guide and Operations switch to "pay by check" wording. */
export function terminationInEffect(comms: readonly CommsRow[]): { endsOn: string } | null {
  const closed = closedIds(comms);
  const open = comms.filter((r) => r.entry_type === "termination_notice" && r.effective_on && !closed.has(r.id)).map((r) => r.effective_on as string).sort();
  return open.length ? { endsOn: open[0] } : null;
}

/** The newest logged compromise call that is not marked done (pre-fills the STOP card letter). */
export function latestOpenCompromiseCall(comms: readonly CommsRow[]): string | null {
  const closed = closedIds(comms);
  const times = comms.filter((r) => r.entry_type === "compromise_reported" && r.occurred_at && !closed.has(r.id)).map((r) => r.occurred_at as string);
  times.sort((a, b) => Date.parse(b) - Date.parse(a));
  return times[0] ?? null;
}

/** The banner words while a termination notice is open. */
export function terminationBannerText(endsOn: string, todayIso: string): string {
  return endsOn < todayIso
    ? `Timberland ended the ACH agreement (last day ${endsOn}). Pay by check; do not upload ACH files.`
    : `Timberland has given notice to end the ACH agreement: the last day is ${endsOn}. Plan to pay by check after that day; do not upload a file that settles after it.`;
}

/** Facts the go-live board accepts from the log (as well as the calendar). */
export function loggedFacts(comms: readonly CommsRow[]): { scheduleGEmail: boolean; accessReady: boolean; countersigned: boolean; dualApprovalOn: boolean } {
  const has = (t: CommsType) => comms.some((r) => r.entry_type === t);
  return { scheduleGEmail: has("schedule_g_email_corrected"), accessReady: has("access_ready"), countersigned: has("countersigned_received"), dualApprovalOn: has("dual_approval_on") };
}

// ─────────────────────────────────────────────────────────────── fees card ──

export function usdCents(c: number): string {
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Schedule B: what the month's statement should show for ACH. */
export function expectedMonthlyFees(returns: number, nocs: number): { totalCents: number; lines: string[] } {
  if (!Number.isInteger(returns) || !Number.isInteger(nocs) || returns < 0 || nocs < 0) throw new Error("expectedMonthlyFees: counts must be whole numbers >= 0");
  const items = returns + nocs;
  const totalCents = FEES.serviceMonthly + FEES.perReturnOrNoc * items;
  return {
    totalCents,
    lines: [
      `ACH service fee ${usdCents(FEES.serviceMonthly)}`,
      `Returns and corrections: ${items} \u00d7 ${usdCents(FEES.perReturnOrNoc)} = ${usdCents(FEES.perReturnOrNoc * items)} (${returns} return${returns === 1 ? "" : "s"}, ${nocs} correction${nocs === 1 ? "" : "s"} logged this month)`,
    ],
  };
}

export const FEE_ROWS: readonly { label: string; cents: number; when: string }[] = [
  { label: "ACH service fee", cents: FEES.serviceMonthly, when: "every month" },
  { label: "Return or bank correction (NOC)", cents: FEES.perReturnOrNoc, when: "per item" },
  { label: "Corporate Nacha CD", cents: FEES.nachaCdYearly, when: "per year" },
  { label: "Lost token replacement", cents: FEES.lostTokenReplacement, when: "per token (Schedule G)" },
];

// ─────────────────────────────────────────────────────────────── STOP card ──

export const STOP_WHEN: readonly string[] = [
  "A wrong file was uploaded, or the same file twice.",
  "A payment you do not recognise is on the account.",
  "Your phone (for the text code) or token is lost or stolen.",
  "Someone logged in to Timberland who was not you, or you got a code you did not ask for.",
];

/** The written confirmation Schedule F asks for after the phone call. No account number beyond the last 4. */
export function compromiseLetter(i: { todayIso: string; calledAtUtc: string | null; whatHappened: string | null }): string {
  const called = i.calledAtUtc ? pacificInstantText(i.calledAtUtc) : "[date and time of the call]";
  const what = (i.whatHappened ?? "").trim() || "[what happened: for example, my phone that receives the Timberland code was stolen]";
  return [
    i.todayIso,
    "",
    "Timberland Bank, Cash Management",
    "",
    `Re: Written confirmation of a security report, ACH Origination Agreement, ${CONTRACT_LEGAL_NAME}, account ending ${ACCOUNT_LAST4}`,
    "",
    `This letter confirms in writing what I reported to Timberland Bank by phone (${TIMBERLAND_PHONE}) on ${called}, as Schedule F of our ACH agreement asks.`,
    "",
    `What happened: ${what}`,
    "",
    "Please disable any credentials or token that may be affected, tell me about any ACH activity after the time above, and let me know what else you need from me.",
    "",
    "Michael Lyman, Owner",
    CONTRACT_LEGAL_NAME,
  ].join("\n");
}

/** Section 21: tell the payee before the reversal settles. */
export function payeeReversalNotice(i: { payee: string; amountText: string; paidOn: string; reason: string }): string {
  return [
    `Dear ${i.payee.trim() || "[payee]"},`,
    "",
    `On ${i.paidOn} we sent you a payment of ${i.amountText} by direct deposit in error (${i.reason.trim() || "[reason: for example, it was sent twice]"}). We have asked our bank to reverse it, so that amount may be taken back from your account.`,
    "",
    "We are sorry for the trouble. If this causes you any problem, please call us at the number you have for the store.",
    "",
    "Greenway Marijuana",
  ].join("\n");
}

// ───────────────────────────────────────────────────────── database errors ──

const COMMS_ERROR_TABLE: readonly [RegExp, string][] = [
  [/ACH_COMMS_APPEND_ONLY/, "The Timberland log is never changed or deleted. Add a new entry that corrects it."],
  [/ACH_OWNER_ONLY/, "Only the owner adds to the Timberland log. Send it as a request for owner approval."],
  [/ACH_COMMS_DATE: the time/, "The time cannot be in the future."],
  [/ACH_COMMS_DATE: the date is more than/, `The date is more than ${COMMS_MAX_AGE_DAYS} days ago. Check the year.`],
  [/ACH_COMMS_DATE/, "The date cannot be in the future."],
  [/atc_closes_once|ACH_COMMS_CLOSE: .*already/, "That item is already marked done."],
  [/ACH_COMMS_CLOSE: a done entry must name/, "That item could not be found. Reload the page."],
  [/ACH_COMMS_CLOSE: the item to close was not found/, "That item could not be found. Reload the page."],
  [/ACH_COMMS_CLOSE: a .* entry has no clock/, "That entry has no deadline, so there is nothing to mark done."],
  [/ACH_COMMS_CLOSE: it cannot be done before/, "It cannot be marked done before the day it arrived."],
  [/ach_timberland_comms_summary_check/, "Write a short note (5 to 1,000 characters, and never an account or card number)."],
  [/relation "public\.ach_timberland_comms" does not exist|Could not find the table 'public\.ach_timberland_comms'|ach_timberland_comms.*does not exist/, "The Timberland log is not set up yet: run migration 0277 (docs/MIGRATIONS_TO_RUN.md). Nothing was saved."],
  [/atc_/, "The database refused this entry (a required date, time or amount is missing). Nothing was saved."],
];

/** Plain words for a 0277 refusal. Never echoes the raw database text. */
export function commsDbErrorMessage(message: string | null | undefined): string {
  const m = String(message ?? "");
  for (const [re, text] of COMMS_ERROR_TABLE) if (re.test(m)) return text;
  return "The Timberland log refused this. Nothing was saved. Reload the page and try again.";
}

// ───────────────────────────────────────────────────────────── self-tests ──

export function __runTimberlandObligationsCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, name: string): void => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`timberland-obligations-core self-test FAILED: ${name}`);
    }
  };
  const now = new Date("2026-10-20T18:00:00Z"); // Tue Oct 20, 11:00 am PDT
  const today = "2026-10-20";
  const row = (p: Partial<CommsRow> & Pick<CommsRow, "id" | "entry_type">): CommsRow => ({ received_on: today, occurred_at: null, effective_on: null, amount_cents: null, summary: "x", closes_id: null, created_at: "2026-10-20T18:00:00Z", ...p });

  // entry types mirror 0277
  ok(COMMS_TYPES.length === 15 && !COMMS_TYPES.includes("done" as never), "15 offered types, 'done' is not offered");
  ok(COMMS_TYPES.filter((t) => COMMS_TYPE_SPECS[t].clock).join(",") === "amendment_notice,fee_notice,reserve_demand,auth_copy_request,over_limit_request,prefunding_notice,termination_notice,compromise_reported,reversal_needed,statement_received", "clock types match the 0277 close list");
  ok(COMMS_TYPES.filter((t) => COMMS_TYPE_SPECS[t].needsTime).join(",") === "compromise_reported,reversal_needed", "time needed: compromise and reversal (0277 atc_time_needed)");
  ok(COMMS_TYPES.filter((t) => COMMS_TYPE_SPECS[t].needsSecondDate).join(",") === "over_limit_request,termination_notice,reversal_needed", "second date needed (0277 atc_second_date_needed)");
  ok(COMMS_TYPES.filter((t) => COMMS_TYPE_SPECS[t].needsAmount).join(",") === "reserve_demand,over_limit_request", "amount needed (0277 atc_amount_needed)");

  // forms
  const f = (o: Record<string, string>) => checkCommsForm((k) => o[k], today, now);
  ok(!f({ entry_type: "done", received_on: today, summary: "hello there" }).ok, "done is not a form type");
  ok(!f({ entry_type: "fee_notice", received_on: "2026-10-21", summary: "Fee letter" }).ok, "future date refused");
  ok(!f({ entry_type: "fee_notice", received_on: "2025-09-14", summary: "Fee letter" }).ok, "401 days back refused");
  ok(f({ entry_type: "fee_notice", received_on: "2025-09-15", summary: "Fee letter" }).ok, "400 days back accepted");
  ok(!f({ entry_type: "fee_notice", received_on: "2026-02-30", summary: "Fee letter" }).ok, "not a real date refused");
  ok(!f({ entry_type: "other", received_on: today, summary: "acct 1234567" }).ok, "7-digit run refused");
  ok(f({ entry_type: "other", received_on: today, summary: "Called 1-800-562-8761" }).ok, "the bank phone number is fine");
  ok(!f({ entry_type: "other", received_on: today, summary: " ab " }).ok, "short summary refused");
  ok(!f({ entry_type: "compromise_reported", received_on: today, summary: "Phone stolen" }).ok, "compromise needs a time");
  const cmp = f({ entry_type: "compromise_reported", received_on: today, time: "09:30", summary: "Phone stolen" });
  ok(cmp.ok && cmp.row.occurredAtUtc === "2026-10-20T16:30:00.000Z", "09:30 PDT -> 16:30Z");
  ok(!f({ entry_type: "compromise_reported", received_on: today, time: "11:30", summary: "Phone stolen" }).ok, "a call time in the future refused");
  ok(!f({ entry_type: "reserve_demand", received_on: today, summary: "Reserve letter" }).ok, "reserve needs an amount");
  const res = f({ entry_type: "reserve_demand", received_on: today, amount: "$5,000.00", summary: "Reserve letter" });
  ok(res.ok && res.row.amountCents === 500000, "reserve amount in cents");
  ok(!f({ entry_type: "termination_notice", received_on: today, effective_on: "2026-10-19", summary: "Ending letter" }).ok, "termination end before notice refused");
  ok(!f({ entry_type: "reversal_needed", received_on: today, time: "08:00", effective_on: "2026-10-21", summary: "Duplicate file" }).ok, "reversal settlement after discovery refused");
  ok(!checkCloseForm((k) => ({ comms_id: "nope", summary: "did it" })[k], today).ok, "close needs a real id");
  ok(checkCloseForm((k) => ({ comms_id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427", summary: "Read and applied" })[k], today).ok, "close accepted");

  // clocks
  const fee = commsClock(row({ id: "a", entry_type: "fee_notice", received_on: "2026-10-19" }), today, now)!;
  ok(fee.dueDate === "2026-10-19" && fee.tone === "danger", "fee notice: same day, yesterday's is overdue");
  const reserve = commsClock(row({ id: "b", entry_type: "reserve_demand", amount_cents: 500000 }), today, now)!;
  ok(reserve.dueDate === "2026-11-03", "reserve: 10 FedACH banking days from Tue Oct 20 (Veterans Day Nov 11 not in range) = Tue Nov 3");
  const copy = commsClock(row({ id: "c", entry_type: "auth_copy_request", received_on: "2026-11-09" }), "2026-11-09", now)!;
  ok(copy.dueDate === "2026-11-17", "auth copy: 5 banking days from Mon Nov 9 skips Veterans Day (Wed Nov 11) = Tue Nov 17");
  const over = commsClock(row({ id: "d", entry_type: "over_limit_request", effective_on: "2026-10-26", amount_cents: 7500000 }), today, now)!;
  ok(over.dueDate === "2026-10-22", "over-limit: 2 usable days before Mon Oct 26 = Thu Oct 22");
  const cmpC = commsClock(row({ id: "e", entry_type: "compromise_reported", occurred_at: "2026-10-20T16:30:00.000Z" }), today, now)!;
  ok(cmpC.dueUtc === "2026-10-21T16:30:00.000Z" && cmpC.tone === "gold", "compromise: 24 hours from the call");
  ok(commsClock(row({ id: "e2", entry_type: "compromise_reported", occurred_at: "2026-10-19T16:30:00.000Z" }), today, now)!.tone === "danger", "compromise overdue after 24 h");
  const rv = reversalDueUtc("2026-10-20T16:00:00.000Z", "2026-10-16");
  ok(rv.lastDay === "2026-10-23" && rv.dueUtc === "2026-10-21T16:00:00.000Z" && !rv.windowClosed, "reversal: 24 h from discovery is earlier than the 5th banking day");
  const rv2 = reversalDueUtc("2026-10-23T10:00:00.000Z", "2026-10-16");
  ok(rv2.dueUtc === "2026-10-23T23:00:00.000Z" && rv2.lastDay === "2026-10-23" && !rv2.windowClosed, "reversal: 4:00 pm PDT on the 5th banking day when that is earlier");
  ok(reversalDueUtc("2026-10-24T16:00:00.000Z", "2026-10-16").windowClosed, "reversal: window closed after the 5th banking day");
  const rvC = commsClock(row({ id: "f", entry_type: "reversal_needed", occurred_at: "2026-10-20T16:00:00.000Z", effective_on: "2026-10-16" }), today, now)!;
  ok(/Phone Timberland at 1-800-562-8761/.test(rvC.action) && /no debit files/.test(rvC.action), "reversal action: phone (no debit files)");
  const st = commsClock(row({ id: "g", entry_type: "statement_received", received_on: "2026-10-05" }), today, now)!;
  ok(st.dueDate === "2026-11-04" && st.tone === "neutral", "statement: 30 calendar days");
  ok(commsClock(row({ id: "h", entry_type: "access_ready" }), today, now) === null, "a fact has no clock");
  const all = obligationClocks({ todayIso: today, nowUtc: now, comms: [row({ id: "a", entry_type: "fee_notice", received_on: "2026-10-19" }), row({ id: "z", entry_type: "done", closes_id: "a" }), row({ id: "g", entry_type: "statement_received", received_on: "2026-10-05" })], notices: [] });
  ok(all.length === 1 && all[0].key === "comms:g", "a closed item has no clock; done rows are not clocks");
  const ord = obligationClocks({ todayIso: today, nowUtc: now, comms: [row({ id: "g", entry_type: "statement_received", received_on: "2026-10-05" }), row({ id: "a", entry_type: "fee_notice", received_on: "2026-10-19" })], notices: [] });
  ok(ord[0].key === "comms:a", "overdue first");
  const nc = obligationClocks({ todayIso: today, nowUtc: now, comms: [], notices: [{ id: "n1", notice_kind: "noc", code: "C01", received_on: "2026-10-19", apply_by: "2026-10-27", payee: "Pat" }] });
  ok(nc.length === 2 && nc.some((c) => c.key === "refuse:n1" && c.dueDate === "2026-11-03"), "NOC: apply-by plus refuse-by 15 calendar days");
  ok(obligationClocks({ todayIso: today, nowUtc: now, comms: [], notices: [{ id: "r1", notice_kind: "return", code: "R03", received_on: today, apply_by: null, payee: "Pat" }] })[0].tone === "neutral", "a return has no contract clock");

  // termination and facts
  ok(terminationInEffect([row({ id: "t", entry_type: "termination_notice", effective_on: "2026-10-23" })])?.endsOn === "2026-10-23", "termination in effect");
  ok(terminationInEffect([row({ id: "t", entry_type: "termination_notice", effective_on: "2026-10-23" }), row({ id: "u", entry_type: "done", closes_id: "t" })]) === null, "withdrawn termination is closed");
  const facts = loggedFacts([row({ id: "s", entry_type: "schedule_g_email_corrected" })]);
  ok(facts.scheduleGEmail && !facts.accessReady && !facts.countersigned && !facts.dualApprovalOn, "logged facts");

  // fees
  const fees = expectedMonthlyFees(1, 2);
  ok(fees.totalCents === 6500, "$50 + 3 x $5 = $65");
  ok(expectedMonthlyFees(0, 0).totalCents === 5000, "no items: $50");
  let threw = false;
  try {
    expectedMonthlyFees(-1, 0);
  } catch {
    threw = true;
  }
  ok(threw, "negative count refused");
  ok(FEE_ROWS.map((r) => r.cents).join(",") === "5000,500,2400,2500", "fee rows from the profile");

  // letters
  const letter = compromiseLetter({ todayIso: today, calledAtUtc: "2026-10-20T16:30:00.000Z", whatHappened: "Phone stolen" });
  ok(letter.includes("Tue Oct 20, 9:30 am Pacific") && letter.includes("account ending 6048") && letter.includes("Lymans Marijuana LLC"), "letter pre-filled");
  ok(!/[0-9]{7,}/.test(letter), "letter has no long digit run");
  ok(/\[date and time of the call\]/.test(compromiseLetter({ todayIso: today, calledAtUtc: null, whatHappened: null })), "blank call time is a visible placeholder");
  ok(/may be taken back/.test(payeeReversalNotice({ payee: "Pat", amountText: "$100.00", paidOn: "2026-10-16", reason: "sent twice" })), "payee notice");

  // database errors
  ok(/never changed/.test(commsDbErrorMessage("ACH_COMMS_APPEND_ONLY: the Timberland log is never changed or deleted.")), "db: append-only");
  ok(/Only the owner/.test(commsDbErrorMessage("ACH_OWNER_ONLY: only the owner adds to the Timberland log.")), "db: owner only");
  ok(/time cannot/.test(commsDbErrorMessage("ACH_COMMS_DATE: the time cannot be in the future.")), "db: future time");
  ok(/400 days/.test(commsDbErrorMessage("ACH_COMMS_DATE: the date is more than 400 days ago (2025-01-01). Check the year.")), "db: too old");
  ok(/date cannot be in the future/.test(commsDbErrorMessage("ACH_COMMS_DATE: the date cannot be in the future (2027-01-01).")), "db: future date");
  ok(/already marked done/.test(commsDbErrorMessage('duplicate key value violates unique constraint "atc_closes_once"')), "db: closed twice");
  ok(/no deadline/.test(commsDbErrorMessage("ACH_COMMS_CLOSE: a access_ready entry has no clock to close.")), "db: nothing to close");
  ok(/before the day it arrived/.test(commsDbErrorMessage("ACH_COMMS_CLOSE: it cannot be done before it arrived (2026-10-20).")), "db: done before arrival");
  ok(/could not be found/.test(commsDbErrorMessage("ACH_COMMS_CLOSE: the item to close was not found.")), "db: not found");
  ok(/run migration 0277/.test(commsDbErrorMessage('relation "public.ach_timberland_comms" does not exist')), "db: missing table (pg)");
  ok(/run migration 0277/.test(commsDbErrorMessage("Could not find the table 'public.ach_timberland_comms' in the schema cache")), "db: missing table (PostgREST)");
  ok(/short note/.test(commsDbErrorMessage('new row for relation "ach_timberland_comms" violates check constraint "ach_timberland_comms_summary_check"')), "db: summary check");
  ok(/required date, time or amount/.test(commsDbErrorMessage('new row violates check constraint "atc_time_needed"')), "db: shape check");
  ok(/Reload the page and try again/.test(commsDbErrorMessage("boom 12345678")) && !/12345678/.test(commsDbErrorMessage("boom 12345678")), "db: unknown never echoed");

  // STOP card + banner helpers
  const cA = row({ id: "ca", entry_type: "compromise_reported", occurred_at: "2026-10-19T16:30:00.000Z" });
  const cB = row({ id: "cb", entry_type: "compromise_reported", occurred_at: "2026-10-20T16:30:00.000Z" });
  ok(latestOpenCompromiseCall([cA, cB]) === "2026-10-20T16:30:00.000Z", "letter: newest open call");
  ok(latestOpenCompromiseCall([cA, cB, row({ id: "dn", entry_type: "done", closes_id: "cb" })]) === "2026-10-19T16:30:00.000Z", "letter: a done call is skipped");
  ok(latestOpenCompromiseCall([]) === null, "letter: no call, no time");
  ok(/last day is 2026-11-01/.test(terminationBannerText("2026-11-01", today)) && /given notice/.test(terminationBannerText("2026-11-01", today)), "banner: before the last day");
  ok(/given notice/.test(terminationBannerText(today, today)), "banner: on the last day it is still notice");
  ok(/ended the ACH agreement \(last day 2026-10-19\)/.test(terminationBannerText("2026-10-19", today)), "banner: after the last day");

  return { passed, failed };
}
