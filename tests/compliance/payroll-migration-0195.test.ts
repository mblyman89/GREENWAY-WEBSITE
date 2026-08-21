/**
 * tests/compliance/payroll-migration-0195.test.ts
 *
 * THE MIGRATION IS CODE TOO.
 *
 * payroll-onboarding-core.ts decides what a valid W-4, I-9 and pay agreement
 * look like. 0195 has to agree with it in SQL, because the database is the last
 * line: if the engine is bypassed - a script, a console, a future endpoint that
 * forgets to call evaluateOnboarding() - the CHECK constraints are all that
 * stand between Michael and a silently wrong paycheck.
 *
 * These tests read the migration off disk as text. That is deliberate. They are
 * DRIFT ALARMS, not a SQL interpreter: they prove the file still SAYS the things
 * the design depends on, and they fail the day someone edits it in a way that
 * quietly changes the answer.
 *
 * THE LIVE BEHAVIOUR WAS VERIFIED SEPARATELY, and this is the part that matters:
 * all 195 migrations were applied in order to a real PostgreSQL 15.18 instance
 * in this sandbox, and then attacked. Recorded results:
 *
 *   - hourly rate AND salary on one row      -> REFUSED (basis_shape_chk)
 *   - salary basis with no salary            -> REFUSED (basis_shape_chk)
 *   - unknown labor role                     -> REFUSED (FK)
 *   - a second "current" pay row             -> REFUSED (partial unique index)
 *   - owner salary, paid annually            -> ACCEPTED, resolves to account
 *                                               71010 / never_inventoriable = t
 *   - 2027 W-4 carrying legacy allowances    -> REFUSED (redesign_shape_chk)
 *   - 2019 W-4 carrying Step 3 dollars       -> REFUSED (redesign_shape_chk)
 *   - filing_status 'single'                 -> REFUSED (enum CHECK)
 *   - exempt + extra withholding             -> REFUSED (exempt_no_extra_chk)
 *   - effective_from before signed_on        -> REFUSED (effective_after_signed)
 *   - a second "current" W-4                 -> REFUSED (partial unique index)
 *   - malformed / dashed SSN                 -> REFUSED (ssn_full CHECK)
 *   - writing ssn_last_four directly         -> REFUSED (generated column)
 *   - reveal with a blank reason             -> REFUSED (reason CHECK)
 *   - owner SELECT                           -> 1 w4 / 1 pay / 1 reveal
 *   - manager SELECT, same queries           -> 0 / 0 / 0
 *   - manager INSERT into employee_w4        -> REFUSED by RLS
 *   - owner UPDATE/DELETE on the reveal log  -> 0 rows affected, log intact
 *   - re-applying 0195 a second time         -> clean, data preserved
 *   - all six audit branches                 -> each provoked deliberately,
 *                                               each fired, each repaired to 0
 *
 * A REAL DEFECT THIS TESTING FOUND. public.employees already carries a
 * manager-readable RLS policy (employees_mgr_read). RLS filters ROWS, NOT
 * COLUMNS - so the moment ssn_full was added to that table, a manager account
 * could select it and did: all nine digits came back in a live query. The first
 * draft of this migration asserted in a comment that the column was "owner-only
 * at the RLS level", which was false. The fix is a COLUMN privilege (revoke
 * SELECT on the table, grant it back per column, omitting ssn_full), and the
 * SSN_COLUMN_READABLE audit branch now watches for the regression. This is
 * exactly the class of silent failure Michael asked us to make impossible:
 * "if a field is missing, it should highlight it so something can't silently
 * fail me in some way."
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  ALL_PAY_FREQUENCIES,
  PAY_FREQUENCY_LABELS,
  PAY_PERIODS_PER_YEAR,
} from "@/lib/payroll/payroll-w4-core";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");
const FILENAME = "0195_employee_payroll_setup.sql";
const SQL = readFileSync(path.join(MIGRATIONS_DIR, FILENAME), "utf8");

/**
 * The migration with every `--` comment stripped.
 *
 * This file teaches as well as runs, so a raw-text scan is dangerous in BOTH
 * directions: a "the SQL does not do X" assertion can fail merely because the
 * prose explains that it does not do X. Structural claims are therefore made
 * against this stripped version. (Same reasoning, and same limitation, as the
 * 0188 test: string literals are left intact because no `--` appears inside
 * one here, and a half-clever quote-aware stripper would be likelier to
 * introduce a bug than prevent one.)
 */
const EXEC_SQL = SQL.split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

// ===========================================================================
describe("0195 exists and is numbered cleanly", () => {
  it("is the only migration numbered 0195", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith("0195"));
    expect(files).toEqual([FILENAME]);
  });

  it("is the HIGHEST migration, so nothing was written around it", () => {
    const numbers = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .map((f) => Number(f.slice(0, 4)));
    expect(Math.max(...numbers)).toBe(195);
  });

  it("the comment-stripper actually stripped something, or these tests lie", () => {
    // If EXEC_SQL === SQL the stripper silently did nothing and every
    // "structural" assertion below would really be scanning prose.
    expect(EXEC_SQL.length).toBeLessThan(SQL.length);
    expect(SQL).toContain("-- ");
    expect(EXEC_SQL).not.toContain("-- ");
  });
});

// ===========================================================================
describe("preconditions: it refuses to run out of order", () => {
  it("checks for is_owner() before gating anything on it", () => {
    expect(EXEC_SQL).toContain("to_regprocedure('public.is_owner()') is null");
  });

  it("checks for the tables it attaches to", () => {
    expect(EXEC_SQL).toContain("to_regclass('public.employees') is null");
    expect(EXEC_SQL).toContain("to_regclass('public.gl_payroll_labor_roles') is null");
  });

  it("every precondition RAISES rather than warning", () => {
    // A precondition that only notices is a precondition that gets ignored.
    const precheck = EXEC_SQL.slice(
      EXEC_SQL.indexOf("$precheck$"),
      EXEC_SQL.lastIndexOf("$precheck$"),
    );
    const ifs = (precheck.match(/if /g) ?? []).length;
    const raises = (precheck.match(/raise exception/g) ?? []).length;
    expect(ifs).toBeGreaterThanOrEqual(4);
    expect(raises).toBe(ifs);
  });

  it("says MIGRATION_OUT_OF_ORDER and says nothing was changed", () => {
    expect(EXEC_SQL).toContain("MIGRATION_OUT_OF_ORDER");
    expect(EXEC_SQL).toContain("Nothing was changed.");
  });
});

// ===========================================================================
describe("the three tables exist and are idempotent", () => {
  for (const t of ["employee_w4", "employee_i9", "employee_pay", "employee_ssn_reveals"]) {
    it(`creates ${t} with "if not exists" so a re-run is safe`, () => {
      expect(EXEC_SQL).toContain(`create table if not exists public.${t}`);
    });
  }

  it("adds columns to employees with 'if not exists' too", () => {
    expect(EXEC_SQL).toContain("add column if not exists ssn_full");
    expect(EXEC_SQL).toContain("add column if not exists ssn_last_four");
  });

  it("never uses a bare 'create table' that would fail on re-run", () => {
    // Matches "create table public.x" but not "create table if not exists".
    expect(EXEC_SQL).not.toMatch(/create table\s+public\./);
  });
});

// ===========================================================================
describe("W-4: the shape rules that keep withholding reproducible", () => {
  it("stores the three real filing statuses, and NOT the fictional 'single'", () => {
    expect(EXEC_SQL).toContain("'married_filing_jointly'");
    expect(EXEC_SQL).toContain("'single_or_married_filing_separately'");
    expect(EXEC_SQL).toContain("'head_of_household'");
    // The box reads "Single or Married filing separately". A bare 'single'
    // would be a fourth, wrong value.
    expect(EXEC_SQL).not.toMatch(/in\s*\([^)]*'single'[^_]/);
  });

  it("the 2020 redesign cannot be mixed with pre-2020 allowances", () => {
    expect(EXEC_SQL).toContain("employee_w4_redesign_shape_chk");
    expect(EXEC_SQL).toContain("form_year >= 2020 and legacy_allowances is null");
  });

  it("exempt-plus-extra-withholding is unrepresentable", () => {
    expect(EXEC_SQL).toContain("employee_w4_exempt_no_extra_chk");
  });

  it("a form cannot take effect before it was signed", () => {
    expect(EXEC_SQL).toContain("employee_w4_effective_after_signed_chk");
    expect(EXEC_SQL).toContain("effective_from >= signed_on");
  });

  it("exactly one W-4 may be current per employee", () => {
    expect(EXEC_SQL).toContain("employee_w4_one_current_idx");
    expect(EXEC_SQL).toMatch(
      /create unique index if not exists employee_w4_one_current_idx[\s\S]{0,120}where is_current/,
    );
  });

  it("every money column is an integer-cents bigint, never numeric or float", () => {
    // Only DECLARATIONS, which begin a line. The first version of this test
    // also matched "hourly_rate_milli_cents is not null" inside a CHECK and
    // then complained that a constraint was not a bigint.
    const decls = EXEC_SQL.match(/^\s{2}\w*_cents\s+\S+/gm) ?? [];
    expect(decls.length).toBeGreaterThan(0);
    for (const c of decls) {
      expect(c, `not a bigint: ${c.trim()}`).toMatch(/bigint/);
    }
    // No floating point anywhere near money in this file.
    expect(EXEC_SQL).not.toMatch(/\b(real|double precision|float)\b/);
  });
});

// ===========================================================================
describe("I-9: the quarantine is stated where a reader will hit it", () => {
  it("cites the limitation-on-use rule", () => {
    expect(SQL).toContain("274a.2(b)(4)");
  });

  it("carries a table comment that warns against joining it to pay", () => {
    expect(EXEC_SQL).toContain("comment on table public.employee_i9");
    const comment = EXEC_SQL.slice(EXEC_SQL.indexOf("comment on table public.employee_i9"));
    expect(comment).toContain("QUARANTINED");
    expect(comment).toContain("employee_pay");
  });

  it("carries a comment on citizenship_status specifically", () => {
    // This is the column that does the damage if it leaks into a decision.
    expect(EXEC_SQL).toContain("comment on column public.employee_i9.citizenship_status");
  });

  it("creates NO view joining the I-9 to pay", () => {
    expect(EXEC_SQL).not.toMatch(/create\s+(or replace\s+)?view/i);
  });

  it("Section 2 cannot precede Section 1", () => {
    expect(EXEC_SQL).toContain("employee_i9_section2_order_chk");
  });

  it("one I-9 per employee, so the wrong one cannot be produced on inspection", () => {
    expect(EXEC_SQL).toContain("employee_i9_one_per_employee unique (employee_id)");
  });
});

// ===========================================================================
describe("pay: two different animals, neither contaminating the other", () => {
  it("hourly rates are stored in MILLI-cents, not cents", () => {
    // $0.16445/hr (L&I employee share) cannot be written in cents. Rounding
    // the rate instead of the product is the silent-shortfall bug.
    expect(EXEC_SQL).toContain("hourly_rate_milli_cents");
    expect(EXEC_SQL).not.toContain("hourly_rate_cents ");
  });

  it("an hourly rate and a salary cannot both be set", () => {
    expect(EXEC_SQL).toContain("employee_pay_basis_shape_chk");
  });

  it("supports biweekly (26 periods) and annually (the owner, once at year end)", () => {
    expect(EXEC_SQL).toContain("'biweekly'");
    expect(EXEC_SQL).toContain("'annually'");
  });

  it("every pay row points at a real GL labor role, by foreign key", () => {
    expect(EXEC_SQL).toContain("references public.gl_payroll_labor_roles(code)");
  });

  it("the COGS split is basis points, so it is exact", () => {
    expect(EXEC_SQL).toContain("cogs_split_basis_points");
    expect(EXEC_SQL).toContain("between 0 and 10000");
  });

  it("records the minimum wage AT HIRE rather than deriving it later", () => {
    expect(EXEC_SQL).toContain("minimum_wage_milli_cents_at_hire");
  });

  it("exactly one pay agreement may be current per employee", () => {
    expect(EXEC_SQL).toContain("employee_pay_one_current_idx");
  });
});

// ===========================================================================
describe("the SSN: stored in full because the W-2 needs it, and gated", () => {
  it("stores nine digits, no dashes, and enforces that", () => {
    expect(EXEC_SQL).toContain("ssn_full text");
    expect(EXEC_SQL).toContain("'^[0-9]{9}$'");
  });

  it("the last four is GENERATED, so it can never drift from the full value", () => {
    expect(EXEC_SQL).toContain("generated always as (right(ssn_full, 4)) stored");
  });

  it("protects ssn_full with a COLUMN privilege, because RLS filters rows only", () => {
    // The defect this slice actually found: employees is manager-readable, and
    // row security cannot hide a column inside a visible row.
    expect(EXEC_SQL).toContain("revoke select on public.employees from authenticated");
    expect(EXEC_SQL).toContain("column_name <> 'ssn_full'");
    expect(EXEC_SQL).toContain("grant select (%I) on public.employees to authenticated");
  });

  it("does NOT claim RLS protects the column, because that claim was false", () => {
    // Guard against the comment regressing to the original wrong explanation.
    expect(SQL).not.toContain("OWNER-ONLY at the RLS level");
    expect(SQL).toContain("filters ROWS, not COLUMNS");
  });

  it("the reveal log demands a REASON, and a blank one will not do", () => {
    expect(EXEC_SQL).toContain("reason       text not null");
    expect(EXEC_SQL).toContain("length(btrim(reason)) >= 3");
  });

  it("records the role AS IT WAS at the moment of the reveal", () => {
    expect(EXEC_SQL).toContain("revealed_by_role text not null");
  });
});

// ===========================================================================
describe("RLS: owner only, and the reveal log is append-only", () => {
  it("enables row level security on all four tables", () => {
    for (const t of ["employee_w4", "employee_i9", "employee_pay", "employee_ssn_reveals"]) {
      expect(EXEC_SQL).toContain(`alter table public.${t}`);
    }
    const enables = EXEC_SQL.match(/enable row level security/g) ?? [];
    expect(enables.length).toBe(4);
  });

  it("drops each policy before creating it, so a re-run leaves nothing stale", () => {
    expect(EXEC_SQL).toContain("drop policy if exists");
  });

  it("gates SELECT and INSERT on is_owner() for all four tables", () => {
    expect(EXEC_SQL).toContain("'employee_w4','employee_i9','employee_pay',");
    expect(EXEC_SQL).toContain("using (public.is_owner())");
    expect(EXEC_SQL).toContain("with check (public.is_owner())");
  });

  it("grants UPDATE and DELETE on the three setup tables ONLY", () => {
    // The reveal log is deliberately excluded from this second loop.
    const updateLoop = EXEC_SQL.slice(EXEC_SQL.indexOf("for update using"));
    expect(updateLoop).toBeTruthy();
    const secondArray = EXEC_SQL.match(
      /array\['employee_w4','employee_i9','employee_pay'\]/,
    );
    expect(secondArray).not.toBeNull();
  });

  it("creates NO update or delete policy on the reveal log, for anyone", () => {
    expect(EXEC_SQL).not.toMatch(/employee_ssn_reveals[\s\S]{0,80}for (update|delete)/);
    expect(EXEC_SQL).not.toContain("employee_ssn_reveals_owner_update");
    expect(EXEC_SQL).not.toContain("employee_ssn_reveals_owner_delete");
  });
});

// ===========================================================================
describe("the self-audit: it must be able to FAIL, or it proves nothing", () => {
  it("exists and returns findings, not a boolean", () => {
    expect(EXEC_SQL).toContain(
      "create or replace function public.gl_audit_employee_payroll_setup()",
    );
    expect(EXEC_SQL).toContain("returns table (finding text, detail text)");
  });

  it("carries all six findings, each of which was provoked live", () => {
    for (const finding of [
      "RLS_NOT_ENABLED",
      "POLICY_NOT_OWNER_GATED",
      "REVEAL_LOG_IS_MUTABLE",
      "OWNER_PAY_IN_COGS",
      "SSN_COLUMN_READABLE",
      "SSN_MALFORMED",
    ]) {
      expect(EXEC_SQL, `missing finding ${finding}`).toContain(`'${finding}'::text`);
    }
  });

  it("checks relrowsecurity, not just the presence of policies", () => {
    // Policies on a table with RLS off are never consulted by Postgres.
    expect(EXEC_SQL).toContain("c.relrowsecurity = false");
  });

  it("catches a permissive policy by looking for is_owner in the expression", () => {
    expect(EXEC_SQL).toContain("not like '%is_owner%'");
  });

  it("re-asks the owner-pay-in-COGS question from the payroll side", () => {
    // 0188's CHECK already makes it unrepresentable. This is the second lock:
    // a constraint nobody re-verifies is a constraint someone eventually drops.
    expect(EXEC_SQL).toContain("r.treatment = 'owner'");
    expect(EXEC_SQL).toContain("r.account_code like '6%'");
  });

  it("is documented as 'empty result is the passing result'", () => {
    expect(SQL).toContain("AN EMPTY RESULT IS THE PASSING RESULT");
  });

  it("is not executable by the public", () => {
    expect(EXEC_SQL).toContain(
      "revoke all on function public.gl_audit_employee_payroll_setup() from public",
    );
  });
});

// ===========================================================================
describe("the migration teaches, per standing rule 26", () => {
  it("records Michael's decisions verbatim rather than paraphrasing them", () => {
    expect(SQL).toContain('"hourly for all employees, salary for me"');
    expect(SQL).toContain('"every two weeks on friday"');
    expect(SQL).toContain('"I pay myself once at the end of the year."');
    expect(SQL).toContain('"Sage has no safety nets."');
  });

  it("explains WHY the SSN is stored in full instead of just doing it", () => {
    expect(SQL).toContain("31.6051-1");
    expect(SQL).toMatch(/truncated/i);
  });

  it("explains the milli-cents decision with the actual arithmetic", () => {
    expect(SQL).toContain("0.16445");
    expect(SQL).toContain("51.16.140(2)");
  });

  it("every table carries a comment, so the schema explains itself", () => {
    for (const t of ["employee_w4", "employee_i9", "employee_pay", "employee_ssn_reveals"]) {
      expect(EXEC_SQL, `${t} has no comment`).toContain(`comment on table public.${t}`);
    }
  });

  it("tells the reader how to verify it after running", () => {
    expect(SQL).toContain("gl_audit_employee_payroll_setup()");
    expect(SQL).toContain("HOW TO RUN IT");
  });
});

// ===========================================================================
// THE PAY-FREQUENCY GATE
//
// This section exists because of a REAL DEFECT that shipped past every test
// above, and it is worth stating plainly what happened.
//
// 0195's CHECK constraint accepted six pay_frequency values, one of which was
// 'annually' - deliberately, because Michael pays himself exactly once, at the
// end of the year. The withholding engine's PayFrequency type accepted seven
// values, and 'annually' was NOT among them, because it had been transcribed
// faithfully from Pub. 15-T Worksheet 1A's Table 3, which genuinely omits it.
//
// So the database would happily store the owner's pay row, and the engine
// would then look up `PAY_PERIODS_PER_YEAR['annually']`, get `undefined`, and
// throw "divideRoundHalfUp requires integers - a float reached a money path"
// when someone eventually ran that paycheck. Observed, not theorised.
//
// Two lists of strings, in two languages, that MUST be the same list and that
// nothing forced to be the same list. That is the whole defect class. These
// tests compare the SETS in both directions (standing rule 34), so the next
// person to add a cadence to one side is told immediately about the other.
// ===========================================================================
describe("the pay frequencies in SQL and in TypeScript are the same set", () => {
  /** Pull the accepted values straight out of the CHECK constraint text. */
  function frequenciesAllowedBySql(): string[] {
    // Match the constraint, then the quoted values inside it. Deliberately run
    // against EXEC_SQL so a cadence merely NAMED in a comment cannot satisfy
    // this test - the prose in this migration discusses 'annually' at length.
    const m = /check\s*\(\s*pay_frequency\s+in\s*\(([^)]*)\)/i.exec(EXEC_SQL);
    expect(m, "could not find the pay_frequency CHECK constraint in 0195").not.toBeNull();
    const values = [...(m as RegExpExecArray)[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    // A regex that matched but captured nothing would make every assertion
    // below vacuously true (rule 39).
    expect(values.length).toBeGreaterThan(3);
    return values.sort();
  }

  it("accepts exactly the cadences the engine can actually compute", () => {
    const sqlSet = frequenciesAllowedBySql();
    // Widened to string[] deliberately. The job of this test is to police the
    // boundary between untyped SQL text and the TypeScript union, so casting
    // the SQL side INTO PayFrequency would assume the very thing being checked
    // and the comparison would become vacuous (rule 39).
    const engineSet: string[] = [...ALL_PAY_FREQUENCIES].map(String).sort();

    // The direction that catches the bug that shipped: SQL lets in a value the
    // engine cannot divide by.
    const storableButNotComputable = sqlSet.filter((f) => !engineSet.includes(f));
    expect(
      storableButNotComputable,
      `0195 accepts ${JSON.stringify(storableButNotComputable)}, which PayFrequency does not. ` +
        `The database would store it and the withholding engine would throw on it.`,
    ).toEqual([]);
  });

  it("every cadence the engine offers has a real periods-per-year number", () => {
    // The other direction (rule 34). A frequency in the type with no entry in
    // the table is the `undefined` that became a float error.
    for (const f of ALL_PAY_FREQUENCIES) {
      const periods = PAY_PERIODS_PER_YEAR[f];
      expect(periods, `${f} has no periods-per-year`).toBeTypeOf("number");
      expect(Number.isInteger(periods), `${f} periods-per-year is not an integer`).toBe(true);
      expect(periods, `${f} periods-per-year must be positive`).toBeGreaterThan(0);
      // A label too, so a <select> can never render a raw enum at Michael.
      expect(PAY_FREQUENCY_LABELS[f], `${f} has no human label`).toBeTruthy();
    }
  });

  it("the CHECK constraint is what is being read, not a comment about it", () => {
    // Proves the harness above is looking at executable SQL. If someone deletes
    // the constraint and leaves the explanation, this must fail.
    const stripped = frequenciesAllowedBySql();
    expect(stripped).toContain("biweekly");
    expect(stripped).toContain("annually");
  });
});
