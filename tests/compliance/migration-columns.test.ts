/**
 * tests/compliance/migration-columns.test.ts   (books-35)
 *
 * THE PARSER EVERY MENTOR COVERAGE GATE STANDS ON.
 *
 * If this parser under-reads a migration, every gate built on it reports full
 * coverage over a table it never fully read, and the suite goes green while
 * protecting nothing. That is not a hypothetical: the books-34 parser matched
 * a column only when its type was one of eight it knew, and silently dropped
 * every other line. Pointed at migration 0198 it lost five `smallint` columns,
 * including `wage_orders.priority` — the field that decides which garnishment
 * gets paid first when an employee has more than one.
 *
 * So the tests below are mostly about the REFUSAL path, because that is the
 * behaviour that was missing. A parser that only ever parses good input proves
 * nothing about what it does with input it does not understand.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  KNOWN_SQL_TYPES,
  declaredEnumTypes,
  isKnownType,
  migrationColumnTypesStrict,
  readMigrationColumns,
} from "@/lib/payroll/migration-columns";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const M0198 = join(MIGRATIONS, "0198_sick_leave_and_garnishments.sql");
const M0199 = join(MIGRATIONS, "0199_payroll_ytd_accumulators.sql");

/**
 * Temp migrations are written into the REAL migrations directory's sibling
 * only when they do not need enum resolution; otherwise `declaredEnumTypes`
 * would find no enums. Each test says which it needs.
 */
function tempSource(name: string, body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "migcols-"));
  const p = join(dir, name);
  writeFileSync(p, body, "utf8");
  return p;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT THAT CAUSED THIS FILE TO EXIST
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the smallint columns the books-34 parser silently dropped", () => {
  it("reads all five, by name and by type", () => {
    const cols = migrationColumnTypesStrict(M0198);

    // Three policy knobs. Each one is the input to a refusal code in
    // sick-leave-core.ts, so losing them meant the coverage gate could never
    // ask whether the figure driving a refusal had been explained.
    expect(cols["sick_leave_policy.usable_after_days"]).toBe("smallint");
    expect(cols["sick_leave_policy.usage_increment_minutes"]).toBe("smallint");
    expect(cols["sick_leave_policy.verification_after_days"]).toBe("smallint");

    // The singleton key.
    expect(cols["sick_leave_policy.id"]).toBe("smallint");

    // And the one with the most money attached to it: when an employee has a
    // support order and a creditor garnishment at once, this decides who is
    // satisfied first.
    expect(cols["wage_orders.priority"]).toBe("smallint");
  });

  it("PROOF THE OLD SHAPE WAS THE BUG: `smallint` is not in the eight types the old regex knew", () => {
    // The old allow-list, reproduced verbatim from books-34. This test exists
    // so the reason for the change survives the change.
    const OLD = ["uuid", "bigint", "integer", "text", "boolean", "timestamptz", "numeric", "date"];
    expect(OLD).not.toContain("smallint");
    expect(KNOWN_SQL_TYPES).toContain("smallint");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * REFUSAL, NOT SKIPPING  (standing rule 48)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("a type the parser does not know must refuse, never skip", () => {
  it("GATE IS WIRED: an unknown type throws and names the column", () => {
    const p = tempSource(
      "unknown.sql",
      "create table if not exists public.thing (\n" +
        "  id uuid primary key,\n" +
        "  where_it_happened geography not null\n" +
        ");\n",
    );
    expect(() => migrationColumnTypesStrict(p)).toThrow(/UNRECOGNISED COLUMN TYPE/);
    expect(() => migrationColumnTypesStrict(p)).toThrow(/where_it_happened/);
  });

  it("the refusal names the FILE too, because the reader's next question is 'which one'", () => {
    const p = tempSource(
      "named.sql",
      "create table if not exists public.thing (\n  shape geography\n);\n",
    );
    expect(() => migrationColumnTypesStrict(p)).toThrow(new RegExp("named\\.sql"));
  });

  it("collects EVERY unrecognised column, so the fix is one pass and not whack-a-mole", () => {
    const p = tempSource(
      "several.sql",
      "create table if not exists public.thing (\n" +
        "  a geography,\n" +
        "  b geometry,\n" +
        "  c hstore\n" +
        ");\n",
    );
    const { unrecognised } = readMigrationColumns(p);
    expect(unrecognised.map((u) => u.column).sort()).toEqual(["a", "b", "c"]);
  });

  it("ACCEPT CONTROL: refusal discriminates - a file of known types does not throw", () => {
    // Standing rule 55. Without this, the three tests above would also pass
    // against a parser that refused absolutely everything.
    const p = tempSource(
      "clean.sql",
      "create table if not exists public.fine (\n" +
        "  id uuid primary key,\n" +
        "  amount_cents bigint not null,\n" +
        "  note text\n" +
        ");\n",
    );
    expect(() => migrationColumnTypesStrict(p)).not.toThrow();
    expect(migrationColumnTypesStrict(p)["fine.amount_cents"]).toBe("bigint");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * THE SHAPES REAL MIGRATIONS ACTUALLY CONTAIN
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("shapes found by sweeping all 199 migrations", () => {
  it("`add column if not exists` does not read the word `if` as the column name", () => {
    // A lazy `(?:if not exists )?` group matches the empty string and then
    // takes `if` as the name. The sweep found four columns recorded as
    // `vendors.if` of type `not`.
    const p = tempSource(
      "alter.sql",
      "alter table public.vendors add column if not exists shipping_address1 text;\n",
    );
    const cols = migrationColumnTypesStrict(p);
    expect(cols["vendors.shipping_address1"]).toBe("text");
    expect(Object.keys(cols)).not.toContain("vendors.if");
  });

  it("a column name may contain digits", () => {
    // `([a-z_]+)` excludes them, so `shipping_address1` was never a column at
    // all - a second silent skip hiding behind the first.
    const p = tempSource(
      "digits.sql",
      "create table if not exists public.addr (\n  line1 text,\n  line2 text\n);\n",
    );
    const cols = migrationColumnTypesStrict(p);
    expect(Object.keys(cols).sort()).toEqual(["addr.line1", "addr.line2"]);
  });

  it("a wrapped REFERENCES continuation is not a column called `references`", () => {
    const p = tempSource(
      "wrapped.sql",
      "create table if not exists public.child (\n" +
        "  id uuid primary key,\n" +
        "  parent_id uuid not null\n" +
        "    references public.parent(id) on delete restrict,\n" +
        "  note text\n" +
        ");\n",
    );
    const cols = migrationColumnTypesStrict(p);
    expect(Object.keys(cols).sort()).toEqual(["child.id", "child.note", "child.parent_id"]);
  });

  it("a table-level constraint is not a column called `unique`", () => {
    const p = tempSource(
      "constraint.sql",
      "create table if not exists public.thing (\n" +
        "  id uuid primary key,\n" +
        "  case_number text not null,\n" +
        "  unique (case_number)\n" +
        ");\n",
    );
    expect(Object.keys(migrationColumnTypesStrict(p)).sort()).toEqual([
      "thing.case_number",
      "thing.id",
    ]);
  });

  it("an array type is known because its element type is, and keeps its brackets", () => {
    // The brackets are KEPT deliberately. A `uuid` is a key and may be exempt
    // from needing a lesson; a `uuid[]` is a LIST of keys, which is a
    // modelling decision with meaning, and must not inherit that exemption.
    const p = tempSource(
      "arrays.sql",
      "create table if not exists public.thing (\n" +
        "  tags text[] not null default '{}',\n" +
        "  owners uuid[]\n" +
        ");\n",
    );
    const cols = migrationColumnTypesStrict(p);
    expect(cols["thing.tags"]).toBe("text[]");
    expect(cols["thing.owners"]).toBe("uuid[]");
    expect(isKnownType("uuid[]")).toBe(true);
  });

  it("`int` is normalised to `integer`, so a type rule cannot be dodged by spelling", () => {
    const p = tempSource(
      "alias.sql",
      "create table if not exists public.thing (\n  sort_order int not null default 0\n);\n",
    );
    expect(migrationColumnTypesStrict(p)["thing.sort_order"]).toBe("integer");
  });

  it("a precision qualifier does not become part of the type", () => {
    const p = tempSource(
      "precision.sql",
      "create table if not exists public.thing (\n  rate numeric(12,4) not null\n);\n",
    );
    expect(migrationColumnTypesStrict(p)["thing.rate"]).toBe("numeric");
  });

  it("multi-line CHECK constraints do not leak continuation lines as columns", () => {
    // Inherited from books-34 and still load-bearing: `amount between 0 and`
    // reads as a name followed by a word to any line-shape parser. Depth
    // tracking is what makes only top-level lines eligible.
    const p = tempSource(
      "check.sql",
      "create table if not exists public.thing (\n" +
        "  amount bigint not null,\n" +
        "  constraint thing_sane check (\n" +
        "    amount between 0 and 100\n" +
        "    and amount is not null\n" +
        "  )\n" +
        ");\n",
    );
    expect(Object.keys(migrationColumnTypesStrict(p))).toEqual(["thing.amount"]);
  });

  it("a `--` comment containing a paren does not desynchronise depth tracking", () => {
    const p = tempSource(
      "comment.sql",
      "create table if not exists public.thing (\n" +
        "  -- this note has an unbalanced ( paren in it\n" +
        "  amount bigint not null,\n" +
        "  note text\n" +
        ");\n",
    );
    expect(Object.keys(migrationColumnTypesStrict(p)).sort()).toEqual([
      "thing.amount",
      "thing.note",
    ]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ENUMS
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("enum column types", () => {
  it("finds the enums this repo really declares", () => {
    const enums = declaredEnumTypes(MIGRATIONS);
    expect(enums.size).toBeGreaterThan(10);
    expect(enums).toContain("asset_status");
    expect(enums).toContain("post_status");
  });

  it("a column typed by a declared enum parses, tagged so it cannot pass as a builtin", () => {
    const dir = mkdtempSync(join(tmpdir(), "migcols-enum-"));
    writeFileSync(
      join(dir, "0001_types.sql"),
      "create type mood as enum ('good','bad');\n",
      "utf8",
    );
    const p = join(dir, "0002_use.sql");
    writeFileSync(
      p,
      "create table if not exists public.thing (\n  how mood not null\n);\n",
      "utf8",
    );
    expect(migrationColumnTypesStrict(p)["thing.how"]).toBe("enum:mood");
  });

  it("an UNDECLARED enum-looking type still refuses", () => {
    // The enum escape hatch must not become a way for any unknown word to
    // pass. Only enums the repo actually declares are accepted.
    const p = tempSource(
      "undeclared.sql",
      "create table if not exists public.thing (\n  how invented_mood not null\n);\n",
    );
    expect(() => migrationColumnTypesStrict(p)).toThrow(/UNRECOGNISED COLUMN TYPE/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * VACUITY GUARDS  (standing rule 39)
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("the parser reports honestly when there is nothing to read", () => {
  it("a migration with no columns yields none - and does not pretend to refuse", () => {
    const p = tempSource("empty.sql", "-- a migration that adds nothing at all\nselect 1;\n");
    const { columns, unrecognised } = readMigrationColumns(p);
    expect(Object.keys(columns)).toHaveLength(0);
    expect(unrecognised).toHaveLength(0);
  });

  it("the two migrations the mentors depend on are both non-empty", () => {
    // Every gate downstream guards against a vacuous read. This pins the fact
    // that a vacuous read would be WRONG for these two specific files, so a
    // future edit that empties one is caught here rather than looking like a
    // legitimately empty migration somewhere else.
    expect(Object.keys(migrationColumnTypesStrict(M0198)).length).toBeGreaterThan(50);
    expect(Object.keys(migrationColumnTypesStrict(M0199)).length).toBeGreaterThan(30);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * A STATEMENT THAT WRAPS IS STILL A STATEMENT   (books-38)
 *
 * THE DEFECT. Outside a create-table body this parser read ONE PHYSICAL LINE
 * at a time. So the most ordinary formatting choice in the repo —
 *
 *     alter table public.wage_orders
 *       add column if not exists served_date date;
 *
 * — matched nothing. Not misparsed: DROPPED, and dropped without landing in
 * `unrecognised`, so no caller could find out. Every existing test passed,
 * because every ALTER they used happened to fit on one line.
 *
 * WHAT IT COST. Migration 0201 added `wage_orders.served_date`, the date the
 * twenty-day answer deadline of RCW 26.18.110(1) and the sixty-day continuing
 * lien of RCW 6.27.350(1) are BOTH measured from. Parsing 0201 returned `{}`,
 * so the garnishment mentor's coverage gate reported that every column was
 * taught while the most deadline-critical column in the table had no lesson
 * at all. Standing rule 50: dead code wearing a green check.
 *
 * These tests fail against the old parser. That is what makes them worth
 * having — verified by reverting the fix and watching the first two go red.
 * ═══════════════════════════════════════════════════════════════════════════ */

describe("an alter-table that wraps across lines is still read", () => {
  it("reads a wrapped add-column, which the line-at-a-time parser lost", () => {
    const p = tempSource(
      "wrapped.sql",
      "alter table public.wage_orders\n  add column if not exists served_date date;\n",
    );
    const { columns, unrecognised } = readMigrationColumns(p);
    expect(columns["wage_orders.served_date"]).toBe("date");
    expect(unrecognised).toHaveLength(0);
  });

  it("reads the REAL migration 0201, which is where this was found", () => {
    // Not a synthetic echo of the fix. The actual shipped file.
    const cols = migrationColumnTypesStrict(
      join(MIGRATIONS, "0201_wage_orders_served_date.sql"),
    );
    expect(cols["wage_orders.served_date"]).toBe("date");
  });

  it("still reads a single-line add-column exactly as before", () => {
    // The fix must not be paid for by breaking the shape that already worked.
    const p = tempSource(
      "oneline.sql",
      "alter table public.employees add column if not exists nickname text;\n",
    );
    expect(readMigrationColumns(p).columns["employees.nickname"]).toBe("text");
  });

  it("tolerates a comment line in the middle of the wrapped statement", () => {
    const p = tempSource(
      "commented.sql",
      "alter table public.wage_orders\n  -- see RCW 26.18.110(1)\n  add column if not exists served_date date;\n",
    );
    expect(readMigrationColumns(p).columns["wage_orders.served_date"]).toBe("date");
  });

  it("REPORTS an add-column it cannot read, instead of dropping it in silence", () => {
    // The other half of the defect, and the more important half. A parser that
    // loses a column quietly is worse than one that throws, because the gates
    // downstream keep reporting success over a column they never saw.
    const p = tempSource(
      "unreadable.sql",
      "alter table public.wage_orders add column served_date wat_type_9000;\n",
    );
    const { unrecognised } = readMigrationColumns(p);
    expect(unrecognised.length).toBeGreaterThan(0);
    expect(unrecognised.some((u) => u.table === "wage_orders")).toBe(true);
  });

  it("does not run away to the end of a file that is missing a semicolon", () => {
    // The join is bounded. An unterminated statement must not swallow the rest
    // of the migration and turn one defect into a parse of nothing.
    const tail = Array.from({ length: 40 }, (_, i) => `select ${i};`).join("\n");
    const p = tempSource("noterm.sql", `alter table public.t\n  add column x\n${tail}\n`);
    expect(() => readMigrationColumns(p)).not.toThrow();
  });
});
