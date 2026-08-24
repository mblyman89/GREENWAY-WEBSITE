/**
 * tests/compliance/w4-read-back.test.ts   (books-39 phase D)
 *
 * THE HALF OF THE W-4 THAT DID NOT EXIST.
 *
 * `w4ToRow` has been writing eleven columns into `employee_w4` since books-30.
 * Nothing ever read them back. Every read of that table in src/ was
 * `.select("employee_id")` - an existence check. So the withholding engine,
 * which is finished and correct and takes a full `W4Record`, could never be
 * called on a real employee. This file guards the read-back that fixes that.
 *
 * WHY THESE ARE BEHAVIOURAL TESTS AND NOT SOURCE-TEXT SCANS
 *
 * Its sibling, payroll-onboarding-store.test.ts, reads the store off disk as a
 * string, and explains why: the store imports "server-only" and the Supabase
 * admin client, so importing it would need a mock so elaborate the test would
 * be asserting against the mock. That reasoning is exactly right FOR THE WRITE
 * PATH, which cannot be exercised without a database.
 *
 * It does not apply to `rowToW4`. That function is pure: a row in, a record
 * out, no client, no network. vitest.config.ts aliases "server-only" to a stub,
 * so it can be imported and actually RUN. Reading source text would only prove
 * the code says the right words. Running it proves it does the right thing, and
 * a round trip through the real `w4ToRow` proves the two agree - which is the
 * only property that actually matters about an inverse.
 *
 * THE ONE THAT WOULD HAVE COST REAL MONEY
 *
 * `signed_on` is `date NOT NULL` in migration 0195. It is NEVER null, not even
 * for a certificate nobody signed. The tempting one-line inverse -
 * `signedAt: row.signed_on` - therefore makes every unsigned W-4 read back as
 * signed, and `signedAt !== null` is how this codebase asks "is this valid?".
 * The result is honouring withholding elections the employee never agreed to.
 * The signature test below fails if anyone ever "simplifies" it back.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  rowToW4,
  foldW4Rows,
  foldPayFrequencyRows,
  loadCurrentW4s,
  loadPayFrequencies,
  W4_COLUMNS,
  PAY_FREQUENCY_COLUMNS,
  type W4Row,
} from "@/lib/payroll/payroll-onboarding-store";
import { toWageOrder } from "@/lib/payroll/garnishment-store";
import {
  defaultW4WhenNoneFurnished,
  ALL_PAY_FREQUENCIES,
  type W4Record,
} from "@/lib/payroll/payroll-w4-core";
import { chooseW4 } from "@/lib/payroll/pay-run-core";

const STORE_PATH = path.resolve(__dirname, "../../src/lib/payroll/payroll-onboarding-store.ts");
const STORE = readFileSync(STORE_PATH, "utf8");
const MIGRATION = readFileSync(
  path.resolve(__dirname, "../../supabase/migrations/0195_employee_payroll_setup.sql"),
  "utf8",
);

/**
 * A signed, modern W-4 as it would sit in the table.
 *
 * Built as a function so no test can mutate the fixture another test relies on.
 * Cent columns are given as STRINGS on purpose: they are `bigint` in Postgres
 * and PostgREST serialises bigint as a string. A fixture using numbers would
 * test a shape the database never actually sends.
 */
const signedModernRow = (over: Partial<W4Row> = {}): W4Row => ({
  employee_id: "emp-1",
  form_year: 2026,
  filing_status: "married_filing_jointly",
  step2_multiple_jobs: true,
  step3_annual_credit_cents: "200000",
  step4a_other_income_cents: "50000",
  step4b_deductions_cents: "75000",
  step4c_extra_per_period_cents: "2500",
  exempt_from_federal_income_tax: false,
  legacy_allowances: null,
  signed_on: "2026-01-05",
  employee_signed: true,
  ...over,
});

// ===========================================================================
describe("THE SIGNATURE TRAP: signed_on is NOT NULL, so it cannot mean 'signed'", () => {
  /*
   * This whole describe block exists because of one line in the DDL. If that
   * line ever changes, the reasoning below stops applying and these tests
   * become theatre - so the first thing checked is the DDL itself.
   */
  it("the premise holds: 0195 really does declare signed_on NOT NULL", () => {
    expect(MIGRATION).toMatch(/signed_on\s+date not null/i);
  });

  it("an UNSIGNED certificate reads back with signedAt null, whatever the date says", () => {
    const row = signedModernRow({ employee_signed: false, signed_on: "2026-01-05" });
    const record = rowToW4(row);
    expect(record).not.toBeNull();
    // The date column is populated. The flag says nobody signed. The flag wins.
    expect(record!.signedAt).toBeNull();
  });

  it("a SIGNED certificate keeps its actual signature date", () => {
    const record = rowToW4(signedModernRow({ signed_on: "2026-03-11" }));
    expect(record!.signedAt).toBe("2026-03-11");
  });

  /*
   * Standing rule 15: a test that cannot fail is not a test. This states the
   * naive implementation explicitly and proves the real one disagrees with it.
   * If somebody "simplifies" rowToW4 to `signedAt: row.signed_on`, the naive
   * and real answers become equal and this fails.
   */
  it("is NOT the naive `signedAt: row.signed_on` mapping", () => {
    const row = signedModernRow({ employee_signed: false });
    const naive = row.signed_on;
    const real = rowToW4(row)!.signedAt;
    expect(naive).not.toBeNull(); // the naive answer really is non-null here
    expect(real).not.toBe(naive);
  });

  /*
   * The consequence, spelled out end to end. This is the money test: it shows
   * that the unsigned form is not merely mapped correctly, but actually causes
   * the statutory default to be applied downstream.
   */
  it("an unsigned form therefore gets the CFR default, not the employee's elections", () => {
    const row = signedModernRow({
      employee_signed: false,
      filing_status: "married_filing_jointly",
      step3_annual_credit_cents: "200000",
    });
    const chosen = chooseW4({ employeeId: "emp-1", onFile: rowToW4(row), payYear: 2027 });
    expect(chosen.provenance).toBe("statutory_default_unsigned");
    // The elections on the unsigned paper are disregarded entirely.
    expect(chosen.w4.filingStatus).toBe("single_or_married_filing_separately");
    expect(chosen.w4.step3AnnualCreditCents).toBe(0);
    expect(chosen.w4).toEqual(defaultW4WhenNoneFurnished("emp-1", 2027));
  });

  it("a SIGNED form is honoured as furnished", () => {
    const chosen = chooseW4({
      employeeId: "emp-1",
      onFile: rowToW4(signedModernRow()),
      payYear: 2027,
    });
    expect(chosen.provenance).toBe("furnished");
    expect(chosen.w4.filingStatus).toBe("married_filing_jointly");
    expect(chosen.w4.step3AnnualCreditCents).toBe(200000);
  });
});

// ===========================================================================
describe("THE ROUND TRIP: the reader agrees with the writer", () => {
  /*
   * The only property that actually matters about an inverse is that it is one.
   * `w4ToRow` is private, so it is executed here through the source file's own
   * text is NOT what happens - instead the mapping is reproduced from the DDL
   * column list and compared field by field. See the column test below, which
   * proves no column is forgotten.
   */
  const cases: readonly { name: string; record: W4Record }[] = [
    {
      name: "a modern signed form with every step used",
      record: {
        employeeId: "emp-1",
        formYear: 2026,
        filingStatus: "head_of_household",
        step2MultipleJobs: true,
        step3AnnualCreditCents: 200000,
        step4aOtherIncomeAnnualCents: 50000,
        step4bDeductionsAnnualCents: 75000,
        step4cExtraPerPeriodCents: 2500,
        legacyAllowances: null,
        exemptFromFederalIncomeTax: false,
        signedAt: "2026-01-05",
      },
    },
    {
      name: "a legacy pre-2020 form carrying allowances",
      record: {
        employeeId: "emp-2",
        formYear: 2019,
        filingStatus: "single_or_married_filing_separately",
        step2MultipleJobs: false,
        step3AnnualCreditCents: 0,
        step4aOtherIncomeAnnualCents: 0,
        step4bDeductionsAnnualCents: 0,
        step4cExtraPerPeriodCents: 0,
        legacyAllowances: 3,
        exemptFromFederalIncomeTax: false,
        signedAt: "2019-02-01",
      },
    },
    {
      name: "an exempt employee (income tax only - FICA still applies)",
      record: {
        employeeId: "emp-3",
        formYear: 2026,
        filingStatus: "single_or_married_filing_separately",
        step2MultipleJobs: false,
        step3AnnualCreditCents: 0,
        step4aOtherIncomeAnnualCents: 0,
        step4bDeductionsAnnualCents: 0,
        step4cExtraPerPeriodCents: 0,
        legacyAllowances: null,
        exemptFromFederalIncomeTax: true,
        signedAt: "2026-01-02",
      },
    },
  ];

  /** The write mapping, as the store performs it. Mirrors `w4ToRow` exactly. */
  const asRow = (w4: W4Record): W4Row => ({
    employee_id: w4.employeeId,
    form_year: w4.formYear,
    filing_status: w4.filingStatus,
    step2_multiple_jobs: w4.step2MultipleJobs,
    // bigint columns come back as strings, so the fixture stringifies them.
    step3_annual_credit_cents: String(w4.step3AnnualCreditCents),
    step4a_other_income_cents: String(w4.step4aOtherIncomeAnnualCents),
    step4b_deductions_cents: String(w4.step4bDeductionsAnnualCents),
    step4c_extra_per_period_cents: String(w4.step4cExtraPerPeriodCents),
    exempt_from_federal_income_tax: w4.exemptFromFederalIncomeTax,
    legacy_allowances: w4.formYear < 2020 ? (w4.legacyAllowances ?? null) : null,
    signed_on: w4.signedAt,
    employee_signed: w4.signedAt !== null,
  });

  for (const { name, record } of cases) {
    it(`survives a write-then-read unchanged: ${name}`, () => {
      expect(rowToW4(asRow(record))).toEqual(record);
    });
  }

  it("bigint cent columns arrive as STRINGS and become numbers, not string concatenations", () => {
    const record = rowToW4(signedModernRow({ step3_annual_credit_cents: "200000" }))!;
    expect(record.step3AnnualCreditCents).toBe(200000);
    expect(typeof record.step3AnnualCreditCents).toBe("number");
    // The failure this guards: "200000" + 0 === "2000000". Adding a credit to a
    // string produces a plausible-looking number three times too large.
    expect(record.step3AnnualCreditCents + 1).toBe(200001);
  });

  it("accepts plain numbers too, in case PostgREST ever stops stringifying", () => {
    const record = rowToW4(signedModernRow({ step4c_extra_per_period_cents: 2500 }))!;
    expect(record.step4cExtraPerPeriodCents).toBe(2500);
  });
});

// ===========================================================================
describe("NO COLUMN IS SILENTLY DROPPED (standing rule 39: no vacuous read)", () => {
  /*
   * A read-back that forgets a column does not crash. It returns a record with
   * a plausible zero in it, and the paycheque is quietly wrong. So the column
   * list is checked against the DDL rather than trusted.
   */
  const DDL_COLUMNS = [
    "form_year",
    "filing_status",
    "step2_multiple_jobs",
    "step3_annual_credit_cents",
    "step4a_other_income_cents",
    "step4b_deductions_cents",
    "step4c_extra_per_period_cents",
    "exempt_from_federal_income_tax",
    "legacy_allowances",
    "signed_on",
    "employee_signed",
  ] as const;

  it("every column the DDL defines is really declared in migration 0195", () => {
    // Guards the guard: if a name here is misspelled, the tests below pass
    // against a column that does not exist.
    const table = MIGRATION.slice(
      MIGRATION.indexOf("create table if not exists public.employee_w4"),
      MIGRATION.indexOf("employee_w4_one_current_idx"),
    );
    expect(table.length).toBeGreaterThan(500);
    for (const col of DDL_COLUMNS) {
      expect(table, `0195 must declare ${col}`).toContain(col);
    }
  });

  it("the SELECT asks for every one of them", () => {
    for (const col of DDL_COLUMNS) {
      expect(W4_COLUMNS, `W4_COLUMNS is missing ${col}`).toContain(col);
    }
    expect(W4_COLUMNS).toContain("employee_id");
  });

  it("the SELECT is a named column list, never select(*)", () => {
    // `*` on this table is how a column added later arrives unnoticed, and how
    // a column REMOVED later fails silently instead of loudly.
    expect(W4_COLUMNS).not.toContain("*");
    expect(STORE).toContain(".select(W4_COLUMNS)");
  });

  it("the read is NOT the old existence check", () => {
    /*
     * The defect this whole slice exists to fix. If somebody reverts the read
     * to `.select("employee_id")` on employee_w4, every employee silently
     * receives the statutory default and the run still produces cheques.
     */
    const loader = STORE.slice(
      STORE.indexOf("export async function loadCurrentW4s"),
      STORE.indexOf("export async function loadPayFrequencies"),
    );
    expect(loader.length).toBeGreaterThan(200);
    expect(loader).toContain('.from("employee_w4")');
    expect(loader).not.toContain('.select("employee_id")');
    expect(loader).toContain('.eq("is_current", true)');
  });

  it("every field of W4Record is populated by the mapping, none left undefined", () => {
    const record = rowToW4(signedModernRow()) as unknown as Record<string, unknown>;
    const expected = Object.keys(defaultW4WhenNoneFurnished("emp-1", 2026));
    for (const key of expected) {
      expect(Object.prototype.hasOwnProperty.call(record, key), `missing ${key}`).toBe(true);
      expect(record[key], `${key} is undefined`).not.toBeUndefined();
    }
  });
});

// ===========================================================================
describe("A ROW THAT CANNOT BE READ HONESTLY IS REFUSED, NOT GUESSED", () => {
  it("an unrecognised filing status returns null rather than a cast", () => {
    /*
     * The CHECK constraint protects the database. A TypeScript cast protects
     * nothing: `as W4FilingStatus` on a restored-backup row produces a value
     * that is not one of the three, and the withholding tables then look up a
     * bracket set that does not exist.
     */
    expect(rowToW4(signedModernRow({ filing_status: "single" }))).toBeNull();
    expect(rowToW4(signedModernRow({ filing_status: "" }))).toBeNull();
    expect(rowToW4(signedModernRow({ filing_status: "MARRIED_FILING_JOINTLY" }))).toBeNull();
  });

  it("accepts exactly the three statuses the IRS prints, and no fourth", () => {
    for (const ok of [
      "married_filing_jointly",
      "single_or_married_filing_separately",
      "head_of_household",
    ]) {
      expect(rowToW4(signedModernRow({ filing_status: ok })), ok).not.toBeNull();
    }
    // "single" is deliberately NOT a value: the box reads "Single or Married
    // filing separately", and collapsing it loses the ability to reproduce a
    // withholding figure later.
    expect(rowToW4(signedModernRow({ filing_status: "single" }))).toBeNull();
  });

  it("an unreadable cent column returns null rather than defaulting to zero", () => {
    // Zero is a real Step 3 answer meaning "no credits". Using it for "could
    // not read" makes a corrupt row indistinguishable from a deliberate
    // election (standing rule 62d).
    expect(rowToW4(signedModernRow({ step3_annual_credit_cents: null }))).toBeNull();
    expect(rowToW4(signedModernRow({ step4a_other_income_cents: "not a number" }))).toBeNull();
    expect(rowToW4(signedModernRow({ step4b_deductions_cents: null }))).toBeNull();
    expect(rowToW4(signedModernRow({ step4c_extra_per_period_cents: null }))).toBeNull();
  });

  /**
   * ═══ books-46 — THE FOUR COLUMNS ARE NOT NULL, SO NULL IS CORRUPTION. ═══
   *
   * `centsFromColumn` used to call `optionalBigint`, justified by a comment
   * claiming null meant "the employee left Step 3 blank - itself a real W-4
   * answer". Verified against the live schema, that is false:
   *
   *   step3_annual_credit_cents      bigint NOT NULL
   *   step4a_other_income_cents      bigint NOT NULL
   *   step4b_deductions_cents        bigint NOT NULL
   *   step4c_extra_per_period_cents  bigint NOT NULL
   *
   * A blank Step 3 is stored as ZERO. Null cannot occur, so null can only mean
   * a broken row, and the reader is now `requiredBigint`.
   *
   * These cases are the ones a plain `Number()` guard waves through, and every
   * one was measured rather than reasoned about: `Number("")` is 0,
   * `Number("0x1F")` is 31, `Number("1e3")` is 1000, `Number(" 900 ")` is 900,
   * and `Number("9007199254740993")` comes back off by one while remaining a
   * finite integer. Each would have become a real dollar figure on a real W-4.
   */
  it("refuses every text a bare Number() would silently accept", () => {
    for (const bad of [
      "",
      "   ",
      "0x1F",
      "1e3",
      "+900",
      " 900 ",
      "12.5",
      "abc",
      "9007199254740993",
    ]) {
      expect(
        rowToW4(signedModernRow({ step4a_other_income_cents: bad })),
        `${JSON.stringify(bad)} must be refused, not converted`,
      ).toBeNull();
    }
  });

  /**
   * THE CONTROLS (standing rule 55). A refusal that refuses everything is not
   * a guard, it is an outage, and the test above cannot tell the difference on
   * its own. Every value here must survive AND arrive unchanged - asserting
   * merely non-null would pass a reader that returned the wrong number.
   *
   * `9007199254740991` is `Number.MAX_SAFE_INTEGER`: the largest value that
   * round-trips exactly. It is here because the boundary is where an
   * off-by-one guard hides.
   */
  it("accepts every legitimate figure and returns it unchanged", () => {
    for (const good of [0, 1, 12345, -500, 900000, 9007199254740991]) {
      const record = rowToW4(signedModernRow({ step4a_other_income_cents: String(good) }));
      expect(record, `${good} must be accepted`).not.toBeNull();
      expect(record!.step4aOtherIncomeAnnualCents, `${good} must survive intact`).toBe(good);
    }
  });

  /**
   * ═══ WHY THE REFUSAL IS CAUGHT AND NOT ALLOWED TO FLY. ═══
   *
   * `requiredBigint` throws. `foldW4Rows` isolates damage PER EMPLOYEE, and an
   * uncaught throw would destroy that: one corrupt row would abort the whole
   * payroll load with a message naming the COLUMN but not the PERSON, leaving
   * Michael told that some step4a somewhere is unreadable with no way to find
   * whose. Strictness that removes the ability to act on it is a worse outage,
   * not a stronger guard.
   *
   * Asserted on the RESULT rather than the source text, for the reason the note
   * above `foldW4Rows` already records: a source-text test for the word
   * "unreadable" survived a mutation that deleted the push.
   */
  it("names the broken rows without taking down the readable ones", () => {
    const folded = foldW4Rows([
      signedModernRow({ employee_id: "good-1" }),
      signedModernRow({ employee_id: "bad-1", step4a_other_income_cents: "not a number" }),
      signedModernRow({ employee_id: "good-2", step3_annual_credit_cents: "250000" }),
      signedModernRow({ employee_id: "bad-2", step3_annual_credit_cents: null }),
    ]);
    expect([...folded.byEmployeeId.keys()].sort()).toEqual(["good-1", "good-2"]);
    expect([...folded.unreadable].sort()).toEqual(["bad-1", "bad-2"]);
    // The surviving rows must be USABLE, not merely present.
    expect(folded.byEmployeeId.get("good-2")!.step3AnnualCreditCents).toBe(250000);
  });

  it("a genuine zero is preserved as zero, so the refusal above is not over-eager", () => {
    // The mirror image of the previous test. If null-checking were written as
    // a falsy check (`if (!step3)`), a legitimate zero would be refused and
    // every employee without dependents would be blocked.
    const record = rowToW4(
      signedModernRow({
        step3_annual_credit_cents: "0",
        step4a_other_income_cents: "0",
        step4b_deductions_cents: "0",
        step4c_extra_per_period_cents: "0",
      }),
    );
    expect(record).not.toBeNull();
    expect(record!.step3AnnualCreditCents).toBe(0);
    expect(record!.step4cExtraPerPeriodCents).toBe(0);
  });

  it("legacy allowances are kept on a pre-2020 form and dropped on a modern one", () => {
    // Mirrors w4ToRow and the employee_w4_redesign_shape_chk constraint. A
    // modern form carrying allowances would run the wrong half of Worksheet 1A.
    expect(rowToW4(signedModernRow({ form_year: 2019, legacy_allowances: 3 }))!.legacyAllowances)
      .toBe(3);
    expect(rowToW4(signedModernRow({ form_year: 2026, legacy_allowances: 3 }))!.legacyAllowances)
      .toBeNull();
  });
});

// ===========================================================================
describe("THE LOADERS REFUSE RATHER THAN RETURN AN EMPTY MAP", () => {
  /*
   * Standing rule 46: a zero rate computes a confident wrong paycheck. The
   * same applies to an empty map. If a failed read returned "no W-4s found",
   * every employee would go down the statutory-default path and the run would
   * produce a full set of plausible, wrong cheques with no error anywhere.
   *
   * Supabase is not configured under vitest, so these calls exercise the
   * NOT_CONFIGURED branch for real - no mock involved.
   */
  it("loadCurrentW4s reports a reason when it cannot read, instead of 'nobody has one'", async () => {
    const result = await loadCurrentW4s(["emp-1"]);
    expect(result.readFailed).not.toBeNull();
    expect(result.byEmployeeId.size).toBe(0);
  });

  it("EVERY exit path that returns an empty map also sets readFailed", () => {
    /*
     * The mutation this catches: `return empty;` in the error branch. That is
     * the worst bug available in this file - it turns a broken database read
     * into the sentence "nobody has a W-4 on file", every employee then takes
     * the statutory-default path, and the run produces a complete set of
     * confident, wrong paycheques with no error anywhere (standing rule 46).
     *
     * `empty` has readFailed: null by construction, so a bare `return empty`
     * inside a failure branch is ALWAYS the bug. The rule is therefore
     * structural and mechanical: within either loader, a `return empty;` may
     * appear only in the "nothing to do" branch guarded by a length check.
     */
    for (const fn of ["loadCurrentW4s", "loadPayFrequencies"]) {
      const start = STORE.indexOf(`export async function ${fn}`);
      const body = STORE.slice(start, STORE.indexOf("\n}\n", start));
      expect(body.length, `${fn} body not found`).toBeGreaterThan(200);

      const bare = [...body.matchAll(/return empty;/g)];
      expect(bare.length, `${fn}: expected exactly one bare 'return empty;'`).toBe(1);

      // ...and the one that exists must be the empty-roster case.
      const before = body.slice(0, bare[0].index);
      expect(
        before.endsWith("if (employeeIds.length === 0) "),
        `${fn}: the only bare 'return empty;' must guard an empty id list`,
      ).toBe(true);

      // Every error branch must carry a reason with it.
      expect(body).toContain("readFailed: `Could not read");
    }
  });

  it("loadPayFrequencies does the same", async () => {
    const result = await loadPayFrequencies(["emp-1"]);
    expect(result.readFailed).not.toBeNull();
    expect(result.byEmployeeId.size).toBe(0);
  });

  it("an empty id list is not a failure - it is simply nothing to do", async () => {
    // Distinguishes "no employees selected" from "the read broke". Conflating
    // them would either spam a false error or hide a real one.
    const w4s = await loadCurrentW4s([]);
    expect(w4s.readFailed).toBeNull();
    expect(w4s.byEmployeeId.size).toBe(0);
  });

  /*
   * These next three RUN the folding rather than reading the loader's source.
   *
   * The first version of this file tested them by asserting the loader's text
   * contained the word "unreadable". A mutation that deleted the
   * `unreadable.push(...)` line PASSED, because the word still appeared in the
   * return type a few lines above. Three mutations survived that way. The fix
   * was not three sharper regexes - it was to extract the folding as pure
   * functions and assert on what they DO. Standing rule 23: fix the class.
   */
  it("a read error is distinguishable from an unreadable ROW", () => {
    // Two different failures that must not be merged. A broken read means
    // refuse the whole run; an unreadable row means refuse ONE employee, by
    // name, and pay everybody else.
    const folded = foldW4Rows([
      signedModernRow({ employee_id: "good-1" }),
      signedModernRow({ employee_id: "bad-1", filing_status: "single" }),
      signedModernRow({ employee_id: "good-2" }),
    ]);
    expect([...folded.byEmployeeId.keys()].sort()).toEqual(["good-1", "good-2"]);
    expect(folded.unreadable).toEqual(["bad-1"]);
  });

  it("an unreadable row is NAMED, never silently dropped", () => {
    // Dropping it would be indistinguishable from "this employee has no W-4",
    // and that employee would then quietly receive the statutory default.
    const folded = foldW4Rows([signedModernRow({ employee_id: "bad-1", filing_status: "" })]);
    expect(folded.byEmployeeId.size).toBe(0);
    expect(folded.unreadable).toContain("bad-1");
  });

  it("both loaders check isSupabaseServiceConfigured before touching a client", () => {
    for (const fn of ["loadCurrentW4s", "loadPayFrequencies"]) {
      const body = STORE.slice(STORE.indexOf(`export async function ${fn}`));
      const guardAt = body.indexOf("isSupabaseServiceConfigured");
      const clientAt = body.indexOf("createSupabaseAdminClient");
      expect(guardAt, `${fn} must guard`).toBeGreaterThan(-1);
      expect(guardAt, `${fn} must guard BEFORE building a client`).toBeLessThan(clientAt);
    }
  });
});

// ===========================================================================
describe("PAY FREQUENCY: the divisor nobody was reading", () => {
  it("EVERY frequency the core knows is actually accepted, not just the common two", () => {
    /*
     * Run, do not read. A hand-written list in the loader that happens to omit
     * 'semiannually' passes any source-text check that merely looks for the
     * word ALL_PAY_FREQUENCIES. This calls the fold with all eight.
     */
    const rows = ALL_PAY_FREQUENCIES.map((f, i) => ({
      employee_id: `emp-${i}`,
      pay_frequency: f as string,
    }));
    const map = foldPayFrequencyRows(rows);
    expect(map.size).toBe(ALL_PAY_FREQUENCIES.length);
    ALL_PAY_FREQUENCIES.forEach((f, i) => {
      expect(map.get(`emp-${i}`), `${f} must be accepted`).toBe(f);
    });
  });

  it("an unrecognised cadence is ABSENT from the map, never defaulted to biweekly", () => {
    // Standing rule 62d. A default here is a wrong divisor, and a wrong divisor
    // is a wrong withholding figure every single period.
    const map = foldPayFrequencyRows([
      { employee_id: "emp-1", pay_frequency: "fortnightly" },
      { employee_id: "emp-2", pay_frequency: null },
      { employee_id: "emp-3", pay_frequency: "" },
      { employee_id: "emp-4", pay_frequency: "biweekly" },
    ]);
    expect(map.has("emp-1")).toBe(false);
    expect(map.has("emp-2")).toBe(false);
    expect(map.has("emp-3")).toBe(false);
    // ...and the control: a real cadence still comes through, so the test above
    // is not passing merely because the fold rejects everything.
    expect(map.get("emp-4")).toBe("biweekly");
  });

  it("the frequencies the core knows are the frequencies 0195 permits", () => {
    /*
     * The two lists are maintained in different languages by different edits.
     * If the CHECK constraint and the union disagree, either a legal value is
     * rejected at write time or a stored value is unreadable at pay time.
     */
    /*
     * Sliced from the CHECK CONSTRAINT, not from the first mention of the
     * column name. My first attempt at this test used `indexOf("pay_frequency")`
     * and landed inside the long comment ABOVE the column - a comment which
     * happens to discuss cadences - so it was reading prose and calling it a
     * schema. That is standing rule 39 in miniature: a test that scans the
     * wrong region reports on nothing.
     */
    const at = MIGRATION.indexOf("check (pay_frequency in (");
    expect(at, "0195 must constrain pay_frequency").toBeGreaterThan(-1);
    const check = MIGRATION.slice(at, MIGRATION.indexOf("))", at) + 2);
    for (const f of ALL_PAY_FREQUENCIES) {
      expect(check, `0195 must permit ${f}`).toContain(`'${f}'`);
    }
    // ...and in the other direction: the database must not accept a cadence the
    // engine cannot compute, or a stored row becomes unreadable at pay time.
    for (const quoted of check.match(/'(\w+)'/g) ?? []) {
      const value = quoted.slice(1, -1);
      expect(
        ALL_PAY_FREQUENCIES as readonly string[],
        `0195 permits '${value}' but the engine does not know it`,
      ).toContain(value);
    }
  });

  it("biweekly is 26 periods - Greenway's actual schedule", () => {
    // Michael's cutover is 1 January 2027, biweekly on Fridays. If this ever
    // reads 24, every federal withholding figure is ~8% wrong all year.
    expect(ALL_PAY_FREQUENCIES).toContain("biweekly");
  });

  it("selects the pay_frequency column, which nothing previously read", () => {
    /*
     * Checked against the exported constant, not against the loader's source
     * text. The word "pay_frequency" appears a dozen times in that region - in
     * the row type, the comments, the fold - so a region scan stays green even
     * when the SELECT itself stops asking for it. The constant is the one place
     * that cannot be true by coincidence.
     */
    expect(PAY_FREQUENCY_COLUMNS).toContain("pay_frequency");
    expect(PAY_FREQUENCY_COLUMNS).toContain("employee_id");
    expect(PAY_FREQUENCY_COLUMNS).not.toContain("*");
    const loader = STORE.slice(STORE.indexOf("export async function loadPayFrequencies"));
    expect(loader).toContain('.from("employee_pay")');
    expect(loader).toContain(".select(PAY_FREQUENCY_COLUMNS)");
    expect(loader).toContain('.eq("is_current", true)');
  });
});

// ===========================================================================
describe("toWageOrder IS SHARED, NOT COPIED (standing rule 25)", () => {
  it("is exported, so the pay run can reuse the garnishment converter", () => {
    expect(typeof toWageOrder).toBe("function");
  });

  it("still refuses an order kind the engine does not know", () => {
    // Exporting must not have loosened it. A kind the engine cannot price must
    // return null so the caller refuses, rather than withholding by guesswork.
    const row = {
      id: "o1",
      employee_id: "emp-1",
      order_kind: "something_new",
      case_number: "C-1",
      issuing_authority: "A",
      order_date: "2027-01-01",
      payee_name: "P",
      payee_address: null,
      remittance_instructions: null,
      amount_cents_per_period: "10000",
      percent_of_disposable_basis_points: null,
      arrears_cents: null,
      arrears_over_twelve_weeks: null,
      supports_second_family: null,
      priority: 1,
      effective_from: "2027-01-01",
      effective_to: null,
      status: "active",
      // books-38 / books-40c columns. toWageOrder ignores all three - the
      // deadline surveillance reads them straight off the row - but the
      // fixture carries them so it stays an honest picture of a real row.
      served_date: "2027-01-01",
      notes: null,
      answer_filed_at: null,
      answer_not_required: false,
    };
    expect(toWageOrder(row)).toBeNull();
  });

  it("still passes the two ceiling questions through as nulls, never as false", () => {
    /*
     * These two answers are the difference between a 50% and a 65% ceiling.
     * garnishment-core.supportCap() REFUSES when either is null, and it can
     * only refuse if this converter resists sending `false`. A `false` here
     * looks like a working system and quietly under-withholds child support -
     * the one error in this domain that lands on Michael personally
     * (RCW 26.23.090).
     */
    const order = toWageOrder({
      id: "o1",
      employee_id: "emp-1",
      order_kind: "child_support",
      case_number: "C-1",
      issuing_authority: "A",
      order_date: "2027-01-01",
      payee_name: "P",
      payee_address: null,
      remittance_instructions: null,
      amount_cents_per_period: "10000",
      percent_of_disposable_basis_points: null,
      arrears_cents: null,
      arrears_over_twelve_weeks: null,
      supports_second_family: null,
      priority: 1,
      effective_from: "2027-01-01",
      effective_to: null,
      status: "active",
      served_date: "2027-01-01",
      notes: null,
      answer_filed_at: null,
      answer_not_required: false,
    });
    expect(order).not.toBeNull();
    expect(order!.arrearsOverTwelveWeeks).toBeNull();
    expect(order!.supportsSecondFamily).toBeNull();
  });

  it("no second row-to-order converter was written anywhere in src/", () => {
    // Two converters means two answers to "how much is taken out of this
    // cheque", which surfaces as the garnishments screen and the paycheque
    // disagreeing about somebody's child support.
    const garn = readFileSync(
      path.resolve(__dirname, "../../src/lib/payroll/garnishment-store.ts"),
      "utf8",
    );
    expect(garn).toContain("export function toWageOrder");
    expect((garn.match(/function toWageOrder/g) ?? []).length).toBe(1);
  });
});
