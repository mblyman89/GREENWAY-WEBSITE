/**
 * tests/compliance/payroll-onboarding-store.test.ts
 *
 * THE STORE IS WHERE THE GATE CAN BE BYPASSED.
 *
 * payroll-onboarding-core.ts is pure and heavily tested. 0195's constraints were
 * applied to real Postgres and attacked. This file covers the seam between them,
 * which is the part with no safety net of its own: the store runs as the SERVICE
 * ROLE, so RLS and the ssn_full column privilege do not apply to it. Every
 * protection on this path is code, and code is what this file interrogates.
 *
 * These are STRUCTURAL tests read off disk, for one honest reason: the store
 * imports "server-only" and createSupabaseAdminClient, so importing it under
 * vitest would either fail or require mocking the Supabase client so thoroughly
 * that the test would be asserting against my own mock rather than the store.
 * A test that re-implements the thing it checks proves nothing (standing rule
 * 39). What CAN be proved by reading the file is the ordering and the absence
 * of escape hatches - and ordering is precisely where this file could go wrong.
 *
 * The live behaviour of the SQL underneath was verified separately against
 * PostgreSQL 15.18; see payroll-migration-0195.test.ts for that ledger.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const STORE_PATH = path.resolve(__dirname, "../../src/lib/payroll/payroll-onboarding-store.ts");
const STORE = readFileSync(STORE_PATH, "utf8");

/** The store with comments stripped, for claims about what the CODE does. */
const CODE = STORE.split("\n")
  .map((l) => l.replace(/\/\/.*$/, ""))
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

describe("the file is what we think it is", () => {
  it("the comment stripper actually stripped, or these tests scan prose", () => {
    expect(CODE.length).toBeLessThan(STORE.length);
    expect(STORE).toContain("/*");
    expect(CODE).not.toContain("/*");
  });

  it("is server-only, so it can never be bundled to the browser", () => {
    expect(CODE).toContain('import "server-only"');
  });
});

// ===========================================================================
describe("THE REVEAL ORDERING: audit first, value second", () => {
  /**
   * This is the single most important assertion in this file.
   *
   * If the SSN is read before the audit row is written, then a failed audit
   * insert still leaves the number in memory and one careless edit away from
   * being returned. The whole control is the ORDER.
   */
  it("writes to employee_ssn_reveals BEFORE selecting ssn_full", () => {
    const revealFn = CODE.slice(
      CODE.indexOf("export async function revealSsn"),
      CODE.indexOf("export async function listSsnReveals"),
    );
    expect(revealFn.length).toBeGreaterThan(100);

    const auditAt = revealFn.indexOf('from("employee_ssn_reveals")');
    const selectAt = revealFn.indexOf('select("ssn_full")');

    expect(auditAt, "the audit insert must exist").toBeGreaterThan(-1);
    expect(selectAt, "the ssn read must exist").toBeGreaterThan(-1);
    expect(
      auditAt,
      "the audit row must be written BEFORE the SSN is read, or a failed log " +
        "still exposes the number",
    ).toBeLessThan(selectAt);
  });

  it("returns early when the audit write fails, so the number is never read", () => {
    const revealFn = CODE.slice(
      CODE.indexOf("export async function revealSsn"),
      CODE.indexOf("export async function listSsnReveals"),
    );
    expect(revealFn).toContain("auditError");
    // The failure branch must RETURN, not merely log and continue.
    expect(revealFn).toMatch(/if\s*\(auditError\)\s*\{[\s\S]{0,400}?return\s*\{/);
    const auditFailAt = revealFn.indexOf("audit_write_failed");
    const selectAt = revealFn.indexOf('select("ssn_full")');
    expect(auditFailAt).toBeLessThan(selectAt);
  });

  it("checks the role in CODE, because the service role bypasses SQL gates", () => {
    const revealFn = CODE.slice(
      CODE.indexOf("export async function revealSsn"),
      CODE.indexOf("export async function listSsnReveals"),
    );
    expect(revealFn).toContain("canRevealSsn(input.role)");
    // And the role check comes before everything else.
    const roleAt = revealFn.indexOf("canRevealSsn");
    const auditAt = revealFn.indexOf('from("employee_ssn_reveals")');
    expect(roleAt).toBeLessThan(auditAt);
  });

  /*
   * WHY THIS TEST EXISTS: A MUTANT SURVIVED.
   *
   * The position assertions above all passed while the role check was disabled
   * by rewriting its condition to `if (false && !canRevealSsn(...))`. The guard
   * was still THERE, still in the right ORDER, and completely inert - which is
   * the definition of an untested guard (standing rule 40). Checking that a
   * line exists somewhere is not the same as checking that it can stop
   * anything.
   *
   * So this test reads the actual condition and insists it is a plain negation
   * with nothing else welded on. Any `false &&`, any `||`, any extra term that
   * could short-circuit the refusal, fails here.
   */
  it("the role guard is LIVE, not merely present", () => {
    const revealFn = CODE.slice(
      CODE.indexOf("export async function revealSsn"),
      CODE.indexOf("export async function listSsnReveals"),
    );
    const guard = /if\s*\(([^)]*canRevealSsn\([^)]*\)[^)]*)\)/.exec(revealFn);
    expect(guard, "the role guard must be an if-condition").not.toBeNull();
    const condition = guard![1].trim();
    // Exactly "!canRevealSsn(input.role)" - one negation, one call, nothing else.
    expect(condition, `guard condition was: ${condition}`).toBe("!canRevealSsn(input.role)");
    expect(condition).not.toMatch(/&&|\|\||false|true/);
  });

  /*
   * The same failure mode applies to the save gate, so it gets the same
   * treatment. A `canSaveToPayroll` check that is always false in practice
   * would let every defective record through while looking correct in a diff.
   */
  it("the save gate is LIVE, not merely present", () => {
    const saveFn = CODE.slice(
      CODE.indexOf("export async function saveEmployeePayrollSetup"),
      CODE.indexOf("function w4ToRow"),
    );
    const guard = /if\s*\(([^)]*canSaveToPayroll[^)]*)\)/.exec(saveFn);
    expect(guard, "the save gate must be an if-condition").not.toBeNull();
    const condition = guard![1].trim();
    expect(condition, `guard condition was: ${condition}`).toBe("!evaluation.canSaveToPayroll");
    expect(condition).not.toMatch(/&&|\|\||false|true/);
  });

  it("does not log a reveal that never happened", () => {
    // A refused attempt must not appear in the log as a disclosure, or the log
    // stops meaning "the number was shown".
    const revealFn = CODE.slice(
      CODE.indexOf("export async function revealSsn"),
      CODE.indexOf("export async function listSsnReveals"),
    );
    const notPermittedAt = revealFn.indexOf("not_permitted");
    const auditAt = revealFn.indexOf('from("employee_ssn_reveals")');
    expect(notPermittedAt).toBeLessThan(auditAt);
  });

  it("demands a non-trivial reason before disclosing", () => {
    expect(CODE).toContain("input.reason.trim().length < 3");
    expect(CODE).toContain("no_reason_given");
  });

  it("reuses the core's role rule rather than re-listing roles here", () => {
    // A second copy of "who may see an SSN" is a second thing to update.
    expect(CODE).toContain("canRevealSsn");
    expect(CODE).not.toMatch(/role\s*===\s*["']owner["']/);
  });
});

// ===========================================================================
describe("THE SAVE GATE: no escape hatch exists", () => {
  it("delegates the decision to the core instead of re-deciding", () => {
    expect(CODE).toContain("evaluateOnboarding(input.candidate)");
    expect(CODE).toContain("evaluation.canSaveToPayroll");
  });

  it("refuses BEFORE any write when the checklist is unmet", () => {
    const saveFn = CODE.slice(
      CODE.indexOf("export async function saveEmployeePayrollSetup"),
      CODE.indexOf("function w4ToRow"),
    );
    const evalAt = saveFn.indexOf("evaluateOnboarding");
    const refuseAt = saveFn.indexOf("canSaveToPayroll");
    const firstInsert = saveFn.indexOf(".insert(");
    expect(evalAt).toBeLessThan(refuseAt);
    expect(refuseAt).toBeLessThan(firstInsert);
  });

  it("has NO force/override/saveAnyway parameter", () => {
    // Michael: "Sage has no safety nets." A net with a hole is not a net.
    expect(CODE).not.toMatch(/force\s*[?:]/i);
    expect(CODE).not.toMatch(/saveAnyway|skipValidation|ignoreWarnings|override\s*[?:]/i);
  });

  it("returns a NAMED refusal code, not just a message string", () => {
    expect(CODE).toContain("refusalCode");
    expect(CODE).toContain("OnboardingRefusalCode");
  });

  it("returns the field paths so the screen can highlight them", () => {
    // Michael: "if a field is missing, it should highlight it".
    expect(CODE).toContain("evaluation.blockingProblems.map((p) => p.field)");
  });

  it("never throws to signal a business refusal", () => {
    const saveFn = CODE.slice(
      CODE.indexOf("export async function saveEmployeePayrollSetup"),
      CODE.indexOf("function w4ToRow"),
    );
    expect(saveFn).not.toContain("throw new Error");
  });
});

// ===========================================================================
describe("COUNTING THE WRITE (standing rule 51)", () => {
  it("counts rows written and treats zero as a failure", () => {
    expect(CODE).toContain("rowsWritten");
    expect(CODE).toContain("if (rowsWritten === 0)");
    // and the zero case must NOT return ok:true
    const zeroBranch = CODE.slice(CODE.indexOf("if (rowsWritten === 0)"));
    expect(zeroBranch.slice(0, 400)).toContain("write_failed");
  });

  it("asks the database to return ids, or there is nothing to count", () => {
    // .insert() without .select() returns no rows and rowsWritten would be a
    // zero nobody computed (standing rule 46).
    const inserts = CODE.match(/\.insert\([\s\S]{0,200}?\)/g) ?? [];
    expect(inserts.length).toBeGreaterThan(0);
    // Every insert in the save path is followed by .select(
    const saveFn = CODE.slice(
      CODE.indexOf("export async function saveEmployeePayrollSetup"),
      CODE.indexOf("function w4ToRow"),
    );
    const insertCount = (saveFn.match(/\.insert\(/g) ?? []).length;
    const upsertCount = (saveFn.match(/\.upsert\(/g) ?? []).length;
    const selectIdCount = (saveFn.match(/\.select\("id"\)/g) ?? []).length;
    expect(selectIdCount).toBeGreaterThanOrEqual(insertCount + upsertCount);
  });

  it("checks the error on EVERY write, not just the first", () => {
    const saveFn = CODE.slice(
      CODE.indexOf("export async function saveEmployeePayrollSetup"),
      CODE.indexOf("function w4ToRow"),
    );
    const writes = (saveFn.match(/\.(insert|upsert|update)\(/g) ?? []).length;
    const errorChecks = (saveFn.match(/\.error\)/g) ?? []).length;
    expect(writes).toBeGreaterThanOrEqual(4);
    expect(errorChecks).toBeGreaterThanOrEqual(writes);
  });
});

// ===========================================================================
describe("the SSN never travels where it is not needed", () => {
  it("the roster read names its columns instead of select(*)", () => {
    const listFn = CODE.slice(
      CODE.indexOf("export async function listEmployeeSetup"),
      CODE.indexOf("export type RevealResult"),
    );
    /*
     * books-65 widened this select by one column (soc_code, the ESD work code).
     * The assertion is therefore written as "names these columns and NOT the
     * full SSN" rather than as an exact string, because pinning the exact
     * string made a lawful addition look like a regression while doing nothing
     * extra to protect the number - which is what this test is actually for.
     */
    expect(listFn).toContain("id, full_name, ssn_last_four");
    expect(listFn).toContain("soc_code");
    expect(listFn).not.toContain('select("*")');
    // THE POINT OF THE TEST: whatever else the roster selects, never this.
    expect(listFn).not.toContain("ssn_full");
  });

  it("the roster row type carries only the last four", () => {
    const rowType = STORE.slice(
      STORE.indexOf("export type EmployeeSetupRow"),
      STORE.indexOf("export type EmployeeSetupRow") + 600,
    );
    expect(rowType).toContain("ssnLastFour");
    expect(rowType).toContain("socCode"); // books-65
    expect(rowType).not.toMatch(/ssnFull|ssn_full/);
  });

  it("ssn_full is touched ONLY inside revealSsn and the save path", () => {
    /*
     * Counting occurrences was the first version of this test and it was a bad
     * test: it asserted "exactly 2" when there are legitimately 4 (the select,
     * the type cast, the property read, and the update), so it failed against
     * correct code and told me nothing about WHERE they were.
     *
     * What actually matters is location, not count. Every mention must sit
     * either in revealSsn (which writes an audit row first) or in the save
     * path (which writes the value). A mention anywhere else - a list query, a
     * helper, a log line - is the leak.
     */
    const revealStart = CODE.indexOf("export async function revealSsn");
    const revealEnd = CODE.indexOf("export async function listSsnReveals");
    const saveStart = CODE.indexOf("export async function saveEmployeePayrollSetup");
    const saveEnd = CODE.indexOf("function w4ToRow");
    expect(revealStart).toBeGreaterThan(-1);
    expect(saveStart).toBeGreaterThan(revealEnd);

    const stray: number[] = [];
    let at = CODE.indexOf("ssn_full");
    while (at !== -1) {
      const inReveal = at >= revealStart && at < revealEnd;
      const inSave = at >= saveStart && at < saveEnd;
      if (!inReveal && !inSave) stray.push(at);
      at = CODE.indexOf("ssn_full", at + 1);
    }
    expect(stray, `ssn_full appears outside revealSsn/save at offsets ${stray.join(", ")}`).toEqual([]);
    // ...and it really is present in both, or the search above was vacuous.
    expect(CODE.slice(revealStart, revealEnd)).toContain("ssn_full");
    expect(CODE.slice(saveStart, saveEnd)).toContain("ssn_full");
  });
});

// ===========================================================================
describe("graceful degradation, because migrations are applied by hand", () => {
  it("every exported function checks isSupabaseServiceConfigured", () => {
    const exported = CODE.match(/export async function (\w+)/g) ?? [];
    expect(exported.length).toBeGreaterThanOrEqual(4);
    const guards = (CODE.match(/isSupabaseServiceConfigured/g) ?? []).length;
    expect(guards).toBeGreaterThanOrEqual(exported.length);
  });

  it("refuses loudly on write when 0195 is missing, rather than pretending", () => {
    expect(CODE).toContain("payrollSetupMigrationApplied");
    expect(CODE).toContain("migration_missing");
    // The FIRST occurrence of migration_missing is in the type union at the
    // top of the file; the branch that uses it is later. Search from the
    // refusal branch, not from the type.
    const branch = STORE.indexOf('refusalCode: "migration_missing"');
    expect(branch, "the migration_missing branch must exist").toBeGreaterThan(-1);
    expect(STORE.slice(branch, branch + 400)).toContain("Nothing was saved");
  });
});

// ===========================================================================
describe("it explains itself (standing rule 26)", () => {
  it("says out loud that the service role bypasses RLS", () => {
    // This is the fact that makes every code-level gate here load-bearing.
    expect(STORE).toMatch(/service role/i);
    expect(STORE).toMatch(/bypass/i);
  });

  it("quotes Michael's requirement rather than paraphrasing it", () => {
    expect(STORE).toContain("Sage has no safety nets");
    expect(STORE).toContain("so something can't silently fail me in some way");
  });

  it("explains why there is no override, in terms of behaviour not policy", () => {
    expect(STORE).toMatch(/click past/i);
  });

  it("documents the derived I-9 columns instead of leaving them mysterious", () => {
    expect(STORE).toContain("all_documents_unexpired");
    expect(STORE).toMatch(/second copy of a fact/i);
  });
});
