/**
 * src/lib/registers/night-watch-core.ts   (D182, round slice S5)
 *
 * PURE. The night watch: one health check of the shop's money and records,
 * run before the store opens, turned into a plain morning report.
 *
 * OWNER, verbatim (2026-11-04):
 *   "Nudges by admin screens only for now, it build the email and text
 *    options so I can use it if needed. They will listen if they are nagged
 *    on their phones. Go above and beyond for me. Give me the best possible
 *    system that helps me, works for me, and encourages properly behavior
 *    from my employees."
 *
 * What lives here (no I/O, so every rule is proven by the self-test):
 *   1. buildMorningReport: the findings (drawers left open, second counts
 *      and reconciles not done, a missing or stuck deposit bag, register
 *      exceptions, copied-looking second counts, unexplained over/shorts,
 *      people still on the clock, a failed platform check) become ordered
 *      items, each with who acts, a sentence and the page that fixes it.
 *   2. Notification settings: email and text are BUILT but OFF until the
 *      owner turns them on (parseNotifySettings defaults both off).
 *   3. notifyPlan: which channels send for a report (never both off → none;
 *      an all-clear only if the owner asked for one).
 *   4. reportEmailHtml / reportSmsText: the two messages. Text is short
 *      (one segment where possible) and names the first thing to fix.
 *
 * The fraud triangle (owner): pressure, opportunity, rationalisation. The
 * report removes OPPORTUNITY by making every gap visible by name the next
 * morning (an uncounted drawer or a copied second count cannot hide), and
 * removes RATIONALISATION by saying exactly what the rule is and who owes it.
 * It never blocks anyone (D27): it reports, it does not lock.
 */

import { formatCents } from "./cash";

// ---------------------------------------------------------------------------
// 1. Findings → report
// ---------------------------------------------------------------------------

export type WatchSeverity = "red" | "amber";
export type WatchWho = "crew" | "owner";

export type WatchItem = {
  key: string;
  severity: WatchSeverity;
  who: WatchWho;
  sentence: string;
  href: string;
};

export type WatchFindings = {
  /** The Pacific day the report is for (today, the morning it runs). */
  day: string;
  /** Drawers from a day before today that are still open. */
  openOldDrawers: readonly { registerName: string; businessDay: string }[];
  /** Drawers closed on the iPad but with no second count yet (any day before today). */
  noSecondCount: readonly { registerName: string; businessDay: string }[];
  /** Drawers second-counted but not reconciled (any day before today). */
  notReconciled: readonly { registerName: string; businessDay: string }[];
  /** Days before today with drawers but no deposit bag. */
  missingBagDays: readonly string[];
  /** Yesterday's bag needs a reason (night and morning counts differ). */
  bagNeedsReason: boolean;
  /** Bags counted and ready but not sealed for more than a day. */
  unsealedBagDays: readonly string[];
  /** Sealed bags not yet taken to the bank (days). */
  unbankedBagDays: readonly string[];
  /** Register exceptions still open. */
  openExceptions: number;
  /** Age of the oldest open exception in days (null when none). */
  oldestExceptionDays: number | null;
  /** Second counts yesterday that look copied, fast or entered under the closer's login. */
  loudSecondCounts: readonly { registerName: string; businessDay: string; flags: readonly string[] }[];
  /** Over/shorts of $5 or more with no written reason (last 7 days). */
  unexplainedOverShort: readonly { registerName: string; businessDay: string; overShortMinor: number }[];
  /** People whose work punch has been open more than OPEN_PUNCH_HOURS. */
  longOpenPunches: readonly { name: string; hours: number }[];
  /** The last platform health check, if read. */
  platformStatus: "ok" | "warn" | "fail" | null;
  /** Any read that failed: shown, never treated as all clear (rule 135). */
  readErrors: readonly string[];
};

export const OPEN_PUNCH_HOURS = 14;
export const EXCEPTION_RED_DAYS = 1;

const P_REGISTERS = "/admin/registers";
const P_BAGS = "/admin/registers/deposit-bags";
const P_EXCEPTIONS = "/admin/registers/exceptions";
const P_WARNINGS = "/admin/registers/over-short";
const P_TIMECLOCK = "/admin/staffing/hours";
const P_HEALTH = "/admin/settings/platform-health";

function names(rows: readonly { registerName: string; businessDay: string }[]): string {
  const parts = rows.slice(0, 4).map((r) => `${r.registerName} (${r.businessDay})`);
  const more = rows.length > 4 ? ` and ${rows.length - 4} more` : "";
  return parts.join(", ") + more;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export type MorningReport = {
  day: string;
  status: "clear" | "attention" | "unknown";
  items: WatchItem[];
  redCount: number;
  amberCount: number;
  headline: string;
};

export function buildMorningReport(f: WatchFindings): MorningReport {
  const items: WatchItem[] = [];

  if (f.openOldDrawers.length > 0) {
    items.push({
      key: "open_old_drawers",
      severity: "red",
      who: "crew",
      sentence: `Drawer left open overnight: ${names(f.openOldDrawers)}. Count it out on its iPad now.`,
      href: P_REGISTERS,
    });
  }
  if (f.noSecondCount.length > 0) {
    items.push({
      key: "no_second_count",
      severity: "red",
      who: "crew",
      sentence: `Second count not done: ${names(f.noSecondCount)}. A different person counts it blind before anything else.`,
      href: P_REGISTERS,
    });
  }
  if (f.notReconciled.length > 0) {
    items.push({
      key: "not_reconciled",
      severity: "amber",
      who: "crew",
      sentence: `Not reconciled yet: ${names(f.notReconciled)}.`,
      href: P_REGISTERS,
    });
  }
  if (f.missingBagDays.length > 0) {
    const d = f.missingBagDays;
    items.push({
      key: "missing_bag",
      severity: "red",
      who: "crew",
      sentence: `No deposit bag for ${d.length === 1 ? d[0] : `${d.length} days (${d.slice(0, 3).join(", ")}${d.length > 3 ? ", ..." : ""})`}. There is a bag for every day: build it this morning.`,
      href: P_BAGS,
    });
  }
  if (f.bagNeedsReason) {
    items.push({
      key: "bag_needs_reason",
      severity: "red",
      who: "crew",
      sentence: "Last night's bag and this morning's recount do not match. Write the reason before the bag can be sealed.",
      href: P_BAGS,
    });
  }
  if (f.unsealedBagDays.length > 0) {
    items.push({
      key: "unsealed_bags",
      severity: "amber",
      who: "owner",
      sentence: `${plural(f.unsealedBagDays.length, "bag is", "bags are")} recounted and waiting for your seal (${f.unsealedBagDays.slice(0, 3).join(", ")}).`,
      href: P_BAGS,
    });
  }
  if (f.unbankedBagDays.length > 0) {
    items.push({
      key: "unbanked_bags",
      severity: "amber",
      who: "owner",
      sentence: `${plural(f.unbankedBagDays.length, "sealed bag is", "sealed bags are")} in the safe for the bank (${f.unbankedBagDays.slice(0, 3).join(", ")}).`,
      href: P_BAGS,
    });
  }
  if (f.openExceptions > 0) {
    const old = f.oldestExceptionDays ?? 0;
    items.push({
      key: "exceptions",
      severity: old >= EXCEPTION_RED_DAYS ? "red" : "amber",
      who: "owner",
      sentence: `${plural(f.openExceptions, "register sale needs", "register sales need")} a decision${old >= 1 ? ` (oldest ${plural(old, "day", "days")})` : ""}. The sale happened: record it.`,
      href: P_EXCEPTIONS,
    });
  }
  if (f.loudSecondCounts.length > 0) {
    items.push({
      key: "loud_second_counts",
      severity: "red",
      who: "owner",
      sentence: `Second count may not be independent: ${names(f.loudSecondCounts)}. Check who counted and how long it took.`,
      href: P_REGISTERS,
    });
  }
  if (f.unexplainedOverShort.length > 0) {
    const r = f.unexplainedOverShort;
    const first = r[0]!;
    items.push({
      key: "unexplained_over_short",
      severity: "amber",
      who: "crew",
      sentence: `${plural(r.length, "over/short has", "over/shorts have")} no reason written (e.g. ${first.registerName} ${first.businessDay}: ${formatCents(first.overShortMinor)}).`,
      href: P_WARNINGS,
    });
  }
  if (f.longOpenPunches.length > 0) {
    const p = f.longOpenPunches;
    items.push({
      key: "long_open_punches",
      severity: "amber",
      who: "crew",
      sentence: `Still on the clock after ${OPEN_PUNCH_HOURS}+ hours: ${p
        .slice(0, 3)
        .map((x) => `${x.name} (${x.hours} h)`)
        .join(", ")}. Fix the punch so pay is right.`,
      href: P_TIMECLOCK,
    });
  }
  if (f.platformStatus === "fail") {
    items.push({ key: "platform_fail", severity: "red", who: "owner", sentence: "This morning's database health check FAILED. Open it for the exact fix.", href: P_HEALTH });
  } else if (f.platformStatus === "warn") {
    items.push({ key: "platform_warn", severity: "amber", who: "owner", sentence: "This morning's database health check has a warning.", href: P_HEALTH });
  }
  for (const [i, e] of f.readErrors.entries()) {
    items.push({ key: `read_error_${i}`, severity: "amber", who: "owner", sentence: `Could not check: ${e}`, href: P_REGISTERS });
  }

  // Red first, crew before owner (the crew is in the building first).
  const rank = (x: WatchItem) => (x.severity === "red" ? 0 : 2) + (x.who === "crew" ? 0 : 1);
  items.sort((a, b) => rank(a) - rank(b));

  const redCount = items.filter((x) => x.severity === "red").length;
  const amberCount = items.length - redCount;
  const status: MorningReport["status"] = items.length > 0 ? "attention" : f.readErrors.length > 0 ? "unknown" : "clear";
  const headline =
    items.length === 0
      ? `All clear for ${f.day}: every drawer counted twice, every bag built.`
      : `${f.day}: ${plural(items.length, "thing needs", "things need")} attention${redCount > 0 ? ` (${redCount} urgent)` : ""}.`;
  return { day: f.day, status, items, redCount, amberCount, headline };
}

// ---------------------------------------------------------------------------
// 2. Notification settings (built, OFF by default)
// ---------------------------------------------------------------------------

export const NOTIFY_SETTING_KEY = "night_watch_notify";

export type NotifySettings = {
  emailEnabled: boolean;
  smsEnabled: boolean;
  /** Email addresses for the morning report. Empty = ORDER_STAFF_EMAILS. */
  emailTo: string[];
  /** Phone numbers (E.164, +1...) for the morning text. */
  smsTo: string[];
  /** Also send when everything is clear. */
  sendAllClear: boolean;
};

export const DEFAULT_NOTIFY: NotifySettings = Object.freeze({
  emailEnabled: false,
  smsEnabled: false,
  emailTo: [],
  smsTo: [],
  sendAllClear: false,
}) as NotifySettings;

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** US-first phone normalising: 10 digits → +1XXXXXXXXXX; 11 starting 1 → +1...; +E.164 kept. */
export function normalisePhone(raw: string): string | null {
  const t = raw.trim();
  if (t === "") return null;
  if (t.startsWith("+")) {
    const d = t.slice(1).replace(/[\s().-]/g, "");
    return /^[1-9]\d{7,14}$/.test(d) ? `+${d}` : null;
  }
  const d = t.replace(/[\s().-]/g, "");
  if (/^\d{10}$/.test(d)) return `+1${d}`;
  if (/^1\d{10}$/.test(d)) return `+${d}`;
  return null;
}

export function splitList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
  if (typeof raw !== "string") return [];
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Read the saved setting. Anything missing or malformed falls back to OFF. */
export function parseNotifySettings(raw: unknown): NotifySettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_NOTIFY, emailTo: [], smsTo: [] };
  const o = raw as Record<string, unknown>;
  return {
    emailEnabled: o.emailEnabled === true,
    smsEnabled: o.smsEnabled === true,
    emailTo: splitList(o.emailTo).filter((e) => EMAIL_RE.test(e)),
    smsTo: splitList(o.smsTo)
      .map(normalisePhone)
      .filter((p): p is string => p !== null),
    sendAllClear: o.sendAllClear === true,
  };
}

/** Validate the owner's form. Bad entries are named, not silently dropped. */
export function validateNotifyForm(input: {
  emailEnabled: boolean;
  smsEnabled: boolean;
  emailTo: string;
  smsTo: string;
  sendAllClear: boolean;
}): { ok: true; settings: NotifySettings } | { ok: false; error: string } {
  const emails = splitList(input.emailTo);
  const badEmail = emails.find((e) => !EMAIL_RE.test(e));
  if (badEmail) return { ok: false, error: `"${badEmail}" is not an email address.` };
  const phonesRaw = splitList(input.smsTo);
  const phones: string[] = [];
  for (const p of phonesRaw) {
    const n = normalisePhone(p);
    if (!n) return { ok: false, error: `"${p}" is not a phone number. Use 10 digits, e.g. 360-555-0123.` };
    phones.push(n);
  }
  if (input.smsEnabled && phones.length === 0) return { ok: false, error: "Add at least one phone number before turning texts on." };
  if (emails.length > 20 || phones.length > 20) return { ok: false, error: "At most 20 email addresses and 20 phone numbers." };
  return {
    ok: true,
    settings: {
      emailEnabled: input.emailEnabled,
      smsEnabled: input.smsEnabled,
      emailTo: [...new Set(emails)],
      smsTo: [...new Set(phones)],
      sendAllClear: input.sendAllClear,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Which channels send
// ---------------------------------------------------------------------------

export type ChannelReadiness = {
  /** RESEND_API_KEY and ORDER_EMAIL_FROM are set. */
  emailProvider: boolean;
  /** TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are set. */
  smsProvider: boolean;
  /** Email recipients after the ORDER_STAFF_EMAILS fallback. */
  emailRecipients: number;
};

export type NotifyPlan = { email: boolean; sms: boolean; why: string };

export function notifyPlan(s: NotifySettings, report: Pick<MorningReport, "status">, ready: ChannelReadiness): NotifyPlan {
  const worth = report.status !== "clear" || s.sendAllClear;
  if (!s.emailEnabled && !s.smsEnabled) return { email: false, sms: false, why: "Email and text are off (admin screens only)." };
  if (!worth) return { email: false, sms: false, why: "All clear, and all-clear messages are off." };
  const email = s.emailEnabled && ready.emailProvider && ready.emailRecipients > 0;
  const sms = s.smsEnabled && ready.smsProvider && s.smsTo.length > 0;
  const missing: string[] = [];
  if (s.emailEnabled && !ready.emailProvider) missing.push("email is on but the email service is not set up (RESEND_API_KEY / ORDER_EMAIL_FROM)");
  if (s.emailEnabled && ready.emailProvider && ready.emailRecipients === 0) missing.push("email is on but there is no address");
  if (s.smsEnabled && !ready.smsProvider) missing.push("texts are on but the text service is not set up (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM)");
  return { email, sms, why: missing.length > 0 ? missing.join("; ") : "Sending." };
}

/** One message per Pacific day. */
export function nightWatchKey(day: string): string {
  return `night-watch:daily:${day}`;
}

// ---------------------------------------------------------------------------
// 4. The messages
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function reportSubject(r: MorningReport): string {
  if (r.status === "clear") return `Greenway morning report ${r.day}: all clear`;
  return `Greenway morning report ${r.day}: ${r.items.length} to fix${r.redCount > 0 ? ` (${r.redCount} urgent)` : ""}`;
}

export function reportEmailHtml(r: MorningReport, origin: string): string {
  const rows = r.items
    .map(
      (x) =>
        `<li style="margin:0 0 8px"><strong style="color:${x.severity === "red" ? "#b42318" : "#b54708"}">${x.severity === "red" ? "URGENT" : "To do"}</strong> · ${x.who === "crew" ? "Crew" : "Michael"}: ${esc(x.sentence)} <a href="${esc(origin + x.href)}">Open</a></li>`,
    )
    .join("");
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.4"><p><strong>${esc(r.headline)}</strong></p>${rows ? `<ol>${rows}</ol>` : ""}<p style="color:#667085;font-size:13px">Night watch, Greenway back office. <a href="${esc(origin + "/admin/registers/night-watch")}">Full report</a></p></div>`;
}

export const SMS_MAX = 320;

/** Short text: the headline and the first two things to do. */
export function reportSmsText(r: MorningReport, origin: string): string {
  if (r.items.length === 0) return `Greenway ${r.day}: all clear.`;
  const lead = `Greenway ${r.day}: ${r.items.length} to fix.`;
  const firsts = r.items
    .slice(0, 2)
    .map((x, i) => `${i + 1}) ${x.sentence}`)
    .join(" ");
  const link = ` ${origin}/admin/registers/night-watch`;
  let body = `${lead} ${firsts}`;
  if (body.length + link.length > SMS_MAX) body = body.slice(0, SMS_MAX - link.length - 1).trimEnd() + "…";
  return body + link;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

export function __runNightWatchTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, m: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error("  FAIL night-watch:", m);
    }
  };
  const empty: WatchFindings = {
    day: "2026-11-05",
    openOldDrawers: [],
    noSecondCount: [],
    notReconciled: [],
    missingBagDays: [],
    bagNeedsReason: false,
    unsealedBagDays: [],
    unbankedBagDays: [],
    openExceptions: 0,
    oldestExceptionDays: null,
    loudSecondCounts: [],
    unexplainedOverShort: [],
    longOpenPunches: [],
    platformStatus: "ok",
    readErrors: [],
  };

  const clear = buildMorningReport(empty);
  ok(clear.status === "clear" && clear.items.length === 0, "nothing found → all clear");
  ok(clear.headline.startsWith("All clear"), "all-clear headline");

  const busy = buildMorningReport({
    ...empty,
    noSecondCount: [{ registerName: "Sales Register 1", businessDay: "2026-11-04" }],
    unbankedBagDays: ["2026-11-03"],
    missingBagDays: ["2026-11-04"],
    openExceptions: 1,
    oldestExceptionDays: 2,
    platformStatus: "warn",
  });
  ok(busy.status === "attention", "findings → attention");
  ok(busy.items[0]!.severity === "red" && busy.items[0]!.who === "crew", "red crew items first");
  ok(busy.items.some((x) => x.key === "missing_bag" && x.href.endsWith("deposit-bags")), "missing bag links to bags");
  ok(busy.items.find((x) => x.key === "exceptions")!.severity === "red", "2-day-old exception is red");
  ok(busy.items.at(-1)!.severity === "amber", "amber last");
  ok(busy.redCount === 3, `3 red (${busy.redCount})`);
  ok(/3 urgent/.test(busy.headline), "headline counts urgent");

  const fresh = buildMorningReport({ ...empty, openExceptions: 1, oldestExceptionDays: 0 });
  ok(fresh.items[0]!.severity === "amber", "same-day exception is amber");

  const errs = buildMorningReport({ ...empty, readErrors: ["drawers could not be read"] });
  ok(errs.status === "attention" && errs.items[0]!.sentence.includes("Could not check"), "read error is never all clear");

  const loud = buildMorningReport({ ...empty, loudSecondCounts: [{ registerName: "SR2", businessDay: "2026-11-04", flags: ["identical_and_fast"] }] });
  ok(loud.items[0]!.key === "loud_second_counts" && loud.items[0]!.who === "owner", "copied second count goes to owner");

  const many = buildMorningReport({
    ...empty,
    noSecondCount: [1, 2, 3, 4, 5, 6].map((n) => ({ registerName: `R${n}`, businessDay: "2026-11-04" })),
  });
  ok(many.items[0]!.sentence.includes("and 2 more"), "long lists are shortened");

  const os = buildMorningReport({ ...empty, unexplainedOverShort: [{ registerName: "SR1", businessDay: "2026-11-04", overShortMinor: -990 }] });
  ok(os.items[0]!.sentence.includes("-$9.90") || os.items[0]!.sentence.includes("($9.90)") || os.items[0]!.sentence.includes("$9.90"), "over/short amount shown");

  // settings
  const def = parseNotifySettings(null);
  ok(!def.emailEnabled && !def.smsEnabled, "default: email and text OFF");
  ok(parseNotifySettings({ emailEnabled: "yes" }).emailEnabled === false, "only true turns a channel on");
  const parsed = parseNotifySettings({ emailEnabled: true, smsEnabled: true, emailTo: ["a@b.co", "bad"], smsTo: ["360-555-0123", "x"] });
  ok(parsed.emailTo.length === 1 && parsed.smsTo[0] === "+13605550123", "bad saved entries dropped on read");
  ok(normalisePhone("(360) 555-0123") === "+13605550123", "US 10 digits");
  ok(normalisePhone("1 360 555 0123") === "+13605550123", "US 11 digits");
  ok(normalisePhone("+44 20 7946 0958") === "+442079460958", "E.164 kept");
  ok(normalisePhone("555-0123") === null, "7 digits refused");
  const v1 = validateNotifyForm({ emailEnabled: false, smsEnabled: true, emailTo: "", smsTo: "", sendAllClear: false });
  ok(!v1.ok && v1.error.includes("phone"), "texts on with no number refused");
  const v2 = validateNotifyForm({ emailEnabled: true, smsEnabled: false, emailTo: "a@b.co, nope", smsTo: "", sendAllClear: false });
  ok(!v2.ok && v2.error.includes("nope"), "bad email named");
  const v3 = validateNotifyForm({ emailEnabled: true, smsEnabled: true, emailTo: "a@b.co\na@b.co", smsTo: "3605550123; 360-555-0123", sendAllClear: true });
  ok(v3.ok && v3.settings.emailTo.length === 1 && v3.settings.smsTo.length === 1, "duplicates collapse");

  // plan
  const ready: ChannelReadiness = { emailProvider: true, smsProvider: true, emailRecipients: 2 };
  const on: NotifySettings = { emailEnabled: true, smsEnabled: true, emailTo: [], smsTo: ["+13605550123"], sendAllClear: false };
  ok(!notifyPlan(DEFAULT_NOTIFY, busy, ready).email && !notifyPlan(DEFAULT_NOTIFY, busy, ready).sms, "off by default → nothing sends");
  const p1 = notifyPlan(on, busy, ready);
  ok(p1.email && p1.sms, "on + findings → both send");
  ok(!notifyPlan(on, clear, ready).email, "all clear does not send by default");
  ok(notifyPlan({ ...on, sendAllClear: true }, clear, ready).sms, "all clear sends when asked");
  const p2 = notifyPlan(on, busy, { emailProvider: true, smsProvider: false, emailRecipients: 1 });
  ok(p2.email && !p2.sms && p2.why.includes("TWILIO"), "missing text service named");
  ok(nightWatchKey("2026-11-05") === "night-watch:daily:2026-11-05", "one key per day");

  // messages
  const sms = reportSmsText(busy, "https://greenwaymarijuana.com");
  ok(sms.length <= SMS_MAX, `text fits (${sms.length})`);
  ok(sms.startsWith("Greenway 2026-11-05: 6 to fix.") || sms.startsWith("Greenway 2026-11-05:"), "text leads with the day");
  ok(sms.endsWith("/admin/registers/night-watch"), "text ends with the link");
  ok(reportSmsText(clear, "x") === "Greenway 2026-11-05: all clear.", "all-clear text");
  const html = reportEmailHtml({ ...busy, items: [{ ...busy.items[0]!, sentence: "<b>x</b>" }] }, "https://g.co");
  ok(html.includes("&lt;b&gt;") && !html.includes("<b>x"), "email escapes");
  ok(reportSubject(busy).includes("urgent") && reportSubject(clear).endsWith("all clear"), "subjects");

  return { passed, failed };
}
