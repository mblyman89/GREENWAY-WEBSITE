/**
 * src/lib/accounting/large-draft-notice-core.ts   (slice books-90, PR D)
 *
 * PURE planner for the "you have large entries waiting" email. No imports that
 * touch I/O, no clock, no database — every fact arrives as an argument, so this
 * file can be run by scripts/compliance/run-pure-selftests.ts without a server.
 *
 * WHY THIS EXISTS
 * ---------------
 * books-89 took the $5,000 BLOCK off at Michael's instruction, because he is the
 * sole owner-operator and a second approver does not exist:
 *
 *   "I liked it because it flags large purchases, but I regularly have over 5k
 *    invoices, so I want to be notified about it, then it needs to allow me to
 *    approve it."
 *
 * The block going away is the easy half. The WARNING was the half he said he
 * liked, and a warning that exists only as a boolean in a database row is not a
 * warning — it is a fact nobody is told. books-89 shipped `needs_second_approver`
 * computed and rendered nowhere, and said so out loud rather than pretending
 * otherwise. This closes that gap for the channel Michael then chose:
 *
 *   "We have an email push feature built for the compliance calendar... Let's
 *    use it to send me an email about it."
 *
 * WHAT COUNTS AS LARGE — COPIED FROM THE DATABASE, NOT INVENTED
 * -------------------------------------------------------------
 * Migration 0174:475-486 decides `needs_second_approver` for a draft with:
 *
 *     v_threshold  = coalesce(threshold_cents, 500000)
 *     v_abs_total >= v_threshold
 *     and p_source_kind not in ('pos_sale','excise','purchase','bank','reversal')
 *
 * This module mirrors those three conditions and nothing else. If it flagged
 * entries the database does not consider large, the email would be telling
 * Michael to review things the system will happily post without him; if it
 * flagged fewer, it would be quietly hiding the ones that matter. Both are
 * worse than no email. The exempt list is NOT re-typed here — it is imported
 * from approval-core, which already pins itself to the migration text, so there
 * is exactly one copy of that list in the codebase.
 *
 * The total is likewise not recomputed: `debitTotalCents` already implements the
 * migration's `sum(abs(amount_cents)) / 2` and throws on a non-integer rather
 * than rounding silently.
 *
 * CADENCE / DEDUPE
 * ----------------
 * dedupeKey = "gl-large-drafts:<YYYY-MM-DD>" (Pacific), matching the POS
 * exception planner. compliance_reminder_log has a UNIQUE constraint on
 * dedupe_key, so a day sends at most once however often the cron fires. A new
 * day is a new key, so unapproved large entries nag DAILY until Michael
 * approves them, then the email stops by itself. Nothing needs switching off.
 *
 * URGENCY
 * -------
 * "warning" normally; "critical" once the OLDEST waiting entry is
 * CRITICAL_AGE_DAYS (3) or more Pacific days old, matching the POS planner so
 * the two feel like one system. A large entry sitting unposted for days is
 * either a real bill nobody has paid or a mistake nobody has caught.
 *
 * NEVER GUESS (standing rule 1)
 * -----------------------------
 * A row whose total or threshold is not a safe integer is EXCLUDED and counted
 * as unreadable, never coerced, never assumed to be small. Unreadable rows are
 * reported in the email body in their own sentence, because "we could not read
 * 2 entries" and "there are no large entries" must never look the same
 * (standing rule 46: a failed read is not an empty result).
 */

import { APPROVAL_EXEMPT_SOURCE_KINDS, isApprovalExempt } from "@/lib/accounting/approval-core";

/** Where the email button and push notification send him. */
export const DRAFTS_PATH = "/admin/books/drafts";

/** Oldest waiting entry age, in Pacific days, at which urgency escalates. */
export const CRITICAL_AGE_DAYS = 3;

/**
 * One unapproved draft, in the units the database keeps. The caller converts
 * created_at to a Pacific day key with pacificDayKey() so this module stays
 * pure — it never sees a clock or a timezone.
 */
export type LargeDraftFacts = {
  readonly journalId: string;
  readonly entityCode: string;
  /** YYYY-MM-DD, the accounting date on the entry. */
  readonly journalDate: string;
  readonly sourceKind: string;
  readonly memo: string;
  /** Debit total in integer cents, from debitTotalCents(). */
  readonly totalCents: number;
  /** That entity's gl_approval_policy.threshold_cents. */
  readonly thresholdCents: number;
  /** Pacific day key (YYYY-MM-DD) the draft was created, or null if unknown. */
  readonly createdDayKey: string | null;
};

/** Shaped to drop straight into the Task W reminder engine. */
export type LargeDraftNotice = {
  readonly dedupeKey: string;
  readonly stage: "gl_large_drafts_daily";
  readonly weekKey: null;
  readonly subject: string;
  readonly body: string;
  readonly urgency: "warning" | "critical";
  readonly linkPath: string;
  readonly linkLabel: string;
  readonly footnote: string;
  /** How many entries the notice is about — used by tests and the run result. */
  readonly count: number;
  /** Combined value in cents of those entries. */
  readonly totalCents: number;
};

function isDayKey(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** Whole dollars with thousands separators: 1234567 -> "$12,345.67". */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const part = String(abs % 100).padStart(2, "0");
  const withCommas = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}$${withCommas}.${part}`;
}

/**
 * Pacific calendar days between two YYYY-MM-DD keys. Both are already Pacific,
 * so this is plain date arithmetic with no timezone left to get wrong. Returns
 * null when either key is malformed, so the caller reports "unknown age"
 * instead of inventing a number.
 */
export function daysBetweenDayKeys(fromKey: string, toKey: string): number | null {
  if (!isDayKey(fromKey) || !isDayKey(toKey)) return null;
  const a = Date.UTC(
    Number(fromKey.slice(0, 4)),
    Number(fromKey.slice(5, 7)) - 1,
    Number(fromKey.slice(8, 10)),
  );
  const b = Date.UTC(
    Number(toKey.slice(0, 4)),
    Number(toKey.slice(5, 7)) - 1,
    Number(toKey.slice(8, 10)),
  );
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Does the database consider this draft large? Mirrors 0174:475-486 exactly.
 * Exported so the test can compare it against the migration text rather than
 * against a second copy of my own reasoning (standing rule 39).
 */
export function isLargeDraft(f: {
  totalCents: number;
  thresholdCents: number;
  sourceKind: string;
}): boolean {
  if (!Number.isSafeInteger(f.totalCents) || !Number.isSafeInteger(f.thresholdCents)) {
    return false;
  }
  if (f.thresholdCents < 0) return false;
  if (isApprovalExempt(f.sourceKind)) return false;
  return f.totalCents >= f.thresholdCents;
}

/**
 * Build today's notice, or null when there is nothing to say.
 *
 * `todayKey` is the Pacific day (YYYY-MM-DD) from pacificToday().
 */
export function planLargeDraftNotice(
  todayKey: string,
  drafts: readonly LargeDraftFacts[],
): LargeDraftNotice | null {
  if (!isDayKey(todayKey)) return null;

  const large: LargeDraftFacts[] = [];
  let unreadable = 0;

  for (const d of drafts) {
    // A row we cannot read is COUNTED, never dropped and never guessed at.
    if (!Number.isSafeInteger(d.totalCents) || !Number.isSafeInteger(d.thresholdCents)) {
      unreadable += 1;
      continue;
    }
    if (isLargeDraft(d)) large.push(d);
  }

  if (large.length === 0 && unreadable === 0) return null;

  // Oldest first: the entry that has waited longest is the one to open first.
  const sorted = [...large].sort((a, b) => {
    const ak = isDayKey(a.createdDayKey) ? a.createdDayKey : a.journalDate;
    const bk = isDayKey(b.createdDayKey) ? b.createdDayKey : b.journalDate;
    if (ak !== bk) return ak < bk ? -1 : 1;
    return b.totalCents - a.totalCents;
  });

  const combined = sorted.reduce((s, d) => s + d.totalCents, 0);

  // Age of the oldest, when we can tell. An unknown age stays "warning" rather
  // than escalating on a guess.
  let oldestAge: number | null = null;
  for (const d of sorted) {
    const key = isDayKey(d.createdDayKey) ? d.createdDayKey : null;
    if (!key) continue;
    const age = daysBetweenDayKeys(key, todayKey);
    if (age === null || age < 0) continue;
    if (oldestAge === null || age > oldestAge) oldestAge = age;
  }

  const urgency: "warning" | "critical" =
    oldestAge !== null && oldestAge >= CRITICAL_AGE_DAYS ? "critical" : "warning";

  const n = sorted.length;
  const subject =
    n === 0
      ? `Books: ${unreadable} draft ${unreadable === 1 ? "entry" : "entries"} could not be read`
      : n === 1
        ? `Books: a ${formatCents(sorted[0].totalCents)} entry is waiting for you`
        : `Books: ${n} large entries waiting (${formatCents(combined)})`;

  const lines: string[] = [];

  if (n > 0) {
    lines.push(
      n === 1
        ? "One entry is at or above the large-entry threshold and has not been approved yet:"
        : `${n} entries are at or above the large-entry threshold and have not been approved yet:`,
    );
    lines.push("");
    for (const d of sorted) {
      const age = isDayKey(d.createdDayKey)
        ? daysBetweenDayKeys(d.createdDayKey, todayKey)
        : null;
      const waited =
        age === null ? "" : age <= 0 ? " — entered today" : ` — waiting ${age} day${age === 1 ? "" : "s"}`;
      const memo = d.memo.trim() === "" ? "(no memo)" : d.memo.trim();
      lines.push(
        `• ${formatCents(d.totalCents)} — ${d.entityCode} — ${d.journalDate} — ${memo}${waited}`,
      );
    }
    lines.push("");
    lines.push(
      "Nothing here has posted. These are drafts: they do not touch your P&L, " +
        "balance sheet or tax figures until you approve them.",
    );
    lines.push("");
    lines.push(
      "You can approve these yourself — the second-approver block was removed " +
        "in books-89 because you are the sole owner-operator. This email is the " +
        "flag you asked to keep, not a request for anyone else's signature.",
    );
  }

  if (unreadable > 0) {
    if (n > 0) lines.push("");
    lines.push(
      `${unreadable} draft ${unreadable === 1 ? "entry" : "entries"} could not be read well ` +
        "enough to tell whether it is large, so it has been left out of the list above " +
        "rather than assumed to be small. Open the drafts screen to look.",
    );
  }

  return {
    dedupeKey: `gl-large-drafts:${todayKey}`,
    stage: "gl_large_drafts_daily",
    weekKey: null,
    subject,
    body: lines.join("\n"),
    urgency,
    linkPath: DRAFTS_PATH,
    linkLabel: "Review and approve",
    footnote:
      "Sent once a day while large entries sit unapproved, and it stops on its own " +
      "the day the list is empty. The $5,000 figure is per entity and can be changed " +
      "in the approval policy.",
    count: n,
    totalCents: combined,
  };
}

// =============================================================================
// SELF-TESTS — run by scripts/compliance/run-pure-selftests.ts.
// =============================================================================

function ok(cond: boolean, what: string): void {
  if (!cond) throw new Error(`large-draft-notice-core self-test FAILED: ${what}`);
}

function draft(over: Partial<LargeDraftFacts> = {}): LargeDraftFacts {
  return {
    journalId: "j-1",
    entityCode: "retail",
    journalDate: "2026-11-10",
    sourceKind: "manual",
    memo: "Bulk flower purchase",
    totalCents: 750_000,
    thresholdCents: 500_000,
    createdDayKey: "2026-11-10",
    ...over,
  };
}

export function __runLargeDraftNoticeCoreTests(): void {
  const TODAY = "2026-11-10";

  // ---- nothing to say -----------------------------------------------------
  ok(planLargeDraftNotice(TODAY, []) === null, "no drafts means no email");
  ok(
    planLargeDraftNotice(TODAY, [draft({ totalCents: 499_999 })]) === null,
    "a cent under the threshold is not large",
  );
  ok(
    planLargeDraftNotice(TODAY, [draft({ totalCents: 500_000 })]) !== null,
    "AT the threshold IS large — 0174 uses >=, not >",
  );

  // ---- the exempt kinds ---------------------------------------------------
  for (const kind of APPROVAL_EXEMPT_SOURCE_KINDS) {
    ok(
      planLargeDraftNotice(TODAY, [draft({ sourceKind: kind, totalCents: 9_000_000 })]) === null,
      `${kind} is exempt in 0174, so a huge one raises no flag`,
    );
  }
  ok(
    planLargeDraftNotice(TODAY, [draft({ sourceKind: "atm", totalCents: 9_000_000 })]) !== null,
    "a NON-exempt kind of the same size does raise a flag",
  );

  // ---- never guess --------------------------------------------------------
  const bad = planLargeDraftNotice(TODAY, [draft({ totalCents: 1.5 })]);
  ok(bad !== null, "an unreadable total is reported, not silently dropped");
  ok(bad!.count === 0, "an unreadable row is not counted as a large entry");
  ok(/could not be read/.test(bad!.body), "the email says the row could not be read");

  const badThreshold = planLargeDraftNotice(TODAY, [draft({ thresholdCents: Number.NaN })]);
  ok(badThreshold !== null, "an unreadable threshold is reported too");
  ok(badThreshold!.count === 0, "and is never treated as zero, which would flag everything");

  ok(planLargeDraftNotice("not-a-date", [draft()]) === null, "a malformed today is refused");

  // ---- urgency ------------------------------------------------------------
  const fresh = planLargeDraftNotice(TODAY, [draft({ createdDayKey: TODAY })]);
  ok(fresh!.urgency === "warning", "an entry made today is a warning");
  const old = planLargeDraftNotice(TODAY, [draft({ createdDayKey: "2026-11-07" })]);
  ok(old!.urgency === "critical", "three days waiting escalates to critical");
  const unknownAge = planLargeDraftNotice(TODAY, [draft({ createdDayKey: null })]);
  ok(unknownAge!.urgency === "warning", "an unknown age does NOT escalate on a guess");

  // ---- the message itself -------------------------------------------------
  const two = planLargeDraftNotice(TODAY, [
    draft({ journalId: "a", totalCents: 600_000, createdDayKey: "2026-11-09" }),
    draft({ journalId: "b", totalCents: 800_000, createdDayKey: "2026-11-08" }),
  ]);
  ok(two!.count === 2, "both entries counted");
  ok(two!.totalCents === 1_400_000, "the combined figure adds up");
  ok(two!.subject.includes("$14,000.00"), "the subject carries the combined figure");
  ok(
    two!.body.indexOf("$8,000.00") < two!.body.indexOf("$6,000.00"),
    "oldest first, so the longest-waiting entry is read first",
  );

  ok(
    planLargeDraftNotice(TODAY, [draft({ memo: "   " })])!.body.includes("(no memo)"),
    "a blank memo says so rather than leaving a gap in the line",
  );

  // ---- dedupe -------------------------------------------------------------
  ok(
    planLargeDraftNotice(TODAY, [draft()])!.dedupeKey === "gl-large-drafts:2026-11-10",
    "the dedupe key is per Pacific day so it sends once a day",
  );
  ok(
    planLargeDraftNotice("2026-11-11", [draft()])!.dedupeKey !== "gl-large-drafts:2026-11-10",
    "a new day is a new key, which is what makes it nag until approved",
  );

  // ---- formatting ---------------------------------------------------------
  ok(formatCents(0) === "$0.00", "zero");
  ok(formatCents(5) === "$0.05", "cents pad");
  ok(formatCents(500_000) === "$5,000.00", "the threshold reads as five thousand dollars");
  ok(formatCents(123_456_789) === "$1,234,567.89", "thousands separators");

  ok(daysBetweenDayKeys("2026-11-07", "2026-11-10") === 3, "plain day arithmetic");
  ok(daysBetweenDayKeys("2026-02-28", "2026-03-01") === 1, "across a month end");
  ok(daysBetweenDayKeys("bad", "2026-03-01") === null, "a malformed key is unknown, not zero");
}
