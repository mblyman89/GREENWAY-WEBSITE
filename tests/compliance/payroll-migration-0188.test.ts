/**
 * tests/compliance/payroll-migration-0188.test.ts
 *
 * THE MIGRATION IS CODE TOO.
 *
 * payroll-cogs-core.ts is covered by ~150 assertions and 1,300 fuzz iterations.
 * None of that watches the SQL. This file does, because the two have to agree:
 * the TypeScript decides the treatment, and the database has to be seeded with
 * the same taxonomy, pointed at the same accounts, and gated by the same rules.
 * When they disagree, the one nobody tests is the one that drifts.
 *
 * These tests read the migration off disk as text. That is deliberate. They are
 * drift alarms, not a SQL interpreter: they prove the file still SAYS the things
 * the design depends on, and they fail loudly the day someone edits it in a way
 * that quietly changes the tax answer.
 *
 * (The live behaviour of this migration - that it applies, is idempotent, and
 * actually refuses what it claims to refuse - was verified by applying all 188
 * migrations to a real PostgreSQL 15 instance and posting a real payroll
 * journal through gl_post_payroll_run. See the slice notes.)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  LABOR_ROLES,
  PAYROLL_COGS_ACCOUNT,
  WAGE_EXPENSE_ACCOUNT,
  ACCRUED_PAYROLL_ACCOUNT,
  WITHHELD_TAX_ACCOUNT,
  EMPLOYER_TAX_PAYABLE_ACCOUNT,
  GARNISHMENT_ACCOUNT,
  EMPLOYEE_ADVANCE_ACCOUNT,
} from "../../src/lib/accounting/payroll-cogs-core";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");
const SQL = readFileSync(path.join(MIGRATIONS_DIR, "0188_payroll_to_gl.sql"), "utf8");

/**
 * The migration with every `--` comment removed.
 *
 * This file is heavily commented on purpose: it has to teach as well as run.
 * That makes a raw-text scan dangerous in BOTH directions -- a "this migration
 * does not do X" assertion can fail because the file says, in prose, that it
 * does not do X. Structural claims about what the SQL DOES are therefore made
 * against this stripped version.
 *
 * String literals are left intact: no `--` appears inside one in this file, and
 * a half-clever quote-aware stripper would be more likely to introduce a bug
 * than to prevent one.
 */
const EXEC_SQL = SQL.split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("0188 exists, is numbered cleanly, and is the file we think it is", () => {
  it("is the only migration numbered 0188", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith("0188"));
    expect(files).toEqual(["0188_payroll_to_gl.sql"]);
  });

  it("introduces no duplicate migration numbers anywhere in the folder", () => {
    // Michael personally caught a duplicated 0179 in an earlier slice. Once is
    // a mistake; twice would be a pattern, so the numbering is now policed.
    const numbers = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, 4));
    const dupes = numbers.filter((n, i) => numbers.indexOf(n) !== i);
    expect(dupes, `duplicate migration numbers: ${[...new Set(dupes)].join(", ")}`).toEqual([]);
  });

  it("was read off disk and is substantial (guards every assertion below)", () => {
    expect(SQL.length).toBeGreaterThan(20_000);
  });
});

describe("0188 refuses to run out of order", () => {
  it("checks for is_owner(), the ledger, the posting service, payroll and employees", () => {
    expect(SQL).toContain("MIGRATION_OUT_OF_ORDER");
    for (const dep of [
      "public.is_owner()",
      "public.gl_journals",
      "public.gl_submit_journal",
      "public.payroll_runs",
      "public.employees",
    ]) {
      expect(SQL, `0188 should guard its dependency on ${dep}`).toContain(dep);
    }
  });

  it("uses a prefix that the refusal catalogue deliberately does not police", () => {
    // The gl-refusal-core drift test scans for GL_/TB_ codes. A migration-order
    // failure is not something the owner can act on inside the app, so it is
    // deliberately NOT a GL_ code. This pins that decision.
    expect(SQL).not.toMatch(/raise\s+exception\s+'GL_MIGRATION/i);
  });
});

describe("the SQL taxonomy mirrors the TypeScript taxonomy", () => {
  /** The seeded rows, parsed out of the INSERT ... VALUES block. */
  function seededRoles(): { code: string; account: string; costClass: string }[] {
    const start = SQL.indexOf("insert into public.gl_payroll_labor_roles");
    expect(start).toBeGreaterThan(-1);
    const end = SQL.indexOf("on conflict (code) do update", start);
    expect(end).toBeGreaterThan(start);
    const block = SQL.slice(start, end);

    const rows: { code: string; account: string; costClass: string }[] = [];
    // ('code', 'label', 'treatment', 'account', 'cost_class', bool, ...)
    const re =
      /\(\s*'([a-z_]+)'\s*,\s*'(?:[^']|'')*'\s*,\s*'([a-z_]+)'\s*,\s*'(\d{5})'\s*,\s*'([a-z_0-9]+)'/g;
    for (const m of block.matchAll(re)) {
      rows.push({ code: m[1], account: m[3], costClass: m[4] });
    }
    return rows;
  }

  it("parses the seed block (guards the guard)", () => {
    expect(seededRoles().length).toBeGreaterThan(5);
  });

  it("seeds EXACTLY the roles the TypeScript core knows about", () => {
    const sqlCodes = seededRoles().map((r) => r.code).sort();
    const tsCodes = LABOR_ROLES.map((r) => r.code).slice().sort();
    // If these ever diverge, one of the two is teaching Michael a treatment the
    // other one will not honour.
    expect(sqlCodes).toEqual(tsCodes);
  });

  it("points every role at the SAME account and cost class as the TypeScript", () => {
    const byCode = new Map(seededRoles().map((r) => [r.code, r]));
    for (const role of LABOR_ROLES) {
      const sql = byCode.get(role.code);
      expect(sql, `role ${role.code} missing from the migration`).toBeDefined();
      expect(sql!.account, `role ${role.code} account`).toBe(role.accountCode);
      expect(sql!.costClass, `role ${role.code} cost class`).toBe(role.costClass);
    }
  });

  it("never seeds a selling or admin role into a cost-of-goods account", () => {
    // The single most expensive mistake, asserted directly against the file.
    for (const r of seededRoles()) {
      const ts = LABOR_ROLES.find((x) => x.code === r.code)!;
      if (ts.treatment === "selling" || ts.treatment === "admin" || ts.treatment === "owner") {
        expect(r.account, `${r.code} must not be a COGS account`).not.toMatch(/^6/);
        expect(r.costClass).not.toMatch(/^cogs/);
      }
    }
  });

  it("never seeds cogs_direct - a reseller has no direct labor", () => {
    for (const r of seededRoles()) expect(r.costClass).not.toBe("cogs_direct");
  });
});

describe("the structural guarantees are written into the schema, not just hoped for", () => {
  it("forbids a never-inventoriable role from pointing at a COGS account", () => {
    expect(SQL).toContain("gl_payroll_role_never_cogs_chk");
    expect(SQL).toMatch(/check\s*\(\s*not\s*\(\s*never_inventoriable\s+and\s+account_code\s+like\s+'6%'\s*\)\s*\)/i);
  });

  it("forbids cogs_direct outright", () => {
    expect(SQL).toContain("gl_payroll_role_allocable_only_chk");
    expect(SQL).toMatch(/check\s*\(\s*cost_class\s*<>\s*'cogs_direct'\s*\)/i);
  });

  it("requires a COGS account to carry a COGS cost class", () => {
    expect(SQL).toContain("gl_payroll_role_cogs_class_chk");
  });

  it("requires a written basis for every allocation, exactly as rent already does", () => {
    // gl_allocation_configs (0172) made document_ref and basis_note NOT NULL for
    // rent. Labor is the bigger number, so it gets the same non-negotiable.
    expect(SQL).toMatch(/document_ref\s+text\s+not null\s+check\s*\(\s*length\(btrim\(document_ref\)\)\s*>=\s*3\s*\)/i);
    expect(SQL).toMatch(/basis_note\s+text\s+not null\s+check\s*\(\s*length\(btrim\(basis_note\)\)\s*>=\s*3\s*\)/i);
  });

  it("keeps allocation shares as INTEGER milli-percent, never a float", () => {
    expect(SQL).toMatch(/share_milli_pct\s+integer\s+not null/i);
    expect(SQL).toMatch(/share_milli_pct\s*>=\s*0\s+and\s+share_milli_pct\s*<=\s*100000/i);
    expect(SQL).not.toMatch(/share_milli_pct\s+(numeric|float|real|double)/i);
  });

  it("arms a trigger, because the rule spans two tables and a CHECK cannot see both", () => {
    expect(SQL).toContain("gl_payroll_allocation_guard");
    expect(SQL).toContain("create trigger gl_payroll_allocations_guard");
  });
});

describe("the evidence surface is built, additively", () => {
  it("adds task attribution to the time clock", () => {
    // Without this, the narrow door of Reg. 1.471-3(b) is purely theoretical:
    // time_punches (0037) records only clock-in/clock-out.
    expect(SQL).toContain("add column if not exists labor_role_code");
    expect(SQL).toContain("add column if not exists inbound_manifest_id");
  });

  it("does NOT touch the existing punch_kind CHECK", () => {
    // Loosening it would change how the time clock behaves for staff who have
    // nothing to do with the books.
    //
    // This assertion has to run against EXECUTABLE SQL only. The migration
    // explains, in its comments, that time_punches records
    // "punch_kind in ('work','break')" and that it deliberately does not touch
    // that constraint -- so a naive scan of the raw file matches the very
    // sentence promising the opposite of what it looks like. Strip the comments
    // and the guard means what it says.
    const executable = EXEC_SQL;
    expect(executable).not.toMatch(/drop\s+constraint\s+.*punch_kind/i);
    expect(executable).not.toMatch(/punch_kind/i);
    // ...and prove the stripper did not simply delete the file.
    expect(executable).toContain("create table if not exists public.gl_payroll_labor_roles");
  });

  it("adds every new column with IF NOT EXISTS, so a re-run is silent", () => {
    const addColumns = [...SQL.matchAll(/add column\s+(if not exists\s+)?(\w+)/gi)];
    expect(addColumns.length).toBeGreaterThan(3);
    for (const m of addColumns) {
      expect(m[1], `column ${m[2]} is added without IF NOT EXISTS`).toBeTruthy();
    }
  });
});

describe("posting is a thin bridge, and payroll can never auto-post", () => {
  it("delegates to gl_submit_journal rather than writing lines itself", () => {
    expect(EXEC_SQL).toContain("public.gl_submit_journal(");
    // If 0188 ever inserted straight into the ledger it would bypass balance
    // checks, period locks, idempotency and the approval threshold at once.
    expect(EXEC_SQL).not.toMatch(/insert\s+into\s+public\.gl_journal_lines/i);
    expect(EXEC_SQL).not.toMatch(/insert\s+into\s+public\.gl_journals\b/i);
  });

  it("hard-codes auto-post to false", () => {
    expect(EXEC_SQL).toMatch(/p_auto_post\s*=>\s*false/);
    expect(EXEC_SQL).not.toMatch(/p_auto_post\s*=>\s*true/);
  });

  it("does NOT add a posting template for payroll", () => {
    // gl_posting_templates.source_kind (0174) allows only
    // ('pos_sale','excise','purchase','bank'). Payroll is excluded BY DESIGN,
    // because the 280E labor split is a human judgement every period.
    expect(EXEC_SQL).not.toMatch(/insert\s+into\s+public\.gl_posting_templates/i);
  });

  it("audits for the existence of a payroll template as a tripwire", () => {
    expect(SQL).toContain("must never be auto-postable");
  });

  it("posts with source_kind 'payroll', which 0172 already allows", () => {
    expect(SQL).toMatch(/p_source_kind\s*=>\s*'payroll'/);
  });

  it("is owner-only, and says why that is narrower than admin", () => {
    expect(SQL).toContain("GL_NOT_OWNER");
    expect(SQL).toContain("public.is_owner()");
  });

  it("refuses a payroll line that carries no 280E label", () => {
    // The silent-wrong-answer: gl_submit_journal defaults a missing cost_class
    // to 'none', so an unlabelled payroll journal BALANCES and is still wrong.
    expect(SQL).toContain("GL_PAYROLL_NO_COST_CLASS");
    expect(SQL).toContain("GL_PAYROLL_UNCLASSIFIED_EXPENSE");
    expect(SQL).toContain("GL_PAYROLL_COGS_CLASS_MISMATCH");
    expect(SQL).toContain("GL_PAYROLL_DIRECT_LABOR_CLAIMED");
  });

  it("reads the account TYPE from the chart rather than guessing from the digit", () => {
    expect(SQL).toMatch(/select\s+a\.type\s+into\s+v_type/i);
  });

  it("refuses to silently overwrite a payroll that has already been posted", () => {
    expect(SQL).toContain("GL_PAYROLL_RUN_CHANGED");
    expect(SQL).toContain("gl_content_fingerprint");
  });
});

describe("security", () => {
  it("enables row level security on both new tables and gates them to the owner", () => {
    for (const t of ["gl_payroll_labor_roles", "gl_payroll_allocations"]) {
      expect(SQL).toContain(`alter table public.${t} enable row level security`);
      expect(SQL).toContain(`_owner_all\n  on public.${t}`);
    }
    // An is_admin() gate anywhere in the executable body would quietly hand the
    // books back to an admin, which is the exact thing 0185 was written to stop.
    expect(EXEC_SQL).not.toContain("is_admin()");
  });

  it("revokes the new functions from PUBLIC", () => {
    for (const fn of ["gl_post_payroll_run", "gl_audit_payroll_wiring"]) {
      expect(SQL).toMatch(new RegExp(`revoke all on function public\\.${fn}`));
    }
  });

  it("pins search_path on every security definer function", () => {
    const definers = SQL.split("security definer").length - 1;
    const pinned = SQL.split("set search_path = public").length - 1;
    // A security definer function without a pinned search_path is a privilege
    // escalation waiting for someone to create a lookalike table.
    expect(pinned).toBeGreaterThanOrEqual(definers);
  });
});

describe("the self-check reports problems only", () => {
  it("returns (area, problem) and says that empty means correct", () => {
    expect(SQL).toContain("returns table (area text, problem text)");
    expect(SQL).toContain("AN EMPTY RESULT MEANS EVERYTHING IS CORRECT");
  });

  it("covers every area the slice depends on", () => {
    for (const area of [
      "'labor_role'",
      "'section_280e'",
      "'substantiation'",
      "'allocation'",
      "'evidence'",
      "'bridge'",
      "'posting'",
      "'security'",
    ]) {
      expect(SQL, `the audit should cover ${area}`).toContain(area);
    }
  });
});

describe("the authorities are quoted verbatim in the migration itself", () => {
  it("keeps the decisive reseller/producer distinction where a DBA will read it", () => {
    expect(SQL).toContain("transportation or other necessary charges incurred in");
    expect(SQL).toContain("acquiring possession of the goods");
    expect(SQL).toContain("expenditures for direct labor");
    expect(SQL).toContain("not including any cost of selling");
    expect(SQL).toContain("Resellers must capitalize the acquisition costs");
  });

  it("names the cases that decided it", () => {
    expect(SQL).toContain("Patients Mutual");
    expect(SQL).toContain("Richmond Patients Group");
    expect(SQL).toContain("Alternative Health Care Advocates");
  });

  it("records the owner's request verbatim", () => {
    expect(SQL).toContain(
      "I would like the ability to assign employees as cogs so I can write them",
    );
  });
});

describe("cross-file parity with the rest of the books", () => {
  const chart = readFileSync(path.join(MIGRATIONS_DIR, "0173_chart_of_accounts.sql"), "utf8");

  it("every account 0188 posts to is actually seeded by 0173", () => {
    const accounts = [
      PAYROLL_COGS_ACCOUNT,
      WAGE_EXPENSE_ACCOUNT,
      ACCRUED_PAYROLL_ACCOUNT,
      WITHHELD_TAX_ACCOUNT,
      EMPLOYER_TAX_PAYABLE_ACCOUNT,
      GARNISHMENT_ACCOUNT,
      EMPLOYEE_ADVANCE_ACCOUNT,
    ];
    for (const code of accounts) {
      expect(chart, `account ${code} is not seeded in 0173`).toContain(`'${code}'`);
    }
  });

  it("0173 already demanded the allocation study that 0188 finally enforces", () => {
    // This is the sentence 0173 wrote about account 61000 and could not enforce.
    expect(chart).toContain("gl_allocation_configs");
  });
});
