/**
 * books-34 — PROVE MIGRATION 0199'S CONSTRAINTS ACTUALLY BITE.
 *
 * Standing rule 16: a constraint that has never been seen to reject anything is
 * not a constraint, it is a comment with SQL syntax. A CHECK clause can be
 * misspelled, scoped to the wrong column, or written so that it can never be
 * false, and the migration will apply perfectly cleanly either way. `\d` shows
 * the constraint EXISTS; it does not show that it WORKS.
 *
 * Standing rule 55: refusal must DISCRIMINATE. A table that rejects everything
 * is as useless as one that rejects nothing, so every rejection case below is
 * paired with an ACCEPT control — a row that is legal for the same reason the
 * rejected one was not, differing in as little as one cent.
 *
 * Standing rule 39: guard against a vacuous pass. If the fixtures fail to
 * insert, every "rejected" result below would be a false green, so the harness
 * verifies its own setup before drawing any conclusion.
 *
 * Run against a database that already has all 199 migrations applied:
 *   npx tsx scripts/prove-0199-gates.ts
 * Connection comes from PGURL, or defaults to the local socket database gw34.
 */
import { execFileSync } from "node:child_process";

/**
 * `pg` is not a dependency of this repository and adding one to run a proof
 * script would be the tail wagging the dog. psql is already required by the
 * migrations CI job.
 */
function psql(sql: string, db: string): { ok: boolean; out: string } {
  const url = process.env.PGURL;
  const args = url ? [url, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]
                   : ["-d", db, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql];
  try {
    const out = execFileSync("psql", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, out: out.trim() };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, out: (err.stderr ?? err.stdout ?? err.message ?? "").trim() };
  }
}

const DB = process.env.PGDATABASE ?? "gw34";
let passed = 0;
let failed = 0;

function report(ok: boolean, label: string, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}`);
    if (detail) console.log(detail.split("\n").map((l) => `          ${l}`).join("\n"));
  }
}

/** A row that must be REFUSED, and the constraint that must do the refusing. */
function mustReject(label: string, cols: string, vals: string, constraint: string): void {
  const r = psql(
    `insert into public.payroll_ytd_accumulators (employee_id, tax_year, ${cols})
     values ((select id from public.employees limit 1), 2026, ${vals});`,
    DB,
  );
  if (r.ok) {
    report(false, label, "THE ROW WAS ACCEPTED. The constraint did not fire.");
    psql(`delete from public.payroll_ytd_accumulators;`, DB);
    return;
  }
  if (!r.out.includes(constraint)) {
    report(
      false,
      label,
      `Rejected, but by the WRONG constraint. Expected "${constraint}".\n${r.out.split("\n")[0]}`,
    );
    return;
  }
  report(true, `${label} -> rejected by ${constraint}`);
}

/** A row that must be ACCEPTED — rule 55's other half. */
function mustAccept(label: string, cols: string, vals: string): void {
  psql(`delete from public.payroll_ytd_accumulators;`, DB);
  const r = psql(
    `insert into public.payroll_ytd_accumulators (employee_id, tax_year, ${cols})
     values ((select id from public.employees limit 1), 2026, ${vals});`,
    DB,
  );
  report(r.ok, `${label} -> accepted`, r.out.split("\n")[0]);
  psql(`delete from public.payroll_ytd_accumulators;`, DB);
}

console.log("=== §0  HARNESS SANITY (rule 39: do not pass vacuously) ===");

const tableThere = psql(
  `select to_regclass('public.payroll_ytd_accumulators') is not null;`,
  DB,
);
report(
  tableThere.ok && tableThere.out === "t",
  "payroll_ytd_accumulators exists",
  tableThere.out,
);

// Every rejection test inserts a row referencing an employee. With no employees
// the FK would fail and EVERY test would "pass" for the wrong reason - the
// exact vacuous green rule 39 exists to prevent.
const seed = psql(
  `insert into public.employees (full_name)
   select 'books-34 fixture'
   where not exists (select 1 from public.employees where full_name = 'books-34 fixture');`,
  DB,
);
if (!seed.ok) console.log(`          (seed note: ${seed.out.split("\n")[0]})`);

const haveEmployee = psql(`select count(*) > 0 from public.employees;`, DB);
report(
  haveEmployee.ok && haveEmployee.out === "t",
  "at least one employee exists, so rejections are about CHECKs and not the FK",
  haveEmployee.out,
);

// Prove a WHOLLY VALID row inserts. If this fails, every "rejected" below is
// meaningless because nothing could ever have been inserted.
psql(`delete from public.payroll_ytd_accumulators;`, DB);
const baseline = psql(
  `insert into public.payroll_ytd_accumulators
     (employee_id, tax_year, oasdi_wages_cents, medicare_wages_cents, oasdi_employee_cents, medicare_employee_cents)
   values ((select id from public.employees limit 1), 2026, 500000, 500000, 31000, 7250);`,
  DB,
);
report(baseline.ok, "a wholly valid row DOES insert (the table is not simply closed)", baseline.out);
psql(`delete from public.payroll_ytd_accumulators;`, DB);

console.log("\n=== §1  THE SSA'S THREE REJECTION CONDITIONS ===");

// SSA bullet 1. Medicare has no ceiling and social security does, so medicare
// wages can never be the smaller of the two. One cent below is enough.
mustReject(
  "medicare wages one cent BELOW oasdi wages",
  "oasdi_wages_cents, medicare_wages_cents",
  "500000, 499999",
  "payroll_ytd_medicare_ge_oasdi",
);
mustAccept(
  "medicare wages EQUAL to oasdi wages (the ordinary case, below the ceiling)",
  "oasdi_wages_cents, medicare_wages_cents",
  "500000, 500000",
);
mustAccept(
  "medicare wages ABOVE oasdi wages (the post-ceiling case this slice exists for)",
  "oasdi_wages_cents, medicare_wages_cents",
  "18450000, 19975000",
);

// SSA bullet 2.
mustReject(
  "social security TAX with zero social security WAGES",
  "oasdi_wages_cents, medicare_wages_cents, oasdi_employee_cents",
  "0, 0, 31000",
  "payroll_ytd_no_oasdi_tax_without_wages",
);
mustAccept(
  "zero social security tax AND zero wages (a brand new year)",
  "oasdi_wages_cents, medicare_wages_cents, oasdi_employee_cents",
  "0, 0, 0",
);

// SSA bullet 3.
mustReject(
  "Medicare TAX with zero Medicare WAGES",
  "oasdi_wages_cents, medicare_wages_cents, medicare_employee_cents",
  "0, 0, 7250",
  "payroll_ytd_no_medicare_tax_without_wages",
);

console.log("\n=== §2  MAGNITUDE, SIGN AND THE FUTA BASE ===");

mustReject(
  "negative social security wages",
  "oasdi_wages_cents, medicare_wages_cents",
  "-1, 0",
  "payroll_ytd_sane_magnitude",
);
mustReject(
  "negative withheld tax",
  "oasdi_wages_cents, medicare_wages_cents, oasdi_employee_cents",
  "500000, 500000, -1",
  "payroll_ytd_no_negative_taxes",
);
mustReject(
  "negative L&I hours",
  "lni_hundredth_hours",
  "-1",
  "payroll_ytd_no_negative_hours",
);

// The units trap: $184,500 typed as dollars instead of cents is 184500, which
// is legal. Typed the other way - cents where dollars belong - a plausible
// salary becomes an implausible one. This catches the gross case.
mustReject(
  "a hundred billion in wages (a units error, not a payroll)",
  "oasdi_wages_cents, medicare_wages_cents",
  "10000000001, 10000000001",
  "payroll_ytd_sane_magnitude",
);

// FUTA stops at $7,000 (26 U.S.C. §3306(b)(1)). 700000 cents.
mustReject(
  "FUTA wages ONE CENT above the $7,000 base",
  "futa_wages_cents",
  "700001",
  "payroll_ytd_futa_within_base",
);
mustAccept("FUTA wages EXACTLY at the $7,000 base", "futa_wages_cents", "700000");

console.log("\n=== §3  ONE ROW PER EMPLOYEE PER YEAR ===");

// Two rows for one employee-year means two answers to "has this employee
// passed the wage base", and the pay run takes whichever comes back first.
psql(`delete from public.payroll_ytd_accumulators;`, DB);
const first = psql(
  `insert into public.payroll_ytd_accumulators (employee_id, tax_year)
   values ((select id from public.employees limit 1), 2026);`,
  DB,
);
report(first.ok, "first 2026 row for the employee inserts", first.out);

const dup = psql(
  `insert into public.payroll_ytd_accumulators (employee_id, tax_year)
   values ((select id from public.employees limit 1), 2026);`,
  DB,
);
report(
  !dup.ok && dup.out.includes("payroll_ytd_one_row_per_employee_year"),
  "a SECOND 2026 row for the same employee is refused",
  dup.out.split("\n")[0],
);

// Rule 55 again: the uniqueness must be per YEAR, not per employee. If this is
// refused, the constraint is too broad and the employee could never start 2027.
const nextYear = psql(
  `insert into public.payroll_ytd_accumulators (employee_id, tax_year)
   values ((select id from public.employees limit 1), 2027);`,
  DB,
);
report(nextYear.ok, "the SAME employee CAN open a 2027 row", nextYear.out.split("\n")[0]);
psql(`delete from public.payroll_ytd_accumulators;`, DB);

console.log("\n=== §4  THE TAX YEAR BOUND ===");

// `mustReject` hardcodes tax_year 2026, so these cases are written out. The
// bound catches a four-digit typo, which is one of the few data errors a
// database can detect entirely on its own.
psql(`delete from public.payroll_ytd_accumulators;`, DB);
const badYear = psql(
  `insert into public.payroll_ytd_accumulators (employee_id, tax_year)
   values ((select id from public.employees limit 1), 1999);`,
  DB,
);
report(
  !badYear.ok && badYear.out.includes("tax_year_check"),
  "tax year 1999 is refused",
  badYear.out.split("\n")[0],
);

// ACCEPT CONTROL (rule 55). Greenway's first payroll on this system is
// 1 January 2027, so if 2027 were refused the constraint would break the very
// cutover it was written to protect.
const cutoverYear = psql(
  `insert into public.payroll_ytd_accumulators (employee_id, tax_year)
   values ((select id from public.employees limit 1), 2027);`,
  DB,
);
report(
  cutoverYear.ok,
  "tax year 2027 IS accepted — Greenway's first payroll year on this system",
  cutoverYear.out.split("\n")[0],
);
psql(`delete from public.payroll_ytd_accumulators;`, DB);

console.log("\n=== §5  THE PER-TAX COLUMNS ON payroll_run_lines ===");

// The whole point of §2 of the migration: the lump is RETAINED (rule 25) and
// the detail is added beside it.
const lumpKept = psql(
  `select count(*) = 1 from information_schema.columns
   where table_schema='public' and table_name='payroll_run_lines' and column_name='taxes_cents';`,
  DB,
);
report(
  lumpKept.ok && lumpKept.out === "t",
  "taxes_cents is RETAINED, not dropped (rule 25: extend, do not demolish)",
  lumpKept.out,
);

const NEW_LINE_COLUMNS = [
  "federal_income_tax_cents", "oasdi_employee_cents", "medicare_employee_cents",
  "addl_medicare_employee_cents", "wa_pfml_employee_cents", "wa_cares_employee_cents",
  "wa_lni_employee_cents", "oasdi_employer_cents", "medicare_employer_cents",
  "futa_employer_cents", "wa_suta_employer_cents", "wa_pfml_employer_cents",
  "wa_lni_employer_cents", "oasdi_wages_cents", "medicare_wages_cents",
  "futa_wages_cents", "wa_suta_wages_cents", "wa_pfml_wages_cents",
  "wa_cares_wages_cents", "lni_hundredth_hours",
];
const present = psql(
  `select count(*) from information_schema.columns
   where table_schema='public' and table_name='payroll_run_lines'
     and column_name in (${NEW_LINE_COLUMNS.map((c) => `'${c}'`).join(",")});`,
  DB,
);
report(
  present.ok && Number(present.out) === NEW_LINE_COLUMNS.length,
  `all ${NEW_LINE_COLUMNS.length} per-tax columns exist on payroll_run_lines`,
  `found ${present.out}`,
);

// Rule 62d: nullable with NO default. A zero default would assert "no social
// security was withheld" about historical rows where nobody recorded it.
const noDefaults = psql(
  `select count(*) from information_schema.columns
   where table_schema='public' and table_name='payroll_run_lines'
     and column_name in (${NEW_LINE_COLUMNS.map((c) => `'${c}'`).join(",")})
     and (column_default is not null or is_nullable = 'NO');`,
  DB,
);
report(
  noDefaults.ok && noDefaults.out === "0",
  "every new column is NULLABLE with NO DEFAULT (rule 62d: never invent a default)",
  `${noDefaults.out} column(s) carry a default or NOT NULL`,
);

console.log("\n=== §6  ROW LEVEL SECURITY ===");
const rls = psql(
  `select relrowsecurity from pg_class where oid = 'public.payroll_ytd_accumulators'::regclass;`,
  DB,
);
report(rls.ok && rls.out === "t", "row level security is ENABLED", rls.out);

const policies = psql(
  `select count(*) from pg_policies
   where schemaname='public' and tablename='payroll_ytd_accumulators';`,
  DB,
);
report(
  policies.ok && Number(policies.out) === 4,
  "all four owner-only policies exist (select/insert/update/delete)",
  `found ${policies.out}`,
);

console.log(`\npassed=${passed} failed=${failed}`);
if (failed > 0) {
  console.log("0199 GATE PROOF FAILED.");
  process.exit(1);
}
console.log("0199 CONSTRAINTS PROVEN TO BITE.");
