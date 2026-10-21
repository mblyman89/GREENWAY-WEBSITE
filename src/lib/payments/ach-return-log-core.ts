/**
 * R39 S7 — returns and notifications of change (NOC): the pure layer.
 *
 * Timberland tells Greenway when a credit comes back (a return, R-code) or
 * when the receiving bank corrected the details (a NOC, C-code). Either way
 * the account goes ON HOLD until a person calls the payee at a number already
 * on file (owner Q9, Q13). This file turns what Stephen or Michael types from
 * Timberland's notice into a checked row for public.ach_return_notices
 * (0258 section 6), the hold reason, the deadline, and the owners' email.
 *
 * Code meanings come from ACH_CODES (ach-authorization-core.ts), which is
 * pinned to the bank newsletter in docs/authorities. Deadlines come from the
 * same core (nocApplyBy: the earlier of the next payment or 6 banking days).
 * Nothing here guesses a code's meaning: an unknown code is treated as
 * possible fraud and the screen says to call Timberland.
 *
 * Corrected data from a NOC is the NEW account or routing number: the store
 * encrypts it (corrected_data_enc must be encv1) and screens show last 4.
 */
import { ACH_CODES, classifyAchCode, nocApplyBy, type AchCodeAction } from "./ach-authorization-core";
import { isValidRouting } from "./nacha-core";

export type NoticeKind = "return" | "noc";
export type NoticePayeeType = "vendor" | "employee";

export type ParsedNotice = {
  payeeType: NoticePayeeType;
  payeeId: string;
  kind: NoticeKind;
  code: string;
  codeLabel: string | null;
  known: boolean;
  action: AchCodeAction;
  plain: string;
  receivedOn: string;
  settlementDate: string | null;
  amountCents: number | null;
  traceNumber: string | null;
  correctedData: string | null;
  applyBy: string | null;
};

export type NoticeErrors = Partial<Record<"payee" | "code" | "received_on" | "settlement_date" | "amount" | "trace" | "corrected", string>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** How far back a notice may be dated when typed in (a year and a bit). */
export const NOTICE_MAX_AGE_DAYS = 400;

function isRealDate(s: string): boolean {
  if (!ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function daysApart(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** "$1,234.56", "1234.5", "12" -> cents. Blank -> null. Bad -> NaN. */
export function parseDollarsToCents(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!s) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return Number.NaN;
  const [w, f = ""] = s.split(".");
  return Number(w) * 100 + Number((f + "00").slice(0, 2));
}

/**
 * What the corrected data must look like for each NOC code. C01 an account
 * number, C02 a routing number (check digit verified), C05 a transaction
 * code; the combined codes take the numbers separated by spaces or slashes.
 */
export function checkCorrectedData(code: string, raw: string | null | undefined): { ok: true; value: string } | { ok: false; error: string } {
  const v = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!v) return { ok: false, error: "Type the corrected information exactly as Timberland's notice shows it." };
  if (v.length > 60 || !/^[0-9 /-]+$/.test(v)) return { ok: false, error: "Corrected information is digits only (spaces, dashes or a slash between parts)." };
  const digits = v.replace(/[\s-]/g, "");
  if (code === "C01" && !/^\d{4,17}$/.test(digits)) return { ok: false, error: "C01 gives the correct ACCOUNT number: 4 to 17 digits." };
  if (code === "C02" && !(/^\d{9}$/.test(digits) && isValidRouting(digits))) return { ok: false, error: "C02 gives the correct ROUTING number: 9 digits with a valid check digit." };
  if (code === "C05" && !/^(22|32|23|33)$/.test(digits)) return { ok: false, error: "C05 gives the correct transaction code: 22 or 23 (checking), 32 or 33 (savings)." };
  return { ok: true, value: v };
}

/** Check what was typed from Timberland's notice. `todayIso` is a Pacific date. */
export function parseReturnNotice(get: (k: string) => string | null | undefined, todayIso: string): { ok: true; notice: ParsedNotice } | { ok: false; errors: NoticeErrors } {
  const e: NoticeErrors = {};
  const g = (k: string) => String(get(k) ?? "").trim();

  const payee = g("payee");
  const m = /^(vendor|employee):([0-9a-f-]{36})$/.exec(payee);
  if (!m || !UUID.test(m[2])) e.payee = "Pick who the payment was for.";

  const code = g("code").toUpperCase().replace(/\s/g, "");
  if (!/^[RC]\d{2}$/.test(code)) e.code = "The code is R or C and two digits, for example R03 or C01.";

  const receivedOn = g("received_on");
  if (!isRealDate(receivedOn)) e.received_on = "Pick the date Timberland sent the notice.";
  else if (receivedOn > todayIso) e.received_on = "The notice date cannot be in the future.";
  else if (daysApart(receivedOn, todayIso) > NOTICE_MAX_AGE_DAYS) e.received_on = `That is more than ${NOTICE_MAX_AGE_DAYS} days ago. Check the date.`;

  const settlementRaw = g("settlement_date");
  let settlementDate: string | null = null;
  if (settlementRaw) {
    if (!isRealDate(settlementRaw)) e.settlement_date = "Use a date, or leave it blank.";
    else if (isRealDate(receivedOn) && settlementRaw > receivedOn) e.settlement_date = "The payment settled before the notice came, not after.";
    else settlementDate = settlementRaw;
  }

  const amountCents = parseDollarsToCents(g("amount"));
  if (amountCents !== null && !Number.isFinite(amountCents)) e.amount = "Type the amount like 1234.56, or leave it blank.";

  const traceRaw = g("trace").replace(/\s/g, "");
  if (traceRaw && !/^\d{15}$/.test(traceRaw)) e.trace = "The trace number is 15 digits (or leave it blank).";

  let correctedData: string | null = null;
  if (/^C\d{2}$/.test(code)) {
    const c = checkCorrectedData(code, g("corrected"));
    if (!c.ok) e.corrected = c.error;
    else correctedData = c.value;
  } else if (g("corrected")) {
    e.corrected = "Corrected information only comes with a C-code (NOC). Leave it blank for a return.";
  }

  if (Object.keys(e).length || !m) return { ok: false, errors: e };

  const cls = classifyAchCode(code);
  const kind: NoticeKind = code.startsWith("C") ? "noc" : "return";
  return {
    ok: true,
    notice: {
      payeeType: m[1] as NoticePayeeType,
      payeeId: m[2],
      kind,
      code,
      codeLabel: cls.known ? codeLabel(code) : null,
      known: cls.known,
      action: cls.action,
      plain: cls.plain,
      receivedOn,
      settlementDate,
      amountCents: amountCents === null ? null : amountCents,
      traceNumber: traceRaw || null,
      correctedData,
      applyBy: kind === "noc" ? nocApplyBy(receivedOn, null) : null,
    },
  };
}

function codeLabel(code: string): string | null {
  return ACH_CODES[code]?.label ?? null;
}

/** The hold reason written on the vault / authorization (0259 needs a NEW non-empty reason). */
export function noticeHoldReason(n: Pick<ParsedNotice, "kind" | "code" | "receivedOn" | "codeLabel">): string {
  const what = n.kind === "noc" ? "Bank correction (NOC)" : "ACH return";
  return `${what} ${n.code}${n.codeLabel ? ` (${n.codeLabel})` : ""} received ${n.receivedOn}. Call the payee at a number on file, fix the details, then release.`.slice(0, 500);
}

export function maskTail(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  return d.length ? `\u2022\u2022\u2022\u2022${d.slice(-4)}` : null;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function money(c: number | null): string {
  if (c === null) return "not given";
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Email to Stephen, Michael and the store (owner Q9). Never a full number. */
export function noticeOwnerEmail(i: {
  notice: ParsedNotice;
  payeeName: string;
  held: boolean;
  holdDetail: string;
  loggedBy: string;
  bankingUrl: string;
}): { subject: string; html: string; text: string } {
  const n = i.notice;
  const kindWord = n.kind === "noc" ? "bank correction (NOC)" : "returned payment";
  const name = i.payeeName.replace(/[\r\n]/g, " ").slice(0, 80);
  const subject = `ACH ${kindWord} ${n.code} for ${name}${i.held ? " - on hold" : " - ACTION NEEDED"}`;
  const lines = [
    `Payee: ${name} (${n.payeeType})`,
    `Code: ${n.code}${n.codeLabel ? ` - ${n.codeLabel}` : " - not a code this system knows"}`,
    `What to do: ${n.plain}`,
    `Notice date: ${n.receivedOn}${n.applyBy ? ` | apply the correction by ${n.applyBy}` : ""}`,
    `Amount: ${money(n.amountCents)}${n.traceNumber ? ` | trace ending ${n.traceNumber.slice(-4)}` : ""}`,
    n.correctedData ? `Corrected information ends ${maskTail(n.correctedData) ?? "(see the vault)"} (full value is encrypted in the log)` : null,
    `Account status: ${i.holdDetail}`,
    `Logged by: ${i.loggedBy}`,
    `Open the banking page: ${i.bankingUrl}`,
    "Call the payee only at a number already on file (not one from an email or the notice).",
  ].filter((x): x is string => Boolean(x));
  const text = lines.join("\n");
  const html = `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;line-height:1.5">${lines.map((l) => `<p style="margin:0 0 8px">${esc(l)}</p>`).join("")}</div>`;
  return { subject, html, text };
}

export type OpenNoticeRow = { id: string; notice_kind: NoticeKind; code: string; received_on: string; apply_by: string | null };

/** For the banking page: which open notices are overdue or due within 2 days. */
export function noticeUrgency(r: OpenNoticeRow, todayIso: string): "overdue" | "due_soon" | "open" {
  if (r.notice_kind !== "noc" || !r.apply_by) return "open";
  if (r.apply_by < todayIso) return "overdue";
  return daysApart(todayIso, r.apply_by) <= 2 ? "due_soon" : "open";
}

export const MIN_RESOLUTION_NOTE_CHARS = 10;

export function checkResolutionNote(raw: string | null | undefined): { ok: true; note: string } | { ok: false; error: string } {
  const note = String(raw ?? "").trim().replace(/\s+/g, " ").slice(0, 500);
  if (note.length < MIN_RESOLUTION_NOTE_CHARS) return { ok: false, error: `Say what was done (at least ${MIN_RESOLUTION_NOTE_CHARS} characters), for example "Called Bob at 360-555-0199 on file; new account entered in the vault".` };
  if (/\d{7,}/.test(note.replace(/\d{3}-\d{3}-\d{4}/g, ""))) return { ok: false, error: "Please do not put account or routing numbers in the note." };
  return { ok: true, note };
}

export function __runAchReturnLogCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (c: boolean, label: string) => {
    if (c) passed++;
    else {
      failed++;
      console.error(`[ach-return-log-core] FAIL: ${label}`);
    }
  };
  const V = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const T = "2026-10-05";
  const f = (o: Record<string, string>) => (k: string) => o[k] ?? "";

  // money
  ok(parseDollarsToCents("$1,234.56") === 123456, "dollars with $ and comma");
  ok(parseDollarsToCents("12") === 1200 && parseDollarsToCents("12.5") === 1250, "whole and one decimal");
  ok(parseDollarsToCents("") === null && parseDollarsToCents("  ") === null, "blank -> null");
  ok(Number.isNaN(parseDollarsToCents("12.345") as number) && Number.isNaN(parseDollarsToCents("-5") as number) && Number.isNaN(parseDollarsToCents("1e3") as number), "bad -> NaN");

  // return
  const r = parseReturnNotice(f({ payee: `vendor:${V}`, code: " r03 ", received_on: T, settlement_date: "2026-10-01", amount: "1,500.00", trace: "0210 0002 1000 001" }), T);
  ok(r.ok, "good return parses");
  if (r.ok) {
    ok(r.notice.kind === "return" && r.notice.code === "R03" && r.notice.known, "R03 return, upper-cased, known");
    ok(r.notice.action === "hold_get_new_info" && r.notice.applyBy === null, "R03 action; no apply-by for returns");
    ok(r.notice.amountCents === 150000 && r.notice.traceNumber === "021000021000001", "amount and trace normalised");
    ok(r.notice.codeLabel === "No account or unable to locate account", "label from ACH_CODES");
  }
  // NOC
  const n = parseReturnNotice(f({ payee: `employee:${V}`, code: "C01", received_on: T, corrected: "0012 3456 78" }), T);
  ok(n.ok && n.notice.kind === "noc" && n.notice.applyBy === "2026-10-14", "C01 NOC; apply by 6 banking days: Oct 6,7,8,9,13,14 (Oct 12 Columbus Day skipped)");
  ok(n.ok && n.notice.correctedData === "0012 3456 78", "corrected data kept as typed (store encrypts it)");
  ok(!parseReturnNotice(f({ payee: `vendor:${V}`, code: "C01", received_on: T }), T).ok, "NOC without corrected data refused");
  ok(!parseReturnNotice(f({ payee: `vendor:${V}`, code: "C02", received_on: T, corrected: "021000022" }), T).ok, "C02 bad check digit refused");
  ok(parseReturnNotice(f({ payee: `vendor:${V}`, code: "C02", received_on: T, corrected: "021000021" }), T).ok, "C02 good routing ok");
  ok(!parseReturnNotice(f({ payee: `vendor:${V}`, code: "C05", received_on: T, corrected: "27" }), T).ok, "C05 debit code refused (credits only)");
  ok(parseReturnNotice(f({ payee: `vendor:${V}`, code: "C05", received_on: T, corrected: "32" }), T).ok, "C05 32 ok");
  ok(!parseReturnNotice(f({ payee: `vendor:${V}`, code: "R03", received_on: T, corrected: "123" }), T).ok, "corrected data on a return refused");
  ok(!parseReturnNotice(f({ payee: `vendor:${V}`, code: "C03", received_on: T, corrected: "abc" }), T).ok, "letters refused");
  // unknown
  const u = parseReturnNotice(f({ payee: `vendor:${V}`, code: "R99", received_on: T }), T);
  ok(u.ok && !u.notice.known && u.notice.action === "hold_investigate_fraud" && u.notice.codeLabel === null, "unknown code -> fraud hold, no invented label");
  // R41 S15: R90 (Nacha, from 2028-03-17) is known, held as possible fraud, with Nacha's title
  const r90 = parseReturnNotice(f({ payee: `vendor:${V}`, code: "r90", received_on: T }), T);
  ok(r90.ok && r90.notice.known && r90.notice.kind === "return" && r90.notice.action === "hold_investigate_fraud" && r90.notice.codeLabel === "Entry Returned Due to RDFI\u2019s Sanctions Compliance Obligations", "R90 sanctions return: known, fraud hold, Nacha label");
  // refusals
  const bad = parseReturnNotice(f({ payee: "vendor:nope", code: "X1", received_on: "2026-10-06", settlement_date: "2026-02-30", amount: "abc", trace: "123" }), T);
  ok(!bad.ok && Object.keys(bad.errors).sort().join(",") === "amount,code,payee,received_on,settlement_date,trace", "every bad field reported");
  ok(!parseReturnNotice(f({ payee: `vendor:${V}`, code: "R03", received_on: "2025-08-01" }), T).ok, "older than 400 days refused");
  ok(!parseReturnNotice(f({ payee: `vendor:${V}`, code: "R03", received_on: "2026-10-01", settlement_date: "2026-10-02" }), T).ok, "settlement after notice refused");
  ok(!parseReturnNotice(f({ payee: `bank:${V}`, code: "R03", received_on: T }), T).ok, "unknown payee type refused");

  // hold reason, masking, email
  const hr = noticeHoldReason({ kind: "noc", code: "C01", receivedOn: T, codeLabel: "Incorrect bank account number" });
  ok(hr.startsWith("Bank correction (NOC) C01 (Incorrect bank account number) received 2026-10-05") && hr.length <= 500, "hold reason");
  ok(maskTail("0012 3456 78") === "\u2022\u2022\u2022\u20225678" && maskTail(null) === null, "mask last 4");
  if (n.ok) {
    const em = noticeOwnerEmail({ notice: n.notice, payeeName: "Pat <b>Worker</b>", held: true, holdDetail: "Authorization put on hold.", loggedBy: "Michael", bankingUrl: "https://www.greenwaymarijuana.com/admin/settings/banking" });
    ok(!em.text.includes("0012345678") && !em.text.includes("3456 78") && em.text.includes("\u2022\u2022\u2022\u20225678"), "email never carries the corrected number");
    ok(em.html.includes("&lt;b&gt;") && !em.html.includes("<b>Worker"), "email html escaped");
    ok(em.subject.endsWith("- on hold") && em.text.includes("apply the correction by 2026-10-14"), "subject + deadline");
    const em2 = noticeOwnerEmail({ notice: n.notice, payeeName: "X", held: false, holdDetail: "No authorization to hold.", loggedBy: "M", bankingUrl: "u" });
    ok(em2.subject.endsWith("ACTION NEEDED"), "not held -> ACTION NEEDED");
  }
  if (u.ok) ok(noticeOwnerEmail({ notice: u.notice, payeeName: "X", held: true, holdDetail: "h", loggedBy: "M", bankingUrl: "u" }).text.includes("not a code this system knows"), "unknown code says so");

  // urgency
  ok(noticeUrgency({ id: "1", notice_kind: "noc", code: "C01", received_on: T, apply_by: "2026-10-04" }, T) === "overdue", "past apply-by -> overdue");
  ok(noticeUrgency({ id: "1", notice_kind: "noc", code: "C01", received_on: T, apply_by: "2026-10-07" }, T) === "due_soon", "2 days -> due soon");
  ok(noticeUrgency({ id: "1", notice_kind: "noc", code: "C01", received_on: T, apply_by: "2026-10-08" }, T) === "open", "3 days -> open");
  ok(noticeUrgency({ id: "1", notice_kind: "return", code: "R03", received_on: T, apply_by: null }, T) === "open", "return -> open");

  // resolution note
  ok(!checkResolutionNote("done").ok, "short note refused");
  ok(checkResolutionNote("Called Bob at 360-555-0199 on file; new account in vault").ok, "phone number allowed in note");
  ok(!checkResolutionNote("New account is 0012345678 now").ok, "account number in note refused");
  return { passed, failed };
}
