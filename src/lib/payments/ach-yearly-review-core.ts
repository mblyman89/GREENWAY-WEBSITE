/**
 * src/lib/payments/ach-yearly-review-core.ts  (R41 S14, PURE)
 *
 * Nacha's yearly obligations for an Originator, from the Phase 2 fraud
 * monitoring rule (mirrored verbatim at docs/authorities/ach/nacha-fraud-
 * monitoring-phase-2.txt; every quote below is checked against that file):
 *
 *   1. "establish and implement risk-based processes and procedures ..." :
 *      the written procedure already lives in ach-calendar-core
 *      (ACH_FRAUD_PROCEDURE). This file adds the RISK ASSESSMENT Nacha calls
 *      the minimum ("identify and differentiate higher-risk from lower-risk
 *      transactions").
 *   2. "review (at least annually) these processes and procedures ..." :
 *      a durable yearly review record (table ach_annual_reviews, 0288): who,
 *      when, what was decided, and a fingerprint of the exact procedure and
 *      risk assessment text that was reviewed.
 *   3. A segregation-of-duties report for the reviewer: who holds owner or
 *      admin, every ACH action by person (from the Security Log), every
 *      owner-approval request and its outcome, and plain findings.
 *
 * The risk levels are GREENWAY'S assessment (Nacha prescribes none: "Do the
 * Rules prescribe specific processes and procedures ...? No."). The owner
 * confirms them when recording the review; the fingerprint shows later which
 * wording he confirmed.
 *
 * No I/O. No account numbers anywhere: inputs carry names, roles, action names
 * and dates only.
 */
import { createHash } from "node:crypto";
import { ACH_FRAUD_PROCEDURE } from "@/lib/payments/ach-calendar-core";
import { pacificDayKey, pacificWallTimeToUtcISO } from "@/lib/reports/timezone";

export const PHASE2_FILE = "ach/nacha-fraud-monitoring-phase-2.txt";

/** Verbatim from the Phase 2 mirror (whitespace-flattened comparison). */
export const PHASE2_QUOTES = {
  requirement:
    "establish and implement risk-based processes and procedures, relevant to the role it plays in the authorization or Transmission of Entries, that are reasonably intended to identify Entries that are suspected of being unauthorized or authorized under False Pretenses; and",
  annual: "review (at least annually) these processes and procedures and make appropriate updates to address evolving risks.",
  annualFaq:
    "Yes. The rules require these parties to review their processes and procedures at least annually and make appropriate updates to address evolving risks.",
  minimum:
    "A risk-based approach should not be used, however, to conclude that no monitoring is necessary at all. At a minimum, an entity applying a risk-based approach should conduct a risk assessment to identify and differentiate higher-risk from lower-risk transactions.",
  levels:
    "A party might take extra measures to detect fraud in transactions in which it has determined risks to be elevated; take basic precautions where it has determined that risks are lower, and exempt transactions or activities that it determines involve very low risk.",
  originators:
    "Originators may be best placed to implement procedures to protect against account takeover or other vectors for initiating unauthorized transactions. Such procedures could include change controls regarding payment information and instructions for vendor and payroll payments.",
  falsePretenses:
    "the inducement of a payment by a Person misrepresenting (a) that Person\u2019s identity, (b) that Person\u2019s association with or authority to act on behalf of another Person, or (c) the ownership of an account to be credited.",
  notEveryEntry: "Do the rules require ODFIs, non-consumer Originators, Third-Party Senders, and Third-Party Service Providers to screen every ACH entry individually?",
} as const;
export type Phase2QuoteId = keyof typeof PHASE2_QUOTES;

export type RiskLevel = "higher" | "lower" | "very_low";

export type RiskRow = {
  readonly id: string;
  readonly payment: string;
  readonly level: RiskLevel;
  /** Why, in plain words, tied to a Phase 2 quote. */
  readonly why: string;
  readonly quote: Phase2QuoteId;
  /** 1-based numbers into ACH_FRAUD_PROCEDURE: the controls that answer this risk. */
  readonly procedureItems: readonly number[];
};

export const RISK_LEVEL_WORD: Readonly<Record<RiskLevel, string>> = {
  higher: "Higher risk: extra measures",
  lower: "Lower risk: basic precautions",
  very_low: "Very low risk: little or no money moves",
};

/**
 * Greenway's risk assessment. Greenway only sends credits (payroll PPD and
 * vendor CCD, service class 220); it never debits anyone. The fraud it can
 * suffer is money sent to the wrong account: a changed or new account
 * (False Pretenses), or someone else using the bank login (account takeover).
 */
export const RISK_ASSESSMENT: readonly RiskRow[] = [
  {
    id: "bank-change",
    payment: "Any payment after a payee's routing number, account number or account type changed",
    level: "higher",
    why: "\"Change my account\" emails are the most common way money is sent to a thief. Nacha's False Pretenses definition names it: misrepresenting the ownership of an account to be credited.",
    quote: "falsePretenses",
    procedureItems: [1, 2, 3, 4],
  },
  {
    id: "new-vendor",
    payment: "The first payment to a new vendor (CCD)",
    level: "higher",
    why: "Vendor impersonation (someone pretending to be a vendor, or to act for one) is covered by False Pretenses parts (a) and (b).",
    quote: "falsePretenses",
    procedureItems: [1, 4],
  },
  {
    id: "new-employee",
    payment: "The first direct deposit to a new employee account (PPD)",
    level: "higher",
    why: "Payroll impersonation: a request to send pay somewhere new. The account is checked before real pay goes to it.",
    quote: "falsePretenses",
    procedureItems: [1, 5],
  },
  {
    id: "bank-login",
    payment: "Any file uploaded to Timberland (the bank login itself)",
    level: "higher",
    why: "Nacha says Originators are best placed to protect against account takeover. One person (Michael) holds the Timberland login, with a code.",
    quote: "originators",
    procedureItems: [10, 12],
  },
  {
    id: "repeat-payroll",
    payment: "Regular payroll to an employee account that has not changed and was checked",
    level: "lower",
    why: "Same person, same checked account, every two weeks. Basic precautions: one file per period, one payment per person, amount ceilings, and a warning if the account changed.",
    quote: "levels",
    procedureItems: [9, 11],
  },
  {
    id: "repeat-vendor",
    payment: "A payment to a vendor whose released bank details have not changed",
    level: "lower",
    why: "The details were verified and released earlier and have not changed. Basic precautions: the monthly statement check and the returns log.",
    quote: "levels",
    procedureItems: [6, 11],
  },
  {
    id: "prenote",
    payment: "Prenotes (zero dollars) and account-check test credits (a few cents)",
    level: "very_low",
    why: "No real pay moves: a prenote carries no money and a test credit only cents. Test credits are watched for unusual volume or returns.",
    quote: "levels",
    procedureItems: [7],
  },
];

/**
 * The fingerprint of what the owner reviews: the procedure text and the risk
 * assessment, in order. Stored with each review, so a later reader can tell
 * whether the wording changed after it was reviewed.
 */
export function reviewedTextFingerprint(): string {
  const lines = [
    ...ACH_FRAUD_PROCEDURE.map((p, i) => `P${i + 1}|${p.rule}|${p.enforcedBy ?? ""}`),
    ...RISK_ASSESSMENT.map((r) => `R|${r.id}|${r.level}|${r.payment}|${r.why}|${r.procedureItems.join(",")}`),
  ];
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

// ───────────────────────────────────────────────────────────── review records

export type ReviewOutcome = "no_changes" | "changes_made" | "changes_needed";

export const OUTCOME_WORD: Readonly<Record<ReviewOutcome, string>> = {
  no_changes: "Reviewed: no changes needed",
  changes_made: "Reviewed: changes were made",
  changes_needed: "Reviewed: changes are still needed",
};

export type AnnualReviewRow = {
  id: string;
  review_year: number;
  reviewed_on: string;
  outcome: ReviewOutcome;
  summary: string;
  procedure_sha256: string;
  corrects_id: string | null;
  created_by: string;
  created_at: string;
};

export type ReviewInsert = {
  reviewYear: number;
  outcome: ReviewOutcome;
  summary: string;
  correctsId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The first year the Phase 2 rule applied (effective June 19, 2026). */
export const FIRST_REVIEW_YEAR = 2026;

/**
 * The form. The year is this year or last year (a review done at year-end
 * may be recorded in early January). Both boxes must be ticked: the risk
 * assessment was confirmed and the segregation-of-duties report was read.
 */
export function checkYearlyReviewForm(
  get: (k: string) => string | null,
  todayIso: string,
): { ok: true; row: ReviewInsert } | { ok: false; error: string } {
  const thisYear = Number(todayIso.slice(0, 4));
  const yRaw = (get("review_year") ?? "").trim();
  if (!/^\d{4}$/.test(yRaw)) return { ok: false, error: "Choose the year this review is for." };
  const reviewYear = Number(yRaw);
  if (reviewYear < FIRST_REVIEW_YEAR) return { ok: false, error: `The first year with this rule is ${FIRST_REVIEW_YEAR}.` };
  if (reviewYear > thisYear) return { ok: false, error: "A review cannot be for a future year." };
  if (reviewYear < thisYear - 1) return { ok: false, error: "Only this year's or last year's review can be recorded." };
  const outcome = (get("outcome") ?? "").trim();
  if (outcome !== "no_changes" && outcome !== "changes_made" && outcome !== "changes_needed") return { ok: false, error: "Choose what the review found." };
  const summary = (get("summary") ?? "").trim();
  if (summary.length < 20) return { ok: false, error: "Write at least a sentence (20 characters): what you looked at and what you decided." };
  if (summary.length > 2000) return { ok: false, error: "Keep the summary under 2,000 characters." };
  if (/[0-9]{7,}/.test(summary)) return { ok: false, error: "Please do not put account or routing numbers in the summary." };
  if (get("risk_confirmed") !== "1") return { ok: false, error: "Tick the box to confirm the risk assessment (or say in the summary what should change and choose 'changes are still needed')." };
  if (get("sod_reviewed") !== "1") return { ok: false, error: "Tick the box to confirm you read the who-did-what report." };
  const cRaw = (get("corrects_id") ?? "").trim();
  if (cRaw && !UUID.test(cRaw)) return { ok: false, error: "The review to correct was not recognised. Reload the page." };
  return { ok: true, row: { reviewYear, outcome, summary, correctsId: cRaw || null } };
}

/** Database errors in plain words (0288 guard codes). */
export function reviewDbErrorMessage(raw: string): string {
  if (/ACH_YEARLY_APPEND_ONLY/.test(raw)) return "A yearly review is never changed or deleted. Add a correction instead.";
  if (/ACH_OWNER_ONLY/.test(raw)) return "Only the owner records the yearly review.";
  if (/ACH_YEARLY_YEAR/.test(raw)) return "That year cannot be recorded (only this year or last year, from 2026).";
  if (/ACH_YEARLY_CORRECTS/.test(raw)) return "A correction must point at a review of the same year.";
  if (/23505|duplicate key|aar_one_per_year/.test(raw)) return "This year's review is already recorded. To change it, add a correction to it.";
  if (/check constraint|23514/.test(raw)) return "The database refused the review (a field is out of range). Nothing was saved.";
  return "The review could not be saved. Nothing was saved; try again.";
}

export type YearStatus = {
  year: number;
  /** The review that stands: the newest correction, or the original. */
  current: AnnualReviewRow | null;
  original: AnnualReviewRow | null;
  corrections: AnnualReviewRow[];
  /** true when the reviewed fingerprint differs from today's text. */
  textChangedSince: boolean;
};

export function yearStatus(rows: readonly AnnualReviewRow[], year: number, fingerprintNow: string): YearStatus {
  const mine = rows.filter((r) => r.review_year === year);
  const original = mine.find((r) => r.corrects_id === null) ?? null;
  const corrections = mine.filter((r) => r.corrects_id !== null).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const current = corrections.length ? corrections[corrections.length - 1] : original;
  return { year, current, original, corrections, textChangedSince: current !== null && current.procedure_sha256 !== fingerprintNow };
}

// ──────────────────────────────────────────────────── segregation of duties

export type StaffRow = { id: string; email: string | null; full_name: string | null; role: string; active: boolean; last_login_at: string | null };
export type AuditRow = { id: number; actor_id: string | null; actor_email: string | null; action: string; created_at: string };
export type RequestRow = {
  id: string;
  kind: string;
  target_label: string;
  requested_by: string;
  requested_at: string;
  status: string;
  decided_by: string | null;
  decided_at: string | null;
  apply_error: string | null;
};
export type OwnerReviewRow = { id: string; kind: string; target_label: string; done_by: string; done_at: string; checked_off_by: string | null; checked_off_at: string | null };

/**
 * Which Security Log actions are "ACH actions". Each prefix is one that the
 * banking, payroll and vendor-payment code writes today (read from the
 * recordAudit calls). Kept explicit: a new prefix must be added on purpose.
 */
export const ACH_AUDIT_PREFIXES = [
  "ach.",
  "ach_document.",
  "banking.",
  "payee_banking.",
  "payee_contact.",
  "payroll.run.",
  "vendor_ach.",
  "vendor_esign.",
  "vendor.ach_flag.",
  "vendor_payment.",
] as const;

export function isAchAction(action: string): boolean {
  return ACH_AUDIT_PREFIXES.some((p) => action.startsWith(p));
}

/** The Pacific calendar year as a UTC half-open window [from, to). */
export function yearWindowUtc(year: number): { fromIso: string; toIso: string } {
  return { fromIso: pacificWallTimeToUtcISO(`${year}-01-01`, "start"), toIso: pacificWallTimeToUtcISO(`${year + 1}-01-01`, "start") };
}

export type Finding = { level: "warn" | "info"; code: string; text: string };

export type SodReport = {
  year: number;
  holders: { who: string; role: string; active: boolean; lastLogin: string | null }[];
  people: { who: string; role: string; total: number; actions: { action: string; count: number }[] }[];
  requests: {
    counts: Record<string, number>;
    rows: { kind: string; target: string; requestedBy: string; requestedOn: string; status: string; decidedBy: string | null; decidedOn: string | null; applyError: boolean }[];
  };
  stopActions: { total: number; unchecked: number };
  findings: Finding[];
};

const PRIVILEGED = new Set(["owner", "admin"]);

/**
 * The who-did-what report for one Pacific year. Rows outside the year are
 * ignored (the store reads by the same window; this is the second check).
 */
export function buildSodReport(input: {
  year: number;
  staff: readonly StaffRow[];
  audit: readonly AuditRow[];
  requests: readonly RequestRow[];
  stopReviews: readonly OwnerReviewRow[];
}): SodReport {
  const { fromIso, toIso } = yearWindowUtc(input.year);
  const inYear = (iso: string | null) => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return t >= Date.parse(fromIso) && t < Date.parse(toIso);
  };
  const byId = new Map(input.staff.map((s) => [s.id, s]));
  const name = (id: string | null, fallbackEmail?: string | null): string => {
    if (!id) return fallbackEmail ? `${fallbackEmail} (no staff id)` : "System (no person)";
    const s = byId.get(id);
    if (!s) return fallbackEmail ? `${fallbackEmail} (unknown staff id)` : "Unknown staff id";
    return (s.full_name ?? "").trim() || s.email || "Unnamed staff";
  };
  const roleOf = (id: string | null) => (id ? byId.get(id)?.role ?? "unknown" : "none");
  const findings: Finding[] = [];

  // 1. Who holds owner or admin.
  const holders = input.staff
    .filter((s) => PRIVILEGED.has(s.role))
    .sort((a, b) => (a.role === b.role ? name(a.id).localeCompare(name(b.id)) : a.role === "owner" ? -1 : 1))
    .map((s) => ({ who: name(s.id), role: s.role, active: s.active, lastLogin: s.last_login_at }));
  const activeOwners = input.staff.filter((s) => s.role === "owner" && s.active);
  if (activeOwners.length === 0) findings.push({ level: "warn", code: "no_active_owner", text: "No active owner. Nobody can approve ACH requests, and the procedure names the owner as the one who approves." });
  if (activeOwners.length > 1)
    findings.push({ level: "warn", code: "several_owners", text: `${activeOwners.length} active owners. The written procedure says one person (the owner) approves every ACH change; check this is intended.` });
  for (const s of input.staff.filter((x) => PRIVILEGED.has(x.role) && !x.active))
    findings.push({ level: "info", code: "inactive_privileged", text: `${name(s.id)} is inactive but still has the ${s.role} role. Inactive users cannot sign in; consider lowering the role.` });

  // 2. Every ACH action by person.
  const per = new Map<string, { who: string; role: string; counts: Map<string, number> }>();
  for (const a of input.audit) {
    if (!isAchAction(a.action) || !inYear(a.created_at)) continue;
    const key = a.actor_id ?? `email:${a.actor_email ?? ""}`;
    let p = per.get(key);
    if (!p) {
      p = { who: name(a.actor_id, a.actor_email), role: roleOf(a.actor_id), counts: new Map() };
      per.set(key, p);
    }
    p.counts.set(a.action, (p.counts.get(a.action) ?? 0) + 1);
  }
  const people = [...per.values()]
    .map((p) => ({
      who: p.who,
      role: p.role,
      total: [...p.counts.values()].reduce((s, n) => s + n, 0),
      actions: [...p.counts.entries()].map(([action, count]) => ({ action, count })).sort((x, y) => y.count - x.count || x.action.localeCompare(y.action)),
    }))
    .sort((a, b) => b.total - a.total || a.who.localeCompare(b.who));
  for (const p of people) {
    if (p.role === "none" || p.role === "unknown")
      findings.push({ level: "info", code: "unattributed", text: `${p.total} ACH action(s) are recorded under "${p.who}". Check who did them.` });
    else if (!PRIVILEGED.has(p.role))
      findings.push({ level: "warn", code: "acted_without_role", text: `${p.who} (now ${p.role}) has ${p.total} ACH action(s) this year. Only the owner and admins should touch ACH.` });
  }

  // 3. Every request and its outcome.
  const counts: Record<string, number> = { pending: 0, approved: 0, rejected: 0, withdrawn: 0, superseded: 0 };
  const reqRows = input.requests
    .filter((r) => inYear(r.requested_at))
    .sort((a, b) => a.requested_at.localeCompare(b.requested_at));
  for (const r of reqRows) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
    if ((r.status === "approved" || r.status === "rejected") && r.decided_by !== null && r.decided_by === r.requested_by)
      findings.push({ level: "warn", code: "self_decided", text: `${name(r.requested_by)} both asked for and decided "${r.kind}" (${r.target_label || "no label"}) on ${pacificDayKey(r.requested_at)}.` });
    if (r.status === "approved" && r.apply_error)
      findings.push({ level: "warn", code: "apply_error", text: `"${r.kind}" (${r.target_label || "no label"}) was approved but did not apply. Check it was redone.` });
  }
  if (counts.pending) findings.push({ level: "info", code: "pending", text: `${counts.pending} request(s) from this year are still waiting for the owner.` });

  // 4. Stop actions an admin took at once (D-6), checked off by the owner?
  const stops = input.stopReviews.filter((r) => inYear(r.done_at));
  const unchecked = stops.filter((r) => !r.checked_off_at).length;
  if (unchecked) findings.push({ level: "warn", code: "unchecked_stop", text: `${unchecked} stop action(s) taken by an admin have not been checked off by the owner (Approvals page).` });

  return {
    year: input.year,
    holders,
    people,
    requests: {
      counts,
      rows: reqRows.map((r) => ({
        kind: r.kind,
        target: r.target_label,
        requestedBy: name(r.requested_by),
        requestedOn: pacificDayKey(r.requested_at),
        status: r.status,
        decidedBy: r.decided_by ? name(r.decided_by) : null,
        decidedOn: r.decided_at ? pacificDayKey(r.decided_at) : null,
        applyError: Boolean(r.apply_error),
      })),
    },
    stopActions: { total: stops.length, unchecked },
    findings: findings.sort((a, b) => (a.level === b.level ? 0 : a.level === "warn" ? -1 : 1)),
  };
}

// ──────────────────────────────────────────────────────────────── the packet

function wrap(text: string, width = 92, indent = "   "): string {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && line.length + 1 + w.length > width) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out.map((l) => `${indent}${l}`).join("\n");
}

/**
 * The printable yearly review packet (plain text). The SoD section is only
 * included when given (the route is owner-only: the Security Log is).
 */
export function yearlyReviewPacket(input: {
  year: number;
  generatedAt: Date;
  generatedBy: string;
  reviews: readonly AnnualReviewRow[];
  reviewerName: (id: string) => string;
  sod: SodReport | null;
}): string {
  const fp = reviewedTextFingerprint();
  const st = yearStatus(input.reviews, input.year, fp);
  const L: string[] = [];
  const rule = "=".repeat(92);
  L.push(rule, `GREENWAY ACH FRAUD PROCEDURE: YEARLY REVIEW PACKET FOR ${input.year}`, rule);
  L.push(`Made ${pacificDayKey(input.generatedAt)} (Pacific) by ${input.generatedBy}. No account numbers are in this packet.`);
  L.push(`Fingerprint of the procedure and risk assessment below (SHA-256): ${fp}`, "");

  L.push("1. WHAT NACHA REQUIRES (Fraud Monitoring Phase 2, effective June 19, 2026)", "");
  for (const id of ["requirement", "annual", "minimum", "originators"] as const) L.push(wrap(`"${PHASE2_QUOTES[id]}"`), "");
  L.push(`   Verbatim from docs/authorities/${PHASE2_FILE}`, "");

  L.push("2. GREENWAY'S WRITTEN FRAUD PROCEDURE", "");
  ACH_FRAUD_PROCEDURE.forEach((p, i) => {
    L.push(wrap(`${i + 1}. ${p.rule}`, 92, "   "));
    L.push(`      ${p.enforcedBy ? `Enforced by the software: ${p.enforcedBy}` : "A habit (the software cannot enforce it)."}`);
  });
  L.push("");

  L.push("3. RISK ASSESSMENT (higher-risk and lower-risk payments)", "");
  L.push(wrap(`"${PHASE2_QUOTES.levels}"`), "");
  for (const r of RISK_ASSESSMENT) {
    L.push(`   [${RISK_LEVEL_WORD[r.level]}] ${r.payment}`);
    L.push(wrap(r.why, 92, "      "));
    L.push(`      Answered by procedure item(s): ${r.procedureItems.join(", ")}`);
  }
  L.push("");

  L.push(`4. REVIEW RECORD FOR ${input.year}`, "");
  if (!st.original) L.push("   NOT RECORDED YET. Nacha requires a review at least once a year.");
  for (const r of [st.original, ...st.corrections].filter((x): x is AnnualReviewRow => x !== null)) {
    L.push(`   ${r.corrects_id ? "Correction" : "Review"} recorded ${r.reviewed_on} by ${input.reviewerName(r.created_by)}: ${OUTCOME_WORD[r.outcome]}`);
    L.push(wrap(r.summary, 92, "      "));
    L.push(`      Reviewed text fingerprint: ${r.procedure_sha256}${r.procedure_sha256 === fp ? " (same as today)" : " (the text has changed since)"}`);
  }
  L.push("");

  const s = input.sod;
  if (s) {
    L.push(`5. SEGREGATION OF DUTIES, ${s.year} (from the Security Log and the approvals records)`, "");
    L.push("   Who holds owner or admin:");
    if (!s.holders.length) L.push("      nobody");
    for (const h of s.holders) L.push(`      ${h.who}: ${h.role}${h.active ? "" : " (INACTIVE)"}; last sign-in ${h.lastLogin ? pacificDayKey(h.lastLogin) : "never"}`);
    L.push("", "   Findings:");
    if (!s.findings.length) L.push("      none");
    for (const f of s.findings) L.push(wrap(`${f.level === "warn" ? "CHECK" : "Note"}: ${f.text}`, 92, "      "));
    L.push("", "   Every ACH action by person:");
    if (!s.people.length) L.push("      none recorded this year");
    for (const p of s.people) {
      L.push(`      ${p.who} (${p.role}): ${p.total}`);
      for (const a of p.actions) L.push(`         ${String(a.count).padStart(5)}  ${a.action}`);
    }
    const c = s.requests.counts;
    L.push("", `   Owner-approval requests: ${s.requests.rows.length} (approved ${c.approved ?? 0}, rejected ${c.rejected ?? 0}, withdrawn ${c.withdrawn ?? 0}, superseded ${c.superseded ?? 0}, pending ${c.pending ?? 0})`);
    for (const r of s.requests.rows)
      L.push(wrap(`${r.requestedOn} ${r.kind} (${r.target || "no label"}) asked by ${r.requestedBy}: ${r.status}${r.decidedBy ? ` by ${r.decidedBy} on ${r.decidedOn}` : ""}${r.applyError ? " (did not apply)" : ""}`, 92, "      "));
    L.push("", `   Stop actions taken by an admin at once: ${s.stopActions.total}, not yet checked off by the owner: ${s.stopActions.unchecked}`, "");
  }
  L.push(rule, "END OF PACKET", rule, "");
  return L.join("\n");
}

// ───────────────────────────────────────────────────────────────── self-tests

export function __runAchYearlyReviewCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL ach-yearly-review-core: ${msg}`);
    }
  };
  // Risk assessment shape.
  ok(RISK_ASSESSMENT.some((r) => r.level === "higher") && RISK_ASSESSMENT.some((r) => r.level === "lower"), "both higher and lower risk rows (Nacha's minimum)");
  ok(new Set(RISK_ASSESSMENT.map((r) => r.id)).size === RISK_ASSESSMENT.length, "risk ids unique");
  ok(RISK_ASSESSMENT.every((r) => r.procedureItems.length > 0 && r.procedureItems.every((n) => Number.isInteger(n) && n >= 1 && n <= ACH_FRAUD_PROCEDURE.length)), "every risk row points at real procedure items");
  ok(RISK_ASSESSMENT.every((r) => r.quote in PHASE2_QUOTES), "every risk row cites a quote");
  ok(!RISK_ASSESSMENT.some((r) => /[0-9]{7,}/.test(r.why + r.payment)), "no long digit runs");
  const fp = reviewedTextFingerprint();
  ok(/^[0-9a-f]{64}$/.test(fp) && fp === reviewedTextFingerprint(), "fingerprint is stable SHA-256 hex");

  // Form.
  const form = (o: Record<string, string>) => checkYearlyReviewForm((k) => o[k] ?? null, "2026-12-20");
  const good = { review_year: "2026", outcome: "no_changes", summary: "Read all 12 items and the risk table; nothing got past the steps.", risk_confirmed: "1", sod_reviewed: "1" };
  const g = form(good);
  ok(g.ok && g.row.reviewYear === 2026 && g.row.correctsId === null, "good form");
  ok(!form({ ...good, review_year: "2027" }).ok, "future year refused");
  ok(!form({ ...good, review_year: "2025" }).ok, "before 2026 refused");
  ok(checkYearlyReviewForm((k) => ({ ...good, review_year: "2026" } as Record<string, string>)[k] ?? null, "2027-01-05").ok, "last year allowed in January");
  ok(!checkYearlyReviewForm((k) => ({ ...good, review_year: "2026" } as Record<string, string>)[k] ?? null, "2028-01-05").ok, "two years back refused");
  ok(!form({ ...good, outcome: "fine" }).ok, "unknown outcome refused");
  ok(!form({ ...good, summary: "ok" }).ok, "short summary refused");
  ok(!form({ ...good, summary: "Paid to account 123456789 which looked fine." }).ok, "account number refused");
  ok(form({ ...good, summary: "Called Timberland at 1-800-562-8761; all procedure steps held." }).ok, "the bank phone is allowed");
  ok(!form({ ...good, risk_confirmed: "" }).ok, "risk box required");
  ok(!form({ ...good, sod_reviewed: "0" }).ok, "who-did-what box required");
  ok(!form({ ...good, corrects_id: "nope" }).ok, "bad correction id refused");
  const cid = "11111111-2222-3333-4444-555555555555";
  const gc = form({ ...good, corrects_id: cid });
  ok(gc.ok && gc.row.correctsId === cid, "correction id kept");
  ok(/already recorded/.test(reviewDbErrorMessage("23505 duplicate key value violates unique constraint aar_one_per_year")), "unique message");
  ok(/never changed/.test(reviewDbErrorMessage("ACH_YEARLY_APPEND_ONLY: x")) && /owner/.test(reviewDbErrorMessage("ACH_OWNER_ONLY: x")), "guard messages");

  // Year status.
  const mk = (o: Partial<AnnualReviewRow>): AnnualReviewRow => ({
    id: cid,
    review_year: 2026,
    reviewed_on: "2026-12-20",
    outcome: "no_changes",
    summary: "x".repeat(20),
    procedure_sha256: fp,
    corrects_id: null,
    created_by: "u1",
    created_at: "2026-12-20T18:00:00Z",
    ...o,
  });
  const orig = mk({});
  const corr = mk({ id: "c2", corrects_id: cid, outcome: "changes_made", created_at: "2026-12-21T18:00:00Z", procedure_sha256: "0".repeat(64) });
  const ys = yearStatus([corr, orig, mk({ id: "o25", review_year: 2025 })], 2026, fp);
  ok(ys.original?.id === cid && ys.current?.id === "c2" && ys.corrections.length === 1, "newest correction stands");
  ok(ys.textChangedSince, "changed text detected");
  ok(yearStatus([], 2026, fp).current === null, "nothing recorded");

  // SoD.
  const staff: StaffRow[] = [
    { id: "o", email: "o@x", full_name: "Owner One", role: "owner", active: true, last_login_at: "2026-10-01T10:00:00Z" },
    { id: "a", email: "a@x", full_name: "Admin A", role: "admin", active: true, last_login_at: null },
    { id: "m", email: "m@x", full_name: "Manager M", role: "manager", active: true, last_login_at: null },
    { id: "x", email: "x@x", full_name: "", role: "admin", active: false, last_login_at: null },
  ];
  const audit: AuditRow[] = [
    { id: 1, actor_id: "o", actor_email: "o@x", action: "ach.request.approve", created_at: "2026-03-01T20:00:00Z" },
    { id: 2, actor_id: "o", actor_email: "o@x", action: "ach.request.approve", created_at: "2026-04-01T20:00:00Z" },
    { id: 3, actor_id: "a", actor_email: "a@x", action: "payroll.run.create", created_at: "2026-04-02T20:00:00Z" },
    { id: 4, actor_id: "m", actor_email: "m@x", action: "vendor_ach.generate", created_at: "2026-05-02T20:00:00Z" },
    { id: 5, actor_id: "o", actor_email: "o@x", action: "brand.updated", created_at: "2026-05-02T20:00:00Z" },
    { id: 6, actor_id: "o", actor_email: "o@x", action: "ach.file.voided", created_at: "2026-01-01T07:59:00Z" }, // Dec 31 2025 Pacific
    { id: 7, actor_id: "o", actor_email: "o@x", action: "ach.file.voided", created_at: "2026-01-01T08:00:00Z" }, // Jan 1 2026 Pacific
    { id: 8, actor_id: null, actor_email: null, action: "ach.calendar.done", created_at: "2026-06-01T20:00:00Z" },
  ];
  const requests: RequestRow[] = [
    { id: "r1", kind: "vendor_bank.save", target_label: "Acme", requested_by: "a", requested_at: "2026-03-01T19:00:00Z", status: "approved", decided_by: "o", decided_at: "2026-03-01T20:00:00Z", apply_error: null },
    { id: "r2", kind: "ach_file.void", target_label: "F1", requested_by: "o", requested_at: "2026-04-01T19:00:00Z", status: "approved", decided_by: "o", decided_at: "2026-04-01T20:00:00Z", apply_error: "boom" },
    { id: "r3", kind: "employee_bank.save", target_label: "E", requested_by: "a", requested_at: "2026-05-01T19:00:00Z", status: "pending", decided_by: null, decided_at: null, apply_error: null },
    { id: "r4", kind: "employee_bank.save", target_label: "E", requested_by: "a", requested_at: "2025-05-01T19:00:00Z", status: "rejected", decided_by: "o", decided_at: "2025-05-01T20:00:00Z", apply_error: null },
  ];
  const stops: OwnerReviewRow[] = [
    { id: "s1", kind: "ach_notice.log", target_label: "E", done_by: "a", done_at: "2026-06-01T19:00:00Z", checked_off_by: null, checked_off_at: null },
    { id: "s2", kind: "vendor_bank.hold", target_label: "V", done_by: "a", done_at: "2026-06-02T19:00:00Z", checked_off_by: "o", checked_off_at: "2026-06-03T19:00:00Z" },
  ];
  const rep = buildSodReport({ year: 2026, staff, audit, requests, stopReviews: stops });
  ok(rep.holders.length === 3 && rep.holders[0].role === "owner", "holders: owner first, admins after (inactive included)");
  const own = rep.people.find((p) => p.who === "Owner One");
  ok(own?.total === 3 && own.actions[0].action === "ach.request.approve" && own.actions[0].count === 2, "owner actions counted in-year, non-ACH ignored");
  ok(!rep.people.some((p) => p.actions.some((a) => a.action === "brand.updated")), "brand.updated is not ACH");
  ok(rep.findings.some((f) => f.code === "acted_without_role" && /Manager M/.test(f.text)), "manager ACH action flagged");
  ok(rep.findings.some((f) => f.code === "unattributed"), "system action noted");
  ok(rep.findings.some((f) => f.code === "self_decided" && /ach_file.void/.test(f.text)), "self-decided request flagged");
  ok(rep.findings.some((f) => f.code === "apply_error"), "apply error flagged");
  ok(rep.findings.some((f) => f.code === "pending"), "pending noted");
  ok(rep.findings.some((f) => f.code === "unchecked_stop") && rep.stopActions.total === 2 && rep.stopActions.unchecked === 1, "unchecked stop action flagged");
  ok(rep.findings.some((f) => f.code === "inactive_privileged"), "inactive admin noted");
  ok(!rep.findings.some((f) => f.code === "several_owners" || f.code === "no_active_owner"), "one owner: no owner finding");
  ok(rep.requests.rows.length === 3 && rep.requests.counts.approved === 2 && rep.requests.counts.pending === 1, "requests in year only");
  ok(rep.findings[0].level === "warn", "warnings first");
  const two = buildSodReport({ year: 2026, staff: [...staff, { id: "o2", email: null, full_name: "Owner Two", role: "owner", active: true, last_login_at: null }], audit: [], requests: [], stopReviews: [] });
  ok(two.findings.some((f) => f.code === "several_owners"), "two owners flagged");
  ok(buildSodReport({ year: 2026, staff: [], audit: [], requests: [], stopReviews: [] }).findings.some((f) => f.code === "no_active_owner"), "no owner flagged");
  ok(isAchAction("vendor.ach_flag.opt_out") && !isAchAction("vendor.updated") && isAchAction("payee_banking.vendor.release"), "ACH prefixes exact");
  const w = yearWindowUtc(2026);
  ok(w.fromIso === "2026-01-01T08:00:00.000Z" && w.toIso === "2027-01-01T08:00:00.000Z", "Pacific year window");

  // Packet.
  const pk = yearlyReviewPacket({ year: 2026, generatedAt: new Date("2026-12-20T20:00:00Z"), generatedBy: "Owner One", reviews: [orig, corr], reviewerName: () => "Owner One", sod: rep });
  ok(pk.includes("YEARLY REVIEW PACKET FOR 2026") && pk.includes(fp), "packet header and fingerprint");
  ok(pk.includes("2. GREENWAY'S WRITTEN FRAUD PROCEDURE") && pk.includes("3. RISK ASSESSMENT") && pk.includes("5. SEGREGATION OF DUTIES"), "packet sections");
  ok(pk.includes("Correction recorded") && pk.includes("(the text has changed since)") && pk.includes("(same as today)"), "packet review records");
  ok(pk.includes("CHECK:") && pk.includes("ach.request.approve"), "packet SoD content");
  ok(!/[0-9]{7,}/.test(pk.replace(/[0-9a-f]{64}/g, "")), "packet has no long digit runs besides fingerprints");
  const pk2 = yearlyReviewPacket({ year: 2027, generatedAt: new Date("2027-02-01T20:00:00Z"), generatedBy: "A", reviews: [], reviewerName: () => "?", sod: null });
  ok(pk2.includes("NOT RECORDED YET") && !pk2.includes("SEGREGATION OF DUTIES"), "no record, no SoD without permission");
  return { passed, failed };
}
