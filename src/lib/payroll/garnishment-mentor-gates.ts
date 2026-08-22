/**
 * src/lib/payroll/garnishment-mentor-gates.ts   (books-35)
 *
 * THE RULE-26 COVERAGE GATES FOR THE GARNISHMENT MENTOR.
 *
 * Separate from `garnishment-mentor.ts` for the reason set out at the top of
 * `sick-leave-mentor-gates.ts`: these call `readFileSync`, the mentor's lesson
 * data is reachable from client components, and mixing the two put `node:fs`
 * into a browser bundle in books-33 and broke every deployment while CI stayed
 * green. Standing rule 65b. `tests/compliance/client-bundle-purity.test.ts`
 * walks the client component graph and fails, naming the exact chain, if the
 * boundary breaks again.
 *
 * WHY THESE GATES READ FROM DISK. A hand-typed list of columns, refusal codes
 * or function names passes forever after somebody adds one and forgets the
 * lesson — standing rule 50, dead code wearing a green check. Every gate below
 * parses the real migration or the real engine, and every gate refuses when it
 * parses NOTHING, because a coverage gate that inspects an empty list approves
 * everything (standing rule 39).
 *
 * Each gate also checks the OPPOSITE direction. A lesson beside a column that
 * was renamed or dropped reads as reassurance while covering nothing, and it is
 * the more dangerous of the two failures because the count still looks right.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { assertQuotedLessonsResolve } from "@/lib/payroll/mentor-quote-gate";

import { GARNISHMENT_AUTHORITIES } from "@/lib/payroll/garnishment-authorities";
import {
  GARNISHMENT_FIELD_LESSONS,
  GARNISHMENT_REFUSAL_LESSONS,
  GARNISHMENT_REVIEW_CHECKS,
  GARNISHMENT_SCREEN_LESSONS,
  taughtGarnishmentFieldNames,
} from "@/lib/payroll/garnishment-mentor";
import { migrationColumnTypesStrict } from "@/lib/payroll/migration-columns";
import { WAGE_ORDER_ENTRY_AUTHORITIES } from "@/lib/payroll/wage-order-entry-authorities";

const MIGRATION_0198 = join(
  "supabase",
  "migrations",
  "0198_sick_leave_and_garnishments.sql",
);
const GARNISHMENT_CORE = join("src", "lib", "payroll", "garnishment-core.ts");
/** This file, read from disk. See assertEveryQuotedGarnishmentLessonExists. */
const GARNISHMENT_GATES_SELF = join("src", "lib", "payroll", "garnishment-mentor-gates.ts");

/**
 * The one table this mentor is responsible for.
 *
 * Migration 0198 also creates the three sick-leave tables, which belong to a
 * different mentor. Filtering by table rather than by file is what lets two
 * mentors share one migration without either of them reporting the other's
 * columns as untaught.
 */
const GARNISHMENT_TABLES = ["wage_orders"];

/* ════════════════════════════════════════════════════════════════════════
 * READING THE MIGRATION
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Columns that exist but are not lessons.
 *
 * Surrogate keys, ownership keys and audit timestamps are structural: Michael
 * never chooses them and no filing depends on their VALUE.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THIS LIST IS NOT TRUSTED. IT IS CHECKED.
 * ────────────────────────────────────────────────────────────────────────
 * In books-34 a mutation campaign added `payroll_ytd_accumulators.oasdi_wages_cents`
 * — box 3 of the W-2 — to the equivalent list, and the entire suite stayed
 * GREEN. Every gate still ran, still read the migration, still reported full
 * coverage, while the most important figure in the table quietly stopped
 * needing an explanation.
 *
 * So `assertGarnishmentStructuralExemptionsAreJustified` requires every
 * exempted column to be structural BY ITS TYPE in the migration. Note what
 * that deliberately does NOT excuse here: `wage_orders.priority` is a
 * `smallint`, so it cannot be exempted and must earn a lesson — which is
 * correct, because it looks like an ordering detail and is in fact the field
 * people expect to control who gets paid first when the money runs out.
 */
export const GARNISHMENT_STRUCTURAL_COLUMNS: readonly string[] = [
  "wage_orders.id",
  "wage_orders.employee_id",
  "wage_orders.created_by_staff_id",
  "wage_orders.created_at",
  "wage_orders.updated_at",
];

/**
 * The only SQL types a column may have and still be exempt from a lesson.
 *
 * Exported so the test reads THIS list rather than a copy. A copy in the test
 * would pass forever after somebody widened the real one.
 */
export const GARNISHMENT_STRUCTURAL_TYPES: readonly string[] = ["uuid", "timestamptz"];

/**
 * EVERY migration that touches wage_orders, discovered rather than listed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE HOLE THIS CLOSES, FOUND IN books-38
 * ─────────────────────────────────────────────────────────────────────────
 * Until now this gate read exactly one file, 0198, because that is where
 * wage_orders was created. That was true and it was fragile, and books-38
 * proved it: migration 0201 added `wage_orders.served_date` — the column the
 * twenty-day answer deadline of RCW 26.18.110(1) and the sixty-day continuing
 * lien of RCW 6.27.350(1) are BOTH measured from — and this gate could not see
 * it. Measured, not assumed: `garnishmentMigrationColumnNames()` returned 23
 * names and `includes("wage_orders.served_date")` was false.
 *
 * So the most consequential date in the whole garnishment story could have
 * shipped with no lesson beside it while the coverage gate reported that every
 * column was taught. That is standing rule 50 exactly — dead code wearing a
 * green check — and the failure mode is the dangerous one, because the count
 * still looks right.
 *
 * Pinning a second filename would fix today and re-break at 0207. So the fix
 * is to the CLASS (rule 23): walk the migrations directory and read every file
 * that mentions the table. A future ALTER lands under the mentor automatically
 * and an untaught column fails here by name, with nothing to remember.
 */
function migrationsTouchingGarnishmentTables(): readonly string[] {
  const dir = join(process.cwd(), "supabase", "migrations");
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((f) => join(dir, f))
    .filter((p) => {
      const sql = readFileSync(p, "utf8");
      return GARNISHMENT_TABLES.some((t) => sql.includes(t));
    });
}

/**
 * @param sourcePath when given, read ONLY this file. The broken-input tests
 *        rely on being able to point the gate at a fragment; scanning the real
 *        directory in that case would drown the fragment in real columns.
 */
export function garnishmentMigrationColumnTypes(
  sourcePath?: string,
): Readonly<Record<string, string>> {
  const paths =
    sourcePath !== undefined ? [sourcePath] : migrationsTouchingGarnishmentTables();

  const mine: Record<string, string> = {};
  for (const p of paths) {
    for (const [k, v] of Object.entries(migrationColumnTypesStrict(p))) {
      // Later migrations win: an ALTER ... TYPE is the current truth.
      if (GARNISHMENT_TABLES.some((t) => k.startsWith(`${t}.`))) mine[k] = v;
    }
  }

  // Rule 39. A directory walk that matched nothing would make every coverage
  // assertion below vacuously true, which is the failure this whole file
  // exists to prevent. wage_orders had 23 columns at 0198 and 24 at 0201.
  if (sourcePath === undefined && Object.keys(mine).length < 20) {
    throw new Error(
      `garnishmentMigrationColumnTypes read only ${Object.keys(mine).length} ` +
        `wage_orders columns from ${paths.length} migration(s). That is too few ` +
        `to be real, so every coverage gate built on it would approve ` +
        `everything. Check that the migrations directory is readable and that ` +
        `the table has not been renamed.`,
    );
  }
  return mine;
}

export function garnishmentMigrationColumnNames(sourcePath?: string): readonly string[] {
  return Object.keys(garnishmentMigrationColumnTypes(sourcePath));
}

/**
 * No column may be exempted from needing a lesson unless it is structural by
 * its TYPE in the migration.
 *
 * The `requireEveryExemptionToExist` option exists for the same reason it does
 * in the sick-leave and YTD gates: `assertEveryGarnishmentFieldIsTaught` is
 * deliberately callable against a FRAGMENT of a migration — that is how its own
 * broken-input tests prove it is wired — and a fragment legitimately contains
 * none of the exempted columns. The fragment path therefore checks TYPES ONLY,
 * which is the arm that catches a widened exemption, and the staleness arm runs
 * where it is meaningful: against the whole migration, from its own test.
 */
export function assertGarnishmentStructuralExemptionsAreJustified(
  sourcePath?: string,
  opts: { readonly requireEveryExemptionToExist?: boolean } = {},
): void {
  const { requireEveryExemptionToExist = true } = opts;
  const types = garnishmentMigrationColumnTypes(sourcePath);
  if (Object.keys(types).length === 0) {
    throw new Error(
      "GARNISHMENT STRUCTURAL EXEMPTION GATE BROKEN: read no wage_orders columns from migration " +
        "0198, so every exemption would look unverifiable and the failure would point at the " +
        "wrong thing.",
    );
  }

  const unjustified: string[] = [];
  const nonexistent: string[] = [];
  for (const col of GARNISHMENT_STRUCTURAL_COLUMNS) {
    const t = types[col];
    if (t === undefined) {
      nonexistent.push(col);
      continue;
    }
    if (!GARNISHMENT_STRUCTURAL_TYPES.includes(t)) unjustified.push(`${col} (${t})`);
  }

  // THE TYPE CHECK IS REPORTED FIRST, ON PURPOSE. If an exemption is both
  // stale and mistyped, the mistyped one is the dangerous finding — a stale
  // exemption protects nothing, while a mistyped one hides a live figure.
  if (unjustified.length > 0) {
    throw new Error(
      `WAGE ORDER COLUMNS EXEMPTED FROM NEEDING A LESSON THAT ARE NOT STRUCTURAL: ` +
        `${unjustified.join(", ")}. Only ${GARNISHMENT_STRUCTURAL_TYPES.join(" and ")} columns ` +
        `may be exempt — a text, boolean, integer or smallint column on a wage order holds a ` +
        `decision that changes how much money is taken from somebody's pay, and listing it here ` +
        `would hide it behind a green check.`,
    );
  }

  if (requireEveryExemptionToExist && nonexistent.length > 0) {
    throw new Error(
      `GARNISHMENT STRUCTURAL EXEMPTIONS FOR COLUMNS THAT DO NOT EXIST: ${nonexistent.join(", ")}. ` +
        `A stale exemption is worse than none, because it silently widens as columns are renamed.`,
    );
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * FIELD COVERAGE
 * ════════════════════════════════════════════════════════════════════════ */

export function assertEveryGarnishmentFieldIsTaught(sourcePath?: string): void {
  const fromMigration = garnishmentMigrationColumnNames(sourcePath);
  if (fromMigration.length === 0) {
    throw new Error(
      "GARNISHMENT MENTOR COVERAGE GATE BROKEN: read no wage_orders columns from migration 0198. " +
        "A gate that inspects nothing passes vacuously and protects nothing.",
    );
  }

  // The exemption list is validated BEFORE it is applied. Applying it first
  // and checking it afterwards would let an unjustified exemption suppress the
  // very coverage gap it created, for the duration of this call.
  assertGarnishmentStructuralExemptionsAreJustified(sourcePath, {
    requireEveryExemptionToExist: false,
  });

  const structural = new Set(GARNISHMENT_STRUCTURAL_COLUMNS);
  const shouldBeTaught = fromMigration.filter((f) => !structural.has(f));
  if (shouldBeTaught.length === 0) {
    throw new Error(
      "GARNISHMENT MENTOR COVERAGE GATE BROKEN: every column read from migration 0198 was " +
        "classified as structural, so no lesson would ever be required. Either the parser is " +
        "wrong or the structural exemption list has swallowed the whole table.",
    );
  }

  const taught = new Set(taughtGarnishmentFieldNames());
  const untaught = shouldBeTaught.filter((f) => !taught.has(f));
  if (untaught.length > 0) {
    throw new Error(
      `GARNISHMENT MENTOR COVERAGE GAP: these columns have no lesson: ${untaught.join(", ")}. ` +
        `Standing rule 26 requires every field Michael can see, or that changes what is taken ` +
        `from an employee's pay, to be explained before it ships. Garnishment is the one place ` +
        `in payroll where the EMPLOYER is personally liable for the arithmetic, and every wrong ` +
        `answer is still a plausible dollar figure.`,
    );
  }
}

/**
 * The other direction: no lesson may teach a column that does not exist.
 *
 * This is the gate that catches a rename. A lesson beside a renamed column
 * reads as reassurance while covering nothing at all.
 */
export function assertNoGarnishmentLessonForUnknownField(sourcePath?: string): void {
  const known = new Set(garnishmentMigrationColumnNames(sourcePath));
  if (known.size === 0) {
    throw new Error(
      "GARNISHMENT MENTOR GATE BROKEN: no columns were read from migration 0198, so every lesson " +
        "would look stray and the failure would point at the lessons instead of at the parser.",
    );
  }
  const stray = taughtGarnishmentFieldNames().filter((f) => !known.has(f));
  if (stray.length > 0) {
    throw new Error(
      `GARNISHMENT MENTOR TEACHES COLUMNS THAT DO NOT EXIST: ${stray.join(", ")}. Either the ` +
        `column was renamed and the lesson was not, or the lesson is for a column that was never ` +
        `added.`,
    );
  }
}

export function assertNoDuplicateGarnishmentFieldLessons(): void {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const f of taughtGarnishmentFieldNames()) {
    if (seen.has(f)) dupes.push(f);
    seen.add(f);
  }
  if (dupes.length > 0) {
    throw new Error(
      `DUPLICATE WAGE ORDER FIELD LESSONS: ${dupes.join(", ")}. Two lessons for one column means ` +
        `one of them is wrong and there is no way to tell which is being read.`,
    );
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * AUTHORITIES
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Every authority a garnishment lesson is allowed to cite.
 *
 * books-38. This used to be `GARNISHMENT_AUTHORITIES` alone, which was right
 * while there was one registry. Garnishment then split into two acts with two
 * bodies of law behind them, and they are genuinely different subjects:
 *
 *   GARNISHMENT_AUTHORITIES          — the MATH of withholding. How much may
 *                                      be taken: the CCPA caps, disposable
 *                                      earnings, the Washington exemptions.
 *   WAGE_ORDER_ENTRY_AUTHORITIES     — the ACT of receiving an order. The duty
 *                                      to answer, the employer's own liability
 *                                      for ignoring it, the processing fee,
 *                                      anti-retaliation, when it expires.
 *
 * The `served_date` lesson needs the second set, because that column exists to
 * answer a question about deadlines rather than about dollars. Merging the two
 * here — rather than loosening the check, or copying the ids into a second
 * list that would quietly disagree — keeps the guarantee intact: a citation
 * still has to point at a real, mirrored authority, and there is exactly one
 * place that decides what "real" means.
 */
const CITABLE_AUTHORITY_IDS: readonly string[] = [
  ...GARNISHMENT_AUTHORITIES.map((a) => a.id),
  ...WAGE_ORDER_ENTRY_AUTHORITIES.map((a) => a.id),
];

export function assertEveryCitedGarnishmentAuthorityExists(): void {
  const known = new Set(CITABLE_AUTHORITY_IDS);
  if (known.size === 0) {
    throw new Error(
      "GARNISHMENT AUTHORITY GATE BROKEN: the authority registry is empty, so every citation " +
        "would look dangling and the failure would point at the lessons instead of at the registry.",
    );
  }
  const dangling: string[] = [];
  for (const l of GARNISHMENT_FIELD_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) dangling.push(`${l.field} -> ${id}`);
  }
  for (const l of GARNISHMENT_SCREEN_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) dangling.push(`${l.topic} -> ${id}`);
  }
  for (const c of GARNISHMENT_REVIEW_CHECKS) {
    for (const id of c.authorityIds) if (!known.has(id)) dangling.push(`${c.key} -> ${id}`);
  }
  if (dangling.length > 0) {
    throw new Error(
      `GARNISHMENT MENTOR CITES AUTHORITIES THAT DO NOT EXIST: ${dangling.join(", ")}. A citation ` +
        `with nothing behind it is worse than none, because the reader believes it was checked.`,
    );
  }
}

/**
 * Authorities no lesson uses. REPORTED, NOT THROWN.
 *
 * A mirrored authority that no lesson happens to cite is not a defect, but it
 * is worth being able to see, because it is usually a lesson somebody meant to
 * write.
 */
export function unusedGarnishmentAuthorityIds(): readonly string[] {
  const used = new Set<string>();
  for (const l of GARNISHMENT_FIELD_LESSONS) for (const id of l.authorityIds) used.add(id);
  for (const l of GARNISHMENT_SCREEN_LESSONS) for (const id of l.authorityIds) used.add(id);
  for (const c of GARNISHMENT_REVIEW_CHECKS) for (const id of c.authorityIds) used.add(id);
  return GARNISHMENT_AUTHORITIES.filter((a) => !used.has(a.id)).map((a) => a.id);
}

/* ════════════════════════════════════════════════════════════════════════
 * REFUSAL CODES
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * The refusal codes the ENGINE declares, parsed from its union type on disk.
 *
 * Deliberately not imported as a value — a TypeScript union has no runtime
 * representation, so the only way to know what the engine actually declares is
 * to read the source. That is also what makes the gate honest: it cannot be
 * satisfied by editing a list in the mentor.
 */
export function garnishmentEngineRefusalCodes(sourcePath?: string): readonly string[] {
  const p = sourcePath ?? join(process.cwd(), GARNISHMENT_CORE);
  const text = readFileSync(p, "utf8");
  const block = text.match(/export type GarnishmentRefusalCode\s*=([\s\S]*?);/);
  if (!block) return [];
  return [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

export function assertEveryGarnishmentRefusalCodeIsTaught(sourcePath?: string): void {
  const codes = garnishmentEngineRefusalCodes(sourcePath);
  if (codes.length === 0) {
    throw new Error(
      "GARNISHMENT REFUSAL GATE BROKEN: read no refusal codes from garnishment-core.ts. A gate " +
        "that parses nothing approves everything.",
    );
  }
  const taught = new Set(GARNISHMENT_REFUSAL_LESSONS.map((l) => l.code as string));
  const untaught = codes.filter((c) => !taught.has(c));
  if (untaught.length > 0) {
    throw new Error(
      `GARNISHMENT REFUSAL CODES WITH NO EXPLANATION: ${untaught.join(", ")}. A refusal that ` +
        `reaches Michael as a bare code is a dead end, and a dead end in garnishment is where ` +
        `somebody overrides the software and withholds a number they made up.`,
    );
  }
  const phantom = [...taught].filter((c) => !codes.includes(c));
  if (phantom.length > 0) {
    throw new Error(
      `GARNISHMENT MENTOR EXPLAINS REFUSAL CODES THAT NO LONGER EXIST: ${phantom.join(", ")}. A ` +
        `stale entry masks a real gap, because the count looks right while a live code goes ` +
        `untaught.`,
    );
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * EXPORTED FUNCTION COVERAGE
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Which engine functions the mentor explains, and where.
 *
 * A judgement call, so it is written out rather than inferred. Each entry names
 * the lesson carrying the explanation, so a reader can check the claim instead
 * of taking it on trust.
 */
export const GARNISHMENT_CORE_FUNCTION_COVERAGE: Readonly<Record<string, string>> = {
  centsToDollars:
    "Taught by the amount_cents_per_period field lesson and the basis-points lesson beside it: " +
    "every figure in this engine is an integer number of cents precisely so that no garnishment " +
    "ever moves by a rounding artefact, and this is the one place they are turned into something " +
    "a person reads.",
  computeDisposableEarnings:
    "Taught by the screen lesson 'Disposable earnings is not take-home pay' — the most expensive " +
    "misunderstanding in the field, and the reason the engine reports the voluntary deductions it " +
    "deliberately did NOT subtract instead of quietly leaving them out.",
  protectedFloorCents:
    "Taught by the screen lesson 'The protected floor is weekly, and Greenway pays biweekly', " +
    "which explains why the weekly figure must be multiplied by the workweeks in the period and " +
    "why using the unmultiplied floor takes about twice the lawful amount.",
  ccpaCeiling:
    "Taught by the screen lesson 'The employee always gets whichever rule protects them more' and " +
    "by 'Every number on the screen arrives with the sentence that produced it', which explains " +
    "why the engine decides which limit bound BEFORE rounding rather than after.",
  washingtonExemption:
    "Taught by the screen lesson on Washington's exemptions differing by debt type — eighty-five " +
    "percent and fifty times the state wage for student loans, eighty and thirty-five for " +
    "consumer debt, seventy-five and thirty-five against the federal wage for ordinary creditors.",
  supportCap:
    "Taught by the screen lesson 'Support orders are not held to twenty-five percent' together " +
    "with the supports_second_family and arrears_over_twelve_weeks field lessons, which are the " +
    "two yes-or-no answers this function refuses to proceed without.",
  computeOneOrder:
    "Taught by the six review checks, which are the questions this function answers in order, and " +
    "by the shortfall screen lesson explaining why the difference between what an order demands " +
    "and what the caps allow is reported rather than carried forward.",
  computeAllOrders:
    "Taught by the screen lessons on equal apportionment of competing maintenance orders and on " +
    "priority, which explain why support outranks everything by federal law regardless of the " +
    "priority numbers typed on the orders themselves.",
};

/**
 * The functions the ENGINE exports, read from its source on disk.
 *
 * Same reasoning as the refusal codes: read the file, do not trust a list.
 */
/**
 * Every lesson title GARNISHMENT_CORE_FUNCTION_COVERAGE quotes must exist.
 *
 * books-36, standing rule 23: fix the CLASS, not the instance. The identical
 * hole was found by mutation in the sick-leave coverage map — deleting a
 * quoted lesson left the suite green while the map went on telling readers
 * where teaching lived that had been deleted. This map quotes five lesson
 * titles and had exactly the same exposure, so it gets the same gate. The
 * shared implementation lives in mentor-quote-gate.ts rather than being
 * copied, so a fix here is a fix everywhere (standing rule 25).
 *
 * `topicsOverride` exists so a test can hand this a deliberately broken lesson
 * list and prove the gate BITES (standing rule 16).
 */
export function assertEveryQuotedGarnishmentLessonExists(
  topicsOverride?: readonly string[],
): void {
  assertQuotedLessonsResolve({
    gatesSourcePath: GARNISHMENT_GATES_SELF,
    mapName: "GARNISHMENT_CORE_FUNCTION_COVERAGE",
    topics: topicsOverride ?? GARNISHMENT_SCREEN_LESSONS.map((l) => l.topic),
    label: "GARNISHMENT",
  });
}

export function garnishmentExportedFunctionNames(sourcePath?: string): readonly string[] {
  const p = sourcePath ?? join(process.cwd(), GARNISHMENT_CORE);
  const text = readFileSync(p, "utf8");
  return [...text.matchAll(/^export function ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
}

export function assertEveryGarnishmentFunctionIsTaught(sourcePath?: string): void {
  const fns = garnishmentExportedFunctionNames(sourcePath);
  if (fns.length === 0) {
    throw new Error(
      "GARNISHMENT FUNCTION GATE BROKEN: read no exported functions from garnishment-core.ts. A " +
        "gate that parses nothing approves everything.",
    );
  }
  const covered = new Set(Object.keys(GARNISHMENT_CORE_FUNCTION_COVERAGE));
  const untaught = fns.filter((f) => !covered.has(f));
  if (untaught.length > 0) {
    throw new Error(
      `GARNISHMENT ENGINE FUNCTIONS WITH NO EXPLANATION: ${untaught.join(", ")}. Standing rule 26 ` +
        `requires the engine to be explainable, not merely correct.`,
    );
  }
  const phantom = [...covered].filter((f) => !fns.includes(f));
  if (phantom.length > 0) {
    throw new Error(
      `GARNISHMENT MENTOR EXPLAINS FUNCTIONS THAT NO LONGER EXIST: ${phantom.join(", ")}. A stale ` +
        `entry masks a real gap, because the count looks right while a live function goes ` +
        `untaught.`,
    );
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * THE REVIEW CHECKLIST
 * ════════════════════════════════════════════════════════════════════════ */

export function assertGarnishmentReviewChecksAreWellFormed(): void {
  if (GARNISHMENT_REVIEW_CHECKS.length === 0) {
    throw new Error(
      "GARNISHMENT REVIEW CHECKLIST GATE BROKEN: there are no checks, so the ordering rules below " +
        "would pass vacuously.",
    );
  }

  const orders = GARNISHMENT_REVIEW_CHECKS.map((c) => c.order);
  const expected = Array.from({ length: orders.length }, (_, i) => i + 1);
  if (orders.join(",") !== expected.join(",")) {
    throw new Error(
      `GARNISHMENT REVIEW CHECKS ARE NOT IN A COMPLETE SEQUENCE: got ${orders.join(", ")}, ` +
        `expected ${expected.join(", ")}. The order is the teaching — a gap or a duplicate means ` +
        `a step is missing or two steps claim the same position.`,
    );
  }

  const keys = new Set<string>();
  for (const c of GARNISHMENT_REVIEW_CHECKS) {
    if (keys.has(c.key)) {
      throw new Error(`DUPLICATE GARNISHMENT REVIEW CHECK KEY: ${c.key}.`);
    }
    keys.add(c.key);
  }

  // Disposable earnings must be computed first. Every cap that follows is a
  // percentage of it, so a checklist that asks about caps before the base
  // teaches the wrong order of thinking even if every individual step is right.
  if (GARNISHMENT_REVIEW_CHECKS[0].key !== "disposable-first") {
    throw new Error(
      `GARNISHMENT REVIEW CHECKLIST STARTS IN THE WRONG PLACE: the first check is ` +
        `'${GARNISHMENT_REVIEW_CHECKS[0].key}'. Disposable earnings must be established before ` +
        `any ceiling is discussed, because every ceiling is a percentage of it.`,
    );
  }
}
