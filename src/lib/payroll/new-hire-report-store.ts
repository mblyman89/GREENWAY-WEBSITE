/**
 * src/lib/payroll/new-hire-report-store.ts   (books-68)
 *
 * Reads the people and the employer identity the DSHS 18-463 new-hire report
 * prints. Every judgement lives in new-hire-report-core.ts; this file only
 * fetches rows and hands them over unchanged, so the refusals are testable.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS INSTEAD OF REUSING listEmployeeSetup()
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Rule 25 says extend, never duplicate, so the first thing I did was check
 * whether the roster loader already answered this. MEASURED — `EmployeeSetupRow`
 * carries exactly:
 *
 *     employeeId, fullName, ssnLastFour, hasW4, hasI9, hasPay, socCode
 *
 * RCW 26.23.040(3)(a) requires "The employee's name, address, social security
 * number, and date of birth." Of those four, the roster has a full name and the
 * LAST FOUR digits of the SSN. It has no address, no date of birth, and not the
 * whole number. Three of the four required facts are simply not in that shape,
 * and `ssnLastFour` is worse than absent for this purpose: printing it would put
 * a nine-character box on a legal report containing four correct digits and five
 * missing ones, which reads as a filled field.
 *
 * So this is a different question, not the same question asked twice, and it
 * gets its own loader.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE SSN IS READ IN FULL, AND THAT IS THE WHOLE REASON THIS FILE IS CAREFUL
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everywhere else in this system the SSN is masked, and `revealSsn()` will not
 * show it until an audit row has been written — "if the log fails, the reveal
 * fails". That control exists because showing a Social Security number is an
 * event worth recording.
 *
 * This form prints nine digits per employee, in full, on paper Michael mails to
 * a state registry. RCW 26.23.040(3)(a) requires it by name; there is no masked
 * variant of a new-hire report. So the number is read here rather than refused.
 *
 * What is NOT done is quietly turning the reveal control off. Every call to this
 * loader writes one audit row per employee whose number it read, through the
 * SAME table `revealSsn` uses, with a reason naming the form. If Michael ever
 * asks "who has seen Ana's number", the answer includes the day he opened the
 * new-hire report, which is true and which he would want to know.
 *
 * The write happens BEFORE the numbers are returned, in the same order
 * `revealSsn` established, for the same reason: an audit log you can skip when
 * the insert is inconvenient is not an audit log.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHERE THE NAME COMES FROM, AND THE SPLIT I REFUSED TO MAKE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MEASURED before writing a query: `public.employees` (0037) has ONE name
 * column, `full_name`, and its own comment calls it a DISPLAY name for the
 * timeclock that "may be a nickname". The 18-463 has three separate boxes —
 * LAST NAME, FIRST NAME, MIDDLE NAME — so full_name cannot fill them.
 *
 * The obvious shortcut is to split `full_name` on the last space. Migration
 * 0203 already wrote down why that is forbidden, in the course of solving this
 * same problem for the W-2:
 *
 *   "splitting a name on the last space is a guess that fails on compound
 *    surnames, surnames recorded first, and single-word legal names"
 *
 * That reasoning does not weaken because a different form is asking. So this
 * loader reads the columns 0203 created — `w2_last_name` and
 * `w2_first_name_and_initial` — which hold the legal name AS PRINTED ON THE
 * SOCIAL SECURITY CARD. That is the same fact DSHS is asking for: a new-hire
 * report is matched against the child-support registry by name and SSN, so the
 * name that must appear is the one the SSA has, which is exactly what those
 * columns were captured to hold.
 *
 * The `w2_` prefix is now a misnomer and is worth saying out loud. Adding
 * `dshs_first_name` alongside it would store one fact in two places, and the
 * failure mode of that is a W-2 and a new-hire report that disagree about a
 * person's legal name — the precise mismatch 0203 exists to prevent. Rule 25:
 * extend, never duplicate. If the prefix is ever cleaned up, it is a rename,
 * not a second column.
 *
 * MIDDLE NAME is left unread, and that is a decision rather than an oversight.
 * RCW 26.23.040(3)(a) requires "name, address, social security number, and date
 * of birth" and does not itemise a middle name, which is why the core marks
 * that box `required: false`. `w2_first_name_and_initial` already carries the
 * middle INITIAL where the card shows one. Inventing a column to hold a fact no
 * statute asks for, and no screen collects, would leave a box that is empty in
 * the database and empty on the paper while implying somebody forgot to fill
 * it. It prints an em dash, like every other honestly-absent optional value.
 */

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import { loadCompanyProfile } from "@/lib/accounting/company-profile-store";
import {
  type NewHireEmployee,
  type NewHireEmployer,
} from "@/lib/payroll/new-hire-report-core";

/**
 * How far back the screen looks by default.
 *
 * NOT a rule DSHS wrote, and it is not allowed to look like one. The statute
 * gives twenty days from the date of hire to report, and says nothing about how
 * long a hire stays interesting afterwards. Ninety days is a VIEWING window
 * chosen so that a hire which is already late still appears (twenty days due,
 * seventy days of lateness visible) rather than dropping off the screen at the
 * exact moment it starts costing $25 a month. Rule 62d — the number is ours, so
 * it is labelled as ours wherever it is shown.
 */
export const NEW_HIRE_LOOKBACK_DAYS = 90;

export type NewHireLoad = {
  readonly ok: boolean;
  /** Set only when the DATABASE could not be read. Distinct from "no hires". */
  readonly readFailed: boolean;
  readonly employer: NewHireEmployer;
  readonly employees: readonly NewHireEmployee[];
  /**
   * True when the reveal audit row could not be written. The numbers are then
   * withheld and the caller refuses, rather than printing them unlogged.
   */
  readonly auditWriteFailed: boolean;
};

const EMPTY_EMPLOYER: NewHireEmployer = {
  legalName: null,
  street: null,
  city: null,
  state: null,
  zip: null,
  ein: null,
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/**
 * Load the hires that belong on a new-hire report.
 *
 * `sinceYmd` is the earliest hire date to include. Passing null loads every
 * employee with a hire date, which is what the "show me the form" button does
 * on a quiet screen — better an empty form than a form that silently hid
 * somebody because of a window they never chose.
 */
export async function loadNewHireReport(input: {
  readonly sinceYmd: string | null;
  readonly actorId: string | null;
  readonly role: string;
}): Promise<NewHireLoad> {
  if (!isSupabaseServiceConfigured) {
    return {
      ok: false,
      readFailed: true,
      employer: EMPTY_EMPLOYER,
      employees: [],
      auditWriteFailed: false,
    };
  }

  const admin = createSupabaseAdminClient();

  const profileLoad = await loadCompanyProfile();
  const p = profileLoad.ok ? profileLoad.profile : {};
  const employer: NewHireEmployer = {
    // Field names MEASURED from COMPANY_FIELDS in company-identity-core.ts,
    // not guessed: the address is address_line1/city/state_code/zip_code.
    legalName: str(p["legal_name"]),
    street: str(p["address_line1"]),
    city: str(p["city"]),
    state: str(p["state_code"]),
    zip: str(p["zip_code"]),
    ein: str(p["ein"]),
  };

  let query = admin
    .from("employees")
    .select(
      "id, full_name, w2_last_name, w2_first_name_and_initial, home_street, home_city, " +
        "home_state, home_zip, date_of_birth, hire_date, ssn_full",
    )
    .not("hire_date", "is", null)
    .order("hire_date", { ascending: false });

  if (input.sinceYmd !== null) query = query.gte("hire_date", input.sinceYmd);

  const { data, error } = await query;

  if (error) {
    return {
      ok: false,
      readFailed: true,
      employer,
      employees: [],
      auditWriteFailed: false,
    };
  }

  type Row = {
    id: string;
    full_name: string | null;
    w2_last_name: string | null;
    w2_first_name_and_initial: string | null;
    home_street: string | null;
    home_city: string | null;
    home_state: string | null;
    home_zip: string | null;
    date_of_birth: string | null;
    hire_date: string | null;
    ssn_full: string | null;
  };

  /*
   * Cast through `unknown`. The generated Supabase types do not know about
   * home_street/home_city/home_state/home_zip yet — migration 0208 adds them in
   * this same slice and the type generator has not been re-run — so the client
   * infers `GenericStringError[]` for the whole select. This is the same shape
   * of cast `listEmployeeSetup` uses; the runtime guard is the `error` check
   * above, which is what actually catches a column that is not there.
   */
  const rows = ((data ?? []) as unknown) as Row[];
  if (rows.length === 0) {
    return { ok: true, readFailed: false, employer, employees: [], auditWriteFailed: false };
  }

  /*
   * ═══ THE AUDIT ROW GOES IN FIRST ═══
   *
   * One row per employee whose number is about to be read, through the same
   * table the Sage-style reveal writes. Only for rows that actually HAVE a
   * number: logging a disclosure of nothing would pad the log with events that
   * never happened, which makes the log less trustworthy, not more.
   */
  const withSsn = rows.filter((r) => str(r.ssn_full) !== null);
  let auditWriteFailed = false;

  if (withSsn.length > 0) {
    const { error: auditError } = await admin.from("employee_ssn_reveals").insert(
      withSsn.map((r) => ({
        employee_id: r.id,
        revealed_by: input.actorId,
        // `revealed_by_role` is NOT NULL in 0195, and the whole insert would
        // fail on a blank one — taking the report down with it. An unknown role
        // is recorded as unknown, which is true and which still logs the event.
        revealed_by_role: input.role.trim() === "" ? "unknown" : input.role.trim(),
        reason:
          "Printed in full on the DSHS 18-463 Washington New Hire Report, which " +
          "RCW 26.23.040(3)(a) requires to carry the employee's social security number.",
      })),
    );
    if (auditError) auditWriteFailed = true;
  }

  const employees: NewHireEmployee[] = rows.map((r) => ({
    employeeId: r.id,
    // The legal name as printed on the social security card (0203), NOT
    // full_name — which that migration's own comment calls a display name that
    // "may be a nickname". A nickname on a child-support registry match fails.
    lastName: str(r.w2_last_name),
    firstName: str(r.w2_first_name_and_initial),
    // Deliberately never populated. See the docblock: no statute asks for it,
    // no column holds it, and the initial rides along in the first-name field.
    middleName: null,
    street: str(r.home_street),
    city: str(r.home_city),
    state: str(r.home_state),
    zip: str(r.home_zip),
    // Withheld, not faked, when the log failed. The core then refuses by name
    // on the SSN field, which is the true reason the form cannot be produced.
    ssn: auditWriteFailed ? null : str(r.ssn_full),
    dateOfBirth: str(r.date_of_birth),
    dateOfHire: str(r.hire_date),
    // full_name IS the right choice here and only here: displayName labels the
    // block on screen so Michael knows who he is looking at, and the timeclock
    // name is the one he recognises. It is never printed in a form box.
    displayName: str(r.full_name) ?? str(r.w2_last_name) ?? r.id,
  }));

  return { ok: true, readFailed: false, employer, employees, auditWriteFailed };
}
