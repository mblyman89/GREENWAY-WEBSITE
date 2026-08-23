/**
 * src/lib/payroll/wage-order-watch-mentor-gates.ts   (books-40c)
 *
 * THE COVERAGE GATES FOR THE WATCHMAN.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE MENTOR
 *
 * Because `GarnishmentWorkbench.tsx` and `WageOrderAnswerControl.tsx` are
 * `"use client"` files that import the mentor for its sentences, and these
 * functions call `readFileSync`. Several Vercel deployments once died with
 *
 *     Code generation for chunk item errored
 *     Caused by: the chunking context (unknown) does not support external
 *     modules (request: node:fs)
 *
 * after exactly that mistake, with a fully green test suite the whole time.
 * House pattern: DATA in `*-mentor.ts`, GATES in `*-mentor-gates.ts`, gates
 * imported only by tests.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THESE GATES ARE ACTUALLY DEFENDING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This slice ships a notification system. Notification systems have a specific
 * and nasty failure mode that ordinary tests cannot see: they keep passing
 * every unit test while being wired to nothing. `planWageOrderReminders` can be
 * perfect, exhaustively tested, and never called by the cron - and the suite
 * stays green while Michael is never told about a single deadline. That is
 * standing rule 50, and this slice is unusually exposed to it because the whole
 * feature's value lives in the wiring rather than in the arithmetic.
 *
 * The books-40c recon found precisely that defect already in the tree:
 * `answerDeadlineFor()` and `expiryOutlookFor()` were correct, tested, and
 * imported by exactly one form where they were displayed for thirty seconds
 * while typing and then never evaluated again. So these gates read the real
 * files and answer questions the teaching data cannot answer about itself:
 *
 *   - does the CRON actually run the wage order planner?
 *   - is the answer WRITE reachable from a screen?
 *   - is there a snooze anywhere, which would defeat the whole design?
 *   - is every alert kind, and every refusal code, explained to Michael?
 *   - does the screen re-derive deadlines instead of asking the core?
 *
 * Each returns findings rather than throwing, so a failing test names the exact
 * mismatch instead of reporting that something, somewhere, is wrong (standing
 * rule 64a: detection is not explanation).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const WATCH_CORE_PATH = join(ROOT, "src", "lib", "payroll", "wage-order-watch-core.ts");
const WATCH_STORE_PATH = join(ROOT, "src", "lib", "payroll", "wage-order-watch-store.ts");
const MENTOR_PATH = join(ROOT, "src", "lib", "payroll", "wage-order-watch-mentor.ts");
const REMINDERS_PATH = join(ROOT, "src", "lib", "notifications", "compliance-reminders.ts");
const READ_STORE_PATH = join(ROOT, "src", "lib", "payroll", "garnishment-store.ts");
const WRITE_STORE_PATH = join(ROOT, "src", "lib", "payroll", "wage-order-write-store.ts");
const ACTIONS_PATH = join(ROOT, "src", "app", "admin", "books", "garnishments", "actions.ts");
const PAGE_PATH = join(ROOT, "src", "app", "admin", "books", "garnishments", "page.tsx");
const WORKBENCH_PATH = join(
  ROOT,
  "src",
  "components",
  "admin",
  "books",
  "GarnishmentWorkbench.tsx",
);
const ANSWER_CONTROL_PATH = join(
  ROOT,
  "src",
  "components",
  "admin",
  "books",
  "WageOrderAnswerControl.tsx",
);
const MIGRATION_PATH = join(
  ROOT,
  "supabase",
  "migrations",
  "0202_wage_order_answer_log.sql",
);

const MUTATION_SCRIPT_PATH = join(
  ROOT,
  "scripts",
  "compliance",
  "mutate-slice-books-40c.py",
);

const read = (p: string): string => readFileSync(p, "utf8");

/** Strip comments so prose discussing a pattern is not read as an implementation. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every path this module reads, so a test can prove they all exist. */
export const WATCH_GATE_PATHS: readonly string[] = [
  WATCH_CORE_PATH,
  WATCH_STORE_PATH,
  MENTOR_PATH,
  REMINDERS_PATH,
  READ_STORE_PATH,
  WRITE_STORE_PATH,
  ACTIONS_PATH,
  PAGE_PATH,
  MUTATION_SCRIPT_PATH,
  WORKBENCH_PATH,
  ANSWER_CONTROL_PATH,
  MIGRATION_PATH,
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  IS THE WATCHMAN ACTUALLY ON DUTY?
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WatchmanWiring = {
  /** Does the reminder engine import the planner? */
  readonly engineImportsPlanner: boolean;
  /** Does it import the snapshot loader? */
  readonly engineImportsSnapshot: boolean;
  /** Does it CALL the planner, not merely import it? */
  readonly engineCallsPlanner: boolean;
  /** Is the planner block wrapped in its own try/catch? */
  readonly plannerHasOwnTryCatch: boolean;
  /** How many planners does the engine run in total? */
  readonly plannerCallCount: number;
};

/**
 * Is the nightly cron actually running the wage order planner?
 *
 * THE FAILURE THIS EXISTS TO PREVENT. `planWageOrderReminders` has thirty-seven
 * tests. Every one of them would pass if the function were imported by nothing.
 * An importing-but-not-calling variant is even quieter: the import satisfies a
 * grep, the lint stays clean if the symbol is referenced in a type, and no
 * email is ever sent.
 *
 * The try/catch check matters for a different reason. The engine runs several
 * planners in one pass; if the wage order block threw uncaught, it would take
 * the CCRS and excise reminders down with it. Each planner failing alone is a
 * deliberate property of that file, and this proves the new one honours it.
 */
export function watchmanWiring(): WatchmanWiring {
  const src = read(REMINDERS_PATH);
  const code = stripComments(src);

  // The planner's block, from its call to the end of the enclosing catch.
  const at = code.indexOf("planWageOrderReminders(");
  let hasTryCatch = false;
  if (at !== -1) {
    // Look backwards for the nearest `try {` and forwards for a `catch`.
    const before = code.slice(Math.max(0, at - 2000), at);
    const after = code.slice(at, at + 2000);
    hasTryCatch = /try\s*\{[^}]*$/.test(before) && /catch\s*\(/.test(after);
  }

  return {
    // No `s` flag: `[^}]*` already crosses newlines, and the flag needs an
    // ES2018 target that this tsconfig does not set. Vitest transpiled it
    // happily; `tsc --noEmit` did not, which is why the typecheck runs.
    engineImportsPlanner: /import\s*\{[^}]*planWageOrderReminders/.test(code),
    engineImportsSnapshot: /import\s*\{[^}]*loadWageOrderWatchSnapshot/.test(code),
    engineCallsPlanner: code.includes("planWageOrderReminders("),
    plannerHasOwnTryCatch: hasTryCatch,
    // Every `plan*Reminder`/`plan*Reminders` invocation in the engine.
    plannerCallCount: (code.match(/\bplan[A-Za-z]*Reminders?\(/g) ?? []).length,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  IS THE OFF SWITCH REACHABLE, AND IS IT THE ONLY ONE?
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * How many times the answer-recording path is referenced across the stack.
 *
 * Same probe shape as `lifecycleActionCallCounts()`, and for the same reason:
 * books-38 and books-40 both reported `0` for three lifecycle actions that were
 * complete, correct and unreachable. A write nobody can click is worse here
 * than it was there, because this write is the ONLY thing that stops a daily
 * critical reminder. An unreachable off switch would train Michael to ignore
 * the alarm within a fortnight, and an ignored alarm is worse than no alarm.
 */
export function answerWriteCallCounts(): Readonly<Record<string, number>> {
  const surfaces = [ACTIONS_PATH, PAGE_PATH, WORKBENCH_PATH, ANSWER_CONTROL_PATH]
    .map(read)
    .join("\n");
  const symbols = [
    "recordWageOrderAnswer",
    "recordWageOrderAnswerAction",
    "onRecordAnswer",
  ] as const;

  const out: Record<string, number> = {};
  for (const s of symbols) out[s] = surfaces.split(s).length - 1;
  return out;
}

/**
 * Has a snooze, dismiss or mute appeared anywhere in the answer path?
 *
 * THE DESIGN THIS DEFENDS, AND IT IS THE WHOLE SLICE.
 *
 * The watchman escalates to critical daily and never gives up. That is only
 * defensible because the off switch records a FACT - the answer was filed on
 * this date, or this order carries no answer duty and here is why. The moment
 * somebody adds a dismiss button, the system starts collecting "Michael saw
 * this message" instead of "the duty was discharged", and those are different
 * facts with very different consequences: only one of them is a defence under
 * RCW 26.18.110(6).
 *
 * A future maintainer under pressure from a noisy inbox will be tempted, and
 * the temptation will look like kindness. Returns the offending lines so the
 * test can print them.
 */
export function snoozePathsInAnswerFlow(): readonly string[] {
  const files = [
    ANSWER_CONTROL_PATH,
    ACTIONS_PATH,
    WRITE_STORE_PATH,
    WATCH_CORE_PATH,
    WORKBENCH_PATH,
  ];
  const hits: string[] = [];
  for (const f of files) {
    const code = stripForIdentifiers(read(f));
    for (const line of code.split("\n")) {
      if (SNOOZE_RE.test(line)) hits.push(`${f}: ${line.trim()}`);
    }
  }
  return hits;
}

/**
 * The words that mean "make this stop without doing the thing".
 *
 * MUTATION TESTING REWROTE THIS PATTERN. The first version required whole-word
 * matches on an exact list - `\b(snooze|dismissAlert|muteReminder|...)\b` - and
 * a mutation that added `const [snoozeUntil, setSnoozeUntil] = useState(null)`
 * walked straight past it, because `snoozeUntil` is not the word `snooze`. That
 * is not a contrived spelling; it is the FIRST name a React developer reaches
 * for. The gate was checking for the one identifier nobody would actually type.
 *
 * So the match is now on substrings and covers the shapes a real maintainer
 * would write: `snoozeUntil`, `handleSnooze`, `onDismiss`, `muteFor7Days`,
 * `remindMeLater`, `hideUntil`. `mute[A-Z_]` is deliberately narrow so that
 * ordinary words containing "mute" cannot trip it.
 */
const SNOOZE_RE =
  /(snooze|dismiss|unmute|mute[A-Z_]|suppressremind|ignorealert|remindmelater|hideuntil|silenc)/i;

/**
 * How many sabotage runs does the mutation script actually perform?
 *
 * WHY A GATE COUNTS A NUMBER IN A PYTHON FILE. The owner report tells Michael
 * that this feature was deliberately broken twenty-four different ways and the
 * tests caught every one. That claim is the entire basis on which he is being
 * asked to trust the green tick, and it is the one sentence in the document he
 * cannot check for himself.
 *
 * It is also the easiest claim in the repository to falsify by accident: delete
 * six mutations while tidying, and nothing anywhere goes red. The suite still
 * passes, the report still says twenty-four, and the number quietly becomes a
 * boast rather than a fact. So the count is re-derived from the script's own
 * source on every commit.
 *
 * Counted structurally - tuple openings at the list's indentation inside the
 * MUTATIONS literal - rather than by counting a word, so a mutation that is
 * commented out stops being counted.
 */
export function mutationCount(): number {
  const src = read(MUTATION_SCRIPT_PATH);
  const start = src.indexOf("MUTATIONS = [");
  if (start === -1) return 0;
  const body = src.slice(start + "MUTATIONS = [".length);
  return (body.match(/^ {4}\(\s*$/gm) ?? []).length;
}

/**
 * Would the snooze detector actually catch a snooze?
 *
 * The gate above returns an empty array today, and an empty array is exactly
 * what a BROKEN detector returns too. Standing rule 39: prove the negative
 * result is a real finding and not a pattern that can no longer match
 * anything. This runs the live `SNOOZE_RE` against the identifiers a real
 * maintainer would type, and against the prose that must never trip it.
 *
 * Both directions are returned so a test can assert on each. Weaken the
 * pattern and `mutantsCaught` shrinks; over-broaden it and `proseFalsePositives`
 * grows.
 */
export function snoozeDetectorSelfTest(): {
  readonly mutantsCaught: number;
  readonly mutantsTried: number;
  readonly missed: readonly string[];
  readonly proseFalsePositives: readonly string[];
} {
  // Names taken from how this would really be written, not from the pattern.
  const mutants = [
    "  const [snoozeUntil, setSnoozeUntil] = useState<string | null>(null);",
    "  function handleSnooze() { setHidden(true); }",
    "  const snoozedUntil = addDays(today, 7);",
    "  onDismiss={() => setHidden(true)}",
    "  const muteFor7Days = true;",
    "  const remindMeLater = 1;",
    "  hideUntil={d}",
  ];
  // Real lines from this slice's own source and screen copy.
  const prose = [
    '  "or the judgment is satisfied, vacated or dismissed.",',
    '  <p className="mt-1 text-xs text-[var(--admin-text-muted)]">',
    '    "on its own, and filing now limits the argument that Greenway ignored the order. Send " +',
    "  <span>This is the only thing that stops the answer reminders. There is no dismiss.</span>",
  ];

  const missed = mutants.filter((m) => !SNOOZE_RE.test(stripForIdentifiers(m)));
  const falsePositives = prose.filter((p) => SNOOZE_RE.test(stripForIdentifiers(p)));

  return {
    mutantsCaught: mutants.length - missed.length,
    mutantsTried: mutants.length,
    missed,
    proseFalsePositives: falsePositives,
  };
}

/**
 * Reduce a source file to the part that can actually DO something.
 *
 * Comments, string literals and JSX text are all prose. This slice's own
 * source is full of paragraphs explaining why there is no dismiss button, and
 * the screen prints the sentence "There is no dismiss." to Michael. A gate
 * that searched raw text would fire on its own documentation - and the fix a
 * tired maintainer would reach for is to delete the explanation, which is the
 * opposite of what should happen (standing rule 39: a gate that cries wolf
 * gets disabled, and a disabled gate protects nothing).
 *
 * Stripping strings before JSX text matters: `className="...text-muted"` is an
 * attribute, not display text, and it survives the JSX pass only because the
 * string pass has already emptied it.
 */
function stripForIdentifiers(src: string): string {
  return stripComments(src)
    .replace(/`(?:[^`\\]|\\.)*`/g, "``")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/>[^<>{}]+</g, "><");
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  DOES THE SCREEN ASK THE CORE, OR RE-DECIDE?
 * ═══════════════════════════════════════════════════════════════════════════ */

export type AnswerControlDelegation = {
  /** Does the control call the shared validator? */
  readonly callsValidator: boolean;
  /** Does it ask the core which orders carry a duty? */
  readonly callsHasAnswerDuty: boolean;
  /** Any order-kind comparisons written inline in JSX. Expected empty. */
  readonly inlineKindComparisons: readonly string[];
  /** Any day-count arithmetic written inline. Expected empty. */
  readonly inlineDayArithmetic: readonly string[];
};

/**
 * Does the answer control delegate every decision to the pure core?
 *
 * The failure guarded against is subtle and would pass every other test:
 * somebody writes `orderKind === "child_support" && <p>cannot waive</p>` in
 * JSX. It renders correctly the day it is written, it cannot be tested without
 * a browser, and it drifts the first time the rule changes - at which point the
 * form says one thing and the server refuses with another.
 *
 * The day-arithmetic check exists because the same temptation applies to
 * deadlines: a `20` or a `* 24 * 60 * 60 * 1000` in a component is a second,
 * untested implementation of a statutory clock.
 */
export function answerControlDelegatesToCore(): AnswerControlDelegation {
  const code = stripComments(read(ANSWER_CONTROL_PATH));

  const kinds = [
    ...code.matchAll(
      /orderKind\s*(?:===|!==)\s*"(child_support|spousal_support|creditor|consumer_debt|federal_tax_levy|state_tax_levy|student_loan)"/g,
    ),
  ].map((m) => m[0]);

  const dayMath = [
    ...code.matchAll(/24\s*\*\s*60\s*\*\s*60\s*\*\s*1000|\b86400000\b|\bgetTime\(\)/g),
  ].map((m) => m[0]);

  return {
    callsValidator: code.includes("validateAnswerRecord("),
    callsHasAnswerDuty: code.includes("hasAnswerDuty("),
    inlineKindComparisons: kinds,
    inlineDayArithmetic: dayMath,
  };
}

/**
 * Does the workbench render the watchman's alerts, or quietly drop them?
 *
 * The board could accept `alerts` as a prop, satisfy TypeScript, and never map
 * over it. Everything would compile and the panel would simply never appear.
 */
export function workbenchSurfacesAlerts(): {
  readonly acceptsAlerts: boolean;
  readonly rendersAlerts: boolean;
  readonly acceptsOutstandingCount: boolean;
  readonly rendersOutstandingCount: boolean;
  readonly rendersAnswerControl: boolean;
} {
  const code = stripComments(read(WORKBENCH_PATH));
  return {
    acceptsAlerts: /readonly alerts:/.test(code),
    rendersAlerts: /alerts\.map\(/.test(code),
    acceptsOutstandingCount: /readonly answersOutstandingCount:/.test(code),
    rendersOutstandingCount: /\{answersOutstandingCount\}/.test(code),
    rendersAnswerControl: /<WageOrderAnswerControl/.test(code),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  IS EVERYTHING MICHAEL CAN SEE EXPLAINED?
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The alert kinds the CORE can emit, read from its source.
 *
 * Read from the file rather than imported so the gate is checking the shipped
 * text, not a value the mentor could have been written against. If somebody
 * adds a kind to the union and forgets the exported list, this notices.
 */
export function alertKindsInCore(): readonly string[] {
  const src = read(WATCH_CORE_PATH);
  const at = src.indexOf("export type WageOrderAlertKind =");
  if (at === -1) return [];
  const body = src.slice(at, src.indexOf(";", at));
  return [...body.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

/** The alert kinds the MENTOR teaches, read from its source. */
export function alertKindsTaught(): readonly string[] {
  const src = read(MENTOR_PATH);
  return [...src.matchAll(/kind:\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

/** The refusal codes `validateAnswerRecord` can return, read from source. */
export function answerRefusalCodesInCore(): readonly string[] {
  const src = read(join(ROOT, "src", "lib", "payroll", "wage-order-lifecycle-core.ts"));
  const at = src.indexOf("export type AnswerRecordRefusalCode =");
  if (at === -1) return [];
  const body = src.slice(at, src.indexOf(";", at));
  return [...body.matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

/** The refusal codes the mentor explains, read from source. */
export function answerRefusalCodesTaught(): readonly string[] {
  const src = read(MENTOR_PATH);
  return [...src.matchAll(/code:\s*"([A-Z_]+)"/g)].map((m) => m[1]);
}

/**
 * Do the authority ids the watch mentor names resolve in the real registry?
 *
 * A typo here renders a blank card rather than an error, which is the worst
 * kind of failure: the screen looks finished and the law is missing.
 */
export function watchAuthorityIdsResolve(): {
  readonly named: readonly string[];
  readonly unresolved: readonly string[];
} {
  const mentor = read(MENTOR_PATH);
  const at = mentor.indexOf("export const WATCH_AUTHORITY_IDS");
  const block = at === -1 ? "" : mentor.slice(at, mentor.indexOf("] as const", at));
  const named = [...block.matchAll(/"([a-z0-9-]+)"/g)].map((m) => m[1]);

  const registry = read(
    join(ROOT, "src", "lib", "payroll", "wage-order-entry-authorities.ts"),
  );
  const unresolved = named.filter((id) => !registry.includes(`id: "${id}"`));
  return { named, unresolved };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §5  ONE NUMBER, ONE PLACE
 * ═══════════════════════════════════════════════════════════════════════════ */

export type WaiverReasonLengths = {
  readonly core: number | null;
  readonly database: number | null;
  readonly controlImportsCore: boolean;
  readonly controlHasRivalLiteral: boolean;
};

/**
 * The minimum waiver-reason length, as stated by each layer that enforces it.
 *
 * Three layers enforce this rule: the pure core, migration 0202's
 * `wage_orders_waiver_has_reason` CHECK, and the browser form. Three copies of
 * a number is three chances for them to disagree, and the disagreement would
 * show up as a form that accepts something the database then rejects - which
 * reads to Michael as the software being broken.
 *
 * So the number is defined once and imported, and this proves it.
 */
export function waiverReasonLengthByLayer(): WaiverReasonLengths {
  const core = read(join(ROOT, "src", "lib", "payroll", "wage-order-lifecycle-core.ts"));
  const coreMatch = core.match(/MIN_ANSWER_WAIVER_REASON_CHARS\s*=\s*(\d+)/);

  const control = read(ANSWER_CONTROL_PATH);
  const controlImportsCore = /MIN_ANSWER_WAIVER_REASON_CHARS/.test(control);
  const controlHasRivalLiteral =
    /const\s+MIN_ANSWER_WAIVER_REASON_CHARS\s*=\s*\d+/.test(control);

  const sql = read(MIGRATION_PATH);
  const at = sql.indexOf("wage_orders_waiver_has_reason");
  const dbMatch =
    at === -1
      ? null
      : sql.slice(at, at + 400).match(/length\(btrim\(answer_waived_reason\)\)\s*>=\s*(\d+)/);

  return {
    core: coreMatch ? Number(coreMatch[1]) : null,
    database: dbMatch ? Number(dbMatch[1]) : null,
    controlImportsCore,
    controlHasRivalLiteral,
  };
}

/**
 * Does the watchman re-derive the statutory day counts, or reuse books-38's?
 *
 * The twenty days of RCW 26.18.110(1) and the sixty days of RCW 6.27.350(1)
 * were already implemented, tested and mutation-proved in
 * `wage-order-entry-core.ts`. A second copy inside the watchman would be a
 * second thing to keep correct, and the two would eventually disagree about a
 * legal deadline. Standing rule 25.
 */
export function watchCoreReusesStatutoryDays(): {
  readonly importsAnswerDeadline: boolean;
  readonly importsExpiryOutlook: boolean;
  readonly rivalTwenty: readonly string[];
  readonly rivalSixty: readonly string[];
} {
  const code = stripComments(read(WATCH_CORE_PATH));
  return {
    importsAnswerDeadline: code.includes("answerDeadlineFor"),
    importsExpiryOutlook: code.includes("expiryOutlookFor"),
    // A literal 20 or 60 assigned to anything day-shaped in this file would be
    // a second copy of a statutory period.
    rivalTwenty: [...code.matchAll(/=\s*20\b(?!\d)/g)].map((m) => m[0]),
    rivalSixty: [...code.matchAll(/=\s*60\b(?!\d)/g)].map((m) => m[0]),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §6  DOES THE READER SUPPLY WHAT THE WATCHMAN NEEDS?
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The answer-log columns `loadGarnishmentBoard` actually selects.
 *
 * THE DEFECT THIS EXISTS TO PREVENT, WHICH WAS REAL IN THIS SLICE.
 *
 * Migration 0201 added `served_date` in books-38 and the entry form wrote it,
 * but `loadGarnishmentBoard()` never selected it. The board therefore could not
 * compute a single deadline, and nothing failed - because nothing asked. The
 * same hazard applies to all three answer columns: omit one from the `.select`
 * and the watchman quietly treats every order as unanswered forever, or worse,
 * treats an unanswered one as settled.
 */
export function answerColumnsSelectedByBoard(): readonly string[] {
  // COMMENTS ARE STRIPPED FIRST, AND THAT IS NOT A DETAIL. The `.select()` in
  // this function is preceded by a comment explaining why the three columns
  // matter. A naive `body.includes("served_date")` would therefore pass on the
  // strength of the comment alone - the gate would keep reporting success
  // after somebody deleted the columns from the query and left the prose
  // behind, which is the precise shape of the defect it was written to catch
  // (standing rule 39: guard the vacuous read).
  const src = stripComments(read(READ_STORE_PATH));
  const at = src.indexOf("export async function loadGarnishmentBoard");
  if (at === -1) return [];

  // Narrow to the wage_orders `.select(...)` argument itself.
  const selectAt = src.indexOf(".select(", at);
  if (selectAt === -1) return [];
  const close = src.indexOf(")", selectAt);
  if (close === -1) return [];
  const selectArg = src.slice(selectAt, close);

  const wanted = ["served_date", "answer_filed_at", "answer_not_required"];
  return wanted.filter((c) => selectArg.includes(c));
}

/**
 * Does the board hand the SAME assessment to the screen that the cron uses?
 *
 * Two surfaces deriving "is this overdue" separately is how a board that says
 * fine and an email that says overdue end up on the same desk on the same
 * morning. Both must call `assessWageOrder`, and the board must stamp the date
 * it measured from so the form can check against the server's day rather than
 * the browser's.
 */
export function boardSharesOneAssessment(): {
  readonly boardCallsAssess: boolean;
  readonly boardUsesPacificToday: boolean;
  readonly boardExportsAsOf: boolean;
  readonly snapshotFeedsPlanner: boolean;
} {
  const board = stripComments(read(READ_STORE_PATH));
  const engine = stripComments(read(REMINDERS_PATH));
  return {
    boardCallsAssess: board.includes("assessWageOrder("),
    boardUsesPacificToday: board.includes("pacificToday()"),
    boardExportsAsOf: /asOf:\s*todayIso/.test(board),
    snapshotFeedsPlanner: engine.includes("loadWageOrderWatchSnapshot("),
  };
}

/* ═════════════════════════════════════════════════════════════════════════
 * §7  THE THREE GATES MUTATION TESTING FORCED US TO WRITE
 *
 * Everything above this line was written first and then attacked. Three of
 * the attacks got through, which means three of the gates above were weaker
 * than they read. They are recorded here rather than quietly patched into
 * the originals, because the reason each one exists is worth more than the
 * gate itself.
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * Is the off switch connected all the way down, hop by hop?
 *
 * WHY THE COUNTING GATE ABOVE WAS NOT ENOUGH. `answerWriteCallCounts()` joins
 * four files and counts how many times each symbol appears. A mutation that
 * severed the server action from the write store left the import line and the
 * docblock in place, so the count stayed comfortably above zero and the gate
 * reported healthy while the button did nothing. Counting a NAME proves the
 * name is written down somewhere. It does not prove anybody CALLS it.
 *
 * So this gate walks the actual chain, one hop at a time, in stripped source:
 *
 *   page.tsx  --onRecordAnswer={recordWageOrderAnswerAction}-->  workbench
 *   workbench --onRecord={onRecordAnswer}-->                     control
 *   control   --await onRecord({...})-->                         server action
 *   action    --recordWageOrderAnswer({...})-->                  write store
 *
 * Break any single link and exactly one boolean goes false, which tells the
 * next reader WHICH hop is broken rather than that something, somewhere, is.
 */
export function answerWriteChain(): {
  readonly pageWiresAction: boolean;
  readonly workbenchPassesToControl: boolean;
  readonly controlInvokesCallback: boolean;
  readonly actionInvokesStore: boolean;
} {
  const page = stripComments(read(PAGE_PATH));
  const workbench = stripComments(read(WORKBENCH_PATH));
  const control = stripComments(read(ANSWER_CONTROL_PATH));
  const action = stripComments(read(ACTIONS_PATH));

  return {
    pageWiresAction: /onRecordAnswer=\{\s*recordWageOrderAnswerAction\s*\}/.test(page),
    workbenchPassesToControl: /onRecord=\{\s*onRecordAnswer\s*\}/.test(workbench),
    controlInvokesCallback: /await\s+onRecord\(/.test(control),
    actionInvokesStore: /await\s+recordWageOrderAnswer\(\s*\{/.test(action),
  };
}

/**
 * Does the answer form measure "is this date in the future?" against the
 * SERVER's day, or against the laptop's?
 *
 * THE BUG THIS PREVENTS IS A NASTY ONE TO DIAGNOSE. `validateAnswerRecord`
 * refuses a post-dated answer, and it is handed a `today` to compare against.
 * If the browser supplies that value, then a machine whose clock is a day fast
 * - which is ordinary, not exotic - renders a form that says the date is fine,
 * and a server that refuses it a moment later. Michael would see a form
 * contradict itself with no way to tell which half was lying.
 *
 * The fix is that the board stamps `asOf` from `pacificToday()` on the server
 * and the workbench feeds exactly that down. So: prove the prop is wired from
 * `asOf`, and prove no clock is read anywhere in the two client files. A type
 * import cannot introduce a clock, but a well-meaning default like
 * `today ?? new Date().toISOString().slice(0, 10)` absolutely can, and it
 * would look like defensive programming while removing the defence.
 */
export function answerFormUsesServerDate(): {
  readonly workbenchFeedsAsOf: boolean;
  readonly boardStampsAsOf: boolean;
  readonly clockReadsInClient: readonly string[];
} {
  const workbench = stripComments(read(WORKBENCH_PATH));
  const control = stripComments(read(ANSWER_CONTROL_PATH));
  const board = stripComments(read(READ_STORE_PATH));

  const clockReads: string[] = [];
  for (const [name, code] of [
    ["GarnishmentWorkbench.tsx", workbench],
    ["WageOrderAnswerControl.tsx", control],
  ] as const) {
    for (const line of code.split("\n")) {
      if (/new Date\(|Date\.now\(/.test(line)) clockReads.push(`${name}: ${line.trim()}`);
    }
  }

  return {
    workbenchFeedsAsOf: /today=\{\s*asOf\s*\}/.test(workbench),
    boardStampsAsOf: /asOf:\s*todayIso/.test(board) && board.includes("pacificToday()"),
    clockReadsInClient: clockReads,
  };
}

/**
 * Is any part of this feature switched off while still looking present?
 *
 * STANDING RULE 50, IN THE FORM IT ACTUALLY ARRIVES IN. Nobody deletes a
 * feature they are unsure about. They put `false &&` in front of it, or wrap
 * it in `if (false)`, intending to come back. It compiles, it lints, it
 * typechecks, the component is still imported, the props are still passed,
 * every existing gate that asks "is this rendered anywhere in the file?" still
 * says yes - and the alert strip is gone from the screen.
 *
 * A mutation that prefixed the alert strip's condition with `false &&` sailed
 * past `workbenchSurfacesAlerts()` for exactly that reason: the `alerts.map(`
 * call was still in the file, just unreachable.
 *
 * This is deliberately a blunt instrument over the whole watch UI rather than
 * a check aimed at the one line that got caught. Returns the offending lines
 * so the failure names them.
 */
export function disabledRenderBranches(): readonly string[] {
  const files: readonly (readonly [string, string])[] = [
    ["GarnishmentWorkbench.tsx", WORKBENCH_PATH],
    ["WageOrderAnswerControl.tsx", ANSWER_CONTROL_PATH],
  ];

  const hits: string[] = [];
  for (const [name, path] of files) {
    const code = stripComments(read(path));
    for (const line of code.split("\n")) {
      if (/(^|[^A-Za-z0-9_])false\s*&&|&&\s*false([^A-Za-z0-9_]|$)|if\s*\(\s*(false|0)\s*\)/.test(line)) {
        hits.push(`${name}: ${line.trim()}`);
      }
    }
  }
  return hits;
}
