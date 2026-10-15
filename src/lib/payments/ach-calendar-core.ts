/**
 * src/lib/payments/ach-calendar-core.ts  (R40)
 *
 * The ACH record-keeping calendar and rule watch. PURE: no I/O, no clock (the
 * caller passes today's Pacific date as YYYY-MM-DD).
 *
 * The owner's ask: "a helper function that helps me keep track of the
 * important record keeping requirements and to remind me of when I need to do
 * something like update code based on legislation changes or ... sign a
 * yearly agreement."
 *
 * Three kinds of task:
 *   once      do it one time (adopt the fraud procedure, agreement on file,
 *             LlamaParse DPA if LlamaParse is turned on)
 *   monthly   reconcile last month's bank statement (RCW 62A.4A-204 / -505)
 *   quarterly look at Nacha's "New Rules" page for anything that needs code
 *   annual    year-end: fraud-procedure review (Nacha Phase 2 "at least
 *             annually"), Timberland agreement review, records review
 *
 * Plus a RULE WATCH: each upcoming Nacha rule, its effective date, the
 * verbatim sentence from Nacha's page (mirrored under docs/authorities/ach),
 * and whether Greenway's code needs a change. "watch" items remind 60 days
 * ahead so a code change is never a surprise.
 *
 * NOT LEGAL ADVICE: due dates here are Greenway's own house rules, chosen to
 * sit well inside the legal limits they cite.
 */

export type AchCalTaskId =
  | "fraud_procedure_adopt"
  | "timberland_agreement_on_file"
  | "llamaparse_dpa"
  | "statement_reconciliation"
  | "rule_watch"
  | "fraud_procedure_review"
  | "timberland_annual_review"
  | "retention_review"
  // R41 S6: the Guide's "Timberland setup" checklist (one-time; done by hand until the S10 communications log)
  | "timberland_access_ready"
  | "timberland_users_phones"
  | "timberland_schedule_g_email"
  | "timberland_countersigned_copy"
  // R41 S8: yearly Timberland re-checks (plan S8; the Schedule F self-check is plan S10 item 5, done early)
  | "timberland_agreement_reread"
  | "timberland_limits_reconfirm"
  | "timberland_name_id_reconfirm"
  | "timberland_schedule_f_selfcheck";

export type Cadence = "once" | "monthly" | "quarterly" | "annual";

export type AchCalTask = {
  readonly id: AchCalTaskId;
  readonly cadence: Cadence;
  readonly title: string;
  /** Why it matters, in plain words. */
  readonly why: string;
  /** Baby steps. */
  readonly steps: readonly string[];
  /** Where to do it in the back office (or the outside link). */
  readonly href: string;
  readonly hrefLabel: string;
  /** ACH_LEGAL_LIBRARY ids that back this task (checked by tests). */
  readonly lawIds: readonly string[];
  /** Optional verbatim sentence and the mirrored file it comes from (checked by tests). */
  readonly quote?: { readonly text: string; readonly file: string };
};

/** LlamaParse's DPA is a DocuSign PowerForm the owner signs; it is not in the back office. */
export const LLAMAPARSE_DPA_URL =
  "https://powerforms.docusign.net/c2d2c960-b423-418b-8c0d-142d6d99960e?env=na4&acct=ee4e6249-cd9d-4111-89ef-aa930b7cbb40&accountId=ee4e6249-cd9d-4111-89ef-aa930b7cbb40";

export const ACH_CAL_TASKS: readonly AchCalTask[] = [
  {
    id: "fraud_procedure_adopt",
    cadence: "once",
    title: "Adopt the written ACH fraud procedure",
    why: "Since June 2026 Nacha requires every business that sends ACH payments to have written, risk-based steps for spotting payments made by fraud or under false pretenses. Greenway's system already does these things; adopting the page puts it in writing with your name and date.",
    steps: [
      "Read the procedure on this page (it lists what the system already enforces).",
      "If you agree, type your name and press \"Adopt\". The date and your login are recorded.",
      "Review it once a year (the year-end task below reminds you).",
    ],
    href: "/admin/settings/banking/calendar#fraud-procedure",
    hrefLabel: "Read and adopt the procedure",
    lawIds: ["rcw-62a-4a-202-b", "case-choice-escrow-declined-dual-control"],
    quote: {
      text: "Yes. The rules require these parties to review their processes and procedures at least annually and make appropriate updates to address evolving risks.",
      file: "ach/nacha-fraud-monitoring-phase-2.txt",
    },
  },
  {
    id: "timberland_agreement_on_file",
    cadence: "once",
    title: "Timberland ACH agreement on file and security procedures understood",
    why: "Your bank agreement sets the security procedure: your login, plus a token or a text code to approve each file (Schedule F). Timberland also offers dual approval; it is off by your choice (signed Schedule C). Under RCW 62A.4A-202, if you turn down a procedure the bank offered and a thief gets through, the loss can be yours (Choice Escrow).",
    steps: [
      "Keep the signed ACH origination / Cash Management agreement (Schedules A to G) with your banking records, and ask Timberland for its countersigned copy.",
      "Read Schedule F (security procedures) and Schedule G (token or text code). Keep your token or phone safe.",
      "Dual approval is optional and off by your choice. If you ever want a second approver at the bank, ask Timberland.",
      "Press \"Done\".",
    ],
    href: "/admin/settings/banking?tab=company",
    hrefLabel: "Open My banking",
    lawIds: ["rcw-62a-4a-202-b", "rcw-62a-4a-202-c", "case-choice-escrow-declined-dual-control"],
  },
  {
    id: "llamaparse_dpa",
    cadence: "once",
    title: "Sign LlamaParse's Data Processing Agreement",
    why: "When you choose \"Read the scan with LlamaParse\" on a scanned ACH form, the scan goes to LlamaIndex. Their DPA is the contract that says how they protect it. It is signed online through DocuSign, not in the back office.",
    steps: [
      "Open the DocuSign link (button).",
      "Fill in Greenway Marijuana as the customer and sign as owner.",
      "Save the completed PDF DocuSign emails you with your banking records, then press \"Done\".",
    ],
    href: LLAMAPARSE_DPA_URL,
    hrefLabel: "Open the LlamaParse DPA (DocuSign)",
    lawIds: [],
  },
  {
    id: "statement_reconciliation",
    cadence: "monthly",
    title: "Check last month's bank statement against the ACH files",
    why: "Washington law gives you a short window to report a payment you did not authorize. Report within a reasonable time, never more than 90 days, or you lose interest on the refund. After one year you cannot recover at all. Checking every month keeps you far inside both limits.",
    steps: [
      "Open last month's Timberland statement.",
      "Match every ACH debit to a payroll run or vendor payment file in the back office.",
      "Anything you do not recognise: call Timberland the same day, at the number on your card or statement.",
      "Press \"Done\" for that month.",
    ],
    href: "/admin/payroll",
    hrefLabel: "Open payroll runs",
    lawIds: ["rcw-62a-4a-204-a-ninety-days", "rcw-62a-4a-505-one-year"],
  },
  {
    id: "rule_watch",
    cadence: "quarterly",
    title: "Look for new Nacha rules that need a code change",
    why: "Nacha changes the ACH rules every year. Most changes are for banks, but some (like the PAYROLL description in March 2026) change what Greenway's files must say. The rule watch below lists what is already known; this quarterly look catches anything new.",
    steps: [
      "Open nacha.org/newrules.",
      "Compare it with the rule watch list on this page.",
      "Anything new that mentions Originators, PPD, CCD, return codes or entry descriptions: ask your developer to update the code.",
      "Press \"Done\" for the quarter.",
    ],
    href: "https://www.nacha.org/newrules",
    hrefLabel: "Open Nacha New Rules",
    lawIds: [],
  },
  {
    id: "fraud_procedure_review",
    cadence: "annual",
    title: "Year-end: review the ACH fraud procedure",
    why: "Nacha's Phase 2 fraud-monitoring rule says the procedure must be reviewed at least once a year and updated for new risks.",
    steps: [
      "Re-read the fraud procedure on this page.",
      "Think back over the year: any returned payments, bank-change requests or odd emails? Did anything get past the steps?",
      "If something should change, note it and tell your developer. Then press \"Done\" for the year.",
    ],
    href: "/admin/settings/banking/calendar#fraud-procedure",
    hrefLabel: "Read the procedure",
    lawIds: ["rcw-62a-4a-202-b"],
    quote: {
      text: "Yes. The rules require these parties to review their processes and procedures at least annually and make appropriate updates to address evolving risks.",
      file: "ach/nacha-fraud-monitoring-phase-2.txt",
    },
  },
  {
    id: "timberland_annual_review",
    cadence: "annual",
    title: "Year-end: review the Timberland agreement and who can approve",
    why: "Michael is Greenway's only Timberland user (Appendix B). Once a year, make sure that is still true, that the phone for the text code is still yours, and that the agreement has not been replaced with terms you have not read. The dual-approval note on Operations comes back each January for this review.",
    steps: [
      "Log in to Timberland's cash management portal and list the users who can upload or approve ACH. It should be Michael only.",
      "Remove anyone who should not be there. Check the phone number for the text code and the token. Dual approval stays off unless you choose to turn it on.",
      "Ask Timberland whether the agreement or security procedure changed this year; read any change.",
      "Press \"Done\" for the year.",
    ],
    href: "/admin/settings/banking?tab=company",
    hrefLabel: "Open My banking",
    lawIds: ["rcw-62a-4a-202-c", "case-patco-one-size-fits-all"],
  },
  {
    id: "retention_review",
    cadence: "annual",
    title: "Year-end: records and legal holds",
    why: "Signed ACH forms are archived, never deleted (owner rule). Once a year, look at any legal holds and make sure the records for people who left are still there.",
    steps: [
      "Open ACH operations, Records.",
      "Check each legal hold still has a reason. Remove a hold only when the matter is over.",
      "Press \"Done\" for the year.",
    ],
    href: "/admin/settings/banking/operations#records",
    hrefLabel: "Open Records",
    lawIds: [],
  },
  // R41 S6: Timberland setup (Guide checklist). One-time; press Done when true.
  {
    id: "timberland_access_ready",
    cadence: "once",
    title: "Timberland: cash management access is ready",
    why: "Timberland's cash management portal is a separate login from online banking. Brenda said she will tell you when it is set up. No file can be uploaded until it is.",
    steps: ["Wait for Brenda's message that the cash management access is set up.", "Log in once and confirm you can see the ACH upload screen.", "Press \"Done\"."],
    href: "/admin/settings/banking?tab=company",
    hrefLabel: "Open My banking",
    lawIds: [],
  },
  {
    id: "timberland_users_phones",
    cadence: "once",
    title: "Timberland: users and phones are correct (Michael only)",
    why: "Appendix B lists one Timberland user, Michael Lyman, who enters and approves. Schedule G sends the approval code to his phone by text or call. A wrong phone means no code, and no file.",
    steps: ["In the portal, check the user list shows Michael only.", "Check the phone number for the text code is yours.", "Press \"Done\"."],
    href: "/admin/settings/banking?tab=company",
    hrefLabel: "Open My banking",
    lawIds: [],
  },
  {
    id: "timberland_schedule_g_email",
    cadence: "once",
    title: "Timberland: Schedule G email corrected",
    why: "The email on the signed Schedule G is misspelled, so Timberland's security notices may not reach you. You are telling Brenda yourself. Until she confirms, watch the portal for notices.",
    steps: ["Ask Brenda to correct the Schedule G email.", "When she confirms, write who confirmed and when in the note.", "Press \"Done\"."],
    href: "/admin/settings/banking?tab=company",
    hrefLabel: "Open My banking",
    lawIds: [],
  },
  {
    id: "timberland_countersigned_copy",
    cadence: "once",
    title: "Timberland: countersigned agreement on file",
    why: "Our copy of the ACH agreement is signed by Greenway. Ask Timberland for the copy with its countersignature, and keep it with your banking records.",
    steps: ["Ask Brenda for the countersigned copy.", "Keep it privately (never in the website's code).", "Press \"Done\"."],
    href: "/admin/settings/banking?tab=company",
    hrefLabel: "Open My banking",
    lawIds: [],
  },
  // R41 S8: yearly Timberland re-checks. Each quote is checked against its mirror by tests.
  {
    id: "timberland_agreement_reread",
    cadence: "annual",
    title: "Year-end: re-read the Timberland ACH agreement",
    why: "Section 28 lets Timberland change the agreement by notice, and a change takes effect when you receive it. Once a year, make sure the copy you follow is the current one, and re-read the parts that decide who pays when something goes wrong (sections 11, 17, 18, 21, 23 and 25 and Schedule F are in the Legal library, word for word).",
    steps: [
      "Ask Timberland whether any amendment or fee notice was sent this year. Read any you find.",
      "Open the Legal library and re-read the Timberland agreement entries.",
      "If anything changed, tell your developer so the app follows the new terms. Then press \"Done\" for the year.",
    ],
    href: "/admin/settings/banking/library#timberland",
    hrefLabel: "Open the agreement entries",
    lawIds: ["timberland-s25-liability", "timberland-s11-indemnity"],
    quote: {
      text: "Such amendments shall become effective upon receipt of notice by Company or such later date as may be stated in Financial Institution's notice to Company.",
      file: "ach/timberland-ach-agreement-2026-10-09.redacted.txt",
    },
  },
  {
    id: "timberland_limits_reconfirm",
    cadence: "annual",
    title: "Year-end: re-confirm the Timberland limits",
    why: "The app refuses any file over Timberland's limits (Schedule C): $50,000 per file and per day, $100,000 per month. If Timberland changed a limit and the app did not, a payroll could be refused at the bank on payday, or the app could hold back a file the bank would take.",
    steps: [
      "Ask Timberland to confirm the daily and monthly credit limits on file for Greenway.",
      "Compare them with the room-left card on the Guide.",
      "If they differ, tell your developer before the next payroll. Then press \"Done\" for the year.",
    ],
    href: "/admin/settings/banking/guide",
    hrefLabel: "Open the Guide (room left)",
    lawIds: [],
    quote: {
      text: "Maximum monthly aggregate limit of all credit files .......... $100,000.00",
      file: "ach/timberland-ach-agreement-2026-10-09.redacted.txt",
    },
  },
  {
    id: "timberland_name_id_reconfirm",
    cadence: "annual",
    title: "Year-end: re-confirm the company name and ID Timberland matches",
    why: "Brenda matches fields in every file to her setup: the company name (GREENWAY MARIJUA, all that fits) and the Company ID (1 plus the EIN). If either changes on her side or ours, files stop matching.",
    steps: [
      "Open My banking and look at What Timberland sees.",
      "Ask Timberland to confirm the company name and Company ID on its side still match.",
      "Press \"Done\" for the year.",
    ],
    href: "/admin/settings/banking?tab=company",
    hrefLabel: "Open My banking",
    lawIds: [],
    quote: {
      text: "There are 3 parameters I need to have match my side.",
      file: "ach/timberland-brenda-2026-10.txt",
    },
  },
  {
    id: "timberland_schedule_f_selfcheck",
    cadence: "annual",
    title: "Year-end: Schedule F security self-check",
    why: "Schedule F makes Greenway responsible for its own computers and codes. If a password, phone or token may be stolen, phone Timberland at once and confirm in writing within 1 calendar day.",
    steps: [
      "The computer you upload from uses a private, secured internet connection (not public Wi-Fi).",
      "It has anti-virus, anti-spyware and a firewall turned on.",
      "Your phone for the text code (or the token) is safe and only yours. The Timberland user list is still Michael only.",
      "If a code may be stolen: phone Timberland at 1-800-562-8761 at once, then confirm in writing within 1 calendar day.",
      "Press \"Done\" for the year.",
    ],
    href: "/admin/settings/banking/library#timberland",
    hrefLabel: "Read Schedule F",
    lawIds: ["timberland-schedule-f-notice"],
    quote: {
      text: "Timberland Bank requires companies\u2019 use of a private secured internet connection and a network that is protected by Anti-virus, Anti-spyware, and a Firewall on all company computers that will be originating ACH files.",
      file: "ach/timberland-ach-agreement-2026-10-09.redacted.txt",
    },
  },
];

// ─────────────────────────────────────────────────────────────── dates ─────

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function assertIso(d: string): void {
  if (!ISO.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new Error(`Not a YYYY-MM-DD date: ${d}`);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  assertIso(a);
  assertIso(b);
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDays(d: string, n: number): string {
  assertIso(d);
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function lastDayOfMonth(y: number, m: number): string {
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** The period a task is working on today, and when it is due. */
export function currentPeriod(cadence: Cadence, todayIso: string): { key: string; label: string; due: string | null; soonDays: number } {
  assertIso(todayIso);
  const y = Number(todayIso.slice(0, 4));
  const m = Number(todayIso.slice(5, 7));
  switch (cadence) {
    case "once":
      return { key: "once", label: "One time", due: null, soonDays: 0 };
    case "monthly": {
      // The statement for LAST month, due by the 15th of this month.
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      const key = `${py}-${String(pm).padStart(2, "0")}`;
      const label = new Date(Date.UTC(py, pm - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
      return { key, label: `${label} statement`, due: `${todayIso.slice(0, 7)}-15`, soonDays: 15 };
    }
    case "quarterly": {
      const q = Math.ceil(m / 3);
      return { key: `${y}-Q${q}`, label: `Q${q} ${y}`, due: lastDayOfMonth(y, q * 3), soonDays: 30 };
    }
    case "annual":
      return { key: String(y), label: String(y), due: `${y}-12-31`, soonDays: 45 };
  }
}

// ────────────────────────────────────────────────────────── done map ───────

export type AchDoneRecord = { doneAt: string; byEmail: string | null; note?: string | null };
export type AchDoneMap = Partial<Record<AchCalTaskId, Record<string, AchDoneRecord>>>;

const TASK_IDS = new Set<string>(ACH_CAL_TASKS.map((t) => t.id));

/** Keep only known tasks and well-formed records. Anything else is dropped (fails toward "not done"). */
export function normalizeAchDoneMap(raw: unknown): AchDoneMap {
  const out: AchDoneMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [task, periods] of Object.entries(raw as Record<string, unknown>)) {
    if (!TASK_IDS.has(task) || !periods || typeof periods !== "object" || Array.isArray(periods)) continue;
    const keep: Record<string, AchDoneRecord> = {};
    for (const [pk, rec] of Object.entries(periods as Record<string, unknown>)) {
      if (!pk || pk.length > 40 || !rec || typeof rec !== "object") continue;
      const r = rec as Record<string, unknown>;
      if (typeof r.doneAt !== "string" || Number.isNaN(Date.parse(r.doneAt))) continue;
      keep[pk] = {
        doneAt: r.doneAt,
        byEmail: typeof r.byEmail === "string" ? r.byEmail : null,
        note: typeof r.note === "string" ? r.note.slice(0, 500) : null,
      };
    }
    out[task as AchCalTaskId] = keep;
  }
  return out;
}

// ───────────────────────────────────────────────────────── evaluate ────────

export type AchCalStatus = "done" | "overdue" | "due" | "due_soon" | "upcoming" | "not_needed";

export type AchCalEntry = {
  task: AchCalTask;
  periodKey: string;
  periodLabel: string;
  due: string | null;
  status: AchCalStatus;
  /** Days until due (negative = overdue); null for one-time tasks. */
  days: number | null;
  done: AchDoneRecord | null;
  /** Plain sentence for the badge. */
  statusText: string;
};

export type AchCalContext = {
  /** LLAMA_CLOUD_API_KEY is set (the DPA only matters if scans can be sent). */
  llamaParseConfigured: boolean;
};

export function evaluateAchCalendar(todayIso: string, done: AchDoneMap, ctx: AchCalContext): AchCalEntry[] {
  const out: AchCalEntry[] = [];
  for (const task of ACH_CAL_TASKS) {
    const p = currentPeriod(task.cadence, todayIso);
    const rec = done[task.id]?.[p.key] ?? null;
    if (task.id === "llamaparse_dpa" && !ctx.llamaParseConfigured && !rec) {
      out.push({ task, periodKey: p.key, periodLabel: p.label, due: null, status: "not_needed", days: null, done: null, statusText: "Not needed: LlamaParse is not turned on (no LLAMA_CLOUD_API_KEY)." });
      continue;
    }
    if (rec) {
      out.push({ task, periodKey: p.key, periodLabel: p.label, due: p.due, status: "done", days: p.due ? daysBetween(todayIso, p.due) : null, done: rec, statusText: `Done ${rec.doneAt.slice(0, 10)}${rec.byEmail ? ` by ${rec.byEmail}` : ""}.` });
      continue;
    }
    if (!p.due) {
      out.push({ task, periodKey: p.key, periodLabel: p.label, due: null, status: "due", days: null, done: null, statusText: "To do (one time)." });
      continue;
    }
    const days = daysBetween(todayIso, p.due);
    const status: AchCalStatus = days < 0 ? "overdue" : days === 0 ? "due" : days <= p.soonDays ? "due_soon" : "upcoming";
    const statusText =
      status === "overdue" ? `Overdue by ${-days} day${days === -1 ? "" : "s"} (was due ${p.due}).`
      : status === "due" ? "Due today."
      : status === "due_soon" ? `Due in ${days} day${days === 1 ? "" : "s"} (${p.due}).`
      : `Due ${p.due}.`;
    out.push({ task, periodKey: p.key, periodLabel: p.label, due: p.due, status, days, done: null, statusText });
  }
  const rank: Record<AchCalStatus, number> = { overdue: 0, due: 1, due_soon: 2, upcoming: 3, done: 4, not_needed: 5 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || (a.days ?? -1e6) - (b.days ?? -1e6));
}

/** Is a task done for its CURRENT period? (used by the Guide's setup checklist) */
export function isTaskDoneNow(id: AchCalTaskId, todayIso: string, done: AchDoneMap): boolean {
  const t = ACH_CAL_TASKS.find((x) => x.id === id);
  if (!t) return false;
  return Boolean(done[id]?.[currentPeriod(t.cadence, todayIso).key]);
}

/** Validate a "mark done" request against today's period (no back-dating into the future, no unknown task). */
export function checkMarkDone(input: { taskId: string; periodKey: string; todayIso: string; note?: string | null }):
  | { ok: true; taskId: AchCalTaskId; periodKey: string; note: string | null }
  | { ok: false; error: string } {
  const t = ACH_CAL_TASKS.find((x) => x.id === input.taskId);
  if (!t) return { ok: false, error: "Unknown task. Reload the page." };
  const p = currentPeriod(t.cadence, input.todayIso);
  if (input.periodKey !== p.key) return { ok: false, error: "That period is not the current one. Reload the page." };
  const note = (input.note ?? "").trim();
  if (t.id === "fraud_procedure_adopt" && note.length < 3) return { ok: false, error: "Type your name to adopt the procedure." };
  if (/\d{7,}/.test(note.replace(/\d{3}-\d{3}-\d{4}/g, ""))) return { ok: false, error: "Please do not put account or routing numbers in the note." };
  return { ok: true, taskId: t.id, periodKey: p.key, note: note ? note.slice(0, 500) : null };
}

// ───────────────────────────────────────────────────────── rule watch ──────

export type RuleImpact = "done" | "none" | "watch";

export type NachaRuleWatch = {
  readonly id: string;
  readonly effective: string; // YYYY-MM-DD
  readonly title: string;
  /** Verbatim from the mirrored Nacha page (checked by tests). */
  readonly quote: string;
  readonly quoteFile: string;
  readonly impact: RuleImpact;
  /** What it means for Greenway's code, in plain words. */
  readonly greenway: string;
};

const NEW_RULES = "ach/nacha-new-rules-2026-10.txt";

export const NACHA_RULE_WATCH: readonly NachaRuleWatch[] = [
  {
    id: "ced-payroll-2026-03-20",
    effective: "2026-03-20",
    title: "Standard description \"PAYROLL\" on wage payments",
    quote: "This rule requires Originators to use the standardized Company Entry Description “PAYROLL” for PPD credits for payment of wages, salaries and similar types of compensation.",
    quoteFile: "ach/nacha-company-entry-descriptions.txt",
    impact: "done",
    greenway: "Done (R40): payroll files always say PAYROLL, whatever is typed in My banking. Test credits say ACCTVERIFY; vendor files say VENDOR PAY.",
  },
  {
    id: "fraud-phase-2-2026-06-19",
    effective: "2026-06-19",
    title: "Fraud monitoring, Phase 2 (all businesses that send ACH)",
    quote: "Yes. The rules require these parties to review their processes and procedures at least annually and make appropriate updates to address evolving risks.",
    quoteFile: "ach/nacha-fraud-monitoring-phase-2.txt",
    impact: "done",
    greenway: "Done: bank changes go on hold, callbacks only to numbers on file, test-credit monitoring, annual reviews. Adopt the written procedure on this page and review it every year-end.",
  },
  {
    id: "treasury-registry-2026-07-24",
    effective: "2026-07-24",
    title: "U.S. Treasury joins the ACH Contact Registry",
    quote: "This rule will modify the Nacha Operating Rules to allow the U.S. Treasury’s Bureau of the Fiscal Service (BFS) to participate in the ACH Contact Registry.",
    quoteFile: NEW_RULES,
    impact: "none",
    greenway: "Bank-to-bank. No change for Greenway.",
  },
  {
    id: "funds-9am-2026-09-18",
    effective: "2026-09-18",
    title: "Receiving banks make credits available by 9:00 a.m. on settlement day",
    quote: "This rule will eliminate the 5:00 pm local time receipt condition, so that funds availability would be required at 9:00 am (in the RDFI’s local time) on Settlement Date for all non-Same Day ACH credits.",
    quoteFile: NEW_RULES,
    impact: "none",
    greenway: "Good news for payday: if the file's effective date is payday, employees' banks must make the money available by 9 a.m. No code change. Keep uploading the payroll file at least one banking day early.",
  },
  {
    id: "iat-definition-2026-09-18",
    effective: "2026-09-18",
    title: "Clearer definition of international (IAT) entries",
    quote: "The intent of this rule is to provide more clarity for users when making IAT determinations.",
    quoteFile: NEW_RULES,
    impact: "none",
    greenway: "Greenway only pays U.S. accounts (PPD and CCD). No change.",
  },
  {
    id: "characters-2027-01-01",
    effective: "2027-01-01",
    title: "The exact list of characters ACH accepts",
    quote: "This rule will document the current set of characters that are accepted by both ACH Operators.",
    quoteFile: NEW_RULES,
    impact: "watch",
    greenway: "Greenway's files already use a safe subset (capital letters, digits, space and . , & / -). When Nacha publishes the list, confirm the subset is inside it. A test pins today's subset.",
  },
  {
    id: "same-day-10m-2027-09-17",
    effective: "2027-09-17",
    title: "Same Day ACH limit rises to $10 million",
    quote: "This rule amendment will raise the per-entry dollar limit for Same Day ACH from $1 million per payment to $10 million per payment.",
    quoteFile: NEW_RULES,
    impact: "none",
    greenway: "Greenway does not send Same Day ACH. No change.",
  },
  {
    id: "r90-sanctions-2028-03-17",
    effective: "2028-03-17",
    title: "New return code R90 (sanctions)",
    quote: "This rule will create a new return reason code (R90) to support an RDFI’s decision to return an entry in compliance with sanctions obligations.",
    quoteFile: NEW_RULES,
    impact: "watch",
    greenway: "Code change before March 2028: add R90 to the return-code list. Until then an R90 is treated as an unknown code, which already puts the payee ON HOLD and flags possible fraud (safe).",
  },
];

/** Rules a reminder should mention: "watch" items within 60 days of their date (or past it). */
export const RULE_WATCH_LEAD_DAYS = 60;

export function ruleWatchStatus(r: NachaRuleWatch, todayIso: string): { days: number; label: string; remind: boolean } {
  const days = daysBetween(todayIso, r.effective);
  const label = days > 0 ? `Takes effect in ${days} days (${r.effective})` : days === 0 ? "Takes effect today" : `In effect since ${r.effective}`;
  return { days, label, remind: r.impact === "watch" && days <= RULE_WATCH_LEAD_DAYS && days >= -30 };
}

// ─────────────────────────────────────────────────────────── reminders ─────

export type AchCalReminder = {
  dedupeKey: string;
  stage: string;
  weekKey: null;
  subject: string;
  body: string;
  urgency: "info" | "warning" | "critical";
  linkPath: string;
  linkLabel: string;
  footnote: string;
};

const CAL_PATH = "/admin/settings/banking/calendar";
const FOOT = "Greenway ACH calendar. This reminder repeats weekly while a task is overdue and stops once it is marked done.";

/**
 * Today's reminders. Dedupe keys make each one fire once per stage (overdue
 * re-fires once per 7 days), so a re-run cron never double-sends.
 */
export function planAchCalendarReminders(
  todayIso: string,
  entries: readonly AchCalEntry[],
  reviews: { overdue: number; missingDate: number },
): AchCalReminder[] {
  const out: AchCalReminder[] = [];
  for (const e of entries) {
    if (e.status === "done" || e.status === "not_needed" || e.status === "upcoming") continue;
    if (e.task.cadence === "once") {
      // One-time setup: a weekly nudge until done.
      const wk = Math.floor(daysBetween("2026-01-05", todayIso) / 7);
      out.push({
        dedupeKey: `ach-cal:${e.task.id}:once:w${wk}`,
        stage: "setup",
        weekKey: null,
        subject: `ACH setup: ${e.task.title}`,
        body: `${e.task.why} Open the ACH calendar to do it.`,
        urgency: "info",
        linkPath: CAL_PATH,
        linkLabel: "Open the ACH calendar",
        footnote: FOOT,
      });
      continue;
    }
    if (e.status === "overdue") {
      const wk = Math.floor(-(e.days ?? 0) / 7);
      out.push({
        dedupeKey: `ach-cal:${e.task.id}:${e.periodKey}:overdue:w${wk}`,
        stage: "overdue",
        weekKey: null,
        subject: `OVERDUE: ${e.task.title} (${e.periodLabel})`,
        body: `${e.statusText} ${e.task.why}`,
        urgency: "critical",
        linkPath: CAL_PATH,
        linkLabel: "Open the ACH calendar",
        footnote: FOOT,
      });
      continue;
    }
    out.push({
      dedupeKey: `ach-cal:${e.task.id}:${e.periodKey}:${e.status}`,
      stage: e.status,
      weekKey: null,
      subject: `${e.status === "due" ? "Due today" : "Coming up"}: ${e.task.title} (${e.periodLabel})`,
      body: `${e.statusText} ${e.task.why}`,
      urgency: e.status === "due" ? "warning" : "info",
      linkPath: CAL_PATH,
      linkLabel: "Open the ACH calendar",
      footnote: FOOT,
    });
  }
  for (const r of NACHA_RULE_WATCH) {
    const s = ruleWatchStatus(r, todayIso);
    if (!s.remind) continue;
    out.push({
      dedupeKey: `ach-rule:${r.id}:${s.days > 0 ? "ahead" : "live"}`,
      stage: "rule_watch",
      weekKey: null,
      subject: `Nacha rule ${s.days > 0 ? "coming" : "now in effect"}: ${r.title}`,
      body: `${s.label}. ${r.greenway}`,
      urgency: "warning",
      linkPath: `${CAL_PATH}#rule-watch`,
      linkLabel: "Open the rule watch",
      footnote: FOOT,
    });
  }
  if (reviews.overdue + reviews.missingDate > 0) {
    const wk = Math.floor(daysBetween("2026-01-05", todayIso) / 7);
    out.push({
      dedupeKey: `ach-cal:authorization-reviews:w${wk}`,
      stage: "reviews",
      weekKey: null,
      subject: `ACH: ${reviews.overdue + reviews.missingDate} payee authorization review(s) need attention`,
      body: `${reviews.overdue} overdue and ${reviews.missingDate} with no review date. Each active ACH authorization is reviewed at least once a year.`,
      urgency: reviews.overdue > 0 ? "warning" : "info",
      linkPath: "/admin/settings/banking/operations#reviews",
      linkLabel: "Open annual reviews",
      footnote: FOOT,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────── fraud procedure ───────

/**
 * C6: the written fraud procedure. Each line is something the system ENFORCES
 * or a house rule the owner adopts; `enforcedBy` names where, so the page can
 * link to it and a test can check the link exists.
 */
export const ACH_FRAUD_PROCEDURE: readonly { readonly rule: string; readonly enforcedBy: string | null }[] = [
  { rule: "Bank details are never accepted or changed from an email, text or phone call alone. Vendors use the secure sign-up link; employees sign in person.", enforcedBy: "/admin/settings/banking?tab=vendors" },
  { rule: "Any change to a routing number, account number or account type puts that payee ON HOLD. Nothing is paid to the new account until it is released.", enforcedBy: "/admin/settings/banking/operations#holds" },
  { rule: "Before a hold is released, we call the payee at a phone number we have had on file for at least 90 days (or confirm in person) and write down who we spoke to.", enforcedBy: "/admin/settings/banking/operations#holds" },
  { rule: "Michael, the owner, can make and release any ACH change himself. Stephen gathers and records ACH information; anything he adds, changes, removes or releases waits for Michael's approval. Every change is logged with who entered it and who approved it.", enforcedBy: "/admin/settings/banking/approvals" },
  { rule: "A new employee account is checked with a prenote or a test credit before real pay goes to it.", enforcedBy: "/admin/settings/banking/operations#checks" },
  { rule: "Returned payments and bank correction notices are logged the same day. The payee goes on hold at once, and Stephen, Michael and the store are emailed.", enforcedBy: "/admin/settings/banking/operations#notices" },
  { rule: "Test credits are monitored for unusual volume or returns.", enforcedBy: "/admin/settings/banking/operations#monitor" },
  { rule: "Every active payee authorization is reviewed at least once a year.", enforcedBy: "/admin/settings/banking/operations#reviews" },
  { rule: "Payroll files are guarded: one file per two-week period, one payment per employee, amount ceilings, and a warning when an account changed since the last payment.", enforcedBy: "/admin/payroll" },
  { rule: "Michael is Greenway's only Timberland user. He uploads and approves files with his login plus a text code or token. Timberland's dual approval is off (signed Schedule C), by the owner's choice. Timberland never calls back on ACH files. Our call-backs to payees, at numbers on file 90+ days, before any bank change are what stop 'change my account' fraud.", enforcedBy: null },
  { rule: "We check each month's bank statement against our ACH files and report anything unknown to Timberland the same day.", enforcedBy: "/admin/settings/banking/calendar" },
  { rule: "Each of us uses our own login. Logins and passkeys are never shared.", enforcedBy: null },
];

// ─────────────────────────────────────────────────────────── self-tests ────

export function __runAchCalendarCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL ach-calendar-core: ${msg}`);
    }
  };
  ok(daysBetween("2026-10-11", "2026-12-31") === 81, "daysBetween");
  ok(addDays("2026-12-31", 1) === "2027-01-01", "addDays year roll");
  const mo = currentPeriod("monthly", "2026-01-03");
  ok(mo.key === "2025-12" && mo.due === "2026-01-15", "January works on December's statement");
  ok(currentPeriod("quarterly", "2026-10-11").key === "2026-Q4" && currentPeriod("quarterly", "2026-10-11").due === "2026-12-31", "Q4");
  ok(currentPeriod("quarterly", "2026-02-11").due === "2026-03-31", "Q1 end");
  ok(currentPeriod("annual", "2026-10-11").due === "2026-12-31", "annual due year-end");

  const none = evaluateAchCalendar("2026-10-11", {}, { llamaParseConfigured: false });
  ok(none.length === ACH_CAL_TASKS.length, "one entry per task");
  ok(none.find((e) => e.task.id === "llamaparse_dpa")?.status === "not_needed", "DPA not needed without LlamaParse");
  ok(none.find((e) => e.task.id === "statement_reconciliation")?.status === "due_soon", "statement due by the 15th");
  ok(none.find((e) => e.task.id === "fraud_procedure_review")?.status === "upcoming", "year-end task upcoming in October");
  ok(none.find((e) => e.task.id === "fraud_procedure_adopt")?.status === "due", "adopt is to-do");
  ok(evaluateAchCalendar("2026-10-11", {}, { llamaParseConfigured: true }).find((e) => e.task.id === "llamaparse_dpa")?.status === "due", "DPA due with LlamaParse on");
  const late = evaluateAchCalendar("2026-10-20", {}, { llamaParseConfigured: false });
  const rec = late.find((e) => e.task.id === "statement_reconciliation");
  ok(rec?.status === "overdue" && rec.days === -5, "statement overdue after the 15th");
  ok(late[0].status === "overdue", "overdue sorts first");
  const doneMap = normalizeAchDoneMap({ statement_reconciliation: { "2026-09": { doneAt: "2026-10-05T10:00:00Z", byEmail: "m@x" } }, bogus: { x: { doneAt: "2026-01-01" } } });
  ok(!("bogus" in doneMap), "unknown task dropped");
  ok(evaluateAchCalendar("2026-10-20", doneMap, { llamaParseConfigured: false }).find((e) => e.task.id === "statement_reconciliation")?.status === "done", "done map honoured");
  ok(normalizeAchDoneMap({ rule_watch: { "2026-Q4": { doneAt: "not a date" } } }).rule_watch?.["2026-Q4"] === undefined, "bad record dropped");
  ok(normalizeAchDoneMap("nope") && Object.keys(normalizeAchDoneMap([1])).length === 0, "garbage -> empty");
  ok(isTaskDoneNow("statement_reconciliation", "2026-10-20", doneMap) && !isTaskDoneNow("statement_reconciliation", "2026-11-02", doneMap), "isTaskDoneNow follows the period");

  ok(checkMarkDone({ taskId: "rule_watch", periodKey: "2026-Q4", todayIso: "2026-10-11" }).ok, "mark current period");
  ok(!checkMarkDone({ taskId: "rule_watch", periodKey: "2026-Q3", todayIso: "2026-10-11" }).ok, "old period refused");
  ok(!checkMarkDone({ taskId: "nope", periodKey: "once", todayIso: "2026-10-11" }).ok, "unknown task refused");
  ok(!checkMarkDone({ taskId: "fraud_procedure_adopt", periodKey: "once", todayIso: "2026-10-11", note: "" }).ok, "adopt needs a name");
  ok(!checkMarkDone({ taskId: "statement_reconciliation", periodKey: "2026-09", todayIso: "2026-10-11", note: "acct 123456789" }).ok, "no account numbers in notes");

  const rem = planAchCalendarReminders("2026-10-20", late, { overdue: 1, missingDate: 0 });
  ok(rem.some((r) => r.dedupeKey === "ach-cal:statement_reconciliation:2026-09:overdue:w0" && r.urgency === "critical"), "overdue reminder key");
  ok(rem.some((r) => r.stage === "reviews"), "authorization review reminder");
  ok(!rem.some((r) => r.dedupeKey.includes("fraud_procedure_review")), "upcoming tasks do not nag");
  ok(new Set(rem.map((r) => r.dedupeKey)).size === rem.length, "dedupe keys unique");
  const r90 = NACHA_RULE_WATCH.find((r) => r.id === "r90-sanctions-2028-03-17")!;
  ok(!ruleWatchStatus(r90, "2026-10-11").remind && ruleWatchStatus(r90, "2028-02-01").remind, "R90 reminds within 60 days");
  ok(planAchCalendarReminders("2028-02-01", [], { overdue: 0, missingDate: 0 }).some((r) => r.dedupeKey === "ach-rule:r90-sanctions-2028-03-17:ahead"), "rule reminder planned");
  ok(NACHA_RULE_WATCH.every((r, i, a) => i === 0 || a[i - 1].effective <= r.effective), "rule watch in date order");
  let threw = false;
  try {
    daysBetween("2026-13-01", "2026-01-01");
  } catch {
    threw = true;
  }
  ok(threw, "bad date throws");
  // R41 S8: the four yearly Timberland tasks are annual, due at year-end, and upcoming (not nagging) in October.
  const s8 = ["timberland_agreement_reread", "timberland_limits_reconfirm", "timberland_name_id_reconfirm", "timberland_schedule_f_selfcheck"] as const;
  ok(s8.every((id) => ACH_CAL_TASKS.find((t) => t.id === id)?.cadence === "annual"), "S8 tasks are yearly");
  ok(s8.every((id) => none.find((e) => e.task.id === id)?.status === "upcoming"), "S8 tasks upcoming in October, due 12-31");
  ok(!rem.some((r) => s8.some((id) => r.dedupeKey.includes(id))), "S8 tasks do not nag before they are due");
  return { passed, failed };
}
