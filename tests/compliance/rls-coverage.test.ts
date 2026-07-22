/**
 * GW-019 + GW-020 — RLS coverage and security-hardening regression guard.
 *
 * Part 1 mirrors the embedded self-tests of the pure parser and pins its
 * behaviors (comment handling, static + dynamic RLS forms, gap analysis).
 *
 * Part 2 is the PERMANENT tripwire: it runs the parser over the REAL
 * `supabase/migrations/` directory on every PR. If anyone ever adds a table
 * without enabling row-level security — the exact mistake GW-019 found four
 * times — this suite goes red before the migration reaches the database.
 *
 * Part 3 pins the specific hardening decisions of 0130 by inspecting the
 * migration text itself, so a future edit cannot silently weaken them.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  extractCreatedTables,
  extractRlsEnabledTables,
  findRlsGaps,
  stripLineComments,
  __runRlsCoverageTests,
  type MigrationFile,
} from "@/lib/security/rls-coverage-core";

const migrationsDir = join(__dirname, "..", "..", "supabase", "migrations");

function loadRealMigrations(): MigrationFile[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));
}

describe("rls-coverage-core (GW-019 parser)", () => {
  it("embedded self-tests pass", () => {
    expect(() => __runRlsCoverageTests()).not.toThrow();
  });

  it("a commented-out CREATE TABLE is never counted", () => {
    expect(extractCreatedTables("-- create table public.ghost (id int);")).toEqual([]);
  });

  it("a commented-out RLS enable is never counted as coverage", () => {
    expect(
      extractRlsEnabledTables("-- alter table public.ghost enable row level security;"),
    ).toEqual([]);
  });

  it("a double-dash inside a string literal does not start a comment", () => {
    expect(stripLineComments("select 'a -- b';")).toContain("a -- b");
  });

  it("handles the repo's dynamic foreach RLS pattern (0039/0040/0113)", () => {
    const sql = `
      do $$
      declare t text;
      begin
        foreach t in array array['medical_endorsement_config','medical_exempt_sales'] loop
          execute format('alter table public.%I enable row level security;', t);
        end loop;
      end $$;
    `;
    expect(extractRlsEnabledTables(sql)).toEqual([
      "medical_endorsement_config",
      "medical_exempt_sales",
    ]);
  });

  it("a DO block without RLS text contributes no coverage (trigger loops)", () => {
    const sql = `
      do $$
      declare t text;
      begin
        foreach t in array array['some_table'] loop
          execute format('drop trigger if exists %I_t on public.%I;', t, t);
        end loop;
      end $$;
    `;
    expect(extractRlsEnabledTables(sql)).toEqual([]);
  });

  it("coverage is cross-file: create in one migration, secure in a later one", () => {
    const report = findRlsGaps([
      { name: "a.sql", sql: "create table public.t1 (id int);" },
      { name: "b.sql", sql: "alter table public.t1 enable row level security;" },
    ]);
    expect(report.gaps).toEqual([]);
  });
});

describe("REAL migrations: every table has RLS (GW-019 tripwire)", () => {
  const files = loadRealMigrations();
  const report = findRlsGaps(files);

  it("loads the full migration set (0130+ files)", () => {
    expect(files.length).toBeGreaterThanOrEqual(130);
  });

  it("parses a sane number of created tables (159 at the time of GW-019)", () => {
    expect(report.created.length).toBeGreaterThanOrEqual(159);
  });

  it("EVERY created table has row-level security enabled — zero gaps", () => {
    // If this fails, the listed tables are readable AND writable by anyone
    // holding the public anon key. Add RLS in the same migration that
    // creates the table (see 0130 for the pattern).
    expect(report.gaps).toEqual([]);
  });

  it("the four GW-019 tables are now covered by name", () => {
    for (const t of [
      "kb_product_categories",
      "noncannabis_products",
      "noncannabis_sku_sequences",
      "noncannabis_adjustments",
    ]) {
      expect(report.rlsEnabled).toContain(t);
    }
  });
});

describe("0130 hardening decisions stay pinned (GW-020)", () => {
  const sql = readFileSync(join(migrationsDir, "0130_security_rls_hardening.sql"), "utf8");
  const clean = stripLineComments(sql);

  it("employees: the broad staff read/write policies are dropped", () => {
    expect(clean).toMatch(/drop policy if exists employees_staff_read\s+on public\.employees/);
    expect(clean).toMatch(/drop policy if exists employees_staff_write on public\.employees/);
  });

  it("employees: exactly one manager+ SELECT policy is created, and no write policy", () => {
    expect(clean).toMatch(
      /create policy employees_mgr_read on public\.employees\s+for select using \(public\.is_manager\(\)\)/,
    );
    // No INSERT/UPDATE/DELETE/ALL policy may exist for employees.
    expect(clean).not.toMatch(/create policy \w+ on public\.employees\s+for (insert|update|delete|all)/i);
  });

  it("employees: sensitive columns are excluded from the API SELECT grant", () => {
    // The grant-back list must NOT contain any of the four sensitive columns.
    const grant = clean.match(/grant select \(([\s\S]*?)\) on table public\.employees/i);
    expect(grant).not.toBeNull();
    const cols = (grant as RegExpMatchArray)[1];
    for (const sensitive of [
      "clock_pin",
      "bank_routing",
      "bank_account_number",
      "bank_account_type",
    ]) {
      expect(cols).not.toContain(sensitive);
    }
    // And the table-level SELECT is revoked first (column grants are additive).
    expect(clean).toMatch(/revoke select on table public\.employees from anon, authenticated/);
  });

  it("employees: a database-level audit trigger is armed", () => {
    expect(clean).toMatch(/create trigger trg_employees_audit\s+after insert or update or delete on public\.employees/);
  });

  it("audit function: snapshots exclude the sensitive values themselves", () => {
    expect(clean).toContain(
      "array['clock_pin','bank_routing','bank_account_number','bank_account_type']",
    );
    expect(clean).toContain("- sensitive"); // jsonb minus the sensitive keys
    expect(clean).toContain("_sensitive_changed"); // names-only change flags
  });

  it("audit_logs: reads tighten to admin, and history is append-only even for the service role", () => {
    expect(clean).toMatch(
      /create policy audit_admin_read on public\.audit_logs\s+for select using \(public\.is_admin\(\)\)/,
    );
    expect(clean).toMatch(
      /revoke update, delete on table public\.audit_logs from anon, authenticated, service_role/,
    );
  });

  it("the 0076 view is flipped to security_invoker so it cannot bypass RLS", () => {
    expect(clean).toMatch(
      /alter view public\.kb_noncannabis_catalog set \(security_invoker = on\)/,
    );
  });

  it("workforce siblings: direct API writes are dropped", () => {
    expect(clean).toMatch(/drop policy if exists shifts_staff_write on public\.shifts/);
    expect(clean).toMatch(/drop policy if exists time_punches_staff_write on public\.time_punches/);
  });

  it("is_manager() mirrors roles.ts staffing.manage (owner/admin/manager)", () => {
    expect(clean).toMatch(
      /create or replace function public\.is_manager\(\)[\s\S]*?role in \('owner','admin','manager'\)/,
    );
  });
});
