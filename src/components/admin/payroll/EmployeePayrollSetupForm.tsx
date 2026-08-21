"use client";

/**
 * src/components/admin/payroll/EmployeePayrollSetupForm.tsx   (slice books-25)
 *
 * ENTER ONE EMPLOYEE'S W-4, I-9 AND PAY, WITH THE CHECKLIST WATCHING.
 *
 * WHAT MICHAEL ASKED FOR, VERBATIM (standing rule 1)
 *
 *   "an enterprise grade setup process that has the same level of mentoring and
 *    guidance as all the other books slices... It should only contain things
 *    greenway is required to have"
 *
 *   "It should have a check list of task to be completed before it lets you save
 *    them to the system, and if a field is missing, it should highlight it so
 *    something can't silently fail me in some way."
 *
 *   "Payroll has always been something I've feared because I have had no
 *    reliable way of knowing I'm doing it right."
 *
 *   "Sage has no safety nets"
 *
 * That last pair is the whole design brief. Fear comes from not knowing, so the
 * answer is not a friendlier Save button - it is showing him, continuously and
 * without being asked, exactly what the system currently thinks and exactly
 * what is still missing. Nothing on this screen waits for a submit to tell him
 * something it already knows.
 *
 * THREE THINGS ON SCREEN AT ONCE, ON PURPOSE
 *
 *   1. THE FORM. Flat, every field visible.
 *   2. THE CHECKLIST. Recomputed on every keystroke from the same engine
 *      function the save path uses, so it can never flatter the form.
 *   3. THE WORKED PAYCHECK. What will actually come out of this person's
 *      check, line by line, each line showing its own arithmetic.
 *
 * Sage's employee setup shows (1) alone, saves whatever it is given, and the
 * consequences appear in a payroll run weeks later. Michael's screenshots show
 * every hourly rate reading 0.00 on a saved employee. That is what (2) and (3)
 * exist to make impossible: a wage of zero is refused, and if it were not, the
 * paycheck panel would be showing a take-home of $0.00 the entire time.
 *
 * WHY THE FIELDS ARE FLAT AND NOTHING COLLAPSES
 *
 * Pub. 15-T's rules for electronic substitute W-4s require the fields of Steps
 * 1(c) through 4(c) to be presented with the same wording and the same
 * prominence as the paper form. That forbids hiding secondary fields behind
 * accordions or hover cards. The TEACHING COPY collapses; the form fields never
 * do. This is a legal constraint on the layout, not a taste.
 *
 * WHY THE CHECKLIST IS NOT THE AUTHORITY
 *
 * It is advice. `saveSetupAction` re-runs the identical evaluation on the
 * server and refuses on its own authority, so a client that skipped or lied
 * about the checklist gets the same answer. There is one definition of "ready
 * for payroll" in this system and it lives in the engine.
 *
 * WHY THIS COMPONENT COMPUTES NOTHING
 *
 * Every number, every formula string, every "is this done" decision comes from
 * `payroll-onboarding-ui-core.ts`, which is pure and tested. This file's only
 * job is to put those values on screen and highlight the fields the engine
 * names. If the view layer decided what counted as done, two screens could
 * disagree about the same employee.
 */

import { useMemo, useState, useTransition } from "react";

import { Badge, Button, Card, CardHeader, Field, Input, Section, Select } from "@/components/admin/ui";
import { LABOR_ROLES } from "@/lib/accounting/payroll-cogs-core";
import {
  ssnVerificationCaveat,
  type I9Document,
  type I9DocumentCategory,
  type OnboardingCandidate,
  type PayBasis,
  type PayRecord,
} from "@/lib/payroll/payroll-onboarding-core";
import {
  buildChecklistView,
  buildWorkedPaycheck,
  formatHours,
  formatMilliCentsAsRate,
  type ChecklistRowState,
} from "@/lib/payroll/payroll-onboarding-ui-core";
import {
  ALL_PAY_FREQUENCIES,
  ALL_W4_FILING_STATUSES,
  PAY_FREQUENCY_LABELS,
  W4_FILING_STATUS_LABELS,
  type PayFrequency,
  type W4FilingStatus,
  type W4Record,
} from "@/lib/payroll/payroll-w4-core";
import { formatCentsPlain } from "@/lib/payroll/payroll-withholding-core";
import { findGuidanceAuthority } from "@/lib/accounting/books-guidance-core";
import { revealSsnAction, saveSetupAction } from "@/app/admin/books/payroll-setup/actions";

// ---------------------------------------------------------------------------
// Form state. Every money field is held as the STRING the user typed.
//
// A number input bound to a number loses "17.85" halfway through typing, and
// worse, parseFloat gives back a float - the exact thing integer cents exist to
// prevent. So text in, explicit integer conversion once, at the boundary.
// ---------------------------------------------------------------------------

type FormState = {
  employeeId: string;
  legalFirstName: string;
  legalLastName: string;
  ssn: string;
  newHireReportedYmd: string;

  // W-4
  w4FormYear: string;
  w4FilingStatus: W4FilingStatus;
  w4Step2MultipleJobs: boolean;
  w4Step3Credit: string;
  w4Step4aOtherIncome: string;
  w4Step4bDeductions: string;
  w4Step4cExtra: string;
  w4Exempt: boolean;
  w4SignedYmd: string;

  // I-9
  i9Section1SignedYmd: string;
  i9Section2CompletedYmd: string;
  i9FirstDayYmd: string;
  i9CopiesRetained: boolean;
  i9Documents: I9Document[];

  // Pay
  payBasis: PayBasis;
  payHourlyRate: string;
  payAnnualSalary: string;
  payFrequency: PayFrequency;
  payLaborRoleCode: string;
  payCogsSplitPercent: string;
  payHireYmd: string;
  payMinimumWage: string;

  // Illustration input (not saved - it only drives the worked paycheck)
  illustrationHours: string;
};

/**
 * Dollars-and-cents text to integer CENTS.
 *
 * Returns null for anything that is not a clean money figure, so "" and "abc"
 * are both "not answered" rather than silently becoming zero. Rule 46: a zero
 * nobody entered looks exactly like a zero somebody entered, and this is the
 * boundary where that confusion would be created.
 */
function dollarsToCents(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(t)) return null;
  const negative = t.startsWith("-");
  const [whole, frac = ""] = t.replace("-", "").split(".");
  const cents = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/**
 * Dollars-and-cents text to integer MILLI-CENTS (1000 x a cent).
 *
 * Five decimal places are accepted because real rates need them: L&I charges
 * $0.16445 per hour worked. Rounding the RATE before multiplying is the classic
 * silent shortfall, so the rate is kept exact and the PRODUCT is rounded once.
 */
function dollarsToMilliCents(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d*(\.\d{0,5})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const value = Number(whole || "0") * 100_000 + Number(frac.padEnd(5, "0"));
  return Number.isFinite(value) ? value : null;
}

/** Percent text to integer BASIS POINTS. 33.33% -> 3333. */
function percentToBasisPoints(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d*(\.\d{0,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  const bp = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0"));
  return Number.isFinite(bp) ? bp : null;
}

function ymdOrNull(text: string): string | null {
  const t = text.trim();
  return t === "" ? null : t;
}

// ---------------------------------------------------------------------------

const STATE_TONE: Record<ChecklistRowState, "danger" | "orange" | "green" | "neutral"> = {
  blocking: "danger",
  warning: "orange",
  done: "green",
  not_started: "neutral",
};

const STATE_WORD: Record<ChecklistRowState, string> = {
  blocking: "Blocks payroll",
  warning: "Worth a look",
  done: "Done",
  not_started: "Not started",
};

export function EmployeePayrollSetupForm({
  employeeId,
  employeeName,
  maskedSsnOnFile,
  defaultFormYear,
  todayYmd,
}: {
  employeeId: string;
  employeeName: string;
  /** What is already on file, already masked. The full number never ships here. */
  maskedSsnOnFile: string | null;
  defaultFormYear: number;
  todayYmd: string;
}) {
  const [form, setForm] = useState<FormState>(() => {
    const [first = "", ...rest] = employeeName.split(" ");
    return {
      employeeId,
      legalFirstName: first,
      legalLastName: rest.join(" "),
      ssn: "",
      newHireReportedYmd: "",
      w4FormYear: String(defaultFormYear),
      // NOT pre-selected to the most common answer. A filing status that
      // arrived by default is indistinguishable from one read off the form,
      // and this field moves real money.
      w4FilingStatus: "single_or_married_filing_separately",
      w4Step2MultipleJobs: false,
      w4Step3Credit: "",
      w4Step4aOtherIncome: "",
      w4Step4bDeductions: "",
      w4Step4cExtra: "",
      w4Exempt: false,
      w4SignedYmd: "",
      i9Section1SignedYmd: "",
      i9Section2CompletedYmd: "",
      i9FirstDayYmd: "",
      i9CopiesRetained: false,
      i9Documents: [],
      payBasis: "hourly",
      payHourlyRate: "",
      payAnnualSalary: "",
      // Michael: "every two weeks on friday". This IS pre-selected, because it
      // is a fact about Greenway rather than a fact about the employee - and
      // Sage's defaulting to Weekly while he pays biweekly is a live defect in
      // his current system, silently mis-annualizing every calculation.
      payFrequency: "biweekly",
      payLaborRoleCode: "",
      payCogsSplitPercent: "0",
      payHireYmd: "",
      // DELIBERATELY BLANK. There is no minimum-wage figure anywhere in this
      // codebase to read from - payroll-cogs-core.ts says of its own field
      // "NOT hard-coded" - and this screen is not going to be the first place
      // that invents one. A prefilled wage floor that nobody verified is worse
      // than an empty box, because the empty box asks a question and the
      // prefilled one silently answers it. Michael: "never assume, always
      // double check."
      payMinimumWage: "",
      illustrationHours: "80",
    };
  });

  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealReason, setRevealReason] = useState("");
  const [revealNote, setRevealNote] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    // Any edit invalidates the last save message. Leaving a stale "saved"
    // banner above a changed form is how someone believes a change was stored.
    setSaveNote(null);
  }

  // -------------------------------------------------------------------------
  // Build the candidate the engine will judge.
  //
  // A field left blank becomes null, never zero and never today's date. The
  // engine then reports it as missing, which is the truth. Defaulting a blank
  // date to today would be the system inventing evidence about when a federal
  // form was signed.
  // -------------------------------------------------------------------------
  const candidate: OnboardingCandidate = useMemo(() => {
    const formYear = Number(form.w4FormYear);

    const w4: W4Record | null = Number.isInteger(formYear) && formYear > 1900
      ? {
          employeeId: form.employeeId,
          formYear,
          filingStatus: form.w4FilingStatus,
          step2MultipleJobs: form.w4Step2MultipleJobs,
          step3AnnualCreditCents: dollarsToCents(form.w4Step3Credit) ?? 0,
          step4aOtherIncomeAnnualCents: dollarsToCents(form.w4Step4aOtherIncome) ?? 0,
          step4bDeductionsAnnualCents: dollarsToCents(form.w4Step4bDeductions) ?? 0,
          step4cExtraPerPeriodCents: dollarsToCents(form.w4Step4cExtra) ?? 0,
          legacyAllowances: null,
          exemptFromFederalIncomeTax: form.w4Exempt,
          signedAt: ymdOrNull(form.w4SignedYmd),
        }
      : null;

    const pay: PayRecord | null = {
      employeeId: form.employeeId,
      basis: form.payBasis,
      hourlyRateMilliCents:
        form.payBasis === "hourly" ? dollarsToMilliCents(form.payHourlyRate) : null,
      annualSalaryCents:
        form.payBasis === "salary" ? dollarsToCents(form.payAnnualSalary) : null,
      payFrequency: form.payFrequency,
      laborRoleCode: form.payLaborRoleCode,
      cogsSplitBasisPoints: percentToBasisPoints(form.payCogsSplitPercent) ?? 0,
      hireYmd: form.payHireYmd,
      minimumWageMilliCentsAtHire: dollarsToMilliCents(form.payMinimumWage),
    };

    return {
      employeeId: form.employeeId,
      legalFirstName: form.legalFirstName,
      legalLastName: form.legalLastName,
      ssn: form.ssn,
      w4,
      i9: {
        employeeId: form.employeeId,
        section1SignedYmd: ymdOrNull(form.i9Section1SignedYmd),
        section2CompletedYmd: ymdOrNull(form.i9Section2CompletedYmd),
        firstDayOfEmploymentYmd: ymdOrNull(form.i9FirstDayYmd),
        documents: form.i9Documents,
        copiesRetained: form.i9CopiesRetained,
      },
      pay,
      newHireReportedYmd: ymdOrNull(form.newHireReportedYmd),
    };
  }, [form]);

  const view = useMemo(() => buildChecklistView(candidate), [candidate]);

  /**
   * Every field path the checklist wants highlighted, flattened into a set.
   * A field is highlighted because the ENGINE named it, never because this
   * component guessed it was important.
   */
  const highlighted = useMemo(() => {
    const s = new Set<string>();
    for (const row of view.rows) for (const f of row.highlightFields) s.add(f);
    return s;
  }, [view]);

  /** The engine's own sentence about this field, if it has one. */
  function problemFor(path: string): string | undefined {
    if (!highlighted.has(path)) return undefined;
    for (const row of view.rows) {
      if (row.highlightFields.includes(path) && row.problems.length > 0) {
        return row.problems[0];
      }
    }
    // Named but with no sentence attached. Say something true rather than
    // nothing - a highlighted field with no explanation is the Sage experience.
    return "This still needs an answer before payroll can run.";
  }

  /**
   * The worked paycheck. Wrapped because the engine REFUSES rather than guesses
   * when the setup is not yet computable, and a refusal must be shown, not
   * swallowed into an error boundary.
   */
  const paycheck = useMemo(() => {
    if (!candidate.w4 || !candidate.pay) return null;
    try {
      return buildWorkedPaycheck({
        w4: candidate.w4,
        pay: candidate.pay,
        hundredthHours: Math.round(Number(form.illustrationHours || "0") * 100),
        onIsoDate: todayYmd,
      });
    } catch {
      return null;
    }
  }, [candidate, form.illustrationHours, todayYmd]);

  function onSave() {
    startTransition(async () => {
      const result = await saveSetupAction({
        candidate,
        ssn: form.ssn.trim() === "" ? null : form.ssn,
      });
      setSaveNote(
        result.ok
          ? {
              ok: true,
              message:
                `Saved. ${result.rowsWritten} record${result.rowsWritten === 1 ? "" : "s"} ` +
                `written for ${form.legalFirstName} ${form.legalLastName}. Any previous ` +
                `version was superseded rather than overwritten, so the history of what ` +
                `was on file, and when, is still there.`,
            }
          : { ok: false, message: result.message },
      );
    });
  }

  function onReveal() {
    startTransition(async () => {
      const result = await revealSsnAction({ employeeId, reason: revealReason });
      if (result.ok) {
        setRevealed(result.ssn);
        setRevealNote(
          "Shown, and logged. The log records who looked, when, and the reason " +
            "you gave. That log is readable on this screen - a log nobody reads " +
            "is the same as no log.",
        );
      } else {
        setRevealed(null);
        setRevealNote(result.message);
      }
    });
  }

  const laborRole = LABOR_ROLES.find((r) => r.code === form.payLaborRoleCode);

  return (
    <div className="space-y-6">
      {/* =================================================================== */}
      {/* THE CHECKLIST. First, because it is the answer to "am I done?" and   */}
      {/* that question should never require scrolling.                        */}
      {/* =================================================================== */}
      <Section
        title="What still has to happen before this employee can be paid"
        description="Recomputed as you type, by the same code that runs when you press Save. It cannot tell you one thing and the save another."
      >
        <Card>
          <div
            className={`mb-4 rounded-[var(--admin-radius)] border p-3 text-sm ${
              view.canSave
                ? "border-[var(--admin-green)]/40 bg-[var(--admin-green)]/10 text-[var(--admin-text)]"
                : "border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 text-[var(--admin-text)]"
            }`}
          >
            {view.canSave ? (
              <>
                <strong>Ready to save.</strong> Every step that blocks payroll is
                clean. {view.warningCount > 0 ? `${view.warningCount} thing${view.warningCount === 1 ? "" : "s"} below are worth reading first, but none of them stop you.` : "There are no outstanding warnings either."}
              </>
            ) : (
              <>
                <strong>Not ready yet.</strong> {view.blockedBecause}
              </>
            )}
          </div>

          <ul className="space-y-3">
            {view.rows.map((row) => (
              <li
                key={row.key}
                className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATE_TONE[row.state]}>{STATE_WORD[row.state]}</Badge>
                  <span className="text-sm font-semibold text-[var(--admin-text)]">
                    {row.label}
                  </span>
                  {row.blocksPayroll ? null : (
                    <span className="text-xs text-[var(--admin-text-faint)]">
                      (does not stop payroll)
                    </span>
                  )}
                  {row.deadlineYmd ? (
                    <span className="text-xs text-[var(--admin-orange)]">
                      due {row.deadlineYmd}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--admin-text-faint)]">
                  {row.whatItIs}
                </p>
                {row.problems.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {row.problems.map((p, i) => (
                      <li key={i} className="text-sm text-[var(--admin-danger)]">
                        {p}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      {/* =================================================================== */}
      {/* IDENTITY + SSN                                                       */}
      {/* =================================================================== */}
      <Section
        title="Who they are"
        description="The legal name and Social Security number, exactly as they appear on the card."
      >
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Legal first name"
              required
              error={problemFor("legalFirstName")}
            >
              <Input
                value={form.legalFirstName}
                onChange={(e) => set("legalFirstName", e.target.value)}
              />
            </Field>
            <Field label="Legal last name" required error={problemFor("legalLastName")}>
              <Input
                value={form.legalLastName}
                onChange={(e) => set("legalLastName", e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Social Security number"
              required
              error={problemFor("identity.ssn")}
              help="Stored in full because the W-2 and every Washington wage report key on it. Masked for everyone but you."
            >
              <Input
                value={form.ssn}
                placeholder={maskedSsnOnFile ?? "000-00-0000"}
                onChange={(e) => set("ssn", e.target.value)}
              />
            </Field>
            <Field
              label="New-hire report filed"
              error={problemFor("newHireReportedYmd")}
              help="Washington requires new hires reported within 20 days. Leave blank until it is actually done."
            >
              <Input
                type="date"
                value={form.newHireReportedYmd}
                onChange={(e) => set("newHireReportedYmd", e.target.value)}
              />
            </Field>
          </div>

          <p className="mt-3 text-sm leading-relaxed text-[var(--admin-text-faint)]">
            {ssnVerificationCaveat()}
          </p>

          {/* ---------------- the reveal, Sage-style but logged ------------- */}
          {maskedSsnOnFile ? (
            <div className="mt-4 rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
              <CardHeader
                title="The number already on file"
                subtitle="Masked by default. Revealing it is a logged event."
              />
              <p className="mt-2 font-mono text-sm text-[var(--admin-text)]">
                {revealed ?? maskedSsnOnFile}
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <Field
                  label="Why do you need to see it?"
                  className="min-w-[16rem] flex-1"
                  help="Required. The reason is what makes the log worth reading a year from now."
                >
                  <Input
                    value={revealReason}
                    onChange={(e) => setRevealReason(e.target.value)}
                    placeholder="Checking it against the card before filing W-2s"
                  />
                </Field>
                <Button onClick={onReveal} disabled={pending}>
                  Show the full number
                </Button>
              </div>
              {revealNote ? (
                <p className="mt-2 text-sm text-[var(--admin-text-faint)]">{revealNote}</p>
              ) : null}
            </div>
          ) : null}
        </Card>
      </Section>

      {/* =================================================================== */}
      {/* THE W-4                                                              */}
      {/* Flat and fully visible - Pub. 15-T's substitute-form prominence rule.*/}
      {/* =================================================================== */}
      <Section
        title="Form W-4, as signed"
        description="Copy what is on the paper. Nothing here is inferred, and nothing is filled in for you."
      >
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Year printed on the form"
              required
              error={problemFor("w4.formYear")}
              help="The year on the paper they signed - not this year. This one field decides which withholding method runs."
            >
              <Input
                value={form.w4FormYear}
                onChange={(e) => set("w4FormYear", e.target.value)}
              />
            </Field>
            <Field
              label="Step 1(c) - filing status"
              required
              error={problemFor("w4.filingStatus")}
            >
              <Select
                value={form.w4FilingStatus}
                onChange={(e) => set("w4FilingStatus", e.target.value as W4FilingStatus)}
              >
                {ALL_W4_FILING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {W4_FILING_STATUS_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Step 3 - dependents and other credits (annual)"
              error={problemFor("w4.step3AnnualCreditCents")}
            >
              <Input
                value={form.w4Step3Credit}
                placeholder="0.00"
                onChange={(e) => set("w4Step3Credit", e.target.value)}
              />
            </Field>
            <Field
              label="Step 4(a) - other income, annual"
              error={problemFor("w4.step4aOtherIncomeAnnualCents")}
            >
              <Input
                value={form.w4Step4aOtherIncome}
                placeholder="0.00"
                onChange={(e) => set("w4Step4aOtherIncome", e.target.value)}
              />
            </Field>
            <Field
              label="Step 4(b) - deductions, annual"
              error={problemFor("w4.step4bDeductionsAnnualCents")}
            >
              <Input
                value={form.w4Step4bDeductions}
                placeholder="0.00"
                onChange={(e) => set("w4Step4bDeductions", e.target.value)}
              />
            </Field>
            <Field
              label="Step 4(c) - extra withholding PER PAY PERIOD"
              error={problemFor("w4.step4cExtraPerPeriodCents")}
              help="Per period, not per year. This is the field people most often enter annually by mistake."
            >
              <Input
                value={form.w4Step4cExtra}
                placeholder="0.00"
                onChange={(e) => set("w4Step4cExtra", e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Date signed"
              required
              error={problemFor("w4.signedAt")}
              help="An unsigned W-4 is not a W-4. Blank means we treat it as no form on file."
            >
              <Input
                type="date"
                value={form.w4SignedYmd}
                onChange={(e) => set("w4SignedYmd", e.target.value)}
              />
            </Field>
            <div className="space-y-2 pt-6">
              {/* A checkbox is still a field the engine can name in a refusal,
                  so it gets the same highlight treatment as a text input. A
                  checkbox that cannot be highlighted is a field that can be
                  named in a refusal and then not found on screen. */}
              <label className="flex items-start gap-2 text-sm text-[var(--admin-text)]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.w4Step2MultipleJobs}
                  onChange={(e) => set("w4Step2MultipleJobs", e.target.checked)}
                />
                <span>Step 2 box checked (multiple jobs, or spouse works)</span>
              </label>
              {problemFor("w4.step2MultipleJobs") ? (
                <p className="text-xs text-[var(--admin-danger)]">
                  {problemFor("w4.step2MultipleJobs")}
                </p>
              ) : null}
              <label className="flex items-start gap-2 text-sm text-[var(--admin-text)]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={form.w4Exempt}
                  onChange={(e) => set("w4Exempt", e.target.checked)}
                />
                <span>They claimed exempt from federal income tax withholding</span>
              </label>
            </div>
          </div>

          {form.w4Exempt ? (
            <p className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 p-3 text-sm leading-relaxed text-[var(--admin-text)]">
              Exempt stops FEDERAL INCOME TAX only. Social Security and Medicare
              still come out of this person&apos;s check exactly as before, and no
              W-4 can change that. The money withheld is held in trust for the
              United States the instant it is withheld, and a shortfall is
              collectible from you personally - so this system enforces the
              distinction and will not be talked out of it.
            </p>
          ) : null}
        </Card>
      </Section>

      {/* =================================================================== */}
      {/* THE I-9                                                              */}
      {/* =================================================================== */}
      <Section
        title="Form I-9"
        description="Kept in its own record that the payroll engine cannot read. Immigration facts must never touch a pay decision."
      >
        <Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="First day of work for pay"
              required
              error={problemFor("i9.firstDayOfEmploymentYmd")}
              help="Every I-9 deadline counts from this date."
            >
              <Input
                type="date"
                value={form.i9FirstDayYmd}
                onChange={(e) => set("i9FirstDayYmd", e.target.value)}
              />
            </Field>
            <Field
              label="Section 1 signed by employee"
              required
              error={problemFor("i9.section1SignedYmd")}
              help="No later than their first day."
            >
              <Input
                type="date"
                value={form.i9Section1SignedYmd}
                onChange={(e) => set("i9Section1SignedYmd", e.target.value)}
              />
            </Field>
            <Field
              label="Section 2 completed by you"
              required
              error={problemFor("i9.section2CompletedYmd")}
              help="Within three business days of the first day of work."
            >
              <Input
                type="date"
                value={form.i9Section2CompletedYmd}
                onChange={(e) => set("i9Section2CompletedYmd", e.target.value)}
              />
            </Field>
          </div>

          <label className="mt-4 flex items-start gap-2 text-sm text-[var(--admin-text)]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.i9CopiesRetained}
              onChange={(e) => set("i9CopiesRetained", e.target.checked)}
            />
            <span>
              I photocopy documents for <strong>every</strong> employee
              <span className="block text-xs text-[var(--admin-text-faint)]">
                Copying is optional. Copying only for SOME people is itself
                evidence of discrimination, so this is all-or-nothing on purpose.
              </span>
            </span>
          </label>

          {/* ---- documents ---- */}
          <div className="mt-4">
            <CardHeader
              title="Documents examined"
              subtitle="One from List A, or one from List B together with one from List C."
            />
            {problemFor("i9.documents") ? (
              <p className="mt-2 text-sm text-[var(--admin-danger)]">
                {problemFor("i9.documents")}
              </p>
            ) : null}

            <div className="mt-3 space-y-3">
              {form.i9Documents.map((doc, idx) => (
                <div
                  key={idx}
                  className="grid gap-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3 sm:grid-cols-5"
                >
                  <Field label="List">
                    <Select
                      value={doc.category}
                      onChange={(e) => {
                        const next = [...form.i9Documents];
                        next[idx] = {
                          ...doc,
                          category: e.target.value as I9DocumentCategory,
                        };
                        set("i9Documents", next);
                      }}
                    >
                      <option value="list_a">List A</option>
                      <option value="list_b">List B</option>
                      <option value="list_c">List C</option>
                    </Select>
                  </Field>
                  <Field label="Document">
                    <Input
                      value={doc.title}
                      onChange={(e) => {
                        const next = [...form.i9Documents];
                        next[idx] = { ...doc, title: e.target.value };
                        set("i9Documents", next);
                      }}
                    />
                  </Field>
                  <Field label="Issuing authority">
                    <Input
                      value={doc.issuingAuthority}
                      onChange={(e) => {
                        const next = [...form.i9Documents];
                        next[idx] = { ...doc, issuingAuthority: e.target.value };
                        set("i9Documents", next);
                      }}
                    />
                  </Field>
                  <Field label="Number">
                    <Input
                      value={doc.documentNumber}
                      onChange={(e) => {
                        const next = [...form.i9Documents];
                        next[idx] = { ...doc, documentNumber: e.target.value };
                        set("i9Documents", next);
                      }}
                    />
                  </Field>
                  <Field label="Expires" help="Blank if it does not expire.">
                    <Input
                      type="date"
                      value={doc.expirationYmd ?? ""}
                      onChange={(e) => {
                        const next = [...form.i9Documents];
                        next[idx] = {
                          ...doc,
                          expirationYmd: e.target.value === "" ? null : e.target.value,
                        };
                        set("i9Documents", next);
                      }}
                    />
                  </Field>
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <Button
                variant="neutral"
                onClick={() =>
                  set("i9Documents", [
                    ...form.i9Documents,
                    {
                      category: "list_a",
                      title: "",
                      issuingAuthority: "",
                      documentNumber: "",
                      expirationYmd: null,
                    },
                  ])
                }
              >
                Add a document
              </Button>
              {form.i9Documents.length > 0 ? (
                <Button
                  variant="neutral"
                  onClick={() => set("i9Documents", form.i9Documents.slice(0, -1))}
                >
                  Remove the last one
                </Button>
              ) : null}
            </div>

            <p className="mt-3 text-sm leading-relaxed text-[var(--admin-text-faint)]">
              You do not get to choose which documents they show you. The employee
              picks from the lists; asking for a specific one is document abuse
              under 8 U.S.C. &sect;1324b. This screen records what you were handed.
            </p>
          </div>
        </Card>
      </Section>

      {/* =================================================================== */}
      {/* PAY                                                                  */}
      {/* =================================================================== */}
      <Section
        title="What they are paid"
        description="The part neither federal form tells us, plus the one field that decides whether the wage can reach cost of goods sold."
      >
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Basis" required error={problemFor("pay.basis")}>
              <Select
                value={form.payBasis}
                onChange={(e) => set("payBasis", e.target.value as PayBasis)}
              >
                <option value="hourly">Hourly</option>
                <option value="salary">Salary</option>
              </Select>
            </Field>
            <Field
              label="Pay frequency"
              required
              error={problemFor("pay.payFrequency")}
              help="Getting this wrong does not fail loudly - it quietly mis-annualizes every withholding figure."
            >
              <Select
                value={form.payFrequency}
                onChange={(e) => set("payFrequency", e.target.value as PayFrequency)}
              >
                {ALL_PAY_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {PAY_FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {form.payBasis === "hourly" ? (
              <Field
                label="Hourly rate"
                required
                error={problemFor("pay.hourlyRateMilliCents")}
                help="Up to five decimals, because real rates need them. This is the field Sage leaves at 0.00 and saves anyway."
              >
                <Input
                  value={form.payHourlyRate}
                  placeholder="18.00"
                  onChange={(e) => set("payHourlyRate", e.target.value)}
                />
              </Field>
            ) : (
              <Field
                label="Annual salary"
                required
                error={problemFor("pay.annualSalaryCents")}
              >
                <Input
                  value={form.payAnnualSalary}
                  placeholder="60000.00"
                  onChange={(e) => set("payAnnualSalary", e.target.value)}
                />
              </Field>
            )}
            <Field
              label="First day of work for pay"
              required
              error={problemFor("pay.hireYmd")}
            >
              <Input
                type="date"
                value={form.payHireYmd}
                onChange={(e) => set("payHireYmd", e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Labor role"
              required
              error={problemFor("pay.laborRoleCode")}
              help="This decides whether the wage is cost of goods sold or a §280E-disallowed expense. Not cosmetic."
            >
              <Select
                value={form.payLaborRoleCode}
                onChange={(e) => set("payLaborRoleCode", e.target.value)}
              >
                <option value="">— choose —</option>
                {LABOR_ROLES.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Share of hours in that role, as a percent"
              error={problemFor("pay.cogsSplitBasisPoints")}
              help="Use 0 unless this person genuinely splits time across roles."
            >
              <Input
                value={form.payCogsSplitPercent}
                onChange={(e) => set("payCogsSplitPercent", e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Washington minimum wage on the hire date"
              error={problemFor("pay.minimumWageMilliCentsAtHire")}
              help="Look this up and type it in - it is not prefilled, because this system has no verified source for it and will not guess at a legal floor. Recorded rather than derived, so a later increase cannot make a lawful past rate look unlawful."
            >
              <Input
                value={form.payMinimumWage}
                onChange={(e) => set("payMinimumWage", e.target.value)}
              />
            </Field>
          </div>

          {laborRole ? (
            <div className="mt-4 rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={laborRole.neverInventoriable ? "danger" : "green"}>
                  {laborRole.neverInventoriable
                    ? "Can never reach inventory"
                    : "May be allocable to inventory"}
                </Badge>
                <span className="text-sm font-semibold text-[var(--admin-text)]">
                  posts to account {laborRole.accountCode}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-[var(--admin-text-faint)]">
                {laborRole.plainEnglish}
              </p>
            </div>
          ) : null}

          {form.payBasis === "salary" && form.payFrequency === "annually" ? (
            <p className="mt-3 rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3 text-sm leading-relaxed text-[var(--admin-text-faint)]">
              Paid once a year. That is a real payroll period - IRC &sect;3401(b)
              names it and Pub. 15-T prints an annual table for it - so the
              withholding below is computed from the annual table directly rather
              than by slicing a smaller period. If this is you paying yourself,
              note that an S-corporation owner who works in the business and takes
              no wage at all is the most common reasonable-compensation
              adjustment there is.
            </p>
          ) : null}
        </Card>
      </Section>

      {/* =================================================================== */}
      {/* THE WORKED PAYCHECK                                                  */}
      {/* =================================================================== */}
      <Section
        title="What will actually come out of this check"
        description="Not a payroll run. Nothing here is stored and no liability is created - it answers the question Sage never would."
      >
        <Card>
          {form.payBasis === "hourly" ? (
            <Field
              label="Hours in the period, for this illustration"
              className="max-w-xs"
              help="Not saved. It only drives the numbers below."
            >
              <Input
                value={form.illustrationHours}
                onChange={(e) => set("illustrationHours", e.target.value)}
              />
            </Field>
          ) : null}

          {paycheck === null ? (
            <p className="mt-3 text-sm leading-relaxed text-[var(--admin-text-faint)]">
              There is not enough on file yet to work out a paycheck. Fill in the
              W-4 year, the filing status and the pay basis above and this will
              fill itself in. It stays blank rather than showing you a zero,
              because a zero you did not ask for looks exactly like a zero
              somebody calculated.
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--admin-text)]">
                    Gross pay — {paycheck.periodLabel}
                  </span>
                  <span className="tabular-nums text-lg font-semibold text-[var(--admin-text)]">
                    {formatCentsPlain(paycheck.grossCents)}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-[var(--admin-text-faint)]">
                  {paycheck.grossFormula}
                </p>
              </div>

              <PaycheckTable
                title="Comes out of their check"
                subtitle="Each line shows its own arithmetic. Nothing is a black box."
                lines={paycheck.employeeLines}
              />

              <div className="rounded-[var(--admin-radius)] border border-[var(--admin-green)]/40 bg-[var(--admin-green)]/10 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--admin-text)]">
                    Take-home
                  </span>
                  <span className="tabular-nums text-lg font-semibold text-[var(--admin-text)]">
                    {formatCentsPlain(paycheck.takeHomeCents)}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-[var(--admin-text-faint)]">
                  {paycheck.takeHomeFormula}
                </p>
              </div>

              {paycheck.uncollectedEmployeeTaxCents > 0 ? (
                <p className="rounded-[var(--admin-radius)] border border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 p-3 text-sm leading-relaxed text-[var(--admin-text)]">
                  <strong>
                    {formatCentsPlain(paycheck.uncollectedEmployeeTaxCents)} of
                    employee tax could not be collected
                  </strong>{" "}
                  because the check was not big enough to cover it. That shortfall
                  does not disappear - you either recover it from a later check or
                  you pay it, and either way it turns up on a Form 941. It is shown
                  here because a take-home of zero with a silent shortfall behind
                  it is exactly the kind of thing that looks fine on screen.
                </p>
              ) : null}

              <PaycheckTable
                title="What you pay on top, as the employer"
                subtitle="None of this reduces their take-home. It is your cost, and it is the number people forget when they budget a hire."
                lines={paycheck.employerLines}
              />

              <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--admin-text)]">
                    Total cost to Greenway for this period
                  </span>
                  <span className="tabular-nums text-lg font-semibold text-[var(--admin-text)]">
                    {formatCentsPlain(paycheck.employerCostCents)}
                  </span>
                </div>
                <p className="mt-1 font-mono text-xs text-[var(--admin-text-faint)]">
                  {paycheck.employerCostFormula}
                </p>
              </div>

              {paycheck.refusals.length > 0 ? (
                <div className="rounded-[var(--admin-radius)] border border-[var(--admin-orange)]/40 bg-[var(--admin-orange)]/10 p-3">
                  <p className="text-sm font-semibold text-[var(--admin-text)]">
                    Lines this system would not guess at
                  </p>
                  <ul className="mt-2 space-y-1">
                    {paycheck.refusals.map((r, i) => (
                      <li key={i} className="text-sm text-[var(--admin-text)]">
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {form.payBasis === "hourly" ? (
                <p className="text-xs text-[var(--admin-text-faint)]">
                  Illustration uses {formatHours(Math.round(Number(form.illustrationHours || "0") * 100))} hours
                  at {formatMilliCentsAsRate(dollarsToMilliCents(form.payHourlyRate) ?? 0)} per hour.
                </p>
              ) : null}
            </div>
          )}
        </Card>
      </Section>

      {/* =================================================================== */}
      {/* SAVE                                                                 */}
      {/* =================================================================== */}
      <Section title="Save this employee to payroll">
        <Card>
          {saveNote ? (
            <p
              className={`mb-3 rounded-[var(--admin-radius)] border p-3 text-sm leading-relaxed ${
                saveNote.ok
                  ? "border-[var(--admin-green)]/40 bg-[var(--admin-green)]/10 text-[var(--admin-text)]"
                  : "border-[var(--admin-danger)]/40 bg-[var(--admin-danger)]/10 text-[var(--admin-text)]"
              }`}
            >
              {saveNote.message}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="save" onClick={onSave} disabled={pending || !view.canSave}>
              {pending ? "Saving…" : "Save to payroll"}
            </Button>
            {!view.canSave ? (
              <span className="text-sm text-[var(--admin-text-faint)]">
                {view.blockingCount} step
                {view.blockingCount === 1 ? "" : "s"} still outstanding. The
                checklist at the top of this page names every one, and the fields
                it names are outlined in red above.
              </span>
            ) : null}
          </div>

          <p className="mt-3 text-sm leading-relaxed text-[var(--admin-text-faint)]">
            Pressing this does not overwrite anything. Any version already on file
            is marked superseded and the new one is inserted alongside it, so what
            was on file - and when - remains answerable. The server checks all of
            this again before it writes; the checklist above is advice, not a
            permission slip.
          </p>
        </Card>
      </Section>
    </div>
  );
}

/**
 * The citation behind a paycheck line, looked up in the shared authority
 * registry rather than typed in here.
 *
 * A hand-typed citation next to a computed number is the worst of both worlds:
 * it looks authoritative and it drifts silently the moment the rule it cites is
 * amended. Looking it up means a wrong id renders nothing instead of rendering
 * a lie.
 */
function citeFor(authorityId: string | undefined): string | null {
  if (authorityId === undefined) return null;
  const found = findGuidanceAuthority(authorityId);
  return found ? found.cite : null;
}

/**
 * One side of the paycheck. Split out because employee and employer lines are
 * rendered identically but must never be added together - which is precisely
 * the mistake that makes a "total taxes" figure meaningless.
 */
function PaycheckTable({
  title,
  subtitle,
  lines,
}: {
  title: string;
  subtitle: string;
  lines: readonly {
    label: string;
    amountCents: number;
    formula: string;
    authorityId?: string;
    refusal?: string;
  }[];
}) {
  return (
    <div className="rounded-[var(--admin-radius)] border border-[var(--admin-border)] p-3">
      <CardHeader title={title} subtitle={subtitle} />
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--admin-text-faint)]">
          Nothing on this side for this period.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {lines.map((line, i) => (
            <li
              key={i}
              className="border-b border-[var(--admin-border)]/40 pb-2 last:border-0 last:pb-0"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-[var(--admin-text)]">{line.label}</span>
                <span className="tabular-nums text-sm font-semibold text-[var(--admin-text)]">
                  {formatCentsPlain(line.amountCents)}
                </span>
              </div>
              <p className="mt-0.5 font-mono text-xs text-[var(--admin-text-faint)]">
                {line.formula}
              </p>
              {/*
                THE CITATION. Every line already carried an authorityId and the
                screen was throwing it away, so the paycheck showed arithmetic
                with nothing standing behind it. "6.2%" is a number someone
                typed; "26 U.S.C. 3101(a)" is the reason it is 6.2%. The point
                of this screen is that a figure can be traced, so the trace has
                to be on the page.
              */}
              {citeFor(line.authorityId) ? (
                <p className="mt-0.5 text-xs text-[var(--admin-text-faint)]">
                  {citeFor(line.authorityId)}
                </p>
              ) : null}
              {line.refusal ? (
                <p className="mt-0.5 text-xs text-[var(--admin-orange)]">{line.refusal}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
