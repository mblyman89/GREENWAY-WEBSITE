/**
 * tests/compliance/d82-factory-reset-scales.test.ts
 *
 * D-82. The owner pressed Reset and got
 *   "Reset failed: canceling statement due to statement timeout"
 * because the 0209 reset deleted 139 tables row by row, firing every row
 * trigger, inside Supabase's 8 second limit for signed-in API calls.
 * Migration 0240 re-creates gl_factory_reset to lock, count and TRUNCATE the
 * same tables in one statement, with its own time limits.
 *
 * These tests read the real files. The live proof (timings, refusals, exact
 * counts, rollback) is scripts/recon/factory-reset-scales-pg-check.sql,
 * run against Postgres 15 with every migration applied.
 *
 *   1. The 0240 table list IS the WIPE set, and is the list 0209 deletes.
 *   2. Every guard 0209 had is still in 0240, word for word where it matters.
 *   3. TRUNCATE is used safely: no CASCADE, no RESTART IDENTITY, preflight
 *      before, exact counts, cursor rewinds, one audit row.
 *   4. It is the LAST definition of each function in the migration chain.
 *   5. Owner hand-off: transit hazards, rollback, copy-button text identical
 *      to the migration, plain error for the exact message he saw, page wiring.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { transitHazards } from "../../scripts/compliance/strip-comments-for-sql-editor";
import { buildResetPlan, KEPT_CONNECTION_CURSOR_RESETS } from "@/lib/accounting/factory-reset-core";
import { listSchemaTables } from "@/lib/admin/schema-tables";
import { describeRpcError } from "@/lib/admin/reset-errors";
import {
  RESET_ENGINE_CURRENT,
  RESET_UPGRADE_FILE,
  RESET_UPGRADE_SQL,
} from "@/lib/admin/reset-upgrade-sql";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const MIG_DIR = "supabase/migrations";
const MIG = `${MIG_DIR}/0240_factory_reset_scales.sql`;
const RB = "supabase/rollbacks/0240_factory_reset_scales.rollback.sql";
const PG = "scripts/recon/factory-reset-scales-pg-check.sql";

const noComments = (s: string) =>
  s
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .map((l) => {
      const i = l.indexOf(" -- ");
      return i === -1 ? l : l.slice(0, i);
    })
    .join("\n");

/** Body between the dollar quotes of `create or replace function public.NAME(`. */
function fnBody(sql: string, name: string): string {
  const m = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i").exec(sql);
  if (!m) return "";
  const after = sql.slice(m.index);
  const open = /\$([a-z0-9_]*)\$/i.exec(after);
  if (!open) return "";
  const start = open.index + open[0].length;
  return after.slice(0, after.indexOf(open[0], start) + open[0].length);
}

const mig = read(MIG);
const reset = fnBody(mig, "gl_factory_reset");
const preview = fnBody(mig, "gl_factory_reset_preview");
const old = read(`${MIG_DIR}/0209_factory_reset.sql`);
const oldReset = fnBody(old, "gl_factory_reset");

/** The table array declared in the 0240 reset, in order. */
function wipeArray(): string[] {
  const m = /wipe\s+constant\s+text\[\]\s*:=\s*array\[([\s\S]*?)\];/i.exec(reset);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
}

// === 1. The list ===============================================================
describe("D-82 the 0240 reset empties exactly the WIPE set", () => {
  const plan = buildResetPlan(listSchemaTables());
  const list = wipeArray();

  it("the plan builds, so there is a WIPE set to compare against", () => {
    expect(plan.ok).toBe(true);
  });
  it("names 139 distinct tables", () => {
    expect(list.length).toBe(139);
    expect(new Set(list).size).toBe(list.length);
  });
  it("is exactly the set factory-reset-core.ts classifies WIPE, no more and no less", () => {
    const wipe = plan.ok ? plan.wipe.map((c) => c.table) : [];
    expect([...list].sort()).toEqual([...wipe].sort());
  });
  it("is exactly the list 0209 deleted, in the same order", () => {
    const order = [...old.matchAll(/delete from public\.([a-z0-9_]+) where true/g)].map((x) => x[1]);
    expect(list).toEqual(order);
  });
  it("never names a KEEP table (connections, books structure, people, audit log)", () => {
    const keep = plan.ok ? plan.keep.map((c) => c.table) : [];
    expect(list.filter((t) => keep.includes(t))).toEqual([]);
    for (const t of [
      "gl_accounts",
      "gl_entities",
      "gl_shareholders",
      "audit_logs",
      "staff_profiles",
      "plaid_items",
      "atm_connection",
      "product_fact_provenance",
      "intake_merge_decisions",
      "lookup_jobs",
      "lookup_job_items",
    ]) {
      expect(list, t).not.toContain(t);
    }
  });
});

// === 2. Guards kept ============================================================
describe("D-82 every guard 0209 had is still there", () => {
  it("same signature and security", () => {
    expect(mig).toMatch(
      /create or replace function public\.gl_factory_reset\(\s*\n\s*confirm_phrase\s+text,\s*\n\s*acknowledge_wac_314_55_087\s+boolean default false\s*\n\)/,
    );
    expect(reset).toMatch(/security definer\s*\n\s*set search_path = public/);
    expect(mig).toMatch(/grant execute on function public\.gl_factory_reset\(text, boolean\) to authenticated, service_role;/);
    expect(mig).toMatch(/revoke all on function public\.gl_factory_reset\(text, boolean\) from public;/);
  });
  it("owner gate is the first thing in both functions", () => {
    for (const body of [reset, preview]) {
      const begin = body.indexOf("\nbegin\n");
      const gate = body.indexOf("if not public.is_owner() then");
      expect(gate).toBeGreaterThan(begin);
      expect(body.slice(begin, gate).trim()).toMatch(/^begin(\s*--[^\n]*)*$/);
    }
    expect(reset).toContain("'RESET_NOT_OWNER: only the owner may run the factory reset.'");
  });
  it("the typed phrase, exactly as 0209", () => {
    expect(reset).toContain("if coalesce(btrim(confirm_phrase), '') <> 'ERASE ALL TEST DATA' then");
    expect(reset).toContain("RESET_BAD_CONFIRMATION: type exactly ERASE ALL TEST DATA to confirm. Nothing has been deleted.");
  });
  it("the retention guard asks the same four questions and refuses without the attestation", () => {
    for (const q of [
      "select count(*) into v_orders from public.orders where status = 'completed';",
      "select count(*) into v_excise from public.excise_return_batches;",
      "select count(*) into v_journals from public.gl_journals where status in ('posted','reversed');",
      "(select count(*) from public.ccrs_export_batches)",
      "(select count(*) from public.ccrs_adjustment_batches)",
    ]) {
      expect(reset, q).toContain(q);
      expect(oldReset, q).toContain(q);
    }
    expect(reset).toContain("v_trade := (v_orders > 0 or v_ccrs > 0 or v_excise > 0 or v_journals > 0);");
    expect(reset).toContain("if v_trade and not acknowledge_wac_314_55_087 then");
    expect(reset).toContain("RETENTION GUARD (WAC 314-55-087(1))");
    expect(reset).toMatch(/FIVE-year period \(WSR 24-19-040, effective 10\/12\/2024\)/);
  });
  it("every refusal comes BEFORE the lock and the truncate", () => {
    const code = noComments(reset);
    const truncate = code.search(/execute format\('truncate table %s', v_list\)/);
    const lock = code.search(/execute format\('lock table %s in access exclusive mode', v_list\)/);
    expect(lock).toBeGreaterThan(0);
    expect(truncate).toBeGreaterThan(lock);
    for (const r of [
      "RESET_NOT_OWNER",
      "RESET_BAD_CONFIRMATION",
      "RETENTION GUARD",
      "RESET_SCHEMA_DRIFT",
      "RESET_NO_PRIVILEGE",
      "RESET_KEPT_TABLE_POINTS_AT_WIPE",
    ]) {
      const at = code.indexOf(r);
      expect(at, r).toBeGreaterThan(0);
      expect(at, `${r} must be checked before anything is locked`).toBeLessThan(lock);
    }
    // No refusal after the point of no return.
    expect(code.slice(truncate)).not.toMatch(/raise\s+exception/i);
  });
  it("the door is marked on and off exactly as 0209, and no trigger is disabled", () => {
    expect(reset).toContain("perform set_config('greenway.factory_reset', 'on', true);");
    expect(reset).toContain("perform set_config('greenway.factory_reset', 'off', true);");
    expect(noComments(mig)).not.toMatch(/disable\s+trigger|session_replication_role|drop\s+trigger/i);
  });
});

// === 3. TRUNCATE used safely ===================================================
describe("D-82 TRUNCATE is used safely", () => {
  const code = noComments(reset);
  it("exactly one truncate statement, never CASCADE, never RESTART IDENTITY", () => {
    // Statements, not the word: the privilege name 'TRUNCATE' and the engine
    // label 'truncate-0240' are literals, not statements.
    expect(code.match(/truncate\s+table/gi)?.length).toBe(1);
    expect(code.replace(/'[^']*'/g, "''").match(/truncate/gi)).toBeNull();
    expect(noComments(mig)).not.toMatch(/\bcascade\b/i);
    expect(noComments(mig)).not.toMatch(/restart\s+identity/i);
    // and no row-by-row deletes are left behind
    expect(code).not.toMatch(/delete\s+from/i);
  });
  it("every identifier is quoted with %I, so a table name cannot become SQL", () => {
    expect(code).toContain("string_agg(format('public.%I', x), ', ' order by ord)");
    expect(code).toContain("execute format('select count(*) from public.%I', t) into n;");
  });
  it("the preflight checks existence, privilege and foreign keys from kept tables", () => {
    expect(code).toContain("where to_regclass('public.' || quote_ident(x)) is null;");
    expect(code).toContain("not has_table_privilege(c.oid, 'TRUNCATE')");
    expect(code).toMatch(/k\.contype = 'f'\s*\n\s*and k\.confrelid = any \(v_oids\)\s*\n\s*and not \(k\.conrelid = any \(v_oids\)\);/);
  });
  it("counts every table while it is locked, so the per-table figures are exact", () => {
    expect(code).toMatch(/foreach t in array wipe loop[\s\S]*?counts := counts \|\| jsonb_build_object\(t, n\);[\s\S]*?end loop;/);
    expect(code.indexOf("foreach t in array wipe loop")).toBeGreaterThan(code.indexOf("lock table"));
    expect(code.indexOf("foreach t in array wipe loop")).toBeLessThan(code.indexOf("truncate table"));
  });
  it("still rewinds every kept connection cursor 0209 rewound (D-65)", () => {
    for (const entry of KEPT_CONNECTION_CURSOR_RESETS) {
      expect(code, entry.table).toMatch(new RegExp(`update\\s+public\\.${entry.table}\\s+set`));
      for (const col of entry.columns) {
        expect(code, `${entry.table}.${col}`).toMatch(new RegExp(`${col}\\s*=\\s*null`));
      }
    }
  });
  it("writes exactly one audit row and returns the same shape the app reads", () => {
    expect(code.match(/insert into public\.audit_logs/g)?.length).toBe(1);
    expect(code).toContain("'ops.factory_reset'");
    for (const k of [
      "'ok', true",
      "'reset_at'",
      "'acknowledged_wac_314_55_087'",
      "'evidence_at_reset'",
      "'tables', counts",
      "'tables_emptied'",
      "'total_rows_deleted'",
      "'reset_engine', 'truncate-0240'",
    ]) {
      expect(code, k).toContain(k);
    }
  });
});

// === 4. Time limits, and this is the definition that wins =====================
describe("D-82 time limits and the migration chain", () => {
  it("all three functions declare statement_timeout 55s and lock_timeout 20s", () => {
    for (const body of [reset, preview]) {
      expect(body).toMatch(/set search_path = public\s*\n\s*set statement_timeout = '55s'\s*\n\s*set lock_timeout = '20s'\s*\n\s*as \$\$/);
    }
    expect(mig).toContain("alter function public.gl_audit_factory_reset() set statement_timeout = '55s';");
    expect(mig).toContain("alter function public.gl_audit_factory_reset() set lock_timeout = '20s';");
    expect(mig).toContain("notify pgrst, 'reload schema';");
  });
  it("no later migration redefines the reset or the preview", () => {
    const files = readdirSync(join(ROOT, MIG_DIR)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const i = files.indexOf("0240_factory_reset_scales.sql");
    expect(i).toBeGreaterThan(0);
    expect(files[i - 1]).toBe("0239_intake_merge_decisions.sql");
    for (const f of files.slice(i + 1)) {
      const s = noComments(read(`${MIG_DIR}/${f}`));
      expect(s, f).not.toMatch(/function\s+public\.gl_factory_reset(_preview)?\s*\(/i);
    }
  });
  it("refuses to run without 0209, by name", () => {
    expect(mig).toContain("MIGRATION_OUT_OF_ORDER: 0240 depends on gl_factory_reset_active() from 0209_factory_reset.sql");
  });
});

// === 5. Owner hand-off =========================================================
describe("D-82 owner hand-off", () => {
  it("migration and rollback have zero SQL-editor transit hazards", () => {
    for (const f of [MIG, RB]) {
      const h = transitHazards(read(f));
      expect(h.oddApostrophe, f).toBe(0);
      expect(h.withSemicolon, f).toBe(0);
      expect(h.bareRelationWord, f).toBe(0);
      expect(h.nonAscii, f).toBe(0);
    }
  });
  it("the rollback restores the 0209 row-by-row bodies and removes the time limits", () => {
    const rb = read(RB);
    expect([...rb.matchAll(/delete from public\.([a-z0-9_]+) where true/g)].length).toBe(139);
    expect(noComments(rb)).not.toMatch(/truncate|statement_timeout = '55s'/i);
    expect(rb).toContain("alter function public.gl_audit_factory_reset() reset statement_timeout;");
    expect(rb).toContain("alter function public.gl_audit_factory_reset() reset lock_timeout;");
  });
  it("the scenario script proves the fix under 8s and the defect after rollback, then rolls back", () => {
    const pg = read(PG);
    expect(pg).toContain("set local statement_timeout = '8s';");
    expect(pg).toContain("set local role authenticated;");
    expect(pg).toContain("0240_factory_reset_scales.rollback.sql");
    expect(pg).toContain("= '57014'");
    expect(pg).toContain("FACTORY RESET SCALES CHECK PASSED");
    expect(pg.trimEnd().endsWith("rollback;")).toBe(true);
  });
  it("the Copy button text is byte-for-byte the migration file", () => {
    expect(RESET_UPGRADE_FILE).toBe(MIG);
    expect(RESET_UPGRADE_SQL).toBe(mig);
    expect(mig).toContain(`'reset_engine', '${RESET_ENGINE_CURRENT}'`);
  });
  it("the exact error the owner saw becomes a plain instruction, and says nothing was deleted", () => {
    const msg = describeRpcError({ code: "57014", message: "canceling statement due to statement timeout" });
    expect(msg).not.toMatch(/^Reset failed: canceling/);
    expect(msg).toMatch(/Nothing was deleted/);
    expect(msg).toMatch(/upgrade/i);
    // also when the code is missing and only the words arrive
    expect(describeRpcError({ message: "canceling statement due to statement timeout" })).toBe(msg);
    const lock = describeRpcError({ code: "55P03", message: "canceling statement due to lock timeout" });
    expect(lock).toMatch(/Nothing was deleted/);
    expect(lock).not.toBe(msg);
  });
  it("the existing messages are unchanged", () => {
    expect(describeRpcError({ message: "RESET_NOT_OWNER: x" })).toMatch(/Only the owner/);
    expect(describeRpcError({ message: "RESET_BAD_CONFIRMATION: x" })).toMatch(/ERASE ALL TEST DATA/);
    const g = "RETENTION GUARD (WAC 314-55-087(1)): refusing to wipe - 3 completed sale(s)";
    expect(describeRpcError({ message: g })).toBe(g);
    expect(describeRpcError({ message: "RESET_KEPT_TABLE_POINTS_AT_WIPE: a kept table" })).toMatch(/Nothing was deleted/);
    expect(describeRpcError({ message: "something else" })).toBe("Reset failed: something else");
  });
  it("the page shows the upgrade box only when the preview ran and reports an older engine", () => {
    const page = read("src/app/admin/settings/reset/page.tsx");
    expect(page).toContain("export const maxDuration = 300;");
    expect(page).toContain(
      "const needsUpgrade = preview !== null && preview.resetEngine !== RESET_ENGINE_CURRENT;",
    );
    expect(page).toContain("{needsUpgrade ? <ResetUpgradeBox sql={RESET_UPGRADE_SQL} /> : null}");
    const svc = read("src/lib/admin/reset-service.ts");
    expect(svc).toContain('resetEngine: typeof raw.reset_engine === "string" ? raw.reset_engine : null,');
    expect(svc.match(/describeRpcError\(error\)/g)?.length).toBe(3);
    const box = read("src/components/admin/settings/ResetUpgradeBox.tsx");
    expect(box).toContain("https://supabase.com/dashboard/project/_/sql/new");
    expect(box).toContain("Run query");
    expect(box).toContain("Success. No rows returned");
  });
});
