/**
 * tests/compliance/r-ret-service-role-grants.test.ts  (slice R-RET, owner message 10)
 *
 * Owner, verbatim: "the front register says, "the return was not saved and
 * nothing was changed: permission denied for function record_customer_return."
 * ... the back office keeps saying "⚠ No completed sales matched. Only
 * completed orders can be returned.""
 *
 * Root causes (reproduced on PostgreSQL 15 by
 * scripts/recon/service-role-grants-0330-pg-check.sql):
 *   1. Supabase stopped auto-granting new objects in `public` on 2026-10-30.
 *      0308 revoked EXECUTE from public/anon/authenticated and never granted
 *      service_role (the role the server uses), so record_customer_return was
 *      uncallable. 0330 grants it back, plus every other object the server
 *      could not reach.
 *   2. The back-office search could not find a register sale by anything
 *      printed on the receipt.
 *
 * These guards stop both from coming back:
 *   - every migration that revokes EXECUTE on a function must grant it to
 *     service_role (or be one 0330 covers, or be a trigger function);
 *   - every migration after 0330 that creates a table grants service_role;
 *   - the server callers turn 42501 into a plain "run 0330" message;
 *   - the back-office search uses the receipt / fun name / member lookups.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  __runRpcFallbackCoreTests,
  dbErrorForStaff,
  isMissingDbFunctionError,
  isPermissionDeniedError,
} from "@/lib/db/rpc-fallback-core";

const ROOT = process.cwd();
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const MIG_DIR = "supabase/migrations";
const migrations = readdirSync(join(ROOT, MIG_DIR))
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();
const MIG_0330 = "0330_service_role_grants.sql";

/** Strip `-- comments` so prose never counts as SQL. */
const sqlOnly = (t: string) => t.replace(/--[^\n]*/g, "");
const normSig = (name: string, args: string) =>
  `${name.toLowerCase().replace(/^public\./, "")}(${args.toLowerCase().replace(/\s+/g, "").replace(/timestampwithtimezone/g, "timestamptz")})`;

/** Functions whose EXECUTE is revoked from callers by a migration, mapped to the file. */
function revokedFunctions(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of migrations) {
    const t = sqlOnly(src(`${MIG_DIR}/${f}`));
    for (const m of t.matchAll(/revoke\s+(?:all|execute)\s+on\s+function\s+([\w.]+)\s*\(([^)]*)\)\s+from\s+([^;]+);/gi)) {
      out.set(normSig(m[1], m[2]), f);
    }
  }
  return out;
}

/** Functions granted to service_role anywhere (by name+args, or by a format() loop list). */
function serviceRoleGranted(): Set<string> {
  const out = new Set<string>();
  for (const f of migrations) {
    const t = sqlOnly(src(`${MIG_DIR}/${f}`));
    for (const m of t.matchAll(/grant\s+(?:all|execute)\s+on\s+function\s+([\w.]+)\s*\(([^)]*)\)\s+to\s+([^;]+);/gi)) {
      if (/service_role/i.test(m[3])) out.add(normSig(m[1], m[2]));
    }
    // 0330 and older loops: a quoted 'public.fn(args)' list driving `grant execute ... to service_role`.
    if (/grant execute on function %s to [^']*service_role/i.test(t)) {
      for (const m of t.matchAll(/'public\.(\w+)\(([^)]*)\)'/g)) out.add(normSig(m[1], m[2]));
    }
  }
  return out;
}

/** Trigger functions need no EXECUTE grant (the trigger runs them). */
function triggerFunctions(): Set<string> {
  const out = new Set<string>();
  for (const f of migrations) {
    const t = sqlOnly(src(`${MIG_DIR}/${f}`));
    for (const m of t.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(([^)]*)\)\s*returns\s+trigger/gi)) {
      out.add(normSig(m[1], m[2]));
    }
  }
  return out;
}

describe("R-RET: the server (service_role) can call what migrations lock down", () => {
  it("0330 exists with a rollback and a PG scenario check wired into the execution gate", () => {
    expect(migrations).toContain(MIG_0330);
    expect(migrations[migrations.length - 1] >= MIG_0330).toBe(true);
    expect(existsSync(join(ROOT, "supabase/rollbacks/0330_service_role_grants.rollback.sql"))).toBe(true);
    expect(src("scripts/compliance/verify-migrations-execute.ts")).toMatch(
      /service-role-grants-0330-pg-check\.sql", mustPrint: "GRANTS 0330 CHECK PASSED"/,
    );
    expect(src("docs/MIGRATIONS_TO_RUN.md")).toMatch(/0330_service_role_grants\.sql/);
  });

  it("0330 grants the owner's function (record_customer_return) to service_role", () => {
    const t = src(`${MIG_DIR}/${MIG_0330}`);
    expect(t).toContain("'public.record_customer_return(uuid, numeric, text, uuid, boolean, jsonb, jsonb)'");
    expect(t).toMatch(/grant execute on function %s to service_role/);
    expect(t).toMatch(/to_regprocedure\(sig\) is null/); // safe on a database that never ran 0308
    expect(t).toMatch(/notify pgrst, 'reload schema'/);
  });

  it("0330 never grants anything to anon or authenticated", () => {
    const t = sqlOnly(src(`${MIG_DIR}/${MIG_0330}`));
    for (const m of t.matchAll(/grant\s[^;]*?\sto\s+([^;']+)/gi)) {
      expect(m[1]).not.toMatch(/\banon\b|\bauthenticated\b|\bpublic\b/i);
    }
  });

  it("0330 never widens the append-only ledgers (update/delete stay revoked)", () => {
    const t = src(`${MIG_DIR}/${MIG_0330}`);
    for (const ledger of ["audit_logs", "ach_timberland_comms", "ofac_screening_runs", "ach_control_records", "ach_files"]) {
      expect(t).toContain(`'${ledger}'`);
    }
    expect(t).toMatch(/grant select, insert on table public\.%I to service_role/);
  });

  it("every function a migration revokes EXECUTE on is granted to service_role (or is a trigger)", () => {
    const revoked = revokedFunctions();
    const granted = serviceRoleGranted();
    const triggers = triggerFunctions();
    const missing = [...revoked.entries()]
      .filter(([sig]) => !granted.has(sig) && !triggers.has(sig))
      .map(([sig, file]) => `${file}: ${sig}`);
    expect(missing).toEqual([]);
  });

  it("every migration after 0330 that creates a table grants it to service_role", () => {
    const after = migrations.filter((f) => f > MIG_0330);
    const problems: string[] = [];
    for (const f of after) {
      const t = sqlOnly(src(`${MIG_DIR}/${f}`));
      for (const m of t.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gi)) {
        const table = m[1];
        const re = new RegExp(`grant[^;]*on\\s+(?:table\\s+)?[^;]*\\b(?:public\\.)?${table}\\b[^;]*to[^;]*service_role`, "i");
        if (!re.test(t)) problems.push(`${f}: ${table}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("R-RET: permission denied is explained, never mistaken for 'not migrated'", () => {
  it("pure self-tests pass", () => {
    expect(() => __runRpcFallbackCoreTests()).not.toThrow();
  });

  it("the owner's exact error becomes a 'run 0330' instruction", () => {
    const e = { code: "42501", message: "permission denied for function record_customer_return" };
    expect(isPermissionDeniedError(e)).toBe(true);
    expect(isMissingDbFunctionError(e)).toBe(false);
    expect(dbErrorForStaff(e)).toMatch(/record_customer_return/);
    expect(dbErrorForStaff(e)).toMatch(/0330_service_role_grants\.sql/);
  });

  it("every server caller of the 0308/0309/0323 functions uses the explanation", () => {
    const disp = src("src/lib/inventory/disposition.ts");
    expect(disp).toContain("The return was not saved and nothing was changed: ${dbErrorForStaff(rpcErr)}");
    expect(disp.match(/dbErrorForStaff\(error\)/g)?.length ?? 0).toBeGreaterThanOrEqual(4); // consume hold + 3 vendor-return RPCs
    expect(src("src/lib/noncannabis/returns.ts")).toContain("${dbErrorForStaff(error)}");
    expect(src("src/lib/noncannabis/register-stock.ts")).toContain("error: dbErrorForStaff(error)");
    expect(src("src/lib/noncannabis/invoice-store.ts")).toContain('dbErrorForStaff(error, "save failed")');
  });
});

describe("R-RET G-70 superseded by D66 (Fix Phase 7.1): no back-office return search", () => {
  // The owner's error ("No completed sales matched. Only completed orders can
  // be returned.") came from the Customer return wizard's search. D66 ("Q4-
  // remove it.") removed the wizard, so its search went with it. Returns are
  // found by the printed receipt on the Returns desk and the register.
  it("the wizard, its search and its core are gone; nothing still shows the old dead end", () => {
    expect(existsSync(join(ROOT, "src/components/admin/inventory/CustomerReturnWizard.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "src/lib/inventory/return-search-core.ts"))).toBe(false);
    expect(src("src/lib/inventory/disposition.ts")).not.toMatch(/export async function searchReturnableOrderLines/);
    expect(src("src/app/admin/inventory/disposition/actions.ts")).not.toMatch(/findReturnableLinesAction|createCustomerReturnAction/);
    expect(src("scripts/compliance/run-pure-selftests.ts")).not.toContain("__runReturnSearchCoreTests");
  });

  it("the Returns desk still finds a sale by the printed receipt", () => {
    const store = src("src/lib/pos/returns-store.ts");
    expect(store).toMatch(/export async function lookupSaleByReceipt/);
    expect(store).toMatch(/clientUuidMatchesReceipt\(r\.client_uuid, wanted\)/);
    expect(src("src/app/admin/registers/returns/actions.ts")).toContain("lookupSaleByReceipt(");
  });
});
