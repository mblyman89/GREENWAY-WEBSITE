/**
 * src/lib/payments/ach-guide-core.ts  (R40)
 *
 * The ACH Guide: "hand held, no, carried". PURE: the page's data layer
 * gathers a GuideSnapshot (facts only), and this file turns it into
 *
 *   1. JOURNEYS  - four checklists (one-time setup, employee direct deposit,
 *                  vendor ACH, payday), each step green when done, with a
 *                  progress bar and a deep link straight to where the step is
 *                  done;
 *   2. BLOCKERS  - every reason a payment would be refused RIGHT NOW, most
 *                  serious first, each with plain-English fix steps and a deep
 *                  link; plus the always-available way out for wages (pay that
 *                  person by check this run - WAC 296-128-035(7));
 *   3. EXPLAIN   - paste any refusal message the system shows (payroll, vendor
 *                  payments, the vault) and get the fix. Every message the
 *                  pay gates can produce is mapped; tests generate them from
 *                  the real gate functions so the map cannot drift.
 *
 * Nothing here can move money or change a record. The guide only points.
 */

export type StepStatus = "done" | "todo" | "blocked" | "waiting" | "optional";

export type GuideStep = {
  id: string;
  title: string;
  /** One plain sentence: what to do, or what is already true. */
  detail: string;
  status: StepStatus;
  href: string;
  hrefLabel: string;
};

export type JourneyId = "setup" | "employees" | "vendors" | "payday";

export type Journey = {
  id: JourneyId;
  title: string;
  intro: string;
  steps: GuideStep[];
  /** done / (steps that count). Optional steps never count against you. */
  done: number;
  total: number;
  percent: number;
  /** The first step that is not done (what to do next), or null when complete. */
  next: GuideStep | null;
};

export type BlockerSeverity = "stops_all" | "stops_one" | "warning";

export type Blocker = {
  id: string;
  severity: BlockerSeverity;
  /** Who or what is affected ("Payroll", "Jane Doe", "Acme Farms"). */
  who: string;
  problem: string;
  fix: string[];
  href: string;
  hrefLabel: string;
  /** For wages: the safe way to pay on time anyway. */
  fallback?: string;
};

export type GuideEmployee = {
  id: string;
  name: string;
  active: boolean;
  /** EmployeeAchCardState */
  state: "not_ready" | "legacy_only" | "no_banking" | "payable" | "blocked";
  /** The card's own detail sentence (the gate's reason when blocked). */
  detail: string;
  authorizationState: string | null;
};

export type GuideVendor = {
  id: string;
  name: string;
  /** VendorAchState */
  state: string;
  nextStep: string;
  warnings: string[];
};

export type GuideSnapshot = {
  todayIso: string;
  /** Migrations 0258-0263 applied (ops view ready and vault tables present). */
  migrationsReady: boolean;
  migrationError: string | null;
  encryptionConfigured: boolean;
  /** My banking matches Timberland (R41 S2: originatorReadiness().complete); companyMissing = its problems, verbatim. */
  companyAchComplete: boolean;
  companyMissing: string[];
  /** resolveNotifyContacts().problems */
  notifyProblems: string[];
  emailConfigured: boolean;
  /** From the ACH calendar's done map. */
  timberlandAgreementDone: boolean;
  fraudProcedureAdopted: boolean;
  llamaParseConfigured: boolean;
  llamaParseDpaDone: boolean;
  employees: GuideEmployee[];
  /** vendorFollowUpList() rows (only vendors that need something). */
  vendorFollowUp: GuideVendor[];
  vendorsReady: number;
  vendorsTotal: number;
  vendorEsignInvitesOpen: number;
  ops: {
    notices: { id: string; code: string; payee: string; kind: "return" | "noc"; applyBy: string | null }[];
    holds: { id: string; payee: string; employeeId: string | null }[];
    checksPlanned: number;
    checksWaiting: { payee: string; text: string }[];
    checksActionable: { payee: string; text: string }[];
    reviewsOverdue: number;
    reviewsMissing: number;
  };
  /** Most recent payroll run, if any. */
  lastPayroll: { id: string; payDate: string; generated: boolean } | null;
};

// ───────────────────────────────────────────────────────────── links ───────

export const GUIDE_LINKS = {
  migrations: "/admin/settings/banking/guide#migrations",
  company: "/admin/settings/banking?tab=company",
  vaultEmployees: "/admin/settings/banking?tab=employees",
  vaultVendors: "/admin/settings/banking?tab=vendors",
  documents: "/admin/settings/banking/documents",
  notices: "/admin/settings/banking/operations#notices",
  holds: "/admin/settings/banking/operations#holds",
  checks: "/admin/settings/banking/operations#checks",
  reviews: "/admin/settings/banking/operations#reviews",
  records: "/admin/settings/banking/operations#records",
  calendar: "/admin/settings/banking/calendar",
  fraudProcedure: "/admin/settings/banking/calendar#fraud-procedure",
  library: "/admin/settings/banking/library",
  payroll: "/admin/payroll",
  vendorPayments: "/admin/vendor-payments",
  vendors: "/admin/vendors",
  employees: "/admin/staffing/employees",
} as const;

export const employeeLink = (id: string) => `/admin/staffing/employees/${id}`;
export const employeeEsignLink = (id: string) => `/admin/staffing/employees/${id}/esign`;
export const vendorLink = (id: string) => `/admin/vendors/${id}#vendor-esign`;

/** The plain-English way out for wages, from WAC 296-128-035(7). */
export const PAY_BY_CHECK_FALLBACK =
  "Pay day cannot wait. Leave this person's line blank in the payroll run (blank lines are left out of the ACH file) and pay them by paper check on payday. Fix the direct deposit before the next run.";

// ──────────────────────────────────────────────────────────── journeys ─────

function journey(id: JourneyId, title: string, intro: string, steps: GuideStep[]): Journey {
  const counted = steps.filter((s) => s.status !== "optional");
  const done = counted.filter((s) => s.status === "done").length;
  const total = counted.length;
  return {
    id,
    title,
    intro,
    steps,
    done,
    total,
    percent: total === 0 ? 100 : Math.round((done / total) * 100),
    next: steps.find((s) => s.status !== "done" && s.status !== "optional") ?? null,
  };
}

const st = (ok: boolean, otherwise: StepStatus = "todo"): StepStatus => (ok ? "done" : otherwise);

export function buildJourneys(s: GuideSnapshot): Journey[] {
  const activeEmps = s.employees.filter((e) => e.active);
  const payable = activeEmps.filter((e) => e.state === "payable");
  const blockedEmps = activeEmps.filter((e) => e.state === "blocked");
  const needForm = activeEmps.filter((e) => e.state === "legacy_only" || e.state === "no_banking");
  const ready = s.migrationsReady;

  const setup = journey("setup", "One-time setup", "Do these once. When every box is green, the system can send ACH payments safely.", [
    {
      id: "migrations",
      title: "Turn on the ACH database tables",
      detail: ready ? "Migrations 0258 to 0263 are applied." : s.migrationError ?? "Apply migrations 0258 to 0263 in Supabase (docs/MIGRATIONS_TO_RUN.md), in order.",
      status: st(ready, "blocked"),
      href: GUIDE_LINKS.migrations,
      hrefLabel: "How to apply them",
    },
    {
      id: "encryption",
      title: "Bank-number encryption key is set",
      detail: s.encryptionConfigured ? "DATA_ENCRYPTION_KEY is set, so bank numbers are stored encrypted." : "Set DATA_ENCRYPTION_KEY in Vercel (Settings, Environment Variables) and redeploy. Without it bank numbers cannot be saved or read.",
      status: st(s.encryptionConfigured, "blocked"),
      href: GUIDE_LINKS.migrations,
      hrefLabel: "How to set it",
    },
    {
      id: "company",
      title: "My banking: Greenway's own bank details",
      detail: s.companyAchComplete ? "Timberland routing, company name, Company ID (1 + EIN), originating DFI and the agreement's account all match Timberland's setup." : `Does not match Timberland's setup yet: ${s.companyMissing.join(" ") || "the settings could not be checked."}`,
      status: st(s.companyAchComplete, "blocked"),
      href: GUIDE_LINKS.company,
      hrefLabel: "Open My banking",
    },
    {
      id: "phones",
      title: "Owner phone numbers for urgent notices",
      detail: s.notifyProblems.length === 0 ? "Stephen's and Michael's phones are set; urgent ACH notices list them." : `${s.notifyProblems.join(" ")} Set ACH_NOTIFY_STEPHEN_PHONE and ACH_NOTIFY_MICHAEL_PHONE in Vercel.`,
      status: st(s.notifyProblems.length === 0),
      href: GUIDE_LINKS.migrations,
      hrefLabel: "Where to set them",
    },
    {
      id: "email",
      title: "Email for notices and reminders",
      detail: s.emailConfigured ? "Email is set up (Resend)." : "Set RESEND_API_KEY, ORDER_EMAIL_FROM and ORDER_STAFF_EMAILS in Vercel so return notices and calendar reminders reach you.",
      status: st(s.emailConfigured),
      href: GUIDE_LINKS.migrations,
      hrefLabel: "Where to set them",
    },
    {
      id: "timberland",
      title: "Timberland agreement and security procedures",
      detail: s.timberlandAgreementDone ? "Recorded as on file." : "Get a copy of the signed ACH agreement, accept every security option (dual control), then mark it done on the calendar.",
      status: st(s.timberlandAgreementDone),
      href: GUIDE_LINKS.calendar,
      hrefLabel: "Open the calendar",
    },
    {
      id: "fraud",
      title: "Adopt the written fraud procedure",
      detail: s.fraudProcedureAdopted ? "Adopted. Review it every year-end." : "Read the one-page procedure (it lists what the system already does) and adopt it with your name.",
      status: st(s.fraudProcedureAdopted),
      href: GUIDE_LINKS.fraudProcedure,
      hrefLabel: "Read and adopt",
    },
    {
      id: "llamaparse",
      title: "LlamaParse data agreement (only if you use it)",
      detail: !s.llamaParseConfigured
        ? "Not needed: LlamaParse is not turned on. Scans are read on our own server."
        : s.llamaParseDpaDone
          ? "Signed and recorded."
          : "LlamaParse is turned on. Sign its Data Processing Agreement (DocuSign link on the calendar) before sending scans.",
      status: !s.llamaParseConfigured ? "optional" : st(s.llamaParseDpaDone),
      href: GUIDE_LINKS.calendar,
      hrefLabel: "Open the calendar",
    },
  ]);

  const firstNeed = needForm[0];
  const firstBlocked = blockedEmps[0];
  const employees = journey("employees", "Employee direct deposit", "For each employee: a signed form, a checked account, then they are paid by direct deposit.", [
    {
      id: "emp-form",
      title: "Every active employee has a signed direct-deposit form",
      detail: !ready
        ? "Waiting for setup step 1 (migrations)."
        : needForm.length === 0
          ? `All ${activeEmps.length} active employee(s) have a signed form on file.`
          : `${needForm.length} still need one${firstNeed ? `, starting with ${firstNeed.name}` : ""}. Sign it with them in person on their employee page.`,
      status: !ready ? "waiting" : st(needForm.length === 0),
      href: firstNeed ? employeeEsignLink(firstNeed.id) : GUIDE_LINKS.vaultEmployees,
      hrefLabel: firstNeed ? `Sign with ${firstNeed.name}` : "Open employees in the vault",
    },
    {
      id: "emp-check",
      title: "Each new account is checked (prenote or test credit)",
      detail:
        s.ops.checksPlanned + s.ops.checksActionable.length + s.ops.checksWaiting.length === 0
          ? "No account checks waiting."
          : `${s.ops.checksPlanned} waiting to go in a check file, ${s.ops.checksActionable.length} need you now, ${s.ops.checksWaiting.length} waiting on the bank.`,
      status: !ready ? "waiting" : s.ops.checksPlanned + s.ops.checksActionable.length > 0 ? "todo" : s.ops.checksWaiting.length > 0 ? "waiting" : "done",
      href: GUIDE_LINKS.checks,
      hrefLabel: "Open account checks",
    },
    {
      id: "emp-holds",
      title: "No employee is on hold",
      detail: s.ops.holds.length === 0 ? "No holds." : `${s.ops.holds.length} on hold: ${s.ops.holds.map((h) => h.payee).join(", ")}. Call them at a number on file, then release.`,
      status: !ready ? "waiting" : st(s.ops.holds.length === 0, "blocked"),
      href: GUIDE_LINKS.holds,
      hrefLabel: "Open holds",
    },
    {
      id: "emp-payable",
      title: "Everyone is ready to be paid by direct deposit",
      detail: !ready
        ? "Waiting for setup."
        : blockedEmps.length === 0
          ? `${payable.length} of ${activeEmps.length} active employee(s) are fully set up for direct deposit.`
          : `${blockedEmps.length} would be refused by payroll${firstBlocked ? ` (first: ${firstBlocked.name})` : ""}. See "What is blocking a payment" below.`,
      status: !ready ? "waiting" : st(blockedEmps.length === 0, "blocked"),
      href: firstBlocked ? employeeLink(firstBlocked.id) : GUIDE_LINKS.vaultEmployees,
      hrefLabel: firstBlocked ? `Open ${firstBlocked.name}` : "Open the vault",
    },
  ]);

  const firstVendor = s.vendorFollowUp[0];
  const vendors = journey("vendors", "Vendor ACH", "Vendors sign up online by a secure link; you check the account, then pay invoices by ACH.", [
    {
      id: "ven-invite",
      title: "Send sign-up links to vendors you want to pay by ACH",
      detail: !ready
        ? "Waiting for setup."
        : `${s.vendorsReady} of ${s.vendorsTotal} vendor(s) are ready for ACH. ${s.vendorEsignInvitesOpen} sign-up link(s) are open.`,
      status: !ready ? "waiting" : "optional",
      href: GUIDE_LINKS.vaultVendors,
      hrefLabel: "Open vendor sign-ups",
    },
    {
      id: "ven-followup",
      title: "No vendor needs follow-up",
      detail: !ready
        ? "Waiting for setup."
        : s.vendorFollowUp.length === 0
          ? "Nothing to chase."
          : `${s.vendorFollowUp.length} need something${firstVendor ? `, starting with ${firstVendor.name}: ${firstVendor.nextStep}` : ""}`,
      status: !ready ? "waiting" : st(s.vendorFollowUp.length === 0),
      href: firstVendor ? vendorLink(firstVendor.id) : GUIDE_LINKS.vaultVendors,
      hrefLabel: firstVendor ? `Open ${firstVendor.name}` : "Open vendors",
    },
    {
      id: "ven-docs",
      title: "Paper forms are reviewed",
      detail: "Scanned or emailed forms wait in Documents to review. Accept or reject each one; you type the numbers yourself.",
      status: "optional",
      href: GUIDE_LINKS.documents,
      hrefLabel: "Open documents",
    },
  ]);

  const notices = s.ops.notices.length;
  const payday = journey("payday", "Payday", "Every pay period, in this order.", [
    {
      id: "pay-notices",
      title: "No returned payment or bank correction is open",
      detail: notices === 0 ? "No open notices from Timberland." : `${notices} open. Each payee is on hold until you resolve it.`,
      status: !ready ? "waiting" : st(notices === 0, "blocked"),
      href: GUIDE_LINKS.notices,
      hrefLabel: "Open notices",
    },
    {
      id: "pay-ready",
      title: "Everyone in this run can be paid",
      detail: blockedEmps.length === 0 ? "No employee would be refused." : `${blockedEmps.length} would be refused. Fix them, or leave their line blank and pay them by check.`,
      status: !ready ? "waiting" : st(blockedEmps.length === 0, "blocked"),
      href: GUIDE_LINKS.payroll,
      hrefLabel: "Open payroll",
    },
    {
      id: "pay-file",
      title: "Make the payroll file, upload it to Timberland at least 1 banking day early",
      detail: s.lastPayroll
        ? `Last run: pay date ${s.lastPayroll.payDate}${s.lastPayroll.generated ? ", file made." : ", file NOT made yet."}`
        : "No payroll run yet. Start one on the Payroll page.",
      status: s.lastPayroll?.generated ? "done" : "todo",
      href: s.lastPayroll ? `/admin/payroll/${s.lastPayroll.id}` : GUIDE_LINKS.payroll,
      hrefLabel: s.lastPayroll ? "Open the last run" : "Open payroll",
    },
    {
      id: "pay-approve",
      title: "The other owner approves the file at Timberland (dual control)",
      detail: "One of you uploads, the other approves. This is the single best protection against a stolen login (Patco, Choice Escrow).",
      status: "optional",
      href: GUIDE_LINKS.library,
      hrefLabel: "Why (the cases)",
    },
  ]);

  return [setup, employees, vendors, payday];
}

// ──────────────────────────────────────────────────────────── blockers ─────

const SEV_RANK: Record<BlockerSeverity, number> = { stops_all: 0, stops_one: 1, warning: 2 };

export function buildBlockers(s: GuideSnapshot): Blocker[] {
  const out: Blocker[] = [];
  if (!s.migrationsReady) {
    out.push({
      id: "migrations",
      severity: "stops_all",
      who: "All ACH",
      problem: s.migrationError ?? "The ACH tables are not in the database yet.",
      fix: ["Open Supabase, SQL editor.", "Run 0258, 0259, 0260, 0261, 0262 and 0263 from supabase/migrations, in that order (each is safe to re-run).", "Reload this page."],
      href: GUIDE_LINKS.migrations,
      hrefLabel: "Step-by-step",
    });
  }
  if (!s.encryptionConfigured) {
    out.push({
      id: "encryption",
      severity: "stops_all",
      who: "All ACH",
      problem: "DATA_ENCRYPTION_KEY is not set, so bank numbers cannot be saved or read.",
      fix: ["In Vercel: Project, Settings, Environment Variables.", "Add DATA_ENCRYPTION_KEY (ask your developer for the value; never make up a new one if bank numbers are already stored).", "Redeploy."],
      href: GUIDE_LINKS.migrations,
      hrefLabel: "Details",
    });
  }
  if (!s.companyAchComplete) {
    out.push({
      id: "company",
      severity: "stops_all",
      who: "Payroll and vendor files",
      problem: `My banking does not match Timberland's setup${s.companyMissing.length ? ` (${s.companyMissing.join(" ")})` : ""}. No ACH file can be made.`,
      fix: ["Timberland's values are on My banking (routing 325170754, Company ID 1 + EIN, originating DFI 32517075, name GREENWAY MARIJUANA).", "Make sure the EIN is entered on Books > Company information, type the values into My banking, and save."],
      href: GUIDE_LINKS.company,
      hrefLabel: "Open My banking",
    });
  }
  for (const n of s.ops.notices) {
    out.push({
      id: `notice-${n.id}`,
      severity: "stops_one",
      who: n.payee,
      problem: `${n.kind === "noc" ? "Bank correction" : "Returned payment"} ${n.code} is open; ${n.payee} is on hold.${n.applyBy ? ` Apply the correction by ${n.applyBy}.` : ""}`,
      fix: ["Call the payee at a number already on file (never one from an email or the notice).", "Fix the bank details if needed (they go on hold until checked).", "Resolve the notice with a note saying who you spoke to."],
      href: GUIDE_LINKS.notices,
      hrefLabel: "Open notices",
    });
  }
  for (const h of s.ops.holds) {
    out.push({
      id: `hold-${h.id}`,
      severity: "stops_one",
      who: h.payee,
      problem: `${h.payee}'s direct deposit is ON HOLD (a bank change, return or correction).`,
      fix: ["Call them at a phone number you have had for 90+ days, or see them in person.", "Have them read back the last 4 of the account.", "Michael releases the hold with a note. Stephen's release is sent to Michael for approval."],
      href: GUIDE_LINKS.holds,
      hrefLabel: "Open holds",
      fallback: h.employeeId ? PAY_BY_CHECK_FALLBACK : undefined,
    });
  }
  const heldEmployees = new Set(s.ops.holds.map((h) => h.employeeId).filter(Boolean));
  for (const e of s.employees) {
    if (!e.active || e.state !== "blocked" || heldEmployees.has(e.id)) continue;
    const ex = explainPaymentMessage(e.detail);
    out.push({
      id: `emp-${e.id}`,
      severity: "stops_one",
      who: e.name,
      problem: `Payroll will refuse ${e.name}: ${e.detail}`,
      fix: ex.fix,
      href: ex.href === GUIDE_LINKS.vaultEmployees ? employeeLink(e.id) : ex.href,
      hrefLabel: ex.href === GUIDE_LINKS.vaultEmployees ? `Open ${e.name}` : ex.hrefLabel,
      fallback: PAY_BY_CHECK_FALLBACK,
    });
  }
  for (const c of s.ops.checksActionable) {
    out.push({ id: `check-${c.payee}`, severity: "warning", who: c.payee, problem: `Account check needs you: ${c.text}`, fix: ["Open Account checks and do the step shown."], href: GUIDE_LINKS.checks, hrefLabel: "Open account checks" });
  }
  for (const v of s.vendorFollowUp) {
    const severe = v.state === "on_hold" || v.state === "blocked_unknown" || v.state === "unverified";
    out.push({
      id: `vendor-${v.id}`,
      severity: severe ? "stops_one" : "warning",
      who: v.name,
      problem: `${v.name}: ${v.nextStep}${v.warnings.length ? ` (${v.warnings.join(" ")})` : ""}`,
      fix: vendorFix(v.state),
      href: vendorLink(v.id),
      hrefLabel: `Open ${v.name}`,
      fallback: severe ? "Pay this invoice by check this time, and fix the ACH details before the next one." : undefined,
    });
  }
  if (s.ops.reviewsOverdue + s.ops.reviewsMissing > 0) {
    out.push({
      id: "reviews",
      severity: "warning",
      who: "Annual reviews",
      problem: `${s.ops.reviewsOverdue} authorization review(s) overdue and ${s.ops.reviewsMissing} with no date.`,
      fix: ["Open Annual reviews.", "For each, confirm the payee still wants direct deposit to the same account, then mark it reviewed."],
      href: GUIDE_LINKS.reviews,
      hrefLabel: "Open reviews",
    });
  }
  for (const p of s.notifyProblems) {
    out.push({ id: `notify-${p.slice(0, 30)}`, severity: "warning", who: "Notices", problem: p, fix: ["Set the phone number in Vercel, Environment Variables, and redeploy."], href: GUIDE_LINKS.migrations, hrefLabel: "Details" });
  }
  return out.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
}

function vendorFix(state: string): string[] {
  switch (state) {
    case "needs_bank_info":
    case "not_set_up":
      return ["Open the vendor's page.", "Send the secure sign-up link (Direct deposit sign-up), or upload their signed paper form.", "When they finish, check the account, then it turns green."];
    case "unverified":
      return ["Call the vendor at a number you already had on file (not one from their email).", "Confirm the last 4 of the account, then mark it verified in the vault."];
    case "on_hold":
      return ["A bank change put this vendor on hold.", "Call them at a number already on file and confirm the new details.", "Release the hold in the vault with a note."];
    case "inactive":
      return ["Their ACH record was revoked or archived.", "Pay by check, or send a new sign-up link (the new details go on hold until checked)."];
    case "blocked_unknown":
      return ["The record has a status the system does not know, so nothing is paid.", "Ask your developer to look at it."];
    default:
      return ["Open the vendor's page and follow the next step shown on the ACH card."];
  }
}

// ──────────────────────────────────────────────────────────── explain ──────

export type Explanation = {
  matched: string; // rule id, "unknown" when nothing matched
  title: string;
  why: string;
  fix: string[];
  href: string;
  hrefLabel: string;
  fallback?: string;
};

type Rule = { id: string; test: RegExp } & Omit<Explanation, "matched">;

/**
 * Ordered: the first match wins. Every refusal the pay gates can produce has a
 * rule (tests build the messages from the real functions). Patterns key on
 * the gate's fixed wording, never on names.
 */
const RULES: readonly Rule[] = [
  { id: "migration", test: /migration|apply migrations|0258|one-time setup needed/i, title: "Setup is not finished", why: "The database tables for ACH are not there yet.", fix: ["Apply migrations 0258 to 0263 in Supabase, in order.", "Reload."], href: GUIDE_LINKS.migrations, hrefLabel: "How" },
  { id: "incomplete", test: /record is incomplete|invalid routing number or no account number/i, title: "Bank details incomplete", why: "The routing or account number is missing or invalid (or the encryption key is missing, so it cannot be read).", fix: ["Check DATA_ENCRYPTION_KEY is set.", "Open the record in the vault and finish the details from the signed form (it goes on hold until checked)."], href: GUIDE_LINKS.vaultEmployees, hrefLabel: "Open the vault", fallback: PAY_BY_CHECK_FALLBACK },
  { id: "encryption", test: /DATA_ENCRYPTION_KEY|encryption key/i, title: "Encryption key missing", why: "Bank numbers are stored encrypted; without the key they cannot be read, so the file cannot be built.", fix: ["Set DATA_ENCRYPTION_KEY in Vercel and redeploy."], href: GUIDE_LINKS.migrations, hrefLabel: "How" },
  { id: "not_signed", test: /has not been signed yet/i, title: "The form is not signed", why: "An ACH authorization only counts once the payee signs it.", fix: ["Open the employee's page and press Sign electronically (in person), or upload their signed paper form."], href: GUIDE_LINKS.vaultEmployees, hrefLabel: "Open the vault", fallback: PAY_BY_CHECK_FALLBACK },
  { id: "signed_unverified", test: /Signed, but the account has not been verified/i, title: "Signed, but the account is not checked yet", why: "Before real money goes to a new account it is checked with a prenote ($0) or a test credit (a few cents).", fix: ["Open Account checks.", "Start a prenote or a test credit for this person and download the check file.", "Upload it to Timberland. A prenote passes after 3 banking days with no return; a test credit passes when the person reads back the amount."], href: GUIDE_LINKS.checks, hrefLabel: "Open account checks", fallback: PAY_BY_CHECK_FALLBACK },
  { id: "verifying", test: /verification \(prenote or test credit\) is still in progress|not verified yet \(prenote, test credit or callback\)/i, title: "The account check is not finished", why: "The prenote or test credit has not passed yet.", fix: ["Open Account checks and look at this person's row: it says what to do (wait until a date, or ask them for the amount).", "When it passes, payroll accepts them."], href: GUIDE_LINKS.checks, hrefLabel: "Open account checks", fallback: PAY_BY_CHECK_FALLBACK },
  { id: "unknown_status", test: /unknown status|is not one payroll knows/i, title: "Unknown status", why: "The record has a status the system does not recognise, so it refuses to pay (safe by design).", fix: ["Ask your developer to look at this record."], href: GUIDE_LINKS.records, hrefLabel: "Open records", fallback: PAY_BY_CHECK_FALLBACK },
  { id: "on_hold", test: /ON HOLD|On hold: a bank change/, title: "On hold", why: "A bank change, a returned payment or a bank correction put this payee on hold. This is the main protection against payroll and vendor fraud.", fix: ["Call them at a phone number you have had on file for 90+ days (never a number from an email), or see them in person.", "Have them read back the last 4 of the account.", "Release the hold with a note."], href: GUIDE_LINKS.holds, hrefLabel: "Open holds", fallback: PAY_BY_CHECK_FALLBACK },
  { id: "revoked", test: /revoked/i, title: "Authorization revoked", why: "The payee withdrew permission to pay them by ACH. The record is kept (never deleted) but cannot be used.", fix: ["Pay by check.", "If they want direct deposit again, they sign a new form (it is checked before use)."], href: GUIDE_LINKS.records, hrefLabel: "Open records", fallback: PAY_BY_CHECK_FALLBACK },
  { id: "archived", test: /archived/i, title: "Archived record", why: "This bank record was replaced or ended. It is kept for the files but cannot be paid.", fix: ["Pay by check, or re-open it in the vault (it goes on hold until checked)."], href: GUIDE_LINKS.records, hrefLabel: "Open records", fallback: PAY_BY_CHECK_FALLBACK },
  { id: "opted_out", test: /opted out of ACH/i, title: "Vendor opted out of ACH", why: "This vendor asked to be paid another way.", fix: ["Pay by check this time.", "If they now want ACH, un-check \"opted out\" on the vendor's page and send the sign-up link."], href: GUIDE_LINKS.vendors, hrefLabel: "Open vendors" },
  { id: "no_banking", test: /has no banking on file/i, title: "No bank details on file", why: "There is nowhere to send the money.", fix: ["Open the vendor's page and send the secure sign-up link (or upload their signed paper form).", "Pay this invoice by check meanwhile."], href: GUIDE_LINKS.vaultVendors, hrefLabel: "Open vendors in the vault" },
  { id: "split", test: /fixed amounts|percent|remainder|split/i, title: "The split-deposit rules do not add up", why: "The amounts or percentages on the signed form cannot divide this paycheck.", fix: ["Open the employee's vault record and compare it with their signed form.", "If the form itself is wrong, they sign a new one."], href: GUIDE_LINKS.vaultEmployees, hrefLabel: "Open the vault", fallback: PAY_BY_CHECK_FALLBACK },
  { id: "company", test: /bank ACH block is not fully configured|ACH company settings|originating DFI|company ID/i, title: "My banking is incomplete", why: "Greenway's own bank details are needed in every file.", fix: ["Fill in My banking with the details from Timberland."], href: GUIDE_LINKS.company, hrefLabel: "Open My banking" },
  { id: "cadence", test: /once every \d+ days|Only one payroll file is allowed per two-week period/i, title: "Payroll cadence guardrail", why: "To stop double payments, one payroll file per two weeks and one payment per employee per two weeks.", fix: ["Check you are not paying the same period twice.", "If this is a real correction, pay the difference by check and note why."], href: GUIDE_LINKS.payroll, hrefLabel: "Open payroll" },
  { id: "bank_changed", test: /bank account changed since their last payment/i, title: "Bank account changed since last payday", why: "A changed account right before payday is the most common payroll-fraud pattern.", fix: ["Call the employee at a number on file and confirm the change.", "Then confirm the warning on the payroll run."], href: GUIDE_LINKS.holds, hrefLabel: "Open holds" },
  { id: "duplicate_amount", test: /identical to the last payment|looks like a duplicate/i, title: "This looks like a duplicate payment", why: "The amount is exactly the same as the last payment to this person. That is normal for a fixed salary, and it is also what a double payment looks like.", fix: ["Check the payroll register: is this really a new pay period?", "If it is correct, confirm the warning on the payroll run to continue. The confirmation is recorded."], href: GUIDE_LINKS.payroll, hrefLabel: "Open payroll" },
  { id: "ceiling", test: /usual per-employee ceiling|usual per-run ceiling/i, title: "Amount is above the usual limit", why: "A safety limit caught an unusually large payment. It protects against a typing mistake (an extra zero) and against fraud.", fix: ["Compare the number with the Sage register or paystub.", "If it is correct, confirm the warning on the payroll run to continue. The confirmation is recorded."], href: GUIDE_LINKS.payroll, hrefLabel: "Open payroll" },
  { id: "dual_control", test: /releasing this file yourself|self-approval/i, title: "You are approving your own payroll file", why: "This is a reminder, not a block. Having a second person look at a payroll file is the strongest protection against payroll fraud.", fix: ["If Michael (the owner) generated it himself, this note is a record only. Otherwise Michael reviews the run when he approves it.", "You can still continue."], href: GUIDE_LINKS.payroll, hrefLabel: "Open payroll" },
  { id: "source_document", test: /source document/i, title: "Attach the payroll source document", why: "Every payroll file needs the Sage register (or paystubs) attached, so the numbers can be checked later.", fix: ["Attach the Sage payroll register PDF to the run, then generate."], href: GUIDE_LINKS.payroll, hrefLabel: "Open payroll" },
];

export function explainPaymentMessage(message: string): Explanation {
  const m = (message ?? "").slice(0, 2000);
  for (const r of RULES) {
    if (r.test.test(m)) {
      const { test: _t, id, ...rest } = r;
      void _t;
      return { matched: id, ...rest };
    }
  }
  return {
    matched: "unknown",
    title: "Not a message the guide knows yet",
    why: "Nothing is lost: the system refuses to pay rather than guess.",
    fix: ["Check the blockers list on this page first.", "If it is not there, send the exact message to your developer."],
    href: "/admin/settings/banking/guide#blockers",
    hrefLabel: "See the blockers",
  };
}

export const EXPLAIN_RULE_IDS: readonly string[] = RULES.map((r) => r.id);

// ─────────────────────────────────────────────────────────── self-tests ────

export function sampleSnapshot(over: Partial<GuideSnapshot> = {}): GuideSnapshot {
  return {
    todayIso: "2026-10-11",
    migrationsReady: true,
    migrationError: null,
    encryptionConfigured: true,
    companyAchComplete: true,
    companyMissing: [],
    notifyProblems: [],
    emailConfigured: true,
    timberlandAgreementDone: true,
    fraudProcedureAdopted: true,
    llamaParseConfigured: false,
    llamaParseDpaDone: false,
    employees: [{ id: "e1", name: "Ann", active: true, state: "payable", detail: "ok", authorizationState: "active" }],
    vendorFollowUp: [],
    vendorsReady: 1,
    vendorsTotal: 1,
    vendorEsignInvitesOpen: 0,
    ops: { notices: [], holds: [], checksPlanned: 0, checksWaiting: [], checksActionable: [], reviewsOverdue: 0, reviewsMissing: 0 },
    lastPayroll: { id: "r1", payDate: "2026-10-10", generated: true },
    ...over,
  };
}

export function __runAchGuideCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`FAIL ach-guide-core: ${msg}`);
    }
  };
  const green = buildJourneys(sampleSnapshot());
  ok(green.length === 4, "four journeys");
  ok(green.every((j) => j.percent === 100 && j.next === null), "all green when everything is done");
  ok(buildBlockers(sampleSnapshot()).length === 0, "no blockers when all is well");
  ok(green[0].steps.find((s) => s.id === "llamaparse")?.status === "optional", "DPA optional without LlamaParse");

  const fresh = sampleSnapshot({ migrationsReady: false, migrationError: "One-time setup needed: apply migrations 0258 to 0263", encryptionConfigured: false, companyAchComplete: false, companyMissing: ["Company ID"] });
  const fj = buildJourneys(fresh);
  ok(fj[0].percent < 100 && fj[0].next?.id === "migrations", "setup next = migrations");
  ok(fj[1].steps.every((s) => s.status === "waiting"), "employee steps wait for setup");
  const fb = buildBlockers(fresh);
  ok(fb.slice(0, 3).every((b) => b.severity === "stops_all"), "stops_all first");
  ok(fb.some((b) => b.problem.includes("Company ID")), "names missing company field");

  const blockedEmp = sampleSnapshot({
    employees: [
      { id: "e2", name: "Bo", active: true, state: "blocked", detail: "Account verification (prenote or test credit) is still in progress. Until this is fixed, this employee blocks the payroll ACH file.", authorizationState: "verifying" },
      { id: "e3", name: "Cy", active: false, state: "blocked", detail: "x", authorizationState: "draft" },
    ],
  });
  const bb = buildBlockers(blockedEmp);
  ok(bb.length === 1 && bb[0].who === "Bo", "inactive employees ignored");
  ok(bb[0].fallback === PAY_BY_CHECK_FALLBACK, "wage fallback offered");
  ok(bb[0].href === GUIDE_LINKS.checks, "verifying -> account checks");
  ok(buildJourneys(blockedEmp)[3].steps.find((s) => s.id === "pay-ready")?.status === "blocked", "payday blocked");

  const held = sampleSnapshot({ ops: { ...sampleSnapshot().ops, holds: [{ id: "h1", payee: "Bo", employeeId: "e2" }] }, employees: blockedEmp.employees });
  const hb = buildBlockers(held);
  ok(hb.filter((b) => b.who === "Bo").length === 1 && hb[0].id === "hold-h1", "a held employee appears once (as a hold)");

  const ven = sampleSnapshot({ vendorFollowUp: [{ id: "v1", name: "Acme", state: "on_hold", nextStep: "Release the hold.", warnings: [] }, { id: "v2", name: "Zed", state: "not_set_up", nextStep: "Send link.", warnings: [] }] });
  const vb = buildBlockers(ven);
  ok(vb[0].who === "Acme" && vb[0].severity === "stops_one" && vb[1].severity === "warning", "vendor severity order");
  ok(vb[0].href === "/admin/vendors/v1#vendor-esign", "vendor deep link");

  ok(explainPaymentMessage("Jane: On hold: a bank change, return or correction is waiting for release by Michael (the owner).").matched === "on_hold", "explain on hold");
  ok(explainPaymentMessage("Acme opted out of ACH (cash). Pay another way").matched === "opted_out", "explain opted out");
  ok(explainPaymentMessage("random").matched === "unknown", "unknown falls through");
  ok(explainPaymentMessage("Signed, but the account has not been verified.").matched === "signed_unverified", "signed not verified");
  ok(explainPaymentMessage('X\'s banking has an unknown status ("archived2"). Nothing is paid').matched === "unknown_status", "unknown status beats archived");
  ok(new Set(EXPLAIN_RULE_IDS).size === EXPLAIN_RULE_IDS.length, "rule ids unique");
  const dpa = buildJourneys(sampleSnapshot({ llamaParseConfigured: true }));
  ok(dpa[0].steps.find((s) => s.id === "llamaparse")?.status === "todo" && dpa[0].percent < 100, "DPA counts when LlamaParse is on");
  return { passed, failed };
}
