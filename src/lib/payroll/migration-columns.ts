/**
 * src/lib/payroll/migration-columns.ts   (books-35)
 *
 * ONE PARSER THAT READS A MIGRATION AND REFUSES WHAT IT CANNOT CLASSIFY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS, AND WHAT IT IS FIXING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * books-34 shipped a migration parser inside `ytd-mentor-gates.ts`. It found a
 * column by matching a name followed by a type drawn from a hardcoded list:
 *
 *     /^([a-z_]+)\s+(uuid|bigint|integer|text|boolean|timestamptz|numeric|date)\b/i
 *
 * Read that as an auditor rather than as a programmer. It says: "a line is a
 * column if its type is one of the eight I happen to know." It does NOT say
 * what happens to a line whose type is the ninth. The answer is that the line
 * is skipped — silently, with no count, no warning, and no failure.
 *
 * A coverage gate built on a parser that silently under-reads is worse than no
 * gate. The gate asks "is every column taught?", the parser hands back a
 * shortened list, every column on that shortened list is taught, and the suite
 * goes green while announcing full coverage over a table it never fully read.
 * That is standing rule 50 — dead code wearing a green check — except the check
 * is not dead. It is alive, running, and answering a narrower question than the
 * one it appears to answer.
 *
 * It was not hypothetical. Pointing the books-34 parser at migration 0198
 * (books-33's sick leave and garnishment tables) lost FIVE columns, every one
 * of them a `smallint`:
 *
 *     sick_leave_policy.id
 *     sick_leave_policy.usable_after_days        <- decides NOT_YET_USABLE
 *     sick_leave_policy.usage_increment_minutes  <- decides REQUEST_NOT_IN_INCREMENT
 *     sick_leave_policy.verification_after_days  <- decides VERIFICATION_THRESHOLD_UNLAWFUL
 *     wage_orders.priority                       <- decides which order gets paid first
 *
 * Three of those five are the exact policy knobs the sick-leave engine refuses
 * on, and the fourth decides which garnishment is satisfied first when an
 * employee has more than one. Migration 0199 lost nothing only because it
 * happens to contain no `smallint`. Luck is not a control.
 *
 * STANDING RULE 23 — FIX THE CLASS, NOT THE INSTANCE. Adding `smallint` to the
 * list would fix migration 0198 this afternoon and lose `jsonb` next quarter.
 * The defect is not the missing type. The defect is that an unrecognised type
 * was a SKIP instead of a REFUSAL.
 *
 * STANDING RULE 48 — A CHECK THAT CANNOT CLASSIFY ITS INPUT MUST SAY SO. So
 * this parser knows a set of types, and when it meets a line that is shaped
 * like a column and is not a table constraint, it must land it in exactly one
 * of two places: a parsed column, or a loud complaint naming the file, the
 * table, the column and the type it did not recognise. There is no third
 * bucket, and in particular there is no silent floor.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NODE ONLY — STANDING RULE 65b
 * ─────────────────────────────────────────────────────────────────────────────
 * This module calls `readFileSync`. It is imported by `*-mentor-gates.ts`
 * modules, which are imported by tests and by nothing else. It must never be
 * reachable from a `"use client"` component. In books-33 that exact mistake
 * dragged `node:fs` into a browser bundle and Turbopack refused every Vercel
 * deployment while CI stayed green, because CI ran vitest and never ran
 * `next build`. `tests/compliance/client-bundle-purity.test.ts` walks the
 * client import graph and fails, naming the chain, if this file is ever
 * reachable from the browser.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * The SQL types this codebase actually uses in a column position.
 *
 * This list is DATA, not a filter. Nothing is dropped for being absent from it;
 * an absent type raises `UNRECOGNISED COLUMN TYPE` and stops the run. Adding a
 * type here is therefore a deliberate act by a person who has looked at the
 * column and decided what it is, which is precisely the decision the old
 * regex was making silently on everyone's behalf.
 *
 * Compiled empirically: `scripts/prove-migration-columns.sh` parses every
 * migration in `supabase/migrations` and fails if any of them contains a type
 * that is not on this list. So the list cannot quietly fall behind the schema —
 * if a future migration introduces `interval`, the proof script says so by
 * name before the mentor gates ever get a chance to under-read it.
 */
export const KNOWN_SQL_TYPES: readonly string[] = [
  "bigint",
  "boolean",
  "bytea",
  "citext",
  "date",
  "double precision",
  "inet",
  "integer",
  "interval",
  "json",
  "jsonb",
  "numeric",
  "real",
  "smallint",
  "text",
  "time",
  "timestamp",
  "timestamptz",
  "tsvector",
  "uuid",
];

/**
 * Postgres spellings that mean a type already on the list above.
 *
 * Normalised rather than merely accepted, because a gate that sees `int` in
 * one migration and `integer` in another would treat them as two different
 * things, and any rule expressed in terms of a type — such as "only uuid and
 * timestamptz may be exempt from needing a lesson" — would then be trivially
 * evadable by choosing the other spelling.
 */
const TYPE_ALIASES: Readonly<Record<string, string>> = {
  int: "integer",
  int2: "smallint",
  int4: "integer",
  int8: "bigint",
  bool: "boolean",
  float4: "real",
  float8: "double precision",
  decimal: "numeric",
  varchar: "text",
  "character varying": "text",
  char: "text",
  character: "text",
  timestamptz: "timestamptz",
  "timestamp with time zone": "timestamptz",
  "timestamp without time zone": "timestamp",
  serial: "integer",
  bigserial: "bigint",
  smallserial: "smallint",
};

/**
 * Words that begin a TABLE-level constraint rather than a column.
 *
 * A table constraint sits at the same nesting depth as a column and looks
 * enough like one to fool a name-then-word match: `unique (case_number)` reads
 * as a column named `unique` of type `case_number`. Listing the keywords is
 * how the parser tells the two apart, and anything that is NOT one of these
 * and IS shaped like a column must resolve to a known type or raise.
 */
const TABLE_CONSTRAINT_KEYWORDS: readonly string[] = [
  "primary",
  "foreign",
  "unique",
  "check",
  "constraint",
  "exclude",
  "like",
  "partition",
  "deferrable",
  "initially",
];

/**
 * Multi-word type names, matched before single words so neither half is lost.
 *
 * Longest first: `timestamp with time zone` must be tried before `timestamp`,
 * or the trailing words are read as part of the constraint and the column is
 * recorded with the wrong type.
 */
const MULTI_WORD_TYPES: readonly string[] = [
  "timestamp without time zone",
  "timestamp with time zone",
  "character varying",
  "double precision",
];

/**
 * Words that can follow a column name but are NOT a type.
 *
 * These are continuation fragments of a definition that wrapped onto the next
 * line — `on update cascade ...` belonging to the previous line's REFERENCES
 * clause, or a bare `references public.employees(id)` where the column's real
 * type sat on the line above. A naive reader treats `on` as a column named
 * `on` of type `update`, which is how the sweep first reported
 * `inventory_types.on` and nine copies of `something.references`.
 *
 * They are listed rather than inferred because guessing is not allowed here:
 * an unlisted word that is genuinely unclassifiable must still REFUSE.
 */
const CONTINUATION_WORDS: readonly string[] = [
  "references",
  "on",
  "not",
  "default",
  "generated",
  "collate",
  "using",
  "with",
  "and",
  "or",
];

export type UnrecognisedColumn = {
  readonly table: string;
  readonly column: string;
  readonly rawType: string;
  readonly line: string;
};

/**
 * Is this a type the parser understands?
 *
 * Array-ness and enum-ness are checked by peeling the decoration off, so that
 * `text[]` is known because `text` is, and `enum:post_status` is known because
 * the repo declares that enum — without either being listed separately, which
 * would put the list right back in the business of falling behind.
 */
export function isKnownType(type: string): boolean {
  const base = type.replace(/(\[\])+$/, "");
  if (base.startsWith("enum:")) return true;
  return KNOWN_SQL_TYPES.includes(base);
}

export type MigrationParse = {
  /** `table.column` -> normalised SQL type. */
  readonly columns: Readonly<Record<string, string>>;
  /** Column-shaped lines whose type is not in `KNOWN_SQL_TYPES`. */
  readonly unrecognised: readonly UnrecognisedColumn[];
};

/**
 * Pull the type out of whatever follows a column name.
 *
 * Handles the three decorations Postgres allows between the name and the rest
 * of the definition, each of which would otherwise corrupt the type:
 *
 *   - precision      `numeric(12,2)`  -> `numeric`
 *   - array suffix   `uuid[]`         -> `uuid[]`   (deliberately KEPT — see below)
 *   - two-word names `double precision`
 *
 * The array suffix is kept rather than stripped on purpose. A `uuid` is a key
 * and may be exempt from needing a lesson; a `uuid[]` is a LIST of keys, which
 * is a modelling decision with meaning, and it must not inherit the exemption
 * its element type enjoys. Returning `uuid[]` means it will not match
 * `STRUCTURAL_TYPES` and will be made to earn its explanation.
 */
function extractType(
  rest: string,
  enumTypes: ReadonlySet<string>,
): { type: string; raw: string } | null {
  const lowered = rest.toLowerCase();

  for (const multi of MULTI_WORD_TYPES) {
    if (lowered.startsWith(`${multi} `) || lowered === multi) {
      return { type: TYPE_ALIASES[multi] ?? multi, raw: multi };
    }
  }

  // A type token is a word — optionally schema-qualified, as in
  // `public.order_status` — optionally followed by a precision in parens,
  // optionally followed by one or more array markers.
  const m = rest.match(
    /^(?:public\.)?([a-z][a-z0-9_]*)\s*(\([^)]*\))?\s*((?:\[\s*\])*)/i,
  );
  if (!m) return null;

  const word = m[1].toLowerCase();
  const arrays = (m[3] ?? "").replace(/\s+/g, "");
  const raw = `${word}${m[2] ?? ""}${arrays}`;

  // A word that is plainly a continuation of the previous line is not a type,
  // and must not be normalised into one.
  if (arrays === "" && CONTINUATION_WORDS.includes(word)) return null;

  // An enum declared by `create type ... as enum` earlier in this repo is a
  // real column type. Enums are normalised to `enum:<name>` rather than to
  // their bare name so that they can never collide with a built-in and can
  // never be mistaken for a structural type.
  if (enumTypes.has(word)) return { type: `enum:${word}${arrays}`, raw };

  const base = TYPE_ALIASES[word] ?? word;
  return { type: `${base}${arrays}`, raw };
}

/**
 * Every enum type name declared anywhere in the migrations directory.
 *
 * Read from disk rather than listed, because a hand-written list of enums is
 * exactly the kind of thing that falls behind and reintroduces the silent skip
 * this whole module exists to prevent.
 */
export function declaredEnumTypes(migrationsDir: string): ReadonlySet<string> {
  const names = new Set<string>();
  for (const f of readdirSync(migrationsDir).filter((n) => n.endsWith(".sql"))) {
    const text = readFileSync(join(migrationsDir, f), "utf8");
    for (const m of text.matchAll(
      /create type (?:if not exists )?(?:public\.)?([a-z_][a-z0-9_]*)\s+as\s+enum/gi,
    )) {
      names.add(m[1].toLowerCase());
    }
  }
  return names;
}

/**
 * Read every column a migration defines, and report every line it could not
 * classify. NEVER throws on an unknown type — it collects, so that a caller
 * can report ALL of them at once instead of playing whack-a-mole one run at a
 * time. `migrationColumnTypesStrict` is the arm that refuses.
 *
 * TWO SHAPES ARE READ, because migrations do two different things: they ADD
 * columns to an existing table, and they CREATE a table outright.
 *
 * THE CREATE-TABLE BODY IS PARSED BY PAREN DEPTH, NOT BY LINE SHAPE. This was
 * learned in books-34 and it is not a refinement, it is load-bearing. A body
 * contains multi-line `check (...)` constraints whose continuation lines look
 * exactly like column definitions — `oasdi_wages_cents between 0 and 1000` is
 * a name followed by a word to any regex alive. Tracking depth means only
 * lines at the top level of the body can be columns, which is the actual rule
 * SQL itself uses. A line-shape parser emits those continuations as duplicate
 * columns and then reports coverage over figures that do not exist.
 */
export function readMigrationColumns(sourcePath: string): MigrationParse {
  const text = readFileSync(sourcePath, "utf8");
  const enumTypes = declaredEnumTypes(dirname(sourcePath));

  const columns: Record<string, string> = {};
  const unrecognised: UnrecognisedColumn[] = [];
  let createTable = "";
  let depth = 0;

  for (const rawLine of text.split("\n")) {
    // Strip trailing line comments BEFORE any structural reading. A `--`
    // comment can legitimately contain parentheses, and counting those would
    // desynchronise depth tracking for the remainder of the file — after
    // which every subsequent column is read at the wrong nesting level.
    const line = rawLine.replace(/--.*$/, "").trim();
    if (line === "") continue;

    if (createTable === "") {
      // `if not exists` is consumed by a NON-optional-looking alternation
      // rather than `(?:if not exists )?` followed by a bare name, because a
      // lazy optional group happily matches the empty string and then reads
      // the literal word `if` as the column name. The sweep caught exactly
      // that: four columns recorded as `vendors.if` of type `not`.
      const alter = line.match(
        /^alter table (?:if exists )?(?:public\.)?([a-z_][a-z0-9_]*)\s+add column\s+(?:if not exists\s+)?([a-z_][a-z0-9_]*)\s+(.+)$/i,
      );
      if (alter) {
        const found = extractType(alter[3], enumTypes);
        const key = `${alter[1]}.${alter[2]}`;
        if (found && isKnownType(found.type)) {
          columns[key] = found.type;
        } else {
          unrecognised.push({
            table: alter[1],
            column: alter[2],
            rawType: found?.raw ?? alter[3],
            line,
          });
        }
        continue;
      }

      const create = line.match(
        /^create table (?:if not exists )?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/i,
      );
      if (create) {
        createTable = create[1];
        depth = 1; // the paren that opened the body
        continue;
      }
      continue;
    }

    // Inside a create-table body. Read the column BEFORE updating depth, so a
    // single-line definition that opens and closes its own parens — such as
    // `tax_year integer not null check (tax_year between 2020 and 2100),` —
    // is still seen at top level.
    if (depth === 1) {
      const firstWord = line.split(/[\s(]/)[0].toLowerCase();
      // A line may fail to be a column in two different ways, and both are
      // decided by its FIRST word — the position a column name would occupy.
      // A table constraint (`unique (case_number)`) and a wrapped continuation
      // of the line above (`references public.employees(id) on delete
      // restrict,`) are both shaped like `name something`, and reading either
      // as a column invents a column called `unique` or `references`.
      const isConstraint =
        TABLE_CONSTRAINT_KEYWORDS.includes(firstWord) ||
        CONTINUATION_WORDS.includes(firstWord);
      const shaped = line.match(/^([a-z_][a-z0-9_]*)\s+(.+)$/i);

      if (!isConstraint && shaped) {
        const found = extractType(shaped[2], enumTypes);
        const key = `${createTable}.${shaped[1]}`;
        if (found && isKnownType(found.type)) {
          columns[key] = found.type;
        } else {
          unrecognised.push({
            table: createTable,
            column: shaped[1],
            rawType: found?.raw ?? shaped[2],
            line,
          });
        }
      }
    }

    for (const ch of line) {
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
    }
    if (depth <= 0) createTable = "";
  }

  return { columns, unrecognised };
}

/**
 * The arm every coverage gate uses: read the columns, and REFUSE if any
 * column-shaped line could not be classified.
 *
 * The message names the file, the table, the column and the type, because a
 * refusal that says only "parse error" sends the reader to the parser when the
 * answer is nearly always a new type in a new migration.
 */
export function migrationColumnTypesStrict(
  sourcePath: string,
): Readonly<Record<string, string>> {
  const { columns, unrecognised } = readMigrationColumns(sourcePath);

  if (unrecognised.length > 0) {
    const detail = unrecognised
      .map((u) => `  ${u.table}.${u.column} has type "${u.rawType}"\n      ${u.line}`)
      .join("\n");
    throw new Error(
      `UNRECOGNISED COLUMN TYPE in ${sourcePath}:\n${detail}\n\n` +
        `The parser refuses rather than skipping, because a skipped column is a column no ` +
        `coverage gate will ever ask about — the suite would stay green while reporting full ` +
        `coverage over a table it never fully read. That is exactly how five smallint columns ` +
        `in migration 0198, including wage_orders.priority, went unexamined.\n\n` +
        `If the type above is legitimate, add it to KNOWN_SQL_TYPES in ` +
        `src/lib/payroll/migration-columns.ts on purpose, having decided what the column is.`,
    );
  }

  return columns;
}
