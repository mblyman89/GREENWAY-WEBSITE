/**
 * src/lib/payroll/sick-leave-mentor-gates.ts   (books-35)
 *
 * THE RULE-26 COVERAGE GATES FOR THE SICK LEAVE MENTOR.
 *
 * Separate from `sick-leave-mentor.ts` because these call `readFileSync` and
 * the mentor's lesson data is imported by client components. That is standing
 * rule 65b, and it was learned expensively: in books-33 the two were mixed,
 * `node:fs` landed in a browser bundle, and Turbopack refused every Vercel
 * deployment —
 *
 *     the chunking context (unknown) does not support external modules
 *     (request: node:fs)
 *
 * — while GitHub Actions stayed green, because CI ran vitest and the migrations
 * and never once ran `next build`. Nothing here is softer than it would be
 * inside the mentor; the strictness simply lives where a browser cannot reach
 * it. `tests/compliance/client-bundle-purity.test.ts` walks the client
 * component graph and fails, naming the exact chain, if that boundary breaks.
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
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { migrationColumnTypesStrict } from "@/lib/payroll/migration-columns";
import { SICK_LEAVE_AUTHORITIES } from "@/lib/payroll/sick-leave-authorities";
import {
  SICK_LEAVE_FIELD_LESSONS,
  SICK_LEAVE_REFUSAL_LESSONS,
  SICK_LEAVE_REVIEW_CHECKS,
  SICK_LEAVE_SCREEN_LESSONS,
  taughtSickLeaveFieldNames,
} from "@/lib/payroll/sick-leave-mentor";

const MIGRATION_0198 = join(
  "supabase",
  "migrations",
  "0198_sick_leave_and_garnishments.sql",
);
const SICK_CORE = join("src", "lib", "payroll", "sick-leave-core.ts");

/** The three tables this mentor is responsible for. */
const SICK_TABLES = ["sick_leave_policy", "sick_leave_requests", "sick_leave_ledger"];

/* ═══════════════════════════════════════════════════════════════════════════
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
 * THIS LIST IS NOT TRUSTED. IT IS CHECKED.
 * ─────────────────────────────────────────────────────────────────────────────
 * In books-34 a mutation campaign added `payroll_ytd_accumulators.oasdi_wages_cents`
 * — box 3 of the W-2 — to the equivalent list, and the entire suite stayed
 * GREEN. Every gate still ran, still read the migration, still reported full
 * coverage, while the most important figure in the table quietly stopped
 * needing an explanation.
 *
 * So `assertSickStructuralExemptionsAreJustified` requires every exempted
 * column to be structural BY ITS TYPE in the migration. Note what that
 * deliberately does NOT excuse here: `sick_leave_policy.id` is a `smallint`,
 * not a `uuid`, so it cannot be exempted and must earn a lesson — which is
 * correct, because the constraint pinning it to the value 1 is the only thing
 * making the policy a singleton, and that is worth understanding.
 */
export const SICK_STRUCTURAL_COLUMNS: readonly string[] = [
  "sick_leave_policy.created_at",
  "sick_leave_policy.updated_at",
  "sick_leave_requests.id",
  "sick_leave_requests.employee_id",
  "sick_leave_requests.created_at",
  "sick_leave_requests.updated_at",
  "sick_leave_ledger.id",
  "sick_leave_ledger.employee_id",
  "sick_leave_ledger.created_at",
  "sick_leave_ledger.updated_at",
];

/**
 * The only SQL types a column may have and still be exempt from a lesson.
 *
 * Exported so the test reads THIS list rather than a copy. A copy in the test
 * would pass forever after somebody widened the real one.
 */
export const SICK_STRUCTURAL_TYPES: readonly string[] = ["uuid", "timestamptz"];

export function sickMigrationColumnTypes(
  sourcePath?: string,
): Readonly<Record<string, string>> {
  const p = sourcePath ?? join(process.cwd(), MIGRATION_0198);
  const all = migrationColumnTypesStrict(p);
  const mine: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    if (SICK_TABLES.some((t) => k.startsWith(`${t}.`))) mine[k] = v;
  }
  return mine;
}

export function sickMigrationColumnNames(sourcePath?: string): readonly string[] {
  return Object.keys(sickMigrationColumnTypes(sourcePath));
}

/**
 * No column may be exempted from needing a lesson unless it is structural by
 * its TYPE in the migration.
 *
 * The `requireEveryExemptionToExist` option exists for the same reason it does
 * in the YTD gates: `assertEverySickFieldIsTaught` is deliberately callable
 * against a FRAGMENT of a migration — that is how its own broken-input tests
 * prove it is wired — and a fragment legitimately contains none of the
 * exempted columns. The fragment path therefore checks TYPES ONLY, which is
 * the arm that catches a widened exemption, and the staleness arm runs where
 * it is meaningful: against the whole migration, from its own test.
 */
export function assertSickStructuralExemptionsAreJustified(
  sourcePath?: string,
  opts: { readonly requireEveryExemptionToExist?: boolean } = {},
): void {
  const { requireEveryExemptionToExist = true } = opts;
  const types = sickMigrationColumnTypes(sourcePath);
  if (Object.keys(types).length === 0) {
    throw new Error(
      "SICK STRUCTURAL EXEMPTION GATE BROKEN: read no sick leave columns from migration 0198, so " +
        "every exemption would look unverifiable and the failure would point at the wrong thing.",
    );
  }

  const unjustified: string[] = [];
  const nonexistent: string[] = [];
  for (const col of SICK_STRUCTURAL_COLUMNS) {
    const t = types[col];
    if (t === undefined) {
      nonexistent.push(col);
      continue;
    }
    if (!SICK_STRUCTURAL_TYPES.includes(t)) unjustified.push(`${col} (${t})`);
  }

  // THE TYPE CHECK IS REPORTED FIRST, ON PURPOSE. If an exemption is both
  // stale and mistyped, the mistyped one is the dangerous finding — a stale
  // exemption protects nothing, while a mistyped one hides a live figure.
  if (unjustified.length > 0) {
    throw new Error(
      `SICK LEAVE COLUMNS EXEMPTED FROM NEEDING A LESSON THAT ARE NOT STRUCTURAL: ` +
        `${unjustified.join(", ")}. Only ${SICK_STRUCTURAL_TYPES.join(" and ")} columns may be ` +
        `exempt — an integer or a smallint holds a quantity or a policy choice that changes what ` +
        `an employee is paid, and listing it here would hide it behind a green check.`,
    );
  }

  if (requireEveryExemptionToExist && nonexistent.length > 0) {
    throw new Error(
      `SICK STRUCTURAL EXEMPTIONS FOR COLUMNS THAT DO NOT EXIST: ${nonexistent.join(", ")}. A ` +
        `stale exemption is worse than none, because it silently widens as columns are renamed.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * FIELD COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

export function assertEverySickFieldIsTaught(sourcePath?: string): void {
  const fromMigration = sickMigrationColumnNames(sourcePath);
  if (fromMigration.length === 0) {
    throw new Error(
      "SICK MENTOR COVERAGE GATE BROKEN: read no sick leave columns from migration 0198. A gate " +
        "that inspects nothing passes vacuously and protects nothing.",
    );
  }

  // The exemption list is validated BEFORE it is applied. Applying it first
  // and checking it afterwards would let an unjustified exemption suppress the
  // very coverage gap it created, for the duration of this call.
  assertSickStructuralExemptionsAreJustified(sourcePath, {
    requireEveryExemptionToExist: false,
  });

  const structural = new Set(SICK_STRUCTURAL_COLUMNS);
  const shouldBeTaught = fromMigration.filter((f) => !structural.has(f));
  if (shouldBeTaught.length === 0) {
    throw new Error(
      "SICK MENTOR COVERAGE GATE BROKEN: every column read from migration 0198 was classified as " +
        "structural, so no lesson would ever be required. Either the parser is wrong or the " +
        "structural exemption list has swallowed the whole schema.",
    );
  }

  const taught = new Set(taughtSickLeaveFieldNames());
  const untaught = shouldBeTaught.filter((f) => !taught.has(f));
  if (untaught.length > 0) {
    throw new Error(
      `SICK MENTOR COVERAGE GAP: these columns have no lesson: ${untaught.join(", ")}. Standing ` +
        `rule 26 requires every field Michael can see, or that changes what an employee is paid, ` +
        `to be explained before it ships. Sick leave errors never announce themselves — they ` +
        `produce a plausible number and surface years later as an L&I finding.`,
    );
  }
}

/**
 * The other direction: no lesson may teach a column that does not exist.
 *
 * This is the gate that catches a rename. A lesson beside a renamed column
 * reads as reassurance while covering nothing at all.
 */
export function assertNoSickLessonForUnknownField(sourcePath?: string): void {
  const known = new Set(sickMigrationColumnNames(sourcePath));
  if (known.size === 0) {
    throw new Error(
      "SICK MENTOR GATE BROKEN: no columns were read from migration 0198, so every lesson would " +
        "look stray and the failure would point at the lessons instead of at the parser.",
    );
  }
  const stray = taughtSickLeaveFieldNames().filter((f) => !known.has(f));
  if (stray.length > 0) {
    throw new Error(
      `SICK MENTOR TEACHES COLUMNS THAT DO NOT EXIST: ${stray.join(", ")}. Either the column was ` +
        `renamed and the lesson was not, or the lesson is for a column that was never added.`,
    );
  }
}

export function assertNoDuplicateSickFieldLessons(): void {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const f of taughtSickLeaveFieldNames()) {
    if (seen.has(f)) dupes.push(f);
    seen.add(f);
  }
  if (dupes.length > 0) {
    throw new Error(
      `DUPLICATE SICK LEAVE FIELD LESSONS: ${dupes.join(", ")}. Two lessons for one column means ` +
        `one of them is wrong and there is no way to tell which is being read.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * AUTHORITIES
 * ═══════════════════════════════════════════════════════════════════════════ */

export function assertEveryCitedSickAuthorityExists(): void {
  const known = new Set(SICK_LEAVE_AUTHORITIES.map((a) => a.id));
  if (known.size === 0) {
    throw new Error(
      "SICK AUTHORITY GATE BROKEN: the authority registry is empty, so every citation would look " +
        "dangling and the failure would point at the lessons instead of at the registry.",
    );
  }
  const dangling: string[] = [];
  for (const l of SICK_LEAVE_FIELD_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) dangling.push(`${l.field} -> ${id}`);
  }
  for (const l of SICK_LEAVE_SCREEN_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) dangling.push(`${l.topic} -> ${id}`);
  }
  for (const c of SICK_LEAVE_REVIEW_CHECKS) {
    for (const id of c.authorityIds) if (!known.has(id)) dangling.push(`${c.key} -> ${id}`);
  }
  if (dangling.length > 0) {
    throw new Error(
      `SICK MENTOR CITES AUTHORITIES THAT DO NOT EXIST: ${dangling.join(", ")}. A citation with ` +
        `nothing behind it is worse than none, because the reader believes it was checked.`,
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
export function unusedSickAuthorityIds(): readonly string[] {
  const used = new Set<string>();
  for (const l of SICK_LEAVE_FIELD_LESSONS) for (const id of l.authorityIds) used.add(id);
  for (const l of SICK_LEAVE_SCREEN_LESSONS) for (const id of l.authorityIds) used.add(id);
  for (const c of SICK_LEAVE_REVIEW_CHECKS) for (const id of c.authorityIds) used.add(id);
  return SICK_LEAVE_AUTHORITIES.filter((a) => !used.has(a.id)).map((a) => a.id);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * REFUSAL CODES
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The refusal codes the ENGINE declares, parsed from its union type on disk.
 *
 * Deliberately not imported as a value — a TypeScript union has no runtime
 * representation, so the only way to know what the engine actually declares is
 * to read the source. That is also what makes the gate honest: it cannot be
 * satisfied by editing a list in the mentor.
 */
export function sickEngineRefusalCodes(sourcePath?: string): readonly string[] {
  const p = sourcePath ?? join(process.cwd(), SICK_CORE);
  const text = readFileSync(p, "utf8");
  const block = text.match(/export type SickLeaveRefusalCode\s*=([\s\S]*?);/);
  if (!block) return [];
  return [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

export function assertEverySickRefusalCodeIsTaught(sourcePath?: string): void {
  const codes = sickEngineRefusalCodes(sourcePath);
  if (codes.length === 0) {
    throw new Error(
      "SICK REFUSAL GATE BROKEN: read no refusal codes from sick-leave-core.ts. A gate that " +
        "parses nothing approves everything.",
    );
  }
  const taught = new Set(SICK_LEAVE_REFUSAL_LESSONS.map((l) => l.code as string));
  const untaught = codes.filter((c) => !taught.has(c));
  if (untaught.length > 0) {
    throw new Error(
      `SICK REFUSAL CODES WITH NO EXPLANATION: ${untaught.join(", ")}. A refusal that reaches ` +
        `Michael as a bare code is a dead end, and a dead end in payroll is where somebody ` +
        `overrides the software.`,
    );
  }
  const phantom = [...taught].filter((c) => !codes.includes(c));
  if (phantom.length > 0) {
    throw new Error(
      `SICK MENTOR EXPLAINS REFUSAL CODES THAT NO LONGER EXIST: ${phantom.join(", ")}. A stale ` +
        `entry masks a real gap, because the count looks right while a live code goes untaught.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * EXPORTED FUNCTION COVERAGE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Which engine functions the mentor explains, and where.
 *
 * A judgement call, so it is written out rather than inferred. Each entry names
 * the lesson carrying the explanation, so a reader can check the claim instead
 * of taking it on trust.
 */
export const SICK_CORE_FUNCTION_COVERAGE: Readonly<Record<string, string>> = {
  validatePolicy:
    "Taught by the nine policy field lessons and by every refusal lesson from " +
    "NO_ACCRUAL_RATE_ON_FILE through VERIFICATION_POLICY_UNANSWERED — this is the function those " +
    "refusals come from, and the reason an unlawful policy cannot be saved at all.",
  accrueForPeriod:
    "Taught by the accrual_hundredth_minutes_per_hour field lesson, which explains why the unit " +
    "is hundredths of a minute and what rounding down each period costs over a decade.",
  hoursThatCountTowardAccrual:
    "Taught by the screen lesson 'Why leave never accrues on leave' — the one named function that " +
    "subtracts leave hours before multiplying, so the rule cannot be remembered at one call site " +
    "and forgotten at another.",
  computeBalance:
    "Taught by the screen lesson 'Balances are history, not a number somebody edits', and by the " +
    "entry_date and minutes field lessons which explain the signed sum.",
  planDraw:
    "Taught by the drawn_from field lesson and the two-buckets screen lesson: earned hours are " +
    "spent first so that what survives to December is the gift, which may lapse, rather than " +
    "statutory leave that must be carried.",
  planAward:
    "Taught by the reason field lesson and the AWARD_NOT_POSITIVE and AWARD_WITHOUT_REASON " +
    "refusal lessons, which explain why a gift with no stated purpose is indistinguishable from " +
    "an error.",
  reviewRequest:
    "Taught by the six review checks, which are the questions this function answers in order, " +
    "and by the notice_kind field lesson explaining why short notice never denies a request.",
  sickLeaveRateOfPay:
    "Taught by the screen lesson 'The greater of' and the paid_rate_milli_cents_per_hour field " +
    "lesson — the comparison that costs nothing for years and then matters the January a rate " +
    "sits at the old floor.",
  formatMilliCents:
    "Taught by the paid_rate_milli_cents_per_hour field lesson, which explains why rates are held " +
    "in thousandths of a cent and rounded to whole cents exactly once, at the end.",
  sickLeavePayCents:
    "Taught by the paid_amount_cents field lesson: one multiplication, one rounding, because " +
    "rounding at each step puts a forty-minute absence several cents out with no step looking " +
    "wrong.",
  splitWeekWithSickLeave:
    "Taught by the screen lesson answering Michael's own overtime question — thirty-six worked " +
    "plus eight sick is forty-four paid hours and zero overtime, because overtime counts hours " +
    "actually worked.",
  planYearEndCarryover:
    "Taught by the carryover_cap_minutes and drawn_from field lessons and the two-buckets screen " +
    "lesson, which together explain why the spend order decides the carryover liability.",
  monthlyNotificationText:
    "Taught by the screen lesson on the monthly notification — the obligation most small " +
    "employers have never heard of, satisfied by building the sentence from the ledger and " +
    "putting it on the pay stub.",
};

export function sickExportedFunctionNames(sourcePath?: string): readonly string[] {
  const p = sourcePath ?? join(process.cwd(), SICK_CORE);
  const text = readFileSync(p, "utf8");
  return [...text.matchAll(/^export function ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
}

export function assertEverySickFunctionIsTaught(sourcePath?: string): void {
  const exported = sickExportedFunctionNames(sourcePath);
  if (exported.length === 0) {
    throw new Error(
      "SICK MENTOR COVERAGE GATE BROKEN: read no exported functions from sick-leave-core.ts. A " +
        "coverage gate that inspects nothing passes vacuously and protects nothing.",
    );
  }
  const uncovered = exported.filter((f) => !(f in SICK_CORE_FUNCTION_COVERAGE));
  if (uncovered.length > 0) {
    throw new Error(
      `SICK MENTOR COVERAGE GAP: these exported functions have no explanation: ` +
        `${uncovered.join(", ")}. Standing rule 26 requires every exported function to be taught ` +
        `before it ships.`,
    );
  }
  const phantom = Object.keys(SICK_CORE_FUNCTION_COVERAGE).filter(
    (k) => !exported.includes(k),
  );
  if (phantom.length > 0) {
    throw new Error(
      `SICK MENTOR EXPLAINS FUNCTIONS THAT NO LONGER EXIST: ${phantom.join(", ")}. A stale ` +
        `coverage entry masks a real gap, because the count looks right while a live function ` +
        `goes untaught.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * REVIEW CHECKLIST WELL-FORMEDNESS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The checklist must be a usable ORDER, not a set.
 *
 * Eligibility questions have to come before pricing questions: there is no
 * point establishing the correct rate for leave the employee is not yet
 * entitled to spend. A checklist whose steps are in the wrong order lets a
 * panel report a step complete while its prerequisite is outstanding.
 */
export function assertSickReviewChecksAreWellFormed(): void {
  if (SICK_LEAVE_REVIEW_CHECKS.length === 0) {
    throw new Error(
      "SICK REVIEW CHECK GATE BROKEN: there are no checks, so the checklist would always read " +
        "complete.",
    );
  }

  const keys = new Set(SICK_LEAVE_REVIEW_CHECKS.map((c) => c.key));
  if (keys.size !== SICK_LEAVE_REVIEW_CHECKS.length) {
    throw new Error("DUPLICATE SICK REVIEW CHECK KEYS: a repeated key makes the order ambiguous.");
  }

  const orders = SICK_LEAVE_REVIEW_CHECKS.map((c) => c.order);
  const expected = Array.from({ length: SICK_LEAVE_REVIEW_CHECKS.length }, (_, i) => i + 1);
  if (JSON.stringify([...orders].sort((a, b) => a - b)) !== JSON.stringify(expected)) {
    throw new Error(
      `SICK REVIEW CHECK ORDER IS NOT A CLEAN SEQUENCE: got ${orders.join(", ")}. A gap or a ` +
        `repeat means two steps claim the same position and the reader cannot tell what comes ` +
        `first.`,
    );
  }

  // Eligibility before pricing. This is the substantive claim, not just
  // well-formedness: the rate question must come after the entitlement
  // questions, or the checklist teaches the wrong habit.
  const rateStep = SICK_LEAVE_REVIEW_CHECKS.find((c) => c.key === "rate-is-the-greater-of");
  const usableStep = SICK_LEAVE_REVIEW_CHECKS.find((c) => c.key === "usable-yet");
  if (!rateStep || !usableStep) {
    throw new Error(
      "SICK REVIEW CHECK GATE BROKEN: the eligibility and pricing steps this gate reasons about " +
        "are missing, so the ordering claim cannot be evaluated at all.",
    );
  }
  if (usableStep.order >= rateStep.order) {
    throw new Error(
      "SICK REVIEW CHECKS ARE OUT OF ORDER: the waiting-period question must come before the " +
        "rate question. Pricing leave the employee is not yet entitled to spend answers the " +
        "wrong question first.",
    );
  }
}
