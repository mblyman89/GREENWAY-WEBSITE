import "server-only";

/**
 * src/lib/payroll/form-941-confirmation-store.ts   (books-48)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ONLY THING IN THIS SYSTEM THAT WRITES `filed_form_941_totals`
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Migration 0204 created the table. `reconcileW3To941s` reads it and compares
 * the W-3 against the year's four 941s. Both halves shipped. Nothing ever put a
 * row in, so the comparison has reported "not run" since the day it was built.
 *
 * This file closes that loop, and it is the ONLY file that may.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE FILE FROM form-w2-store.ts
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Not preference — a gate. `tests/compliance/form-w2-store.test.ts` asserts
 * that the W-2 store contains no `.insert(`, `.update(`, `.upsert(`,
 * `.delete(` or `.rpc(` anywhere in its source, under the heading "writes
 * nothing and transmits nothing". That gate is correct and worth keeping: the
 * file that assembles W-2s from SSNs and reads filed returns has no business
 * being able to mutate anything, and a reader who has to check whether it does
 * has already lost.
 *
 * So the write lives here, alone, where it can be read in full in one sitting.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE STILL DOES NOT DO
 * ───────────────────────────────────────────────────────────────────────────
 *
 * IT DOES NOT FILE ANYTHING. Recording what was filed and filing are different
 * acts. Nothing here contacts the IRS, and nothing ever will — we replace the
 * data-preparation half of Aatrix and are not a filing agent. Michael files
 * every return himself. A row in this table is a TRANSCRIPTION of a return that
 * has already gone.
 *
 * IT DOES NO TAX ARITHMETIC. Not a rate, not a cap, not a subtotal. Every
 * judgement about whether the typed figures are storable lives in
 * `form-941-confirmation-core.ts`, which is pure and tested. This file is
 * wiring: check the gate, call the validator, hand the result to the database,
 * translate whatever comes back into a sentence.
 *
 * IT DOES NOT DECIDE WHAT A FIGURE SHOULD BE. If the validator returns
 * warnings — a 5a tax that is not 12.4% of 5a wages, for instance — the row is
 * STORED ANYWAY and the warnings are handed back for display. §5 of the core
 * explains why at length, and it is the single most important design decision
 * in this feature: a table whose purpose is to hold the INDEPENDENT side of a
 * reconciliation must accept figures that disagree with this software's
 * expectations, or it is not independent, and the reconciliation downstream is
 * then guaranteed green (standing rule 39).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY UPSERT AND NOT INSERT
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `unique (tax_year, quarter)` means the second attempt at one quarter is a
 * constraint violation. Two behaviours were possible and the choice matters.
 *
 * A plain INSERT would refuse the correction. Michael transcribes seven figures
 * off a paper return; the realistic error is a typo he spots ten seconds later,
 * and a system that says "Q1 2027 already exists, delete it first" for a typo
 * is a system he stops using.
 *
 * So this upserts on the (tax_year, quarter) key and REPORTS which of the two
 * happened, plainly, in the returned message. What it must never do is
 * overwrite silently: replacing a stored figure without saying so is how a
 * reconciliation that was investigated last week quietly becomes a different
 * answer this week.
 *
 * WHAT AN UPSERT HERE IS NOT: an amendment. A 941-X reports CORRECTIONS — the
 * difference between what was filed and what should have been — not totals, and
 * this table cannot represent one. Overwriting Q1 with post-941-X figures would
 * make the annual comparison agree with a W-2 that was itself never amended.
 * The lesson text on the screen says so; §4 of migration 0204 says so too.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import {
  filedForm941Row,
  validateFiledForm941Draft,
  type FiledForm941Draft,
  type FiledForm941Refusal,
  type FiledForm941Warning,
  type ValidatedFiledForm941,
} from "./form-941-confirmation-core";

/* ═════════════════════════════════════════════════════════════════════════
 * §1  WHAT THE CALLER GETS BACK
 *
 * Three outcomes, not two. "Refused because the entry is wrong" and "failed
 * because the database is unreachable" are different events needing different
 * responses from Michael — one is "fix the number", the other is "this is not
 * your fault" — and collapsing them into a single `{ok:false, message}` is how
 * a form ends up telling somebody their typing is wrong when the network is
 * down.
 * ═════════════════════════════════════════════════════════════════════════ */

export type SaveFiledForm941Result =
  | {
      readonly ok: true;
      /** True when a row for this quarter already existed and was replaced. */
      readonly replacedExisting: boolean;
      readonly value: ValidatedFiledForm941;
      /** Stored despite these. Never suppressed, never a reason to refuse. */
      readonly warnings: readonly FiledForm941Warning[];
      /** The sentence to put on the screen, naming what happened. */
      readonly message: string;
    }
  | {
      readonly ok: false;
      readonly code: "REFUSED";
      readonly refusals: readonly FiledForm941Refusal[];
    }
  | {
      readonly ok: false;
      readonly code: "NOT_CONFIGURED" | "WRITE_FAILED" | "READ_FAILED";
      readonly message: string;
    };

const NOT_CONFIGURED =
  "The database connection is not configured in this environment, so the filed figures cannot be " +
  "recorded from here. Nothing is wrong with your books or with what you typed - this screen " +
  "simply has nothing to write to in this environment.";

/** The table, named once. */
const TABLE = "filed_form_941_totals";

/* ═════════════════════════════════════════════════════════════════════════
 * §2  THE WRITE
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Record what was actually filed for one quarter.
 *
 * The order of operations is deliberate and each step is where it is for a
 * reason:
 *
 *   1. Environment check FIRST. A validation failure reported when the real
 *      problem is a missing service key sends Michael hunting a typo that is
 *      not there.
 *   2. VALIDATE BEFORE READING ANYTHING. The validator is pure and free; a
 *      round trip is neither. More importantly, a bad year must not be used to
 *      query.
 *   3. Read whether the quarter already exists, so the outcome can SAY which
 *      of insert-or-replace happened. Postgres will not tell us after the fact,
 *      and "saved" without saying "replaced the figures you entered on the
 *      14th" is the silent overwrite this design refuses to perform.
 *   4. Upsert on the natural key.
 *   5. Return the warnings alongside success. Warnings are information, not
 *      failure.
 */
export async function saveFiledForm941(
  draft: FiledForm941Draft,
): Promise<SaveFiledForm941Result> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  const validated = validateFiledForm941Draft(draft);
  if (!validated.ok) {
    return { ok: false, code: "REFUSED", refusals: validated.refusals };
  }

  const admin = createSupabaseAdminClient();
  const { taxYear, quarter } = validated.value;

  /*
   * DOES A ROW ALREADY EXIST?
   *
   * `head: true` with an exact count asks the question without hauling the
   * figures back. This is not an optimisation - it is so this function cannot
   * accidentally start making decisions based on the OLD figures, which is one
   * short step from "helpfully" merging them.
   */
  const { count, error: countError } = await admin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("tax_year", taxYear)
    .eq("quarter", quarter);

  if (countError) {
    return {
      ok: false,
      code: "READ_FAILED",
      message:
        `Could not check whether ${taxYear} Q${quarter} had already been recorded: ` +
        `${countError.message}. Nothing was written. This is worth resolving before trying ` +
        `again, because saving without knowing whether a figure is being replaced is exactly ` +
        `what this step is built to avoid.`,
    };
  }

  const replacedExisting = (count ?? 0) > 0;

  const { error: writeError } = await admin
    .from(TABLE)
    // The row is built by `filedForm941Row` from FILED_941_COLUMN_MAP rather
    // than written out here. Two bigint columns holding plausible money will
    // never error if they are swapped, so the field-to-column mapping is data
    // a gate can check against the migration - not a literal nobody re-reads.
    .upsert(filedForm941Row(validated.value), { onConflict: "tax_year,quarter" });

  if (writeError) {
    return {
      ok: false,
      code: "WRITE_FAILED",
      message:
        `The figures for ${taxYear} Q${quarter} could not be saved: ${writeError.message}. ` +
        `Nothing was recorded, so nothing is half-written - the annual comparison will keep ` +
        `reporting this quarter as missing, which is the honest state.`,
    };
  }

  const message = replacedExisting
    ? `${taxYear} Q${quarter} has been REPLACED. Figures were already recorded for this quarter ` +
      `and they have been overwritten with what you just entered. If the earlier figures were ` +
      `used to investigate a difference, that investigation was based on different numbers. Note ` +
      `also that this table records what was FILED, not what a 941-X later corrected - an ` +
      `amendment recorded here would make the annual W-2 comparison agree with a W-2 that was ` +
      `never amended.`
    : `${taxYear} Q${quarter} has been recorded. ` +
      `${quarter === 4 ? "That is the fourth quarter, so if the other three are in, the annual W-2 comparison can now run in full." : "Three more quarters and the annual W-2 comparison can run in full."}`;

  return {
    ok: true,
    replacedExisting,
    value: validated.value,
    warnings: validated.warnings,
    message,
  };
}

/* ═════════════════════════════════════════════════════════════════════════
 * §3  WHAT IS ALREADY RECORDED, FOR THE SCREEN
 *
 * A read, deliberately kept in the same file as the write rather than added to
 * form-w2-store.ts. The 941 screen needs to show which quarters are already in
 * so Michael is not typing Q2 twice, and that is this feature's own question.
 *
 * ═══ WHY THIS RETURNS THE FIGURES AND NOT JUST THE QUARTER NUMBERS. ═══
 *
 * Because the most useful thing the screen can show, while he has the paper
 * return in his hand, is what is ALREADY stored for that quarter. Showing only
 * "Q2 recorded" invites a blind re-entry, and a blind re-entry of seven figures
 * is a fresh chance to transpose one.
 * ═════════════════════════════════════════════════════════════════════════ */

export type RecordedQuarter = {
  readonly quarter: number;
  readonly filedOn: string;
  readonly sourceNote: string;
  readonly line3FederalIncomeTaxCents: number;
  readonly line5aSsWagesCents: number;
  readonly line5aSsTaxCents: number;
  readonly line5cMedicareWagesCents: number;
  readonly line5c5dMedicareTaxCents: number;
  readonly line5dAddlMedicareTaxCents: number;
};

export type RecordedQuartersResult =
  | { readonly ok: true; readonly taxYear: number; readonly quarters: readonly RecordedQuarter[] }
  | { readonly ok: false; readonly code: "NOT_CONFIGURED" | "READ_FAILED"; readonly message: string };

/** The columns, named once, so the select and the row type cannot drift. */
const RECORDED_COLUMNS =
  "quarter, filed_on, source_note, line_3_federal_income_tax_cents, line_5a_ss_wages_cents, line_5a_ss_tax_cents, line_5c_medicare_wages_cents, line_5c_5d_medicare_tax_cents, line_5d_addl_medicare_tax_cents" as const;

type RecordedRow = {
  readonly quarter: number;
  readonly filed_on: string;
  readonly source_note: string;
  readonly line_3_federal_income_tax_cents: number | null;
  readonly line_5a_ss_wages_cents: number | null;
  readonly line_5a_ss_tax_cents: number | null;
  readonly line_5c_medicare_wages_cents: number | null;
  readonly line_5c_5d_medicare_tax_cents: number | null;
  readonly line_5d_addl_medicare_tax_cents: number | null;
};

/**
 * A stored figure, or a refusal to pretend a null is a zero.
 *
 * Every one of these columns is `not null` in migration 0204, so a null here
 * means the row was written by something other than this file, or the column
 * was altered. Reporting it as 0 would put a wrong figure on screen beside a
 * correct one with nothing to distinguish them (rule 62d).
 */
function stored(v: number | null, column: string, who: string): number {
  if (typeof v !== "number") {
    throw new Error(
      `${TABLE}: ${column} is null for ${who}, but the column is declared not null. This row was ` +
        `not written by the confirmation step, so its figures cannot be trusted or displayed.`,
    );
  }
  return v;
}

export async function loadRecordedForm941Quarters(
  taxYear: number,
): Promise<RecordedQuartersResult> {
  if (!isSupabaseServiceConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: NOT_CONFIGURED };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from(TABLE)
    .select(RECORDED_COLUMNS)
    .eq("tax_year", taxYear)
    .order("quarter", { ascending: true });

  if (error) {
    return {
      ok: false,
      code: "READ_FAILED",
      message:
        `Could not read which ${taxYear} quarters have already been recorded: ${error.message}. ` +
        `You can still enter figures, but the screen cannot warn you that a quarter is already ` +
        `in - so check before saving.`,
    };
  }

  const rows = (data ?? []) as unknown as RecordedRow[];

  try {
    const quarters = rows.map((r) => {
      const who = `${taxYear} Q${r.quarter}`;
      return {
        quarter: r.quarter,
        filedOn: r.filed_on,
        sourceNote: r.source_note,
        line3FederalIncomeTaxCents: stored(
          r.line_3_federal_income_tax_cents,
          "line_3_federal_income_tax_cents",
          who,
        ),
        line5aSsWagesCents: stored(r.line_5a_ss_wages_cents, "line_5a_ss_wages_cents", who),
        line5aSsTaxCents: stored(r.line_5a_ss_tax_cents, "line_5a_ss_tax_cents", who),
        line5cMedicareWagesCents: stored(
          r.line_5c_medicare_wages_cents,
          "line_5c_medicare_wages_cents",
          who,
        ),
        line5c5dMedicareTaxCents: stored(
          r.line_5c_5d_medicare_tax_cents,
          "line_5c_5d_medicare_tax_cents",
          who,
        ),
        line5dAddlMedicareTaxCents: stored(
          r.line_5d_addl_medicare_tax_cents,
          "line_5d_addl_medicare_tax_cents",
          who,
        ),
      };
    });
    return { ok: true, taxYear, quarters };
  } catch (e) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
