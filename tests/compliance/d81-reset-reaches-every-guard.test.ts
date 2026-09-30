/**
 * tests/compliance/d81-reset-reaches-every-guard.test.ts
 *
 * D-81 - the factory reset (0209, gl_factory_reset) aborted with "Reset
 * failed" because some guards on the tables it empties never got the
 * transaction-local hatch gl_factory_reset_active(). The owner asked:
 *
 *   "Please refresh the git repo, then proceed to fix the reset data feature
 *    so I can clean out all my dirty test data."
 *
 *   1. THE CLASS, not the instance. Reads every migration in order (the last
 *      definition of a function or trigger wins, a drop removes a trigger)
 *      and, for every table 0209 deletes:
 *        a. every BEFORE ... DELETE trigger whose function raises must call
 *           gl_factory_reset_active() before its first `raise exception`.
 *        b. every column that references another wiped table ON DELETE SET
 *           NULL, where 0209 deletes the referenced table FIRST, makes Postgres
 *           UPDATE the row mid-reset, so every BEFORE ... UPDATE trigger that
 *           raises on that table must also call the hatch first.
 *   2. Migration 0238 text pins: precheck before any DDL, the four hatches,
 *      UPDATE still refused, the audit rewrite limited to the FK columns.
 *   3. Rollback + committed PG scenario script + zero transit hazards.
 *   4. Order and owner hand-off (docs/MIGRATIONS_TO_RUN.md, docs/DEFECTS.md).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { transitHazards } from "../../scripts/compliance/strip-comments-for-sql-editor";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const MIG_DIR = "supabase/migrations";
const MIG = `${MIG_DIR}/0238_factory_reset_reaches_every_guard.sql`;
const RB = "supabase/rollbacks/0238_factory_reset_reaches_every_guard.rollback.sql";
const PG = "scripts/recon/factory-reset-guards-pg-check.sql";
const HATCH = "gl_factory_reset_active";

/** Strip `--` line comments (outside of nothing clever: good enough for DDL scanning). */
const noComments = (s: string) =>
  s
    .split("\n")
    .map((l) => {
      const i = l.indexOf("--");
      return i === -1 ? l : l.slice(0, i);
    })
    .join("\n");

function migrationFiles(): string[] {
  return readdirSync(join(ROOT, MIG_DIR))
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

type Trigger = { name: string; table: string; timing: string; events: string[]; fn: string };

type Schema = {
  functions: Map<string, string>; // name -> body (last definition wins)
  triggers: Map<string, Trigger>; // `${table}.${name}` -> trigger
  setNullFks: Array<{ table: string; column: string; references: string }>;
};

/**
 * Read every migration in order. Function bodies are the text between the
 * dollar-quote that follows `create [or replace] function public.X(` and its
 * matching close. Triggers are `create trigger N before|after E on public.T
 * ... execute function|procedure public.F(`. FKs are `col type references
 * public.R(...) on delete set null` inside `create table public.T (` or an
 * `alter table public.T add column`.
 */
function readSchema(files: string[] = migrationFiles()): Schema {
  const functions = new Map<string, string>();
  const triggers = new Map<string, Trigger>();
  const setNullFks: Schema["setNullFks"] = [];

  for (const f of files) {
    const raw = read(`${MIG_DIR}/${f}`);

    // Functions (raw text: bodies may legitimately contain `--` inside strings).
    const fnRe = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = fnRe.exec(raw))) {
      const after = raw.slice(m.index);
      const open = /\$([a-z0-9_]*)\$/i.exec(after);
      if (!open) continue;
      const tag = open[0];
      const start = open.index + tag.length;
      const end = after.indexOf(tag, start);
      if (end === -1) continue;
      functions.set(m[1].toLowerCase(), after.slice(start, end));
    }

    const sql = noComments(raw);

    // Trigger drops and creates, in file order.
    const trgRe =
      /drop\s+trigger\s+if\s+exists\s+([a-z0-9_]+)\s+on\s+public\.([a-z0-9_]+)|create\s+(?:or\s+replace\s+)?trigger\s+([a-z0-9_]+)\s+(before|after|instead\s+of)\s+([a-z\s,]+?)\s+on\s+public\.([a-z0-9_]+)[\s\S]*?execute\s+(?:function|procedure)\s+public\.([a-z0-9_]+)\s*\(/gi;
    while ((m = trgRe.exec(sql))) {
      if (m[1]) {
        triggers.delete(`${m[2].toLowerCase()}.${m[1].toLowerCase()}`);
      } else {
        const events = m[5]
          .toLowerCase()
          .split(/\s+or\s+/)
          .map((e) => e.trim().split(/\s+/)[0]);
        const t: Trigger = {
          name: m[3].toLowerCase(),
          table: m[6].toLowerCase(),
          timing: m[4].toLowerCase(),
          events,
          fn: m[7].toLowerCase(),
        };
        triggers.set(`${t.table}.${t.name}`, t);
      }
    }

    // ON DELETE SET NULL foreign keys, attributed to the table being created/altered.
    const blockRe =
      /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z0-9_]+)\s*\(([\s\S]*?)\n\s*\)\s*;|alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?public\.([a-z0-9_]+)([\s\S]*?);/gi;
    while ((m = blockRe.exec(sql))) {
      const table = (m[1] ?? m[3]).toLowerCase();
      const body = m[2] ?? m[4];
      const fkRe =
        /(?:add\s+column\s+(?:if\s+not\s+exists\s+)?)?([a-z0-9_]+)\s+[a-z0-9_]+(?:\s+not\s+null)?\s+references\s+public\.([a-z0-9_]+)\s*\([^)]*\)\s+on\s+delete\s+set\s+null/gi;
      let k: RegExpExecArray | null;
      while ((k = fkRe.exec(body))) {
        setNullFks.push({ table, column: k[1].toLowerCase(), references: k[2].toLowerCase() });
      }
    }
  }
  return { functions, triggers, setNullFks };
}

/** Tables 0209 empties, in the order it empties them. */
function resetDeleteOrder(): string[] {
  const body = read(`${MIG_DIR}/0209_factory_reset.sql`);
  return [...body.matchAll(/delete from public\.([a-z0-9_]+) where true/g)].map((x) => x[1]);
}

function raises(body: string): boolean {
  return /raise\s+exception/i.test(noComments(body));
}
function hatchedBeforeFirstRaise(body: string, event: "delete" | "update" = "delete"): boolean {
  const b = noComments(body);
  const r = b.search(/raise\s+exception/i);
  if (r === -1) return false;
  const pre = b.slice(0, r);
  // The hatch has to cover THIS event: some `if <cond> then` ahead of the
  // refusal whose condition calls the hatch and is not limited to the OTHER
  // event, plus the matching return before the refusal. 0209's audit guard
  // had `if tg_op = 'DELETE' and gl_factory_reset_active()`, so the FK-driven
  // UPDATE still raised (the fourth D-81 blocker).
  const other = event === "delete" ? /tg_op\s*=\s*'UPDATE'/i : /tg_op\s*=\s*'DELETE'/i;
  const conds = [...pre.matchAll(/\bif\b([\s\S]*?)\bthen\b/gi)].map((m) => m[1]);
  const opened = conds.some((cnd) => cnd.includes(HATCH) && !other.test(cnd));
  const returns = event === "delete" ? /return\s+old\s*;/i : /return\s+new\s*;/i;
  return opened && returns.test(pre);
}

/** Every trigger that would abort the reset, with the reason. Empty = the reset can finish. */
function resetBlockers(schema: Schema, order: string[]): string[] {
  const wiped = new Set(order);
  const out: string[] = [];
  const raisingBefore = (table: string, event: string) =>
    [...schema.triggers.values()].filter((t) => {
      if (t.table !== table || t.timing !== "before" || !t.events.includes(event)) return false;
      const body = schema.functions.get(t.fn);
      return body !== undefined && raises(body);
    });

  for (const table of wiped) {
    for (const t of raisingBefore(table, "delete")) {
      if (!hatchedBeforeFirstRaise(schema.functions.get(t.fn)!)) out.push(`DELETE ${table} via ${t.name} -> ${t.fn}`);
    }
  }
  for (const fk of schema.setNullFks) {
    if (!wiped.has(fk.table) || !wiped.has(fk.references)) continue;
    if (order.indexOf(fk.references) > order.indexOf(fk.table)) continue; // child emptied first: no UPDATE happens
    for (const t of raisingBefore(fk.table, "update")) {
      if (!hatchedBeforeFirstRaise(schema.functions.get(t.fn)!, "update")) {
        out.push(`SET NULL ${fk.table}.${fk.column} (deleting ${fk.references}) via ${t.name} -> ${t.fn}`);
      }
    }
  }
  return [...new Set(out)].sort();
}

// === 1. The class ==============================================================
describe("D-81 every guard on a wiped table lets the factory reset through", () => {
  const order = resetDeleteOrder();
  const schema = readSchema();

  it("reads the real schema (sanity: the parser sees what the reset touches)", () => {
    expect(order).toHaveLength(139);
    expect(schema.functions.has("gl_factory_reset")).toBe(true);
    // The six BEFORE DELETE guards that raise on wiped tables, found by the
    // database sweep of all 237 migrations.
    for (const k of [
      "gl_journals.trg_gl_journals_immutable",
      "gl_journal_lines.trg_gl_journal_lines_immutable",
      "gl_audit_events.trg_gl_audit_append_only",
      "gl_template_changes.trg_gl_template_changes_append_only",
      "gl_opening_balances.gl_ob_frozen",
      "gl_override_log.trg_gl_override_log_no_update",
    ]) {
      expect(schema.triggers.has(k), k).toBe(true);
    }
    const audit = schema.setNullFks.filter((f) => f.table === "gl_audit_events").map((f) => f.column).sort();
    expect(audit).toEqual(["entity_id", "journal_id", "period_id"]);
  });

  it("finds no blocker on main (0238 applied)", () => {
    expect(resetBlockers(schema, order)).toEqual([]);
  });

  it("names exactly the four D-81 blockers when 0238 is left out (the bug, reproduced)", () => {
    const without = readSchema(migrationFiles().filter((f) => !f.startsWith("0238_")));
    expect(resetBlockers(without, order)).toEqual([
      "DELETE gl_opening_balances via gl_ob_frozen -> gl_ob_guard_frozen",
      "DELETE gl_override_log via trg_gl_override_log_no_update -> gl_override_log_is_append_only",
      "DELETE gl_template_changes via trg_gl_template_changes_append_only -> gl_guard_template_changes_append_only",
      "SET NULL gl_audit_events.journal_id (deleting gl_journals) via trg_gl_audit_append_only -> gl_guard_audit_append_only",
      "SET NULL gl_audit_events.period_id (deleting gl_periods) via trg_gl_audit_append_only -> gl_guard_audit_append_only",
    ]);
  });

  it("catches a hatch placed AFTER the refusal (mutation)", () => {
    const s = readSchema();
    s.functions.set(
      "gl_override_log_is_append_only",
      "begin raise exception 'X'; if public.gl_factory_reset_active() then return old; end if; end",
    );
    expect(resetBlockers(s, order)).toEqual([
      "DELETE gl_override_log via trg_gl_override_log_no_update -> gl_override_log_is_append_only",
    ]);
  });

  it("catches a NEW raising guard on any wiped table (mutation)", () => {
    const s = readSchema();
    s.functions.set("some_new_guard", "begin raise exception 'NOPE'; end");
    s.triggers.set("orders.trg_new", { name: "trg_new", table: "orders", timing: "before", events: ["delete"], fn: "some_new_guard" });
    expect(resetBlockers(s, order)).toEqual(["DELETE orders via trg_new -> some_new_guard"]);
  });
});

// === 2. Migration 0238 =========================================================
describe("D-81 migration 0238", () => {
  const sql = read(MIG);
  const c = noComments(sql);
  const body = (fn: string) => readSchema(migrationFiles().filter((f) => f.startsWith("0238_"))).functions.get(fn) ?? "";

  it("quotes the owner request verbatim", () => {
    expect(sql).toContain("so I can clean out all my dirty test data.");
  });
  it("has a precheck before any DDL, naming every dependency", () => {
    const p = c.indexOf("$precheck$");
    expect(p).toBeGreaterThan(-1);
    expect(p).toBeLessThan(c.indexOf("create or replace function"));
    expect(c).toContain("MIGRATION_OUT_OF_ORDER");
    for (const dep of ["gl_factory_reset_active()", "gl_audit_events", "gl_template_changes", "gl_opening_balances", "gl_override_log"]) {
      expect(c).toContain(dep);
    }
  });
  it("is create or replace only: no trigger dropped, disabled or re-pointed, no data touched", () => {
    expect(c).not.toMatch(/drop\s+trigger|disable\s+trigger|create\s+trigger|drop\s+function|delete\s+from|truncate|alter\s+table/i);
  });
  it("the three delete guards hatch DELETE only, first, and keep their error codes", () => {
    for (const [fn, code] of [
      ["gl_guard_template_changes_append_only", "GL_APPEND_ONLY"],
      ["gl_ob_guard_frozen", "GL_OB_FROZEN"],
      ["gl_override_log_is_append_only", "GL_OVERRIDE_LOG_APPEND_ONLY"],
    ]) {
      const b = body(fn);
      expect(b, fn).toMatch(/if\s+tg_op\s*=\s*'DELETE'\s+and\s+public\.gl_factory_reset_active\(\)\s+then\s+return\s+old;/);
      expect(hatchedBeforeFirstRaise(b), fn).toBe(true);
      expect(b, fn).toContain(code);
    }
  });
  it("the audit guard allows only the FK-shaped null rewrite during a reset, and still refuses everything else", () => {
    const b = body("gl_guard_audit_append_only");
    expect(hatchedBeforeFirstRaise(b, "delete")).toBe(true);
    expect(hatchedBeforeFirstRaise(b, "update")).toBe(true);
    expect(b).toMatch(/if\s+tg_op\s*=\s*'DELETE'\s+then\s+return\s+old;/);
    for (const col of ["journal_id", "period_id", "entity_id"]) {
      expect(b).toMatch(new RegExp(`new\\.${col}\\s+is\\s+null\\s+or\\s+new\\.${col}\\s*=\\s*old\\.${col}`));
    }
    expect(b).toMatch(/\(to_jsonb\(new\) - 'journal_id' - 'period_id' - 'entity_id'\)\s*=\s*\(to_jsonb\(old\) - 'journal_id' - 'period_id' - 'entity_id'\)/);
    expect(b).toContain("GL_IMMUTABLE: gl_audit_events is append-only.");
  });
});

// === 3. Rollback, scenario script, transit =====================================
describe("D-81 rollback and PG scenario script", () => {
  it("the rollback restores all four original bodies without the hatch", () => {
    const rb = read(RB);
    for (const fn of [
      "gl_guard_template_changes_append_only",
      "gl_ob_guard_frozen",
      "gl_override_log_is_append_only",
      "gl_guard_audit_append_only",
    ]) {
      expect(rb, fn).toMatch(new RegExp(`create or replace function public\\.${fn}\\(`));
    }
    const code = noComments(rb);
    // only the audit guard keeps the 0209 DELETE hatch
    expect(code.split(HATCH).length - 1).toBe(1);
    expect(code).not.toContain("to_jsonb");
  });
  it("the scenario script runs the real reset, proves the rollback breaks it, and rolls back", () => {
    const pg = read(PG);
    expect(pg).toContain("gl_factory_reset('ERASE ALL TEST DATA', true)");
    expect(pg).toContain("gl_approve_journal");
    expect(pg).toContain("gl_post_journal");
    expect(pg).toContain("0238_factory_reset_reaches_every_guard.rollback.sql");
    expect(pg).toContain("FACTORY RESET GUARDS CHECK PASSED");
    expect(pg.trimEnd().endsWith("rollback;")).toBe(true);
  });
  it("has zero Supabase-editor transit hazards (migration and rollback)", () => {
    for (const f of [MIG, RB]) {
      const h = transitHazards(read(f));
      expect(h.oddApostrophe, f).toBe(0);
      expect(h.withSemicolon, f).toBe(0);
      expect(h.bareRelationWord, f).toBe(0);
      expect(h.nonAscii, f).toBe(0);
    }
  });
});

// === 4. Order and hand-off =====================================================
describe("D-81 order and owner hand-off", () => {
  it("sits right after 0237 (index-based so later migrations do not break it)", () => {
    const files = migrationFiles();
    const i = files.indexOf("0238_factory_reset_reaches_every_guard.sql");
    expect(i).toBeGreaterThan(0);
    expect(files[i - 1]).toBe("0237_fact_review_for_versions.sql");
    expect(files.filter((f) => f.startsWith("0238_"))).toHaveLength(1);
  });
  it("is handed to the owner in docs/MIGRATIONS_TO_RUN.md with a verify query and the rollback", () => {
    const doc = read("docs/MIGRATIONS_TO_RUN.md");
    const at = doc.indexOf("## D-81 \u2014 0238 \u2014 the factory reset can finish");
    expect(at).toBeGreaterThan(-1);
    const sec = doc.slice(at, at + 7000);
    expect(sec).toContain("- [ ] `0238_factory_reset_reaches_every_guard.sql`");
    expect(sec).toContain("-- expect 4 rows, every one true");
    expect(sec).toContain("0238_factory_reset_reaches_every_guard.rollback.sql");
  });
  it("is recorded in docs/DEFECTS.md", () => {
    expect(read("docs/DEFECTS.md")).toContain("## D-81");
  });
});
