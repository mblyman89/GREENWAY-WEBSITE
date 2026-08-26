/**
 * src/lib/payroll/esd-upload-store.ts   (books-64)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TWO ESD UPLOAD FILES, ASSEMBLED FROM THE REAL QUARTER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Michael: "When we go to do the pdf exports, we will need an export .csv for
 * esd and pfml/ wa cares."
 *
 * Two pure writers already exist — `esd-eams-csv-core` (books-64, unemployment)
 * and `esd-paid-leave-csv-core` (books-56, Paid Leave / WA Cares). Neither could
 * be reached from any screen. `grep -rn "buildPaidLeaveCsv" src/` outside its own
 * module returned NOTHING before this slice: 511 lines of correct, spec-quoted,
 * gate-covered code that Michael could not run. That is D-08's class of defect
 * — right code, wired to nothing — and it is logged as D-11.
 *
 * This module is the join between the quarter in the database and those writers.
 * It holds no formatting rules of its own; every column rule lives in the core
 * that quotes the specification for it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THE NAME COMES FROM THE W-2 COLUMNS AND NOT FROM `full_name`
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `wa-quarterly-store` carries a single `displayName` per person, because the
 * 5208B worksheet prints one name in one column. EAMS does not: it wants last
 * name, first name, middle name and suffix in four separate columns.
 *
 * Splitting `displayName` on the last space would be a guess, and books-62
 * already settled that argument for the W-2. Migration 0203's comment says it
 * exactly:
 *
 *   "splitting a name on the last space is a guess that fails on compound
 *    surnames, surnames recorded first, and single-word legal names"
 *
 * So this module reads the SAME three legal-name columns the W-2 reads —
 * `w2_first_name_and_initial`, `w2_last_name`, `w2_name_suffix` — and refuses
 * when they are absent. The column names say "w2" because that is the form that
 * forced them to exist; the FACT they record is the person's legal name as
 * printed on their social security card, which is what ESD wants too. Reusing
 * them is rule 25; adding parallel `esd_last_name` columns would create two
 * places for one truth and they would eventually disagree.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE SSN, AND WHY NO REVEAL ROW IS WRITTEN
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `ssn_full` is read, exactly as `form-w2-store` reads it, because ESD's file
 * carries the digits and there is no version of this upload that does not. The
 * reasoning that file records applies unchanged, and is repeated here rather
 * than assumed: the digits are handed to a pure writer and never returned to a
 * screen, so writing to `employee_ssn_reveals` would log a disclosure to a human
 * that did not happen. A log with false entries in it is worse than a shorter
 * honest one.
 *
 * The CSV that leaves this module DOES contain full SSNs, because that is what
 * ESD's importer reads. The route that serves it is owner-gated and sets
 * `Content-Disposition: attachment`, so it is a file Michael downloads, not a
 * page anything can render.
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";
import {
  buildEamsCsv,
  type EamsCsvResult,
  type EamsEmployeeRow,
} from "@/lib/payroll/esd-eams-csv-core";
import {
  buildPaidLeaveCsv,
  type PaidLeaveCsvResult,
  type PaidLeaveEmployeeRow,
} from "@/lib/payroll/esd-paid-leave-csv-core";
/*
 * `QuarterRef` and `quarterDateRange` come from the DEPOSIT SCHEDULE core, not
 * from wa-quarterly-core, which merely re-uses the type without exporting it.
 * Found by the compiler: TS2459 "declares 'QuarterRef' locally, but it is not
 * exported". Worth noting because the wrong import compiled fine in the editor
 * and only failed under `tsc --noEmit`.
 *
 * `quarterDateRange` is IMPORTED rather than written here. The first draft of
 * this file had its own private copy — six lines, identical logic, and a second
 * place for the last-day-of-quarter arithmetic to be wrong in. Standing rule 25:
 * extend, never duplicate.
 */
import {
  quarterDateRange,
  type QuarterRef,
} from "@/lib/payroll/payroll-deposit-schedule-core";

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  WHAT IS READ
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The employee facts an ESD upload needs.
 *
 * Deliberately NOT `select("*")`. `ssn_full` is protected by a column-level
 * revoke (migration 0195) rather than by RLS, and naming columns explicitly is
 * what makes it obvious in review that this module touches it.
 */
const EMPLOYEE_COLUMNS =
  "id, full_name, w2_first_name_and_initial, w2_last_name, w2_name_suffix, ssn_full, date_of_birth, wa_cares_exempt, soc_code" as const;

/** The pay-line figures, summed per person over the quarter. */
const LINE_COLUMNS =
  "run_id, employee_id, employee_name, gross_pay_cents, wa_suta_wages_cents, wa_pfml_wages_cents, lni_hundredth_hours" as const;

type EmployeeRow = {
  readonly id: string;
  readonly full_name: string | null;
  readonly w2_first_name_and_initial: string | null;
  readonly w2_last_name: string | null;
  readonly w2_name_suffix: string | null;
  readonly ssn_full: string | null;
  readonly date_of_birth: string | null;
  readonly wa_cares_exempt: boolean | null;
  readonly soc_code: string | null;
};

export type EsdUploadKind = "eams_unemployment" | "paid_leave_wa_cares";

export function isEsdUploadKind(value: string): value is EsdUploadKind {
  return value === "eams_unemployment" || value === "paid_leave_wa_cares";
}

export type EsdUploadBlocker = {
  readonly subject: string;
  readonly missing: string;
  readonly whatToDo: string;
};

export type EsdUploadResult =
  | {
      readonly ok: true;
      readonly kind: EsdUploadKind;
      readonly csv: string;
      readonly fileName: string;
      readonly rowsWritten: number;
      readonly omitted: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: "NOT_CONFIGURED" | "READ_FAILED" | "NO_PAYROLL" | "INCOMPLETE_RECORDS" | "REFUSED";
      readonly message: string;
      /** Named people and named missing facts, never a count. */
      readonly blockers: readonly EsdUploadBlocker[];
    };

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  DATES AND FILE NAMES
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The download's file name.
 *
 * ESD says of EAMS: "We have no rules about how you name your files." So the
 * name is chosen for Michael's benefit rather than the importer's, and it names
 * the PROGRAMME as well as the quarter. Two eight-column CSVs for two different
 * ESD programmes sitting in one Downloads folder called `esd-2026-q1.csv` and
 * `esd-2026-q1(1).csv` is exactly how the wrong file gets uploaded.
 */
export function esdUploadFileName(kind: EsdUploadKind, q: QuarterRef): string {
  const which = kind === "eams_unemployment" ? "eams-unemployment" : "paidleave-wacares";
  return `esd-${which}-${q.year}-q${q.quarter}.csv`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  THE BUILD
 * ═══════════════════════════════════════════════════════════════════════════ */

function num(v: number | string | null): number {
  if (v === null) return 0;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

export async function buildEsdUpload(
  kind: EsdUploadKind,
  quarter: QuarterRef,
): Promise<EsdUploadResult> {
  if (!isSupabaseServiceConfigured) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message:
        "The database connection is not configured, so no upload file can be built. Nothing " +
        "was changed.",
      blockers: [],
    };
  }

  const admin = createSupabaseAdminClient();
  const range = quarterDateRange(quarter);

  /* ── the runs in the quarter, BY PAY DATE ─────────────────────────────── */

  const { data: runData, error: runError } = await admin
    .from("payroll_runs")
    .select("id, pay_date, status")
    .gte("pay_date", range.start)
    .lte("pay_date", range.end);

  if (runError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the pay runs for this quarter: ${runError.message}.`,
      blockers: [],
    };
  }

  const runIds = ((runData ?? []) as { id: string; status: string | null }[])
    .filter((r) => r.status !== "void")
    .map((r) => r.id);

  if (runIds.length === 0) {
    return {
      ok: false,
      code: "NO_PAYROLL",
      message:
        `There are no pay runs in ${quarter.year} Q${quarter.quarter}, so there is no wage ` +
        `file to upload. Note that this is NOT the same as a no-payroll quarter: ESD still ` +
        `wants a report filed, and it has its own route for that. An empty file would look ` +
        `like a filing while telling ESD nothing.`,
      blockers: [],
    };
  }

  /* ── the pay lines ────────────────────────────────────────────────────── */

  const { data: lineData, error: lineError } = await admin
    .from("payroll_run_lines")
    .select(LINE_COLUMNS)
    .in("run_id", runIds);

  if (lineError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the pay lines for this quarter: ${lineError.message}.`,
      blockers: [],
    };
  }

  type LineRow = {
    readonly employee_id: string | null;
    readonly employee_name: string;
    readonly gross_pay_cents: number | string | null;
    readonly wa_suta_wages_cents: number | string | null;
    readonly wa_pfml_wages_cents: number | string | null;
    readonly lni_hundredth_hours: number | string | null;
  };

  const lines = (lineData ?? []) as unknown as LineRow[];

  /*
   * Summed per person, and keyed on `employee_id` ONLY.
   *
   * `wa-quarterly-store` falls back to `employee_name` as a bucket key when the
   * id is null, which is right for a worksheet: a nameless total still shows the
   * money. It is WRONG here. Without an employee id there is no row to read a
   * legal name, an SSN or a date of birth from, so such a line cannot be filed
   * at all, and quietly bucketing it under a display name would produce a file
   * that silently omits somebody's wages.
   */
  type Bucket = { grossCents: number; sutaCents: number; pfmlCents: number; hundredthHours: number };
  const buckets = new Map<string, Bucket>();
  const orphanNames = new Set<string>();

  for (const l of lines) {
    if (l.employee_id === null) {
      orphanNames.add(l.employee_name);
      continue;
    }
    const b = buckets.get(l.employee_id) ?? {
      grossCents: 0,
      sutaCents: 0,
      pfmlCents: 0,
      hundredthHours: 0,
    };
    buckets.set(l.employee_id, {
      grossCents: b.grossCents + num(l.gross_pay_cents),
      sutaCents: b.sutaCents + num(l.wa_suta_wages_cents),
      pfmlCents: b.pfmlCents + num(l.wa_pfml_wages_cents),
      hundredthHours: b.hundredthHours + num(l.lni_hundredth_hours),
    });
  }

  const blockers: EsdUploadBlocker[] = [];

  for (const name of orphanNames) {
    blockers.push({
      subject: name,
      missing: "a link to an employee record",
      whatToDo:
        "This pay line is not attached to an employee, so there is no legal name, SSN or " +
        "date of birth to file for it. Attach it to the right employee before building " +
        "the upload.",
    });
  }

  /* ── the employees ───────────────────────────────────────────────────── */

  const { data: empData, error: empError } = await admin
    .from("employees")
    .select(EMPLOYEE_COLUMNS)
    .in("id", [...buckets.keys()]);

  if (empError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message:
        `Could not read the employee records: ${empError.message}. If this mentions a ` +
        `missing column, the migration that adds the ESD upload fields has not been applied.`,
      blockers: [],
    };
  }

  const employees = new Map<string, EmployeeRow>();
  for (const e of (empData ?? []) as unknown as EmployeeRow[]) {
    employees.set(e.id, e);
  }

  /* ── assemble, refusing per person rather than in bulk ────────────────── */

  const eamsRows: EamsEmployeeRow[] = [];
  const paidLeaveRows: PaidLeaveEmployeeRow[] = [];

  for (const [employeeId, b] of [...buckets.entries()].sort()) {
    const e = employees.get(employeeId);
    const who = e?.full_name?.trim() || `employee ${employeeId}`;

    if (!e) {
      blockers.push({
        subject: who,
        missing: "an employee record",
        whatToDo:
          "There are pay lines for this employee id but no employee row. The record may " +
          "have been deleted after the pay run.",
      });
      continue;
    }

    const lastName = (e.w2_last_name ?? "").trim();
    const firstName = (e.w2_first_name_and_initial ?? "").trim();
    const suffix = (e.w2_name_suffix ?? "").trim();
    const ssn = (e.ssn_full ?? "").trim();

    if (lastName === "") {
      blockers.push({
        subject: who,
        missing: "legal last name",
        whatToDo:
          'Enter the legal name from this person\'s social security card on their employee ' +
          "record. The display name is not used, because it may be a nickname and because " +
          "splitting one name field on the last space guesses wrongly on compound surnames.",
      });
    }
    if (ssn === "") {
      blockers.push({
        subject: who,
        missing: "Social Security number",
        whatToDo:
          "Enter the nine digits on the employee record. ESD permits a blank SSN in its " +
          "file format, but a blank one here would mean this system does not hold the " +
          "number rather than that ESD does not need it — so it stops instead of filing a " +
          "wage row nobody can be matched to.",
      });
    }

    /*
     * HOURS ARE CONVERTED ONCE, ON THE QUARTER TOTAL.
     *
     * Stored as integer hundredths, so dividing per pay line and then adding
     * would round eight times instead of once. Both writers then apply ESD's
     * CEILING rule to this single figure.
     */
    const exactHours = b.hundredthHours / 100;

    if (kind === "eams_unemployment") {
      eamsRows.push({
        ssn,
        lastName,
        firstName,
        // EAMS column D takes a middle NAME or an initial, up to 20 characters.
        // What is stored is a first name AND initial in one field, so there is
        // no separate middle name to give. Empty is explicitly permitted:
        // "Leave this cell blank when it doesn't apply to someone." Splitting
        // the initial back out of the first-name field would be the same guess
        // migration 0203 exists to refuse.
        middleName: "",
        suffix,
        exactHours,
        /*
         * THE UNEMPLOYMENT FILE REPORTS **GROSS** WAGES, NOT SUTA-TAXABLE WAGES.
         *
         * ESD's column G is "Gross wages", and the 5208A then computes excess
         * wages from the gross on its own line — that is what line 14 "EXCESS
         * WAGES" is for. Sending the already-capped taxable figure would report
         * the cap TWICE: once here, once in ESD's own excess-wage calculation,
         * understating wages for anyone over the wage base. Michael's filed Q1
         * confirms the reading: gross 61,531.21 and total taxable 61,531.21 are
         * equal only because nobody had passed $78,200 yet, and the wage detail
         * rows sum to exactly that gross.
         */
        grossWagesCents: b.grossCents,
        socCode: (e.soc_code ?? "").trim(),
      });
    } else {
      const dob = (e.date_of_birth ?? "").trim();
      if (dob === "") {
        blockers.push({
          subject: who,
          missing: "date of birth",
          whatToDo:
            "Paid Leave and WA Cares have required a date of birth since 1 October 2023. " +
            "There is no safe default: a guessed date of birth is a false statement about " +
            "a person, and WA Cares uses it to decide eligibility.",
        });
      }
      paidLeaveRows.push({
        ssn,
        lastName,
        firstName,
        // The Paid Leave file wants an INITIAL, up to one character — the
        // opposite of EAMS's up-to-20-character middle name. Empty for the same
        // reason as above, and the sibling writer refuses anything longer.
        middleInitial: "",
        exactHours,
        // PFML and WA Cares are charged on the PFML wage figure the engine
        // already computed, which is not the same as gross: PFML has its own
        // annual cap tied to the social security wage base.
        grossWagesCents: b.pfmlCents,
        /*
         * FALSE MEANS "GREENWAY HOLDS NO EXEMPTION LETTER", WHICH IS A CLAIM.
         *
         * The sibling module's docblock is explicit that entering "N" asserts
         * something only Michael knows. The column defaults to false, and false
         * is the ordinary truth for every Greenway employee today. When somebody
         * obtains an exemption the flag must be set on their record — it is a
         * stored fact, not an inference made here.
         */
        waCaresExempt: e.wa_cares_exempt === true,
        dateOfBirth: dob,
      });
    }
  }

  if (blockers.length > 0) {
    return {
      ok: false,
      code: "INCOMPLETE_RECORDS",
      message:
        `The upload was not built, because ${blockers.length === 1 ? "one record is" : `${blockers.length} records are`} ` +
        `missing something ESD requires. Nothing was changed. Every missing item is named ` +
        `below with the person it belongs to, so they can be fixed in one pass rather than ` +
        `one refusal at a time.`,
      blockers,
    };
  }

  /* ── hand off to the writer that owns the format ──────────────────────── */

  const built: EamsCsvResult | PaidLeaveCsvResult =
    kind === "eams_unemployment" ? buildEamsCsv(eamsRows) : buildPaidLeaveCsv(paidLeaveRows);

  if (!built.ok) {
    return {
      ok: false,
      code: "REFUSED",
      message:
        "The file format checks refused this quarter. These are ESD's own column rules, " +
        "quoted in the refusal, and nothing was changed.",
      blockers: built.refusals.map((r) => ({
        subject: r.subject,
        missing: r.code,
        whatToDo: r.explanation,
      })),
    };
  }

  return {
    ok: true,
    kind,
    csv: built.csv,
    fileName: esdUploadFileName(kind, quarter),
    rowsWritten: built.rowsWritten,
    omitted: built.omitted,
  };
}
