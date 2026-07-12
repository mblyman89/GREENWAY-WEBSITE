/**
 * src/lib/staffing/employee-lifecycle-core.ts  (Task S-b)
 *
 * Pure definitions + math for the Employee command center: the onboarding
 * checklist (ordered so the WA Fair Chance Act sequence is respected), the
 * document tracker ("do we have their W-4 and I-9 on file?"), compliance
 * deadlines computed from the hire date, WA paid-sick-leave accrual math, and
 * the offboarding checklist. No I/O — everything here is deterministic and
 * covered by __runEmployeeLifecycleTests().
 *
 * Ground truth: docs/EMPLOYEE_COMPLIANCE.md (verified sources — RCW 69.50.357,
 * WAC 314-55-083 / -087(1)(e), RCW 49.94.010, RCW 49.46.210, RCW 49.48.010,
 * USCIS I-9 timing, DSHS new-hire reporting, DOH WAC 246-72).
 */

import { addDaysYmd, dowYmd } from "@/lib/staffing/schedule-core";

// ---------------------------------------------------------------------------
// Lifecycle statuses
// ---------------------------------------------------------------------------

export type EmploymentStatus = "candidate" | "onboarding" | "active" | "terminated";

export const EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  "candidate",
  "onboarding",
  "active",
  "terminated",
];

export const STATUS_LABELS: Record<EmploymentStatus, string> = {
  candidate: "Candidate",
  onboarding: "Onboarding",
  active: "Active",
  terminated: "Terminated",
};

// ---------------------------------------------------------------------------
// Onboarding checklist (ordered). Phases group the wizard's steps; the ORDER
// inside "hiring" is legally meaningful: RCW 49.94.010 (WA Fair Chance Act)
// forbids any criminal-record inquiry until AFTER a conditional offer.
// ---------------------------------------------------------------------------

export type OnboardingPhase = "hiring" | "paperwork" | "compliance" | "ready";

export const PHASE_LABELS: Record<OnboardingPhase, string> = {
  hiring: "1 · Hiring (in this order)",
  paperwork: "2 · New-hire paperwork",
  compliance: "3 · Cannabis compliance",
  ready: "4 · Ready to work",
};

export type OnboardingTaskDef = {
  key: string;
  label: string;
  help: string;
  phase: OnboardingPhase;
  /** Task keys that MUST be done first (legal ordering). */
  requires?: string[];
  /** True when activation should be blocked until this task is complete. */
  critical?: boolean;
  /** Linked document (checking the task nudges the document tracker). */
  docKey?: string;
};

export const ONBOARDING_TASKS: OnboardingTaskDef[] = [
  {
    key: "interview_qualified",
    label: "Interviewed — candidate is otherwise qualified",
    help: "Assess skills and fit FIRST. Do not ask about criminal history at this stage (RCW 49.94.010).",
    phase: "hiring",
  },
  {
    key: "conditional_offer",
    label: "Conditional offer extended (in writing)",
    help: "A conditional offer must come BEFORE any background check — WA Fair Chance Act, RCW 49.94.010. Keep a copy of the offer letter.",
    phase: "hiring",
    docKey: "offer_letter",
  },
  {
    key: "background_check",
    label: "Background check completed",
    help: "Only after the conditional offer. No blanket exclusions — consider the record individually. (From Jan 1, 2027, small employers must also document a legitimate business reason and hold the job 2 business days before adverse action.)",
    phase: "hiring",
    requires: ["conditional_offer"],
    docKey: "background_check",
  },
  {
    key: "age_21_verified",
    label: "Photo ID checked — employee is 21 or older",
    help: "Every employee of a licensed retailer must be at least 21 (RCW 69.50.357; $1,000 per violation). Check the ID yourself; we record the verification, not the birth date.",
    phase: "hiring",
    critical: true,
  },
  {
    key: "i9_section1",
    label: "Form I-9 Section 1 completed by the employee",
    help: "Due by the employee's FIRST day of work for pay. The employee fills out Section 1 themselves.",
    phase: "paperwork",
    critical: true,
    docKey: "i9",
  },
  {
    key: "i9_section2",
    label: "Form I-9 Section 2 completed by you",
    help: "You examine the employee's original documents and complete Section 2 within 3 BUSINESS days of the start date. Retain the I-9 for 3 years after hire or 1 year after separation, whichever is later.",
    phase: "paperwork",
    requires: ["i9_section1"],
    critical: true,
    docKey: "i9",
  },
  {
    key: "w4_collected",
    label: "Form W-4 collected",
    help: "Needed before the first payroll run so withholding is correct. File it with the employee's records (5-year retention, WAC 314-55-087).",
    phase: "paperwork",
    critical: true,
    docKey: "w4",
  },
  {
    key: "new_hire_report",
    label: "New hire reported to DSHS",
    help: "Report every new or rehired employee to the DSHS Division of Child Support within 20 days of hire (dshs.wa.gov → new-hire reporting).",
    phase: "paperwork",
  },
  {
    key: "handbook_signed",
    label: "Employee read and signed the handbook",
    help: "The handbook (Employees → Handbook & Policies) covers conduct, breaks, sick leave, ID checks, and the no-consumption rule. Keep the signed acknowledgment on file.",
    phase: "compliance",
    critical: true,
    docKey: "handbook",
  },
  {
    key: "training_rules",
    label: "Trained on store rules & LCB requirements",
    help: "RCW 69.50.357: all employees must be trained on the rules of the retailer. Log it in the training log below (topic, date, trainer).",
    phase: "compliance",
    critical: true,
  },
  {
    key: "training_id_check",
    label: "Trained on checking ID / spotting under-21 customers",
    help: "RCW 69.50.357: all employees must be trained to identify persons under 21. Log it in the training log below.",
    phase: "compliance",
    critical: true,
  },
  {
    key: "badge_issued",
    label: "Photo ID badge issued",
    help: "WAC 314-55-083: every employee must hold and display an employer-issued badge (trade name, full legal name, photo) on the premises. Record the badge number on this page.",
    phase: "compliance",
    critical: true,
    docKey: "badge",
  },
  {
    key: "clock_pin_set",
    label: "Time-clock PIN set",
    help: "Set a 4–6 digit PIN on the roster so they can clock in at the station or from their phone.",
    phase: "ready",
  },
  {
    key: "added_to_schedule",
    label: "Added to the schedule",
    help: "Build their first week in Employees → Schedule.",
    phase: "ready",
  },
  {
    key: "payroll_setup",
    label: "Payroll set up",
    help: "Pay rate entered (and direct deposit details if they use it) so the first check is on time. Remember: WA paid sick leave accrues from day 1 (1 hour per 40 worked).",
    phase: "ready",
  },
];

export const ONBOARDING_TASK_KEYS = ONBOARDING_TASKS.map((t) => t.key);

// ---------------------------------------------------------------------------
// Offboarding checklist ("termination related things"). Stored in the same
// tasks table with an "offboard." key prefix.
// ---------------------------------------------------------------------------

export type OffboardingTaskDef = {
  key: string;
  label: string;
  help: string;
};

export const OFFBOARDING_TASKS: OffboardingTaskDef[] = [
  {
    key: "offboard.reason_recorded",
    label: "Termination date + reason recorded",
    help: "Part of the employee file — kept 5 years on premises (WAC 314-55-087).",
  },
  {
    key: "offboard.badge_retrieved",
    label: "ID badge retrieved or voided",
    help: "The WAC 314-55-083 badge belongs to the store; collect it on the last day.",
  },
  {
    key: "offboard.pin_cleared",
    label: "Time-clock PIN cleared & open punch closed",
    help: "Terminating on this page clears the PIN automatically; double-check there is no open punch on the Hours page.",
  },
  {
    key: "offboard.login_deactivated",
    label: "Back-office login deactivated (Users page)",
    help: "If they had an admin login, deactivate it the same day on Admin → Users so access ends immediately.",
  },
  {
    key: "offboard.schedule_cleared",
    label: "Removed from future schedules",
    help: "Delete any scheduled shifts after the termination date in Employees → Schedule.",
  },
  {
    key: "offboard.final_pay",
    label: "Final paycheck scheduled",
    help: "RCW 49.48.010: final wages are due at the END of the established pay period — pay them with the normal payroll run, don't skip them.",
  },
  {
    key: "offboard.records_retained",
    label: "Employee file retained (do NOT delete)",
    help: "Keep all records 5 years (WAC 314-55-087). Keep the I-9 for 3 years from hire or 1 year from separation, whichever is later.",
  },
];

export const OFFBOARDING_TASK_KEYS = OFFBOARDING_TASKS.map((t) => t.key);

// ---------------------------------------------------------------------------
// Document tracker definitions
// ---------------------------------------------------------------------------

export type DocumentStatus = "missing" | "on_file" | "signed";

export type DocumentDef = {
  key: string;
  label: string;
  help: string;
  /** Documents the employee must READ AND SIGN (vs. just having on file). */
  signable?: boolean;
  /** Credential that expires (renewal date tracked). */
  expires?: boolean;
  /** Only relevant for a medically endorsed store. */
  medicalOnly?: boolean;
};

export const EMPLOYEE_DOCUMENTS: DocumentDef[] = [
  {
    key: "offer_letter",
    label: "Conditional offer letter",
    help: "Written offer extended before the background check (RCW 49.94.010).",
  },
  {
    key: "background_check",
    label: "Background check report",
    help: "Run only AFTER the conditional offer. Keep the report with the file.",
  },
  {
    key: "i9",
    label: "Form I-9 (employment eligibility)",
    help: "Section 1 by day 1; Section 2 within 3 business days. Retention: 3 years from hire or 1 year from separation, whichever is later.",
  },
  {
    key: "w4",
    label: "Form W-4 (federal withholding)",
    help: "Collected before the first payroll run.",
  },
  {
    key: "handbook",
    label: "Employee handbook acknowledgment",
    help: "The employee read the handbook and signed the acknowledgment page — mark this one SIGNED, not just on file.",
    signable: true,
  },
  {
    key: "badge",
    label: "ID badge record",
    help: "Badge number + photo issued per WAC 314-55-083.",
  },
  {
    key: "consultant_cert",
    label: "DOH medical cannabis consultant certificate",
    help: "Only for a medically endorsed store: 20-hr DOH training + CPR, renews ANNUALLY by the consultant's birthday (WAC 246-72). Track the expiry date.",
    expires: true,
    medicalOnly: true,
  },
];

export const DOCUMENT_KEYS = EMPLOYEE_DOCUMENTS.map((d) => d.key);

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  missing: "Missing",
  on_file: "On file",
  signed: "Read & signed",
};

// ---------------------------------------------------------------------------
// Required-training topics (RCW 69.50.357) seeded into the training log UI.
// ---------------------------------------------------------------------------

export const REQUIRED_TRAINING_TOPICS: { topic: string; help: string }[] = [
  { topic: "Store rules & LCB requirements", help: "Required for ALL employees (RCW 69.50.357)." },
  { topic: "Checking ID / identifying under-21", help: "Required for ALL employees (RCW 69.50.357)." },
  {
    topic: "Medical authorizations & recognition cards",
    help: "Required only for a medically endorsed store (RCW 69.50.357).",
  },
];

// ---------------------------------------------------------------------------
// Deadline math (pure). Dates are YYYY-MM-DD strings; business days = Mon–Fri.
// ---------------------------------------------------------------------------

/** Add N business days (Mon–Fri) to a YMD date. */
export function addBusinessDaysYmd(ymd: string, days: number): string {
  let out = ymd;
  let remaining = days;
  while (remaining > 0) {
    out = addDaysYmd(out, 1);
    const dow = dowYmd(out); // 0 = Sunday, 6 = Saturday
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return out;
}

export type ComplianceDeadline = {
  key: "i9_section2" | "new_hire_report" | "sick_leave_usable";
  label: string;
  dueYmd: string;
  help: string;
};

/**
 * Deadlines that flow from the hire date:
 *   - I-9 Section 2: within 3 business days of the start date (USCIS).
 *   - DSHS new-hire report: within 20 calendar days of hire.
 *   - Paid sick leave usable: the 90th calendar day after commencement
 *     (RCW 49.46.210) — accrual itself starts on day 1.
 */
export function complianceDeadlines(hireYmd: string): ComplianceDeadline[] {
  return [
    {
      key: "i9_section2",
      label: "I-9 Section 2 due",
      dueYmd: addBusinessDaysYmd(hireYmd, 3),
      help: "Within 3 business days of the start date.",
    },
    {
      key: "new_hire_report",
      label: "DSHS new-hire report due",
      dueYmd: addDaysYmd(hireYmd, 20),
      help: "Within 20 days of hire (DSHS Division of Child Support).",
    },
    {
      key: "sick_leave_usable",
      label: "Paid sick leave usable from",
      dueYmd: addDaysYmd(hireYmd, 90),
      help: "Accrues from day 1 (1 hr per 40 worked); usable starting the 90th calendar day.",
    },
  ];
}

// ---------------------------------------------------------------------------
// WA paid sick leave accrual (RCW 49.46.210): minimum 1 hour per 40 hours
// worked = 1 minute per 40 minutes worked. We floor to whole minutes.
// ---------------------------------------------------------------------------

/** Sick-leave minutes accrued for the given worked minutes. */
export function sickLeaveAccruedMinutes(workedMinutes: number): number {
  if (!Number.isFinite(workedMinutes) || workedMinutes <= 0) return 0;
  return Math.floor(workedMinutes / 40);
}

/** Render minutes as "12h 30m" / "45m". */
export function minutesLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem}m`;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

/** Carryover cap: 40 hours (RCW 49.46.210) — for the year-end helper text. */
export const SICK_LEAVE_CARRYOVER_CAP_MINUTES = 40 * 60;

// ---------------------------------------------------------------------------
// Checklist state helpers
// ---------------------------------------------------------------------------

export type TaskState = Record<string, boolean>;

/**
 * Legal-ordering guard: returns an error message when checking `key` now
 * would violate a required order (e.g. background check before the
 * conditional offer), else null.
 */
export function taskOrderViolation(key: string, state: TaskState): string | null {
  const def = ONBOARDING_TASKS.find((t) => t.key === key);
  if (!def?.requires?.length) return null;
  const missing = def.requires.filter((r) => !state[r]);
  if (missing.length === 0) return null;
  const labels = missing
    .map((k) => ONBOARDING_TASKS.find((t) => t.key === k)?.label ?? k)
    .join(", ");
  return `Complete "${labels}" first — the order is required (see the step's helper text).`;
}

/**
 * Activation gate: the critical compliance tasks that must be complete before
 * an employee can be switched to ACTIVE. Returns the incomplete labels.
 */
export function activationBlockers(state: TaskState): string[] {
  return ONBOARDING_TASKS.filter((t) => t.critical && !state[t.key]).map((t) => t.label);
}

/** Progress across the onboarding checklist (0–100). */
export function onboardingProgress(state: TaskState): number {
  const total = ONBOARDING_TASKS.length;
  const done = ONBOARDING_TASKS.filter((t) => state[t.key]).length;
  return Math.round((done / total) * 100);
}

/** Progress across the offboarding checklist (0–100). */
export function offboardingProgress(state: TaskState): number {
  const total = OFFBOARDING_TASKS.length;
  const done = OFFBOARDING_TASKS.filter((t) => state[t.key]).length;
  return Math.round((done / total) * 100);
}

/** Allowed lifecycle transitions (never delete; terminated is re-hireable). */
export function canTransition(from: EmploymentStatus, to: EmploymentStatus): boolean {
  if (from === to) return false;
  const allowed: Record<EmploymentStatus, EmploymentStatus[]> = {
    candidate: ["onboarding", "terminated"],
    onboarding: ["active", "terminated"],
    active: ["terminated"],
    // Rehire within 12 months also reinstates the sick-leave balance.
    terminated: ["onboarding"],
  };
  return allowed[from].includes(to);
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`employee-lifecycle-core self-test failed: ${msg}`);
}

export function __runEmployeeLifecycleTests(): number {
  let n = 0;
  const t = (cond: boolean, msg: string) => {
    assert(cond, msg);
    n += 1;
  };

  // Task/document definitions are unique and consistent.
  t(new Set(ONBOARDING_TASK_KEYS).size === ONBOARDING_TASKS.length, "task keys unique");
  t(new Set(OFFBOARDING_TASK_KEYS).size === OFFBOARDING_TASKS.length, "offboard keys unique");
  t(new Set(DOCUMENT_KEYS).size === EMPLOYEE_DOCUMENTS.length, "doc keys unique");
  t(
    OFFBOARDING_TASKS.every((x) => x.key.startsWith("offboard.")),
    "offboard keys namespaced",
  );
  t(
    ONBOARDING_TASKS.every((x) => !x.key.startsWith("offboard.")),
    "onboarding keys not namespaced",
  );
  // Every docKey referenced by a task exists in the document definitions.
  t(
    ONBOARDING_TASKS.every((x) => !x.docKey || DOCUMENT_KEYS.includes(x.docKey)),
    "task docKeys resolve",
  );
  // Fair Chance ordering encoded: background check requires the offer.
  const bg = ONBOARDING_TASKS.find((x) => x.key === "background_check");
  t(bg?.requires?.includes("conditional_offer") === true, "RCW 49.94 order encoded");
  // The offer task comes BEFORE the background check in display order too.
  t(
    ONBOARDING_TASK_KEYS.indexOf("conditional_offer") < ONBOARDING_TASK_KEYS.indexOf("background_check"),
    "offer listed before background check",
  );

  // Business-day math: Mon 2026-07-13 + 3 business days = Thu 2026-07-16.
  t(addBusinessDaysYmd("2026-07-13", 3) === "2026-07-16", "I-9 Mon start → Thu");
  // Fri start skips the weekend: Fri 2026-07-17 + 3 = Wed 2026-07-22.
  t(addBusinessDaysYmd("2026-07-17", 3) === "2026-07-22", "I-9 Fri start → Wed");
  // Sat start: first business day is Monday. Sat 2026-07-18 + 3 = Wed 2026-07-22.
  t(addBusinessDaysYmd("2026-07-18", 3) === "2026-07-22", "I-9 Sat start → Wed");
  t(addBusinessDaysYmd("2026-07-13", 0) === "2026-07-13", "zero business days = same day");

  // Deadlines flow from the hire date.
  const dl = complianceDeadlines("2026-07-13");
  t(dl.find((d) => d.key === "i9_section2")?.dueYmd === "2026-07-16", "deadline i9");
  t(dl.find((d) => d.key === "new_hire_report")?.dueYmd === "2026-08-02", "deadline DSHS +20d");
  t(dl.find((d) => d.key === "sick_leave_usable")?.dueYmd === "2026-10-11", "sick leave +90d");

  // Sick leave: 1 min per 40 min worked, floored; never negative.
  t(sickLeaveAccruedMinutes(0) === 0, "sick 0");
  t(sickLeaveAccruedMinutes(39) === 0, "sick <40min");
  t(sickLeaveAccruedMinutes(40) === 1, "sick 40min = 1min");
  t(sickLeaveAccruedMinutes(2400) === 60, "40h worked = 1h sick");
  t(sickLeaveAccruedMinutes(2439) === 60, "floors");
  t(sickLeaveAccruedMinutes(-100) === 0, "negative clamps");
  t(minutesLabel(60) === "1h", "label 1h");
  t(minutesLabel(90) === "1h 30m", "label 1h30");
  t(minutesLabel(45) === "45m", "label 45m");
  t(SICK_LEAVE_CARRYOVER_CAP_MINUTES === 2400, "carryover cap 40h");

  // Ordering guard.
  t(taskOrderViolation("background_check", {}) !== null, "bg check blocked w/o offer");
  t(
    taskOrderViolation("background_check", { conditional_offer: true }) === null,
    "bg check ok after offer",
  );
  t(taskOrderViolation("i9_section2", {}) !== null, "s2 blocked w/o s1");
  t(taskOrderViolation("interview_qualified", {}) === null, "no requires = ok");

  // Activation gate: all critical tasks must be done.
  t(activationBlockers({}).length > 0, "blockers when nothing done");
  const allDone: TaskState = {};
  for (const k of ONBOARDING_TASK_KEYS) allDone[k] = true;
  t(activationBlockers(allDone).length === 0, "no blockers when all done");
  const almost = { ...allDone, badge_issued: false };
  t(
    activationBlockers(almost).some((l) => l.toLowerCase().includes("badge")),
    "badge is a critical blocker",
  );

  // Progress math.
  t(onboardingProgress({}) === 0, "progress 0");
  t(onboardingProgress(allDone) === 100, "progress 100");
  const offAll: TaskState = {};
  for (const k of OFFBOARDING_TASK_KEYS) offAll[k] = true;
  t(offboardingProgress(offAll) === 100, "offboard progress 100");
  t(offboardingProgress({}) === 0, "offboard progress 0");

  // Lifecycle transitions: forward-only + rehire; no deletes modeled.
  t(canTransition("candidate", "onboarding"), "candidate→onboarding");
  t(canTransition("onboarding", "active"), "onboarding→active");
  t(canTransition("active", "terminated"), "active→terminated");
  t(canTransition("terminated", "onboarding"), "rehire allowed");
  t(!canTransition("active", "candidate"), "no backwards to candidate");
  t(!canTransition("candidate", "active"), "no skipping onboarding");
  t(!canTransition("active", "active"), "no self transition");

  return n;
}
