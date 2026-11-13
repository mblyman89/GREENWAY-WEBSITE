/**
 * D237 N-3 (SOP-22 G-113, F-22-9): the Sunday newsletter cadence. PURE.
 *
 * Owner (D237): "I approve all from serious to small along with your
 * recommendations". Q-22-4 option (a): "AI drafts by Thursday; you approve;
 * it sends automatically at a fixed Sunday time (please name the time,
 * Pacific)". The time is not named yet, so it is a SETTING (no default time:
 * nothing sends by itself until the owner picks one or schedules a send).
 *
 * The states of one newsletter (SOP-22 App. B.4 N-3):
 *   draft -> ready for approval -> approved -> scheduled -> sending -> sent
 * "draft" = no approval row; "scheduled" = approved with a send time.
 * Editing an approved newsletter takes the approval back (a person approves
 * exactly what goes out).
 *
 * The reminder: on the reminder day (default Friday, the SOP-22 N-3 plan)
 * after the reminder time, if no newsletter is ready, approved or scheduled
 * for the coming Sunday, one email goes to the reminder list. Once a day at
 * most (compliance_reminder_log dedupe key).
 */
import { pacificParts, pacificWallTimeToUtcISO } from "../reports/timezone";

export const NEWSLETTER_CADENCE_KEY = "newsletter_cadence";

export type ApprovalState = "ready" | "approved" | "sending" | "sent";
export const APPROVAL_STATES: readonly ApprovalState[] = ["ready", "approved", "sending", "sent"];

export type NewsletterStage = "draft" | "ready" | "approved" | "scheduled" | "sending" | "sent";

export const STAGE_LABEL: Record<NewsletterStage, string> = {
  draft: "Draft",
  ready: "Ready for approval",
  approved: "Approved (no send time yet)",
  scheduled: "Approved and scheduled",
  sending: "Sending",
  sent: "Sent",
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export type CadenceSettings = {
  /** "HH:MM" Pacific on Sunday, or null = not chosen yet (Q-22-4). */
  sendTime: string | null;
  /** 0 = Sunday ... 6 = Saturday. */
  remindDay: number;
  /** "HH:MM" Pacific. */
  remindTime: string;
  remindEnabled: boolean;
  /** Who gets the reminder. Empty = the store's staff list (ORDER_STAFF_EMAILS). */
  remindEmails: string[];
};

export const DEFAULT_CADENCE: CadenceSettings = {
  sendTime: null,
  remindDay: 5,
  remindTime: "09:00",
  remindEnabled: true,
  remindEmails: [],
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isHhmm(v: unknown): v is string {
  return typeof v === "string" && HHMM.test(v);
}

/** Never throws: bad or missing values fall back to the defaults. */
export function normalizeCadence(raw: unknown): CadenceSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const day = Number(o.remindDay);
  const emails = Array.isArray(o.remindEmails)
    ? o.remindEmails
    : typeof o.remindEmails === "string"
      ? o.remindEmails.split(/[\s,;]+/)
      : [];
  return {
    sendTime: isHhmm(o.sendTime) ? o.sendTime : null,
    remindDay: Number.isInteger(day) && day >= 0 && day <= 6 ? day : DEFAULT_CADENCE.remindDay,
    remindTime: isHhmm(o.remindTime) ? o.remindTime : DEFAULT_CADENCE.remindTime,
    remindEnabled: o.remindEnabled === undefined ? DEFAULT_CADENCE.remindEnabled : o.remindEnabled === true || o.remindEnabled === "on",
    remindEmails: [...new Set(emails.map((e) => String(e).trim().toLowerCase()).filter((e) => EMAIL.test(e)))].slice(0, 10),
  };
}

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Pacific calendar date + weekday of an instant. */
export function pacificDay(nowIso: string): { ymd: string; weekday: number; minutes: number } {
  const p = pacificParts(nowIso);
  return {
    ymd: ymd(p.year, p.month, p.day),
    weekday: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(),
    minutes: p.hour * 60 + p.minute,
  };
}

function addDays(dayYmd: string, n: number): string {
  const [y, m, d] = dayYmd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function hhmmMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** The Pacific date of the next Sunday send (today if Sunday and the time is still ahead). */
export function nextSundayYmd(nowIso: string, sendTime: string): string {
  const t = pacificDay(nowIso);
  if (t.weekday === 0 && t.minutes < hhmmMinutes(sendTime)) return t.ymd;
  return addDays(t.ymd, t.weekday === 0 ? 7 : 7 - t.weekday);
}

/** UTC instant of the next Sunday at the set time, or null when no time is set. */
export function nextSundaySendUtc(nowIso: string, sendTime: string | null): string | null {
  if (!isHhmm(sendTime)) return null;
  const [h, m] = sendTime.split(":").map(Number);
  return pacificWallTimeToUtcISO(nextSundayYmd(nowIso, sendTime), { h, m, s: 0, ms: 0 });
}

/** The stage shown for one newsletter. */
export function stageOf(a: { state: ApprovalState; send_at: string | null } | null): NewsletterStage {
  if (!a) return "draft";
  if (a.state === "approved") return a.send_at ? "scheduled" : "approved";
  return a.state;
}

/** A scheduled send is due once its time has come (the cron runs every 5 minutes). */
export function isSendDue(a: { state: ApprovalState; send_at: string | null }, nowIso: string): boolean {
  return a.state === "approved" && !!a.send_at && Date.parse(a.send_at) <= Date.parse(nowIso);
}

/** Validate a send time a person picked (UTC ISO). */
export function validateSendAt(sendAtIso: string | null, nowIso: string): string | null {
  if (!sendAtIso || Number.isNaN(Date.parse(sendAtIso))) return "Pick a date and time.";
  if (Date.parse(sendAtIso) <= Date.parse(nowIso)) return "That time has already passed. Pick a time in the future.";
  if (Date.parse(sendAtIso) - Date.parse(nowIso) > 60 * 86_400_000) return "Pick a time within 60 days.";
  return null;
}

/** Is the reminder due right now? `covered` = some newsletter is ready, approved or scheduled. */
export function reminderDue(
  c: CadenceSettings,
  nowIso: string,
  covered: boolean,
): { due: false } | { due: true; key: string } {
  if (!c.remindEnabled || covered) return { due: false };
  const t = pacificDay(nowIso);
  if (t.weekday !== c.remindDay || t.minutes < hhmmMinutes(c.remindTime)) return { due: false };
  return { due: true, key: `newsletter_reminder:${t.ymd}` };
}

export const REMINDER_SUBJECT = "Reminder: no newsletter is ready for Sunday yet";

export function reminderText(c: CadenceSettings): string {
  const when = c.sendTime ? `Sunday at ${formatHhmm(c.sendTime)} Pacific` : "Sunday (no send time is set yet)";
  return `No newsletter is marked ready for approval for ${when}. Open Blog & Newsletter, finish this week's newsletter and press "Ready for approval", then the owner or an admin approves it in the Send Center.`;
}

export function formatHhmm(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

export const APPROVAL_VOIDED_MESSAGE =
  "You edited an approved newsletter, so it needs approval again before it can send.";

export function __runNewsletterCadenceCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, c: boolean) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`newsletter-cadence-core: ${name}`);
    }
  };

  // Settings
  const d = normalizeCadence(null);
  ok("default: no send time (Q-22-4 not named)", d.sendTime === null);
  ok("default reminder Friday", d.remindDay === 5);
  ok("default reminder 09:00", d.remindTime === "09:00");
  ok("default reminder on", d.remindEnabled === true);
  ok("bad time dropped", normalizeCadence({ sendTime: "25:00" }).sendTime === null);
  ok("good time kept", normalizeCadence({ sendTime: "09:30" }).sendTime === "09:30");
  ok("bad day -> default", normalizeCadence({ remindDay: 9 }).remindDay === 5);
  ok("day 4 kept", normalizeCadence({ remindDay: 4 }).remindDay === 4);
  ok("off kept", normalizeCadence({ remindEnabled: false }).remindEnabled === false);
  ok("emails parsed + deduped", JSON.stringify(normalizeCadence({ remindEmails: "A@x.com, a@x.com; bad" }).remindEmails) === '["a@x.com"]');
  ok("isHhmm", isHhmm("00:00") && isHhmm("23:59") && !isHhmm("9:00"));

  // Pacific weekday + next Sunday (2026-11-12 is a Thursday)
  const thu = "2026-11-12T20:00:00.000Z"; // Thu 12:00 PST
  ok("weekday thu", pacificDay(thu).weekday === 4);
  ok("next sunday from thu", nextSundayYmd(thu, "09:00") === "2026-11-15");
  ok("send utc PST 09:00 = 17:00Z", nextSundaySendUtc(thu, "09:00") === "2026-11-15T17:00:00.000Z");
  ok("no time -> null", nextSundaySendUtc(thu, null) === null);
  const sunEarly = "2026-11-15T15:00:00.000Z"; // Sun 07:00 PST
  ok("sunday before time -> today", nextSundayYmd(sunEarly, "09:00") === "2026-11-15");
  const sunLate = "2026-11-15T20:00:00.000Z"; // Sun 12:00 PST
  ok("sunday after time -> next week", nextSundayYmd(sunLate, "09:00") === "2026-11-22");
  ok("summer PDT 09:00 = 16:00Z", nextSundaySendUtc("2026-07-01T19:00:00.000Z", "09:00") === "2026-07-05T16:00:00.000Z");
  ok("month rollover", nextSundayYmd("2026-12-31T20:00:00.000Z", "09:00") === "2027-01-03");

  // Stages
  ok("no row = draft", stageOf(null) === "draft");
  ok("ready", stageOf({ state: "ready", send_at: null }) === "ready");
  ok("approved no time", stageOf({ state: "approved", send_at: null }) === "approved");
  ok("approved + time = scheduled", stageOf({ state: "approved", send_at: thu }) === "scheduled");
  ok("sent", stageOf({ state: "sent", send_at: thu }) === "sent");
  ok("labels for all", Object.keys(STAGE_LABEL).length === 6);

  // Due
  ok("due when time passed", isSendDue({ state: "approved", send_at: "2026-11-12T19:00:00.000Z" }, thu));
  ok("not due before", !isSendDue({ state: "approved", send_at: "2026-11-12T21:00:00.000Z" }, thu));
  ok("ready never sends", !isSendDue({ state: "ready", send_at: "2026-11-12T19:00:00.000Z" }, thu));
  ok("sent never re-sends", !isSendDue({ state: "sent", send_at: "2026-11-12T19:00:00.000Z" }, thu));
  ok("no time never sends", !isSendDue({ state: "approved", send_at: null }, thu));

  // Validate
  ok("past refused", validateSendAt("2026-11-12T19:00:00.000Z", thu) !== null);
  ok("future ok", validateSendAt("2026-11-15T17:00:00.000Z", thu) === null);
  ok("too far refused", validateSendAt("2027-03-01T17:00:00.000Z", thu) !== null);
  ok("null refused", validateSendAt(null, thu) !== null);

  // Reminder (Fri 2026-11-13)
  const fri10 = "2026-11-13T18:00:00.000Z"; // Fri 10:00 PST
  const fri08 = "2026-11-13T16:00:00.000Z"; // Fri 08:00 PST
  const r = reminderDue(d, fri10, false);
  ok("reminder due fri 10", r.due === true);
  ok("reminder key per day", r.due === true && r.key === "newsletter_reminder:2026-11-13");
  ok("not before 9", reminderDue(d, fri08, false).due === false);
  ok("not when covered", reminderDue(d, fri10, true).due === false);
  ok("not on thursday", reminderDue(d, thu, false).due === false);
  ok("not when off", reminderDue({ ...d, remindEnabled: false }, fri10, false).due === false);
  ok("reminder text names time", reminderText({ ...d, sendTime: "09:00" }).includes("9:00 AM Pacific"));
  ok("reminder text no time", reminderText(d).includes("no send time is set"));
  ok("formatHhmm pm", formatHhmm("13:05") === "1:05 PM" && formatHhmm("00:00") === "12:00 AM");

  return { passed, failed };
}
