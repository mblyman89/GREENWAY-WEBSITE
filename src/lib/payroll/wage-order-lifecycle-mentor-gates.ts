/**
 * src/lib/payroll/wage-order-lifecycle-mentor-gates.ts   (books-40b)
 *
 * THE COVERAGE GATES FOR THE LIFECYCLE MENTOR.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE MENTOR
 *
 * Because a `"use client"` component imports the mentor for its lesson text,
 * and these functions call `readFileSync`. Several Vercel deployments once died
 * with
 *
 *     Code generation for chunk item errored
 *     Caused by: the chunking context (unknown) does not support external
 *     modules (request: node:fs)
 *
 * after exactly that mistake - a mentor holding both lesson data and a
 * `readFileSync` coverage gate, imported into a client component, with a fully
 * green test suite the whole time. `tests/compliance/client-bundle-purity.test.ts`
 * now catches it in seconds, and the house pattern is this split: DATA in
 * `*-mentor.ts`, GATES in `*-mentor-gates.ts`, gates imported only by tests.
 *
 * WHAT A GATE IS FOR
 *
 * Standing rule 50: dead code wearing a green check. A mentor module can be
 * beautiful, correct and imported by nothing, and every test in the repo still
 * passes. These functions read the real files off disk and answer questions the
 * teaching data cannot answer about itself:
 *
 *   - do the transitions I teach match the transitions the server enforces?
 *   - does the screen actually ask the core which buttons are lawful, or does
 *     it re-decide for itself in JSX?
 *   - is every refusal code the store can emit explained to Michael?
 *   - is the five-character rule the same number in all three places?
 *
 * Each returns findings rather than throwing, so the test names the exact
 * mismatch instead of reporting that something, somewhere, is wrong
 * (standing rule 64a: detection is not explanation).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const CORE_PATH = join(ROOT, "src", "lib", "payroll", "wage-order-lifecycle-core.ts");
const WRITE_STORE_PATH = join(ROOT, "src", "lib", "payroll", "wage-order-write-store.ts");
const READ_STORE_PATH = join(ROOT, "src", "lib", "payroll", "garnishment-store.ts");
const CONTROLS_PATH = join(
  ROOT,
  "src",
  "components",
  "admin",
  "books",
  "WageOrderLifecycleControls.tsx",
);
const WORKBENCH_PATH = join(
  ROOT,
  "src",
  "components",
  "admin",
  "books",
  "GarnishmentWorkbench.tsx",
);
const PAGE_PATH = join(ROOT, "src", "app", "admin", "books", "garnishments", "page.tsx");
const ACTIONS_PATH = join(ROOT, "src", "app", "admin", "books", "garnishments", "actions.ts");
const MIGRATION_PATH = join(
  ROOT,
  "supabase",
  "migrations",
  "0198_sick_leave_and_garnishments.sql",
);

const read = (p: string): string => readFileSync(p, "utf8");

/** Every path this module reads, so a test can prove they all exist. */
export const LIFECYCLE_GATE_PATHS: readonly string[] = [
  CORE_PATH,
  WRITE_STORE_PATH,
  READ_STORE_PATH,
  CONTROLS_PATH,
  WORKBENCH_PATH,
  PAGE_PATH,
  ACTIONS_PATH,
  MIGRATION_PATH,
];

/* ═══════════════════════════════════════════════════════════════════════════
 * §1  DO THE TAUGHT TRANSITIONS MATCH THE ENFORCED ONES?
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Pull the PostgREST status filter each write function actually applies.
 *
 * Slices the source from one `export async function` to the next so a filter
 * belonging to `suspendWageOrder` can never be credited to `resumeWageOrder`.
 * Returns the raw matched text, not a boolean, so the test can print what it
 * found when it disagrees.
 */
export function enforcedStatusGuards(): Readonly<Record<string, string | null>> {
  const src = read(WRITE_STORE_PATH);
  const fnNames = ["terminateWageOrder", "suspendWageOrder", "resumeWageOrder"] as const;
  const out: Record<string, string | null> = {};

  for (const name of fnNames) {
    const start = src.indexOf(`export async function ${name}(`);
    if (start === -1) {
      out[name] = null;
      continue;
    }
    // The next top-level export after this one bounds the slice.
    const after = src.slice(start + 1);
    const nextRel = after.indexOf("\nexport ");
    const body = nextRel === -1 ? after : after.slice(0, nextRel);

    // Either an `.in("status", [...])` or an `.eq("status", "...")`.
    const inMatch = body.match(/\.in\(\s*"status",\s*\[([^\]]*)\]\s*\)/);
    const eqMatch = body.match(/\.eq\(\s*"status",\s*"([a-z]+)"\s*\)/);
    out[name] = inMatch
      ? inMatch[1].replace(/["\s]/g, "")
      : eqMatch
        ? eqMatch[1]
        : null;
  }
  return out;
}

/**
 * The statuses migration 0198 permits, read from the CHECK constraint.
 *
 * Read from the migration rather than trusted from the TypeScript union,
 * because the database is the authority and the union is the copy. If a fourth
 * status is ever added, this finds it.
 */
export function statusesPermittedByMigration(): readonly string[] {
  const sql = read(MIGRATION_PATH);
  const at = sql.indexOf("status text not null default 'active'");
  if (at === -1) return [];
  const window = sql.slice(at, at + 200);
  const m = window.match(/check\s*\(status in \(([^)]*)\)\)/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/'/g, ""))
    .filter((s) => s.length > 0);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §2  IS THE SCREEN ACTUALLY WIRED?
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * How many times each server action is referenced by the garnishment UI.
 *
 * This is the exact probe the books-38 gap report and the books-40 report both
 * ran, and both reported 0 for the three lifecycle actions. It is kept here, in
 * the shipped source rather than only in a test, so the owner documents can be
 * re-derived from it at any time instead of quoting a number somebody typed.
 *
 * "The UI" means the page and the two components - the same surface those
 * reports searched.
 */
export function lifecycleActionCallCounts(): Readonly<Record<string, number>> {
  const surfaces = [PAGE_PATH, WORKBENCH_PATH, CONTROLS_PATH].map(read).join("\n");
  const actions = [
    "createWageOrderAction",
    "terminateWageOrderAction",
    "suspendWageOrderAction",
    "resumeWageOrderAction",
  ] as const;

  const out: Record<string, number> = {};
  for (const a of actions) {
    out[a] = surfaces.split(a).length - 1;
  }
  return out;
}

/**
 * Does the client control ask the core which buttons are lawful?
 *
 * The failure this guards against is subtle and would pass every other test:
 * somebody writes `status === "active" && <Button>Pause</Button>` directly in
 * JSX. It renders correctly today, it is untestable without a browser, and it
 * drifts the first time the rules change. The control must call
 * `lifecycleOptionsFor`, and it must not carry its own status comparisons.
 */
export function controlDelegatesToCore(): {
  readonly callsCore: boolean;
  readonly inlineStatusComparisons: readonly string[];
} {
  const src = read(CONTROLS_PATH);
  // Strip block comments so prose discussing `status === "active"` is not read
  // as an implementation (the same stripping the other gates in this repo do).
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const inline = [
    ...code.matchAll(/status\s*(?:===|!==)\s*"(active|suspended|terminated)"/g),
  ].map((m) => m[0]);

  return {
    callsCore: code.includes("lifecycleOptionsFor("),
    inlineStatusComparisons: inline,
  };
}

/**
 * Does anything in the garnishment feature delete a wage order?
 *
 * Returns the offending lines so the test can print them. Expected to be empty
 * forever. The owner report states in plain words that no delete exists; this
 * is what makes that a checkable claim rather than a promise.
 */
export function deletePathsInGarnishmentFeature(): readonly string[] {
  const files = [
    ACTIONS_PATH,
    WRITE_STORE_PATH,
    READ_STORE_PATH,
    CONTROLS_PATH,
    WORKBENCH_PATH,
    PAGE_PATH,
    CORE_PATH,
  ];
  const hits: string[] = [];
  for (const f of files) {
    const code = read(f)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const line of code.split("\n")) {
      // A PostgREST delete, or an exported action whose name begins with delete.
      if (/\.delete\s*\(/.test(line) || /export\s+async\s+function\s+delete/i.test(line)) {
        hits.push(`${f.slice(ROOT.length + 1)}: ${line.trim()}`);
      }
    }
  }
  return hits;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §3  IS THE FIVE-CHARACTER RULE THE SAME NUMBER EVERYWHERE?
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The minimum reason length as stated by each of the three layers.
 *
 * `core` is the literal in the pure module. `store` is whether the server
 * imports that same constant rather than hard-coding a rival number. `database`
 * is the integer inside 0198's `wage_orders_terminated_has_note` CHECK.
 *
 * Three layers enforcing one rule is correct - a browser check is not a
 * control, and a server check is not a guarantee. Three layers enforcing three
 * DIFFERENT numbers is a defect, and it is the kind that shows up as a
 * confusing refusal months later.
 */
export function minimumReasonLengthByLayer(): {
  readonly core: number | null;
  readonly storeImportsCore: boolean;
  readonly storeHasRivalLiteral: boolean;
  readonly database: number | null;
} {
  const coreSrc = read(CORE_PATH);
  const coreMatch = coreSrc.match(/export const MIN_TERMINATION_NOTE_CHARS\s*=\s*(\d+)/);

  const storeSrc = read(WRITE_STORE_PATH);
  // The store must get the number from the core module, in whichever import
  // form is used, rather than declaring its own.
  const storeImportsCore =
    /MIN_TERMINATION_NOTE_CHARS[\s\S]{0,200}?from\s+"\.\/wage-order-lifecycle-core"/.test(
      storeSrc,
    ) ||
    /from\s+"\.\/wage-order-lifecycle-core"[\s\S]{0,200}?MIN_TERMINATION_NOTE_CHARS/.test(
      storeSrc,
    );
  const storeHasRivalLiteral = /const MIN_TERMINATION_NOTE_CHARS\s*=\s*\d+/.test(storeSrc);

  const sql = read(MIGRATION_PATH);
  const at = sql.indexOf("wage_orders_terminated_has_note");
  const dbMatch =
    at === -1
      ? null
      : sql.slice(at, at + 300).match(/length\(btrim\(termination_note\)\)\s*>=\s*(\d+)/);

  return {
    core: coreMatch ? Number(coreMatch[1]) : null,
    storeImportsCore,
    storeHasRivalLiteral,
    database: dbMatch ? Number(dbMatch[1]) : null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * §4  DOES THE BOARD SHOW WHAT THE BUTTONS NEED?
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Which statuses `loadGarnishmentBoard` actually reads.
 *
 * THE DEFECT THIS EXISTS TO PREVENT, WHICH WAS REAL.
 *
 * Before this slice the board read `.eq("status", "active")`. A suspended order
 * was therefore never rendered by any screen. Wiring up a Resume button under
 * those conditions would have shipped a control that no human being could ever
 * reach - a button on a row that cannot appear - while every test in the repo
 * stayed green. That is standing rule 50 in its most convincing form, and it
 * was found by asking "what does the reader actually return?" rather than by
 * trusting that the wiring task was only about buttons.
 *
 * So the read must now include `suspended`, and it must still exclude
 * `terminated`: an ended order that reappeared on a live board would eventually
 * be withheld against, and withholding under a released order is a conversion
 * of the employee's wages.
 */
export function statusesReadByBoard(): readonly string[] {
  const src = read(READ_STORE_PATH);
  const at = src.indexOf("export async function loadGarnishmentBoard");
  if (at === -1) return [];
  const body = src.slice(at, at + 4000);

  const inMatch = body.match(/\.in\(\s*"status",\s*\[([^\]]*)\]\s*\)/);
  if (inMatch) {
    return inMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/["']/g, ""))
      .filter((s) => s.length > 0);
  }
  const eqMatch = body.match(/\.eq\(\s*"status",\s*"([a-z]+)"\s*\)/);
  return eqMatch ? [eqMatch[1]] : [];
}
