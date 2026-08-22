/**
 * src/lib/accounting/company-profile-store.ts   (slice books-31)
 *
 * Server-side persistence for the ONE row in `public.company_profile`.
 *
 * THE DIVISION OF LABOUR, AND WHY IT IS STRICT
 *
 * `company-identity-core.ts` decides what is valid. This file decides nothing.
 * It reads, it writes, and before it writes it asks the core whether it may.
 * Every judgement about what a form needs lives in COMPANY_FIELDS, and a second
 * copy of that judgement here would eventually disagree with the first,
 * silently, and the disagreement would surface on a 941 nine months later.
 *
 * WHY THERE IS NO `createCompanyProfile`
 *
 * The table is a singleton: `id boolean primary key default true`. There is one
 * company. Michael's directive said this page feeds every form downstream, and
 * two profile rows would mean two answers to "what is our EIN" with nothing to
 * say which is right. So the write path is an UPSERT on the fixed key, and
 * there is deliberately no way through this module to make a second row.
 *
 * WHY THE READ RETURNS A ROW THAT MAY BE MOSTLY EMPTY
 *
 * Because a half-filled profile is the normal state of this screen before
 * cutover, and it is not an error. The screen's job is to show what is missing
 * and why it matters; the store's job is to report faithfully what is there.
 * Readiness is computed by the core from the values, never stored - a stored
 * "ready" flag is a cached opinion that goes stale the moment a field changes.
 *
 * THE SERVICE ROLE BYPASSES EVERY DATABASE GATE
 *
 * These functions use createSupabaseAdminClient(), which runs as the service
 * role and ignores the owner-only RLS policies on `company_profile`. So the SQL
 * gate does NOT protect anything reached through this file. Every caller must
 * pass through `requireBooksAccess()` first, which is `is_owner()` in
 * application form. That is stated here rather than assumed because the
 * migration's RLS is genuinely inert on this path.
 *
 * WHAT THE NEXT SLICE WILL DO WITH THIS (standing rule 62)
 *
 * The 941, 940, W-2, W-3 and Form 5208 builders will call `loadCompanyProfile`
 * and then `requireField` for each value they print. They will NOT read columns
 * directly, because `requireField` is what refuses to substitute a blank for a
 * missing EIN. The ACH writer will call `verifyAchAgreement` before building a
 * NACHA file, so a mismatch between the company EIN and the ACH immediate
 * origin stops the payment run instead of producing a file the bank rejects.
 */
import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSupabaseServiceConfigured } from "@/lib/supabase/env";

import {
  COMPANY_FIELDS,
  allFormReadiness,
  type CompanyProfileValues,
  type FormReadiness,
} from "./company-identity-core";

/** The singleton primary key. There is one company, so there is one row. */
const SINGLETON_ID = true;

/**
 * Every column this module reads or writes.
 *
 * DERIVED FROM THE FIELD REGISTRY where possible, plus the columns the registry
 * deliberately does not carry. `COMPANY_FIELDS` only lists fields a FORM
 * consumes (standing rule 62, consumer-driven); the profile row also holds
 * things like the WSLCB licence number and the effective dates, which no
 * federal form reads but which the business plainly needs recorded.
 */
const EXTRA_COLUMNS = [
  "address_line2",
  "wslcb_license_number",
  "dor_account_number",
  "multi_state_employer",
  "fiscal_year_end_month",
  "payroll_start_date",
  "legal_name_effective_date",
  "address_effective_date",
  "responsible_party_name",
  "responsible_party_ssn_last_four",
  "signer_pin",
] as const;

/** The full select list: registry fields first, then the extras. */
function selectColumns(): string {
  return [...COMPANY_FIELDS.map((f) => f.field), ...EXTRA_COLUMNS].join(", ");
}

export type CompanyProfileRow = CompanyProfileValues & {
  readonly updated_at?: string | null;
};

export type LoadResult =
  | { readonly ok: true; readonly profile: CompanyProfileRow; readonly exists: boolean }
  | { readonly ok: false; readonly code: "NOT_CONFIGURED" | "READ_FAILED"; readonly message: string };

/**
 * Read the company profile.
 *
 * Returns `exists: false` with an empty object rather than throwing when the
 * row has never been created, because "not set up yet" is the expected state
 * before cutover and the screen has to render something useful in it.
 */
export async function loadCompanyProfile(): Promise<LoadResult> {
  if (!isSupabaseServiceConfigured) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message:
        "Supabase is not configured in this environment, so the company profile cannot be read. This is " +
        "a deployment problem, not a data problem - nothing has been lost.",
    };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("company_profile")
    .select(selectColumns())
    .eq("id", SINGLETON_ID)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      code: "READ_FAILED",
      message: `Could not read the company profile: ${error.message}`,
    };
  }

  if (!data) {
    return { ok: true, profile: {}, exists: false };
  }

  return { ok: true, profile: data as unknown as CompanyProfileRow, exists: true };
}

export type SaveResult =
  | { readonly ok: true; readonly readiness: readonly FormReadiness[] }
  | {
      readonly ok: false;
      readonly code: "NOT_CONFIGURED" | "UNKNOWN_FIELD" | "WRITE_FAILED";
      readonly message: string;
      readonly field?: string;
    };

/**
 * Write the company profile.
 *
 * REFUSES AN UNDECLARED COLUMN. A caller that passes `favourite_colour` gets a
 * named error rather than a silently ignored key, because a silently ignored
 * key is how a form ends up reading a field nobody ever saved.
 *
 * DOES NOT REFUSE AN INCOMPLETE PROFILE, and that is deliberate. Michael will
 * fill this screen in over several sittings, and a store that rejected a
 * partial save would force him to invent placeholder values - which is exactly
 * how a plausible wrong EIN gets into a system. Instead the save succeeds and
 * returns the readiness of every form, so the screen can say precisely which
 * filings are still blocked and by what. The refusal to use a blank value
 * happens later and closer to the danger, in `requireField`, at the moment a
 * form builder actually needs it.
 */
export async function saveCompanyProfile(values: CompanyProfileValues): Promise<SaveResult> {
  if (!isSupabaseServiceConfigured) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message: "Supabase is not configured in this environment, so nothing was written.",
    };
  }

  const allowed = new Set<string>([...COMPANY_FIELDS.map((f) => f.field), ...EXTRA_COLUMNS]);
  const row: Record<string, string | null> = {};

  for (const [key, raw] of Object.entries(values)) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        code: "UNKNOWN_FIELD",
        field: key,
        message:
          `"${key}" is not a column of company_profile. Refusing to write it rather than dropping it ` +
          `quietly, because a dropped key looks like a successful save and reads back as blank.`,
      };
    }
    const value = typeof raw === "string" ? raw.trim() : "";
    // Empty string rather than null: the migration's format constraints all
    // permit '' precisely so that a half-finished profile is storable, and a
    // consistent empty representation means readiness never has to ask which
    // kind of nothing it is looking at.
    row[key] = value;
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from("company_profile")
    .upsert({ id: SINGLETON_ID, ...row }, { onConflict: "id" });

  if (error) {
    return { ok: false, code: "WRITE_FAILED", message: `Could not save the company profile: ${error.message}` };
  }

  const after = await loadCompanyProfile();
  const stored = after.ok ? after.profile : values;
  return { ok: true, readiness: allFormReadiness(stored) };
}

export type AchAgreement =
  | { readonly checked: true; readonly agrees: true }
  | { readonly checked: true; readonly agrees: false; readonly explanation: string }
  | { readonly checked: false; readonly reason: string };

/**
 * Does the ACH setup agree with the company identity?
 *
 * WHY THIS LIVES HERE AND NOT IN THE MIGRATION'S AUDIT FUNCTION. The audit
 * function `gl_audit_company_profile()` reports the same disagreement, but it
 * reports it to whoever runs the audit. Michael's directive was that the ACH
 * pipeline runs "end to end automatically with simple validation steps for me
 * to approve everything", so the payment path itself has to be able to ask.
 *
 * The NACHA immediate-origin field is conventionally the company's EIN with a
 * leading digit ("1" for an EIN-based identifier), so both shapes are accepted.
 * Anything else is reported as a disagreement with BOTH values shown, because
 * telling somebody two numbers disagree without saying what they are is how a
 * ten-second fix becomes an afternoon.
 *
 * RETURNS `checked: false` RATHER THAN GUESSING when either side is absent.
 * Standing rule 48: a check that cannot classify its input must not quietly
 * return a pass. An unconfigured ACH setup is not an agreeing ACH setup.
 */
export async function verifyAchAgreement(): Promise<AchAgreement> {
  if (!isSupabaseServiceConfigured) {
    return { checked: false, reason: "Supabase is not configured in this environment." };
  }

  const admin = createSupabaseAdminClient();

  const profile = await admin.from("company_profile").select("ein").eq("id", SINGLETON_ID).maybeSingle();
  if (profile.error) {
    return { checked: false, reason: `Could not read the company profile: ${profile.error.message}` };
  }
  const ein = typeof profile.data?.ein === "string" ? profile.data.ein.trim() : "";
  if (ein === "") {
    return {
      checked: false,
      reason:
        "The company EIN has not been entered yet, so there is nothing to compare the ACH setup against. " +
        "Fill in the EIN on the company information screen first.",
    };
  }

  const ach = await admin.from("ach_company_settings").select("immediate_origin").limit(1).maybeSingle();
  if (ach.error) {
    return { checked: false, reason: `Could not read the ACH settings: ${ach.error.message}` };
  }
  const origin = typeof ach.data?.immediate_origin === "string" ? ach.data.immediate_origin.trim() : "";
  if (origin === "") {
    return {
      checked: false,
      reason:
        "The ACH immediate origin has not been set up yet, so there is nothing to compare. This is not a " +
        "failure - it means direct deposit is not configured, and a payroll run would stop before it " +
        "tried to build a file.",
    };
  }

  const stripped = origin.replace(/[^0-9]/g, "");
  const agrees = stripped === ein || stripped === `1${ein}`;
  if (agrees) return { checked: true, agrees: true };

  return {
    checked: true,
    agrees: false,
    explanation:
      `The company EIN on file is ${ein} and the ACH immediate origin is ${origin}. These identify the ` +
      `same business to two different systems, so they have to match - the bank rejects a file whose ` +
      `originator does not match the account it is drawn on, and the rejection arrives after payday. ` +
      `Correct whichever one is wrong before the next payroll run.`,
  };
}
