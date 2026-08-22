/**
 * src/lib/payroll/timesheet-mentor-gates.ts   (books-33)
 *
 * THE RULE-26 COVERAGE GATES FOR THE TIMESHEET MENTOR.
 *
 * These moved out of `timesheet-mentor.ts` byte for byte. They were not
 * softened, and not one check was dropped - the count of gates here is the
 * count that was there.
 *
 * WHY THEY HAD TO MOVE. `TimesheetWorkbench.tsx` is a client component and it
 * imports the mentor's lesson data. Anything the mentor imports therefore has
 * to survive being bundled for a browser, and these functions call
 * `readFileSync`. Turbopack said so plainly:
 *
 *     the chunking context (unknown) does not support external modules
 *     (request: node:fs)
 *
 * and every Vercel deployment failed while CI stayed green, because CI never
 * runs `next build`.
 *
 * WHY THAT IS SAFE. Nothing in `src/app` or `src/components` has ever called
 * these functions - they are called by `tests/compliance/timesheet-mentor.test.ts`
 * and nowhere else, which was verified by grep across the whole tree before the
 * move. A gate that runs in CI and refuses to ship an untaught field is doing
 * its job from here exactly as it did from there.
 *
 * WHY IT IS NOT AN INVITATION TO ADD MORE fs CODE TO MENTORS. A test in
 * `tests/compliance/client-bundle-purity.test.ts` now walks the client
 * component graph and fails if any `"use client"` file can reach `node:fs`
 * again. Standing rule 65: if a build system can catch it, a test should catch
 * it first.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TIMESHEET_AUTHORITIES } from "@/lib/payroll/timesheet-authorities";
import {
  TIMESHEET_FIELD_LESSONS,
  TIMESHEET_REFUSAL_LESSONS,
  TIMESHEET_SCREEN_LESSONS,
  TIMESHEET_SETUP_STEPS,
  taughtFieldNames,
  type TimesheetSetupStepKey,
} from "@/lib/payroll/timesheet-mentor";

/**
 * Every field the migration added must be taught.
 *
 * READS THE MIGRATION FROM DISK. A list typed by hand would pass forever after
 * somebody added a column and forgot the lesson, which is precisely the failure
 * this gate exists to catch.
 */
export function migrationFieldNames(sourcePath?: string): readonly string[] {
  const p =
    sourcePath ??
    join(process.cwd(), "supabase", "migrations", "0197_timesheet_workweek.sql");
  const text = readFileSync(p, "utf8");

  const names: string[] = [];

  // `alter table X add column if not exists <col>` - the table is named on a
  // preceding line, so we track the most recent `alter table` as we scan.
  let currentTable = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    const alter = line.match(/^alter table (?:if exists )?(?:public\.)?([a-z_]+)/i);
    if (alter) currentTable = alter[1];
    const col = line.match(/^add column if not exists ([a-z_]+)/i);
    if (col && currentTable) names.push(`${currentTable}.${col[1]}`);
  }

  return names;
}

/** The pay_periods columns Michael actually chooses. Structural columns are not lessons. */
const PAY_PERIOD_TAUGHT_COLUMNS = [
  "pay_periods.start_date",
  "pay_periods.end_date",
  "pay_periods.pay_date",
  "pay_periods.status",
] as const;

export function assertEveryFieldIsTaught(sourcePath?: string): void {
  const fromMigration = migrationFieldNames(sourcePath);
  if (fromMigration.length === 0) {
    throw new Error(
      "MENTOR COVERAGE GATE BROKEN: read no added columns from migration 0197. A gate that inspects " +
        "nothing passes vacuously and protects nothing.",
    );
  }
  const taught = new Set(taughtFieldNames());
  const untaught = fromMigration.filter((f) => !taught.has(f));
  if (untaught.length > 0) {
    throw new Error(
      `MENTOR COVERAGE GAP: these columns have no lesson: ${untaught.join(", ")}. Standing rule 26 ` +
        `requires every field Michael can see or set to be explained before it ships.`,
    );
  }
  const missingPeriodLessons = PAY_PERIOD_TAUGHT_COLUMNS.filter((f) => !taught.has(f));
  if (missingPeriodLessons.length > 0) {
    throw new Error(
      `MENTOR COVERAGE GAP: pay period columns with no lesson: ${missingPeriodLessons.join(", ")}.`,
    );
  }
}

/**
 * No lesson may teach a field that does not exist.
 *
 * The other direction, and it matters: a lesson beside a column that was
 * renamed or dropped reads as reassurance while covering nothing.
 */
export function assertNoLessonForUnknownField(sourcePath?: string): void {
  const known = new Set([
    ...migrationFieldNames(sourcePath),
    ...PAY_PERIOD_TAUGHT_COLUMNS,
  ]);
  if (known.size === 0) {
    throw new Error(
      "MENTOR GATE BROKEN: no known fields were read, so every lesson would look stray.",
    );
  }
  const stray = taughtFieldNames().filter((f) => !known.has(f));
  if (stray.length > 0) {
    throw new Error(
      `MENTOR TEACHES FIELDS THAT DO NOT EXIST: ${stray.join(", ")}. Either the column was renamed ` +
        `and the lesson was not, or the lesson is for a field that was never added.`,
    );
  }
}

/** Every authority id cited by any lesson must exist. */
export function assertEveryCitedAuthorityExists(): void {
  const known = new Set(TIMESHEET_AUTHORITIES.map((a) => a.id));
  if (known.size === 0) {
    throw new Error(
      "MENTOR CITATION GATE BROKEN: the authority registry is empty, so every citation would pass " +
        "vacuously.",
    );
  }
  const dangling: string[] = [];
  for (const l of TIMESHEET_FIELD_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) dangling.push(`${l.field} -> ${id}`);
  }
  for (const l of TIMESHEET_SCREEN_LESSONS) {
    for (const id of l.authorityIds) if (!known.has(id)) dangling.push(`${l.topic} -> ${id}`);
  }
  for (const s of TIMESHEET_SETUP_STEPS) {
    for (const id of s.authorityIds) if (!known.has(id)) dangling.push(`${s.key} -> ${id}`);
  }
  if (dangling.length > 0) {
    throw new Error(
      `MENTOR CITES AUTHORITIES THAT DO NOT EXIST: ${dangling.join(", ")}. A citation with nothing ` +
        `behind it is worse than none, because the reader believes it was checked.`,
    );
  }
}

/** Authorities that no lesson uses. Reported, not thrown - see company-identity-mentor. */
export function unusedAuthorityIds(): readonly string[] {
  const used = new Set<string>();
  for (const l of TIMESHEET_FIELD_LESSONS) for (const id of l.authorityIds) used.add(id);
  for (const l of TIMESHEET_SCREEN_LESSONS) for (const id of l.authorityIds) used.add(id);
  for (const s of TIMESHEET_SETUP_STEPS) for (const id of s.authorityIds) used.add(id);
  return TIMESHEET_AUTHORITIES.filter((a) => !used.has(a.id)).map((a) => a.id);
}

/**
 * Every refusal code the engine declares has a lesson.
 *
 * READS THE ENGINE FROM DISK and parses its union type. If somebody adds an
 * eleventh refusal code, this fails until they explain it - which is the whole
 * point, because the alternative is Michael seeing a bare code on a payroll
 * screen with no idea what to do next.
 */
export function engineRefusalCodes(sourcePath?: string): readonly string[] {
  const p =
    sourcePath ?? join(process.cwd(), "src", "lib", "payroll", "timesheet-core.ts");
  const text = readFileSync(p, "utf8");
  const block = text.match(
    /export type TimesheetRefusalCode\s*=([\s\S]*?);/,
  );
  if (!block) return [];
  return [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

export function assertEveryRefusalCodeIsTaught(sourcePath?: string): void {
  const codes = engineRefusalCodes(sourcePath);
  if (codes.length === 0) {
    throw new Error(
      "MENTOR REFUSAL GATE BROKEN: read no refusal codes from timesheet-core.ts. A gate that parses " +
        "nothing approves everything.",
    );
  }
  const taught = new Set(TIMESHEET_REFUSAL_LESSONS.map((l) => l.code as string));
  const untaught = codes.filter((c) => !taught.has(c));
  if (untaught.length > 0) {
    throw new Error(
      `REFUSAL CODES WITH NO EXPLANATION: ${untaught.join(", ")}. A refusal that reaches Michael as a ` +
        `bare code is a dead end, and a dead end in payroll is where somebody overrides the software.`,
    );
  }
  const phantom = [...taught].filter((c) => !codes.includes(c));
  if (phantom.length > 0) {
    throw new Error(
      `MENTOR EXPLAINS REFUSAL CODES THAT NO LONGER EXIST: ${phantom.join(", ")}. A stale entry masks ` +
        `a real gap, because the count looks right while a live code goes untaught.`,
    );
  }
}

/** Which core functions the mentor explains. A judgement, so it is written out. */
export const CORE_FUNCTION_COVERAGE: Readonly<Record<string, string>> = {
  weekdayOfDayKey:
    "Taught by the workweek_starts_on lesson, which explains that the anchor is a weekday number and " +
    "that the boundary it creates decides which hours belong to which week.",
  daysBetweenDayKeys:
    "Taught by the pay period start/end lessons, which explain that both ends are inclusive and that " +
    "an off-by-one silently moves a day's hours onto the next cheque.",
  workweekStartFor:
    "Taught by the screen lesson on each workweek standing alone - this is the function that finds " +
    "which 168-hour period a given day belongs to.",
  splitIntoWorkweeks:
    "Taught by the screen lesson on part-weeks: a period aligned to the anchor divides into whole " +
    "weeks, one that is not divides into fragments and says so.",
  punchMinutes:
    "Taught by the screen lesson on paying from the timestamps, which explains why the stored minutes " +
    "figure is compared rather than trusted.",
  minutesToHundredthHours:
    "Taught by the screen lesson on rounding once: minutes are summed for a whole week before being " +
    "converted, because per-punch rounding accumulates.",
  computePeriodHours:
    "Taught by every screen lesson together - it is the function they describe. Its refusals are each " +
    "explained individually in TIMESHEET_REFUSAL_LESSONS.",
  formatHundredthHours:
    "Taught by the lesson on hours being a reportable quantity: hours are stored as integers and only " +
    "formatted for display, never rounded for storage.",
  formatCents:
    "Taught by the same lesson applied to money - cents are the stored unit and dollars are a " +
    "presentation of them.",
};

/**
 * The rule-26 gate: every exported core function is covered.
 *
 * Reads the file. Fails when it reads nothing. Fails when a function ships with
 * no explanation, and fails when an explanation outlives its function.
 */
export function exportedCoreFunctionNames(sourcePath?: string): readonly string[] {
  const p =
    sourcePath ?? join(process.cwd(), "src", "lib", "payroll", "timesheet-core.ts");
  const text = readFileSync(p, "utf8");
  return [...text.matchAll(/^export function ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
}

export function assertEveryExportedFunctionIsTaught(sourcePath?: string): void {
  const exported = exportedCoreFunctionNames(sourcePath);
  if (exported.length === 0) {
    throw new Error(
      "MENTOR COVERAGE GATE BROKEN: read no exported functions from timesheet-core.ts. A coverage " +
        "gate that inspects nothing passes vacuously and protects nothing.",
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

/** Every setup step's prerequisites must name real steps, and must not cycle. */
export function assertSetupStepsAreWellFormed(): void {
  if (TIMESHEET_SETUP_STEPS.length === 0) {
    throw new Error("SETUP STEP GATE BROKEN: there are no steps, so progress would always read 100%.");
  }
  const keys = new Set(TIMESHEET_SETUP_STEPS.map((s) => s.key));
  const seen = new Set<TimesheetSetupStepKey>();
  for (const s of TIMESHEET_SETUP_STEPS) {
    for (const r of s.requires) {
      if (!keys.has(r)) {
        throw new Error(`STEP ${s.key} REQUIRES AN UNKNOWN STEP: ${r}.`);
      }
      if (!seen.has(r)) {
        throw new Error(
          `STEP ${s.key} REQUIRES ${r}, WHICH COMES LATER IN THE LIST. Prerequisites must be declared ` +
            `before the steps that need them, otherwise the progress panel can report a step complete ` +
            `while its prerequisite is still outstanding.`,
        );
      }
    }
    seen.add(s.key);
  }
  if (!TIMESHEET_SETUP_STEPS.some((s) => s.blocksCompute)) {
    throw new Error(
      "NO STEP BLOCKS COMPUTE: the progress panel would permit hours to be computed from nothing.",
    );
  }
}
