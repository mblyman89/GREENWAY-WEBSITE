/**
 * src/lib/payroll/ytd-mentor-gates.ts   (books-34)
 *
 * THE RULE-26 COVERAGE GATES FOR THE YEAR-TO-DATE MENTOR.
 *
 * These live apart from `ytd-mentor.ts` for one reason, recorded as standing
 * rule 65b: they call `readFileSync`, and the mentor's lesson data is imported
 * by client components. In books-33 that combination dragged `node:fs` into a
 * browser bundle and Turbopack refused every Vercel deployment -
 *
 *     the chunking context (unknown) does not support external modules
 *     (request: node:fs)
 *
 * - while GitHub Actions stayed green, because CI ran vitest and the migrations
 * and never once ran `next build`. Nothing here is softer than it would have
 * been inside the mentor; the strictness simply lives where a browser cannot
 * reach it. `tests/compliance/client-bundle-purity.test.ts` walks the client
 * component graph and fails if any `"use client"` file can reach this module.
 *
 * WHY THESE GATES READ FROM DISK AT ALL. A hand-typed list of columns, refusal
 * codes or function names passes forever after somebody adds one and forgets
 * the lesson. That is standing rule 50 - dead code wearing a green check. Every
 * gate below therefore parses the real migration or the real engine, and every
 * gate refuses when it parses NOTHING, because a coverage gate that inspects an
 * empty list approves everything (standing rule 39).
 *
 * Each gate also checks the OPPOSITE direction. A lesson beside a column that
 * was renamed or dropped reads as reassurance while covering nothing, and it is
 * worse than a missing lesson because the count looks right.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { migrationColumnTypesStrict } from "@/lib/payroll/migration-columns";
import { YTD_AUTHORITIES } from "@/lib/payroll/ytd-authorities";
import {
  YTD_FIELD_LESSONS,
  YTD_REFUSAL_LESSONS,
  YTD_SCREEN_LESSONS,
  YTD_YEAR_END_CHECKS,
  taughtFieldNames,
  type YtdYearEndCheckKey,
} from "@/lib/payroll/ytd-mentor";

const MIGRATION_0199 = join(
  "supabase",
  "migrations",
  "0199_payroll_ytd_accumulators.sql",
);
const YTD_CORE = join("src", "lib", "payroll", "ytd-core.ts");

/* ═══════════════════════════════════════════════════════════════════════════ *
 * READING THE MIGRATION
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Columns that exist but are not lessons.
 *
 * Surrogate keys, ownership keys and audit timestamps are structural: Michael
 * never chooses them and no filing depends on their VALUE. Written out
 * explicitly rather than filtered by a naming pattern, so that adding a real
 * column called `something_at` cannot slip through by resembling one of these.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS LIST IS NOT TRUSTED. IT IS CHECKED. And it was not, until a mutation
 * campaign proved it did not have to be.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `scripts/prove-ytd-mentor-gates.sh` added one line to this array -
 * `payroll_ytd_accumulators.oasdi_wages_cents`, which is box 3 of the W-2 - and
 * the whole suite stayed GREEN. Every gate still ran, still read the migration
 * from disk, still reported full coverage. Meanwhile the single most important
 * figure in the table had quietly stopped needing a lesson.
 *
 * That is standing rule 23 exactly: the defect is not the missing lesson, it is
 * that an exemption list could be extended by anyone, for any reason, with
 * nothing to contradict it. So `assertStructuralExemptionsAreJustified` below
 * requires every exempted column to be structural BY ITS TYPE in the migration -
 * a `uuid` key or a `timestamptz` audit stamp. A `bigint` or an `integer` holds
 * a quantity that reaches a filing, and no amount of listing it here will
 * excuse it from being explained.
 */
export const STRUCTURAL_COLUMNS: readonly string[] = [
  "payroll_ytd_accumulators.id",
  "payroll_ytd_accumulators.employee_id",
  "payroll_ytd_accumulators.created_at",
  "payroll_ytd_accumulators.updated_at",
];

/**
 * The only SQL types a column may have and still be exempt from a lesson.
 *
 * Exported so the test reads THIS list rather than a copy of it. A copy in the
 * test would pass forever after somebody widened the real one.
 */
export const STRUCTURAL_TYPES: readonly string[] = ["uuid", "timestamptz"];

/**
 * No column may be exempted from needing a lesson unless it is structural by
 * its TYPE in the migration.
 *
 * Note what this deliberately does NOT exempt: `last_run_id` is a uuid and
 * `last_recomputed_at` is a timestamptz, so both COULD sit on the exemption
 * list by type - and neither does, because both carry meaning Michael has to
 * understand. Being eligible for exemption is not the same as being exempt.
 * This gate sets the ceiling on what may be excused; the lessons decide what
 * actually is.
 */
export function assertStructuralExemptionsAreJustified(
  sourcePath?: string,
  opts: { readonly requireEveryExemptionToExist?: boolean } = {},
): void {
  const { requireEveryExemptionToExist = true } = opts;
  const types = migrationColumnTypes(sourcePath);
  if (Object.keys(types).length === 0) {
    throw new Error(
      "STRUCTURAL EXEMPTION GATE BROKEN: read no columns from migration 0199, so every exemption " +
        "would look unverifiable and the failure would point at the wrong thing.",
    );
  }

  const unjustified: string[] = [];
  const nonexistent: string[] = [];
  for (const col of STRUCTURAL_COLUMNS) {
    const t = types[col];
    if (t === undefined) {
      nonexistent.push(col);
      continue;
    }
    if (!STRUCTURAL_TYPES.includes(t)) unjustified.push(`${col} (${t})`);
  }

  // THE TYPE CHECK IS REPORTED FIRST, AND ON PURPOSE. If an exemption is both
  // stale and mistyped, the mistyped one is the dangerous finding - a stale
  // exemption protects nothing, while a mistyped one hides a live figure.
  if (unjustified.length > 0) {
    throw new Error(
      `COLUMNS EXEMPTED FROM NEEDING A LESSON THAT ARE NOT STRUCTURAL: ${unjustified.join(", ")}. ` +
        `Only ${STRUCTURAL_TYPES.join(" and ")} columns may be exempt - a numeric column holds a ` +
        `quantity that reaches a filing, and listing it here would hide a W-2 figure behind a ` +
        `green check.`,
    );
  }

  // The staleness arm is OPTIONAL, and the reason is not convenience.
  //
  // `assertEveryFieldIsTaught` is deliberately callable against a fragment of a
  // migration - that is how its own broken-input tests prove it is wired. A
  // fragment legitimately contains none of the exempted columns, and failing
  // there would mean the coverage gate could no longer be tested at all. So the
  // fragment path checks TYPES ONLY, which is the arm that catches a widened
  // exemption, and the staleness arm runs where it is meaningful: against the
  // whole migration, from the test that calls this directly.
  if (requireEveryExemptionToExist && nonexistent.length > 0) {
    throw new Error(
      `STRUCTURAL EXEMPTIONS FOR COLUMNS THAT DO NOT EXIST: ${nonexistent.join(", ")}. A stale ` +
        `exemption is worse than none, because it silently widens as columns are renamed.`,
    );
  }
}

/**
 * Every column migration 0199 introduces, qualified as `table.column`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PARSER THAT USED TO LIVE HERE HAD A HOLE, AND books-35 FOUND IT.
 * ─────────────────────────────────────────────────────────────────────────────
 * It matched a column by requiring its type to be one of eight it knew:
 *
 *     /^([a-z_]+)\s+(uuid|bigint|integer|text|boolean|timestamptz|numeric|date)\b/i
 *
 * A line whose type was the ninth was not reported, not counted and not
 * refused. It was SKIPPED. Every coverage gate downstream then asked "is every
 * column taught?" of a list that was quietly short, and answered yes.
 *
 * Migration 0199 escaped only by luck — it contains no such type. Migration
 * 0198 next door lost FIVE columns, all `smallint`, among them
 * `wage_orders.priority`, which decides which garnishment gets paid first, and
 * the three `sick_leave_policy` knobs the sick-leave engine refuses on.
 *
 * Standing rule 23 says fix the class. So the parsing now lives in
 * `src/lib/payroll/migration-columns.ts`, shared by every mentor's gates, and
 * an unrecognised type REFUSES by name instead of skipping (standing rule 48 —
 * a check that cannot classify its input must say so). This function is kept
 * as the 0199-shaped front door so existing callers and tests read the same,
 * but the reading itself is no longer duplicated here (standing rule 25).
 */
export function migrationColumnTypes(
  sourcePath?: string,
): Readonly<Record<string, string>> {
  const p = sourcePath ?? join(process.cwd(), MIGRATION_0199);
  return migrationColumnTypesStrict(p);
}

export function migrationColumnNames(sourcePath?: string): readonly string[] {
  return Object.keys(migrationColumnTypes(sourcePath));
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * FIELD COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

export function assertEveryFieldIsTaught(sourcePath?: string): void {
  const fromMigration = migrationColumnNames(sourcePath);
  if (fromMigration.length === 0) {
    throw new Error(
      "MENTOR COVERAGE GATE BROKEN: read no columns from migration 0199. A gate that inspects " +
        "nothing passes vacuously and protects nothing.",
    );
  }

  // The exemption list is validated BEFORE it is applied. Applying it first
  // and checking it afterwards would let an unjustified exemption suppress the
  // very coverage gap it created, for the duration of this call.
  //
  // Types only here: this function is called against migration fragments in its
  // own broken-input tests, and a fragment does not contain the exempted
  // columns. The type arm is the one that matters anyway - it is the arm a
  // mutation campaign got past.
  assertStructuralExemptionsAreJustified(sourcePath, {
    requireEveryExemptionToExist: false,
  });

  const structural = new Set(STRUCTURAL_COLUMNS);
  const shouldBeTaught = fromMigration.filter((f) => !structural.has(f));
  if (shouldBeTaught.length === 0) {
    throw new Error(
      "MENTOR COVERAGE GATE BROKEN: every column read from migration 0199 was classified as " +
        "structural, so no lesson would ever be required. Either the parser is wrong or the " +
        "structural exemption list has swallowed the whole table.",
    );
  }

  const taught = new Set(taughtFieldNames());
  const untaught = shouldBeTaught.filter((f) => !taught.has(f));
  if (untaught.length > 0) {
    throw new Error(
      `MENTOR COVERAGE GAP: these columns have no lesson: ${untaught.join(", ")}. Standing rule 26 ` +
        `requires every field Michael can see or that reaches a filing to be explained before it ` +
        `ships. Year-to-date figures are the ones nobody checks until January, so an unexplained ` +
        `column here is an unexplained figure on a W-2.`,
    );
  }
}

/**
 * The other direction: no lesson may teach a column that does not exist.
 *
 * This is the gate that catches a rename. A lesson beside a column that was
 * renamed reads as reassurance while covering nothing at all.
 */
export function assertNoLessonForUnknownField(sourcePath?: string): void {
  const known = new Set(migrationColumnNames(sourcePath));
  if (known.size === 0) {
    throw new Error(
      "MENTOR GATE BROKEN: no columns were read from migration 0199, so every lesson would look " +
        "stray and the failure would point at the lessons instead of at the parser.",
    );
  }
  const stray = taughtFieldNames().filter((f) => !known.has(f));
  if (stray.length > 0) {
    throw new Error(
      `MENTOR TEACHES COLUMNS THAT DO NOT EXIST: ${stray.join(", ")}. Either the column was renamed ` +
        `and the lesson was not, or the lesson is for a column that was never added.`,
    );
  }
}

/** No field may be taught twice - two lessons for one column can disagree. */
export function assertNoDuplicateFieldLessons(): void {
  const seen = new Set<string>();
  const duplicated: string[] = [];
  for (const f of taughtFieldNames()) {
    if (seen.has(f)) duplicated.push(f);
    seen.add(f);
  }
  if (duplicated.length > 0) {
    throw new Error(
      `DUPLICATE FIELD LESSONS: ${duplicated.join(", ")}. Two lessons for one column will eventually ` +
        `disagree, and whichever one a screen happens to render becomes the truth.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * CITATIONS
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Every authority id cited by any lesson must exist in the registry. */
export function assertEveryCitedAuthorityExists(): void {
  const known = new Set(YTD_AUTHORITIES.map((a) => a.id));
  if (known.size === 0) {
    throw new Error(
      "MENTOR CITATION GATE BROKEN: the YTD authority registry is empty, so every citation would " +
        "pass vacuously.",
    );
  }
  const dangling: string[] = [];
  for (const l of YTD_FIELD_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) dangling.push(`${l.field} -> ${id}`);
  }
  for (const l of YTD_SCREEN_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) dangling.push(`${l.topic} -> ${id}`);
  }
  for (const c of YTD_YEAR_END_CHECKS) {
    for (const id of c.authorityIds) if (!known.has(id)) dangling.push(`${c.key} -> ${id}`);
  }
  if (dangling.length > 0) {
    throw new Error(
      `MENTOR CITES AUTHORITIES THAT DO NOT EXIST: ${dangling.join(", ")}. A citation with nothing ` +
        `behind it is worse than none, because the reader believes it was checked.`,
    );
  }
}

/**
 * Authorities that no lesson uses. REPORTED, NOT THROWN.
 *
 * The same judgement the company-identity mentor made: a mirrored authority
 * that no lesson happens to cite is not a defect, but it is worth being able to
 * see, because it is often a lesson somebody meant to write.
 */
export function unusedAuthorityIds(): readonly string[] {
  const used = new Set<string>();
  for (const l of YTD_FIELD_LESSONS) for (const id of l.authorityIds) used.add(id);
  for (const l of YTD_SCREEN_LESSONS) for (const id of l.authorityIds) used.add(id);
  for (const c of YTD_YEAR_END_CHECKS) for (const id of c.authorityIds) used.add(id);
  return YTD_AUTHORITIES.filter((a) => !used.has(a.id)).map((a) => a.id);
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * REFUSAL CODES
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The refusal codes the ENGINE declares, parsed from its union type on disk.
 *
 * Deliberately not imported as a value - a TypeScript union has no runtime
 * representation, so the only way to know what the engine actually declares is
 * to read the source. That is also what makes the gate honest: it cannot be
 * satisfied by updating a list in the mentor.
 */
export function engineRefusalCodes(sourcePath?: string): readonly string[] {
  const p = sourcePath ?? join(process.cwd(), YTD_CORE);
  const text = readFileSync(p, "utf8");
  const block = text.match(/export type YtdRefusalCode\s*=([\s\S]*?);/);
  if (!block) return [];
  return [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

export function assertEveryRefusalCodeIsTaught(sourcePath?: string): void {
  const codes = engineRefusalCodes(sourcePath);
  if (codes.length === 0) {
    throw new Error(
      "MENTOR REFUSAL GATE BROKEN: read no refusal codes from ytd-core.ts. A gate that parses " +
        "nothing approves everything.",
    );
  }
  const taught = new Set(YTD_REFUSAL_LESSONS.map((l) => l.code as string));
  const untaught = codes.filter((c) => !taught.has(c));
  if (untaught.length > 0) {
    throw new Error(
      `REFUSAL CODES WITH NO EXPLANATION: ${untaught.join(", ")}. A refusal that reaches Michael as ` +
        `a bare code is a dead end, and a dead end in payroll is where somebody overrides the ` +
        `software.`,
    );
  }
  const phantom = [...taught].filter((c) => !codes.includes(c));
  if (phantom.length > 0) {
    throw new Error(
      `MENTOR EXPLAINS REFUSAL CODES THAT NO LONGER EXIST: ${phantom.join(", ")}. A stale entry ` +
        `masks a real gap, because the count looks right while a live code goes untaught.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * EXPORTED FUNCTION COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Which core functions the mentor explains, and where.
 *
 * A judgement call, so it is written out rather than inferred. Each entry names
 * the lesson that carries the explanation, so a reader can check the claim
 * instead of taking it.
 */
export const CORE_FUNCTION_COVERAGE: Readonly<Record<string, string>> = {
  emptyAccumulator:
    "Taught by the tax_year lesson: a year that has just begun genuinely has zero wages in it, so " +
    "zero here is a measured truth rather than a stand-in for something unknown.",
  applyRunToAccumulator:
    "Taught by the screen lesson on posting a run twice, and by the YTD_RUN_ALREADY_APPLIED and " +
    "YTD_MEDICARE_BELOW_OASDI refusal lessons - it is the function those refusals come from.",
  unapplyRunFromAccumulator:
    "Taught by the same screen lesson's second half, on voiding a run that was never unwound, and " +
    "by the YTD_WOULD_GO_NEGATIVE refusal lesson which explains why it stops instead of clamping.",
  ytdForWithholding:
    "Taught by the screen lesson on a ceiling you cannot see - this is the function that finally " +
    "tells the withholding engine where in the year the employee stands.",
  oasdiRoomRemaining:
    "Taught by the screen lesson on the wage base moving every year, which explains why the base is " +
    "passed in rather than assumed, and by the oasdi_wages_cents field lesson.",
  computePeriodWithYtd:
    "Taught by the screen lesson on one salary producing two different wage figures - it is the " +
    "function that produces the $184,500 and $199,750 pair from the IRS's own example.",
  reconcileAccumulator:
    "Taught by the screen lesson on a stored total being a claim about rows somewhere else, and by " +
    "the reconcile-to-lines year-end check. Both say the same thing: it reports, it never repairs.",
  rebuildAccumulator:
    "Taught by the last_recomputed_at field lesson and by the YTD_WOULD_GO_NEGATIVE refusal lesson, " +
    "which sends Michael here deliberately - repairing is a separate act from detecting.",
  taxYearForPayDate:
    "Taught by the screen lesson on wages belonging to the year they are PAID, and by the tax_year " +
    "field lesson which names the December-into-January pay period as the case that goes wrong.",
  assertRowMatches:
    "Taught by the YTD_EMPLOYEE_MISMATCH and YTD_YEAR_MISMATCH refusal lessons, which explain why " +
    "crediting one employee's wages to another produces two wrong W-2s and no error anywhere.",
};

export function exportedCoreFunctionNames(sourcePath?: string): readonly string[] {
  const p = sourcePath ?? join(process.cwd(), YTD_CORE);
  const text = readFileSync(p, "utf8");
  return [...text.matchAll(/^export function ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
}

export function assertEveryExportedFunctionIsTaught(sourcePath?: string): void {
  const exported = exportedCoreFunctionNames(sourcePath);
  if (exported.length === 0) {
    throw new Error(
      "MENTOR COVERAGE GATE BROKEN: read no exported functions from ytd-core.ts. A coverage gate " +
        "that inspects nothing passes vacuously and protects nothing.",
    );
  }
  const uncovered = exported.filter((f) => !(f in CORE_FUNCTION_COVERAGE));
  if (uncovered.length > 0) {
    throw new Error(
      `MENTOR COVERAGE GAP: these exported functions have no explanation: ${uncovered.join(", ")}. ` +
        `Standing rule 26 requires every exported function to be taught before it ships.`,
    );
  }
  const phantom = Object.keys(CORE_FUNCTION_COVERAGE).filter((k) => !exported.includes(k));
  if (phantom.length > 0) {
    throw new Error(
      `MENTOR EXPLAINS FUNCTIONS THAT NO LONGER EXIST: ${phantom.join(", ")}. A stale coverage entry ` +
        `masks a real gap, because the count looks right while a live function goes untaught.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 * YEAR-END CHECKLIST WELL-FORMEDNESS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The checklist must be a usable order, not a set.
 *
 * Same shape of gate as the timesheet setup steps, and for the same reason: a
 * prerequisite declared after the step that needs it lets a panel report a step
 * complete while its prerequisite is still outstanding.
 */
export function assertYearEndChecksAreWellFormed(): void {
  if (YTD_YEAR_END_CHECKS.length === 0) {
    throw new Error(
      "YEAR-END CHECK GATE BROKEN: there are no checks, so the checklist would always read complete.",
    );
  }
  const keys = new Set(YTD_YEAR_END_CHECKS.map((c) => c.key));
  if (keys.size !== YTD_YEAR_END_CHECKS.length) {
    throw new Error(
      "DUPLICATE YEAR-END CHECK KEYS: two checks share a key, so one will overwrite the other " +
        "wherever the list is indexed.",
    );
  }

  const seen = new Set<YtdYearEndCheckKey>();
  for (const c of YTD_YEAR_END_CHECKS) {
    for (const r of c.requires) {
      if (!keys.has(r)) {
        throw new Error(`YEAR-END CHECK ${c.key} REQUIRES AN UNKNOWN CHECK: ${r}.`);
      }
      if (!seen.has(r)) {
        throw new Error(
          `YEAR-END CHECK ${c.key} REQUIRES ${r}, WHICH COMES LATER IN THE LIST. Prerequisites must ` +
            `be declared before the checks that need them, otherwise the checklist can report a ` +
            `check passed while its prerequisite is still outstanding.`,
        );
      }
    }
    seen.add(c.key);
  }

  // Reconciliation must come first and must be a prerequisite of the filing
  // checks. Every other check compares a stored figure against a rule, and that
  // comparison is meaningless until the stored figure has been proven to match
  // the lines beneath it.
  if (YTD_YEAR_END_CHECKS[0].key !== "reconcile-to-lines") {
    throw new Error(
      "RECONCILIATION IS NOT THE FIRST YEAR-END CHECK. Checking a wage base against a figure that " +
        "has drifted tells you about the drift, not about the wage base.",
    );
  }
  const unreconciled = YTD_YEAR_END_CHECKS.filter(
    (c) => c.key !== "reconcile-to-lines" && !c.requires.includes("reconcile-to-lines"),
  );
  if (unreconciled.length > 0) {
    throw new Error(
      `YEAR-END CHECKS THAT DO NOT REQUIRE RECONCILIATION: ${unreconciled
        .map((c) => c.key)
        .join(", ")}. Each of these would be comparing a stored total that has not been proven to ` +
        `match its lines.`,
    );
  }

  if (!YTD_YEAR_END_CHECKS.some((c) => c.blocksFiling)) {
    throw new Error(
      "NO YEAR-END CHECK BLOCKS FILING: the checklist would permit a W-2 to be produced from totals " +
        "that failed every test on it.",
    );
  }
}

/**
 * The three SSA rejection conditions must each appear in the year-end checks.
 *
 * Named individually rather than counted, because "three checks exist" would
 * stay true if one of them were replaced by a duplicate of another - and the
 * whole value of this list is that it covers all three conditions the SSA
 * applies mechanically before any human reads the wage report.
 */
export function assertSsaRejectionConditionsAreChecked(): void {
  const required: readonly YtdYearEndCheckKey[] = [
    "medicare-not-below-social-security",
    "no-tax-without-wages",
    "wage-base-not-exceeded",
  ];
  const present = new Set(YTD_YEAR_END_CHECKS.map((c) => c.key));
  const missing = required.filter((k) => !present.has(k));
  if (missing.length > 0) {
    throw new Error(
      `YEAR-END CHECKLIST MISSES AN SSA REJECTION CONDITION: ${missing.join(", ")}. These are the ` +
        `conditions the SSA applies mechanically, so a wage report that violates one is rejected ` +
        `before anybody looks at it.`,
    );
  }
  const notBlocking = required.filter(
    (k) => !YTD_YEAR_END_CHECKS.find((c) => c.key === k)?.blocksFiling,
  );
  if (notBlocking.length > 0) {
    throw new Error(
      `SSA REJECTION CONDITIONS THAT DO NOT BLOCK FILING: ${notBlocking.join(", ")}. Filing anyway ` +
        `guarantees a rejected wage report, so a warning is not enough.`,
    );
  }
}
