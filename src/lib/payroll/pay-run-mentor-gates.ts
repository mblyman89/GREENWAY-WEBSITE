/**
 * src/lib/payroll/pay-run-mentor-gates.ts   (books-39 phase F)
 *
 * THE RULE-26 COVERAGE GATES FOR THE PAY-RUN MENTOR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE FILE FROM pay-run-mentor.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Everything here calls `readFileSync`. The mentor's lesson data is reachable
 * from client components — that is the whole point of it. In books-33 the two
 * lived in one file, `node:fs` went into a browser bundle, and every deployment
 * broke while CI stayed green. Standing rule 65b, and
 * `tests/compliance/client-bundle-purity.test.ts` walks the client component
 * graph and names the exact import chain if the boundary breaks again.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE GATES READ THE ENGINE FROM DISK
 * ─────────────────────────────────────────────────────────────────────────────
 * A hand-typed list of refusal codes passes forever after somebody adds an
 * eighth and forgets the lesson — standing rule 50, dead code wearing a green
 * check. Every gate below parses the real engine source, and every gate refuses
 * when it parses NOTHING, because a coverage gate that inspects an empty list
 * approves everything (standing rule 39).
 *
 * Each gate also checks the OPPOSITE direction. A lesson beside a code that was
 * renamed or deleted reads as reassurance while covering nothing, and it is the
 * more dangerous of the two failures because the count still looks right.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE UNION IS PARSED AND NOT JUST THE RUNTIME ARRAY
 * ─────────────────────────────────────────────────────────────────────────────
 * `pay-run-core.ts` declares its refusal codes TWICE: once as a TypeScript
 * union (`PayRunRefusalCode`) and once as a runtime array
 * (`ALL_PAY_RUN_REFUSAL_CODES`), because a union does not exist at runtime and
 * a test cannot iterate it. Two declarations of the same fact can disagree.
 *
 * `untaughtPayRunCodes()` in the mentor compares the LESSONS against the
 * runtime array. That catches a missing lesson. It cannot catch a code that
 * exists in the union — and therefore in the engine's `switch` statements and
 * in every consumer's exhaustiveness check — but was never added to the array.
 * Such a code would be emitted by the engine, would reach the screen, and would
 * be reported as fully taught by a gate reading only the array.
 *
 * So these gates parse the UNION from source and check three things at once:
 * union vs array, union vs lessons, and lessons vs union. That is why the file
 * does I/O at all, and it is why the gate is not simply
 * `expect(untaughtPayRunCodes()).toEqual([])`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A DEFECT THIS LAYER ALREADY CAUGHT, WRITTEN DOWN SO IT IS NOT RE-LEARNED
 * ─────────────────────────────────────────────────────────────────────────────
 * The first draft of `pay-run-mentor.ts` cited all three W-4 authorities by
 * their TypeScript CONST NAME ("NO_W4_TREAT_AS_SINGLE") rather than by the
 * authority's `id` ("pay-run-cfr-31-3402-f2-1-no-certificate"). `tsc` returned
 * zero because the field was typed `string | null`. Every one of those three
 * citations resolved to nothing while reading, on screen, as proof.
 *
 * The fix was NOT to add a test here. It was to narrow
 * `PayRunAuthority["id"]` to the `PayRunAuthorityId` union so the mistake stops
 * compiling (standing rule 23 — fix the class). The gate below still exists,
 * because the compiler only protects citations written in TypeScript; it does
 * nothing for an id that arrives from a database row or a URL. The gate is the
 * belt; the type is the braces.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  exportedFunctionNames,
  stripTypeScriptComments,
  unionMembersInSource,
} from "@/lib/payroll/mentor-quote-gate";
import {
  ALL_PAY_RUN_AUTHORITY_IDS,
  PAY_RUN_AUTHORITIES,
} from "@/lib/payroll/pay-run-authorities";
import {
  PAY_RUN_CHECKS,
  PAY_RUN_RECOVERIES,
  PAY_RUN_REFUSAL_LESSONS,
  W4_PROVENANCE_LESSONS,
} from "@/lib/payroll/pay-run-mentor";

const PAY_RUN_CORE = join("src", "lib", "payroll", "pay-run-core.ts");
const PAY_RUN_STORE = join("src", "lib", "payroll", "pay-run-store.ts");

/* ═══════════════════════════════════════════════════════════════════════════
 * 1) A SHARED UNION SCRAPE — because there are three unions to read, not one
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Read a string-literal union type out of a TypeScript source file on disk.
 *
 * A thin wrapper over `unionMembersInSource`, which lives in
 * `mentor-quote-gate.ts` so every mentor-gate module shares one implementation
 * (standing rule 25). The split is file-reading here, parsing there — which
 * also means the parser can be tested against a string without touching disk.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THAT PUT THE PARSER IN A SHARED FILE
 * ─────────────────────────────────────────────────────────────────────────────
 * This function was originally written the way every other mentor-gate module
 * writes it — a local regex, `/export type NAME\s*=([\s\S]*?);/`. Pointed at
 * `pay-run-core.ts` it returned SIX refusal codes where seven exist, because
 * the doc-comment above the seventh reads "Never seen; always checked." and the
 * lazy match stopped at that semicolon. `DOES_NOT_RECONCILE` — the code that
 * fires when a paycheque's parts do not re-add to its total — was invisible to
 * the coverage gate, which then found six lessons for six codes and reported
 * complete coverage.
 *
 * The tests below caught it because they compare the scrape against the
 * engine's RUNTIME array as well as against the lessons. A gate that checked
 * only "does every scraped code have a lesson" would have been green.
 *
 * The same span harvested the word "furnished" out of a doc-comment that quoted
 * a union member while explaining it, so `W4Provenance` scraped four members
 * where three exist. Both are properties of the shared PATTERN, not of this
 * file, which is why the fix went upstream (standing rule 23).
 *
 * WHY IT RETURNS `[]` RATHER THAN THROWING. Every caller below throws its own
 * message naming its own union, which is more useful than a generic one. The
 * important discipline — never treat an empty parse as success — is enforced at
 * each call site, and `assertUnionScrapeWorks` proves the scrape itself is not
 * silently broken.
 */
export function unionMembers(sourcePath: string, unionName: string): readonly string[] {
  return unionMembersInSource(readFileSync(sourcePath, "utf8"), unionName);
}

/** Absolute path helper, so every gate reads the same file the app compiles. */
function abs(repoRelative: string): string {
  return join(process.cwd(), repoRelative);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2) THE REFUSAL CODES
 *
 * Standing rule 43: every refusal code must be reachable. Standing rule 26:
 * every refusal that reaches Michael must be explainable. A bare code on a
 * screen is a dead end, and a dead end in payroll is where somebody decides
 * the software is wrong and pays the cheque anyway.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function payRunRefusalCodesInSource(sourcePath?: string): readonly string[] {
  return unionMembers(sourcePath ?? abs(PAY_RUN_CORE), "PayRunRefusalCode");
}

/**
 * The runtime array, read from source rather than imported.
 *
 * Imported, it would be the same value the mentor already compares against, and
 * the union-vs-array check would be comparing the array to itself. Read from
 * disk, the two lists have genuinely independent origins.
 */
export function payRunRefusalCodesInRuntimeArray(sourcePath?: string): readonly string[] {
  // Comments stripped for the same reason the union scrape strips them: a
  // doc-comment inside the array literal that quotes a code name would be
  // harvested as an extra member, and the resulting "array has a code the type
  // does not allow" failure would point at the engine instead of at this gate.
  const text = stripTypeScriptComments(readFileSync(sourcePath ?? abs(PAY_RUN_CORE), "utf8"));
  const start = text.indexOf("export const ALL_PAY_RUN_REFUSAL_CODES");
  if (start < 0) return [];
  // ───────────────────────────────────────────────────────────────────────────
  // FINDING THE ARRAY LITERAL, WITH TWO WRONG ANSWERS ALREADY TRIED
  // ───────────────────────────────────────────────────────────────────────────
  // Attempt one anchored the end on `\n];`, which is the house pattern. It
  // reads NOTHING from an array written on a single line, and reading nothing
  // is indistinguishable — to every caller — from an array that is genuinely
  // empty. A test fixture written on one line exposed it.
  //
  // Attempt two took the first `]` after the declaration. That is worse, and it
  // broke the REAL file: the declaration is
  //
  //     export const ALL_PAY_RUN_REFUSAL_CODES: readonly PayRunRefusalCode[] = [
  //
  // and the first `]` belongs to the TYPE annotation `PayRunRefusalCode[]`, not
  // to the value. The slice was empty, the gate threw, and the failure at least
  // pointed at itself rather than passing.
  //
  // So: find the `=` that begins the initialiser, then its `[`, then the first
  // `]` after that. Correct for both layouts and for the type annotation, and
  // it cannot be satisfied by an empty read because every caller treats an
  // empty result as a broken gate.
  const eq = text.indexOf("=", start);
  if (eq < 0) return [];
  const open = text.indexOf("[", eq);
  if (open < 0) return [];
  const end = text.indexOf("]", open);
  if (end <= open) return [];
  return [...text.slice(open, end).matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

export function assertEveryPayRunRefusalCodeIsTaught(sourcePath?: string): void {
  const codes = payRunRefusalCodesInSource(sourcePath);
  if (codes.length === 0) {
    throw new Error(
      "PAY RUN REFUSAL GATE BROKEN: read no refusal codes from pay-run-core.ts. A gate that " +
        "parses nothing approves everything (standing rule 39).",
    );
  }

  // Union vs runtime array. See the header: a code present in the union but
  // missing from the array is emitted by the engine and invisible to every
  // check that iterates the array — including the mentor's own.
  const runtime = payRunRefusalCodesInRuntimeArray(sourcePath);
  if (runtime.length === 0) {
    throw new Error(
      "PAY RUN REFUSAL GATE BROKEN: read no entries from ALL_PAY_RUN_REFUSAL_CODES. Every " +
        "runtime check of refusal coverage iterates that array, so an empty read makes all of " +
        "them pass vacuously (standing rule 39).",
    );
  }
  const missingFromArray = codes.filter((c) => !runtime.includes(c));
  if (missingFromArray.length > 0) {
    throw new Error(
      `PAY RUN REFUSAL CODES IN THE TYPE BUT NOT IN ALL_PAY_RUN_REFUSAL_CODES: ` +
        `${missingFromArray.join(", ")}. The engine can emit these and every test that walks ` +
        `the array will report full coverage without ever seeing them.`,
    );
  }
  const missingFromUnion = runtime.filter((c) => !codes.includes(c));
  if (missingFromUnion.length > 0) {
    throw new Error(
      `ALL_PAY_RUN_REFUSAL_CODES LISTS CODES THE TYPE DOES NOT ALLOW: ` +
        `${missingFromUnion.join(", ")}. One of the two is out of date, and the array is the ` +
        `one every test trusts.`,
    );
  }

  const taught = new Set(PAY_RUN_REFUSAL_LESSONS.map((l) => l.code as string));
  const untaught = codes.filter((c) => !taught.has(c));
  if (untaught.length > 0) {
    throw new Error(
      `PAY RUN REFUSAL CODES WITH NO EXPLANATION: ${untaught.join(", ")}. Michael is running ` +
        `this alone on a Friday morning with staff waiting to be paid. A code with no lesson ` +
        `is where he stops trusting the software and pays the cheque by hand.`,
    );
  }
  const phantom = [...taught].filter((c) => !codes.includes(c));
  if (phantom.length > 0) {
    throw new Error(
      `PAY RUN MENTOR EXPLAINS REFUSAL CODES THAT NO LONGER EXIST: ${phantom.join(", ")}. A ` +
        `stale entry masks a real gap, because the count looks right while a live code goes ` +
        `untaught.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 3) THE W-4 PROVENANCES
 *
 * Not refusals. These are the cases where the cheque IS computed and IS legally
 * correct, and something still needs saying — which makes them easier to leave
 * unexplained than a refusal, and more expensive when they are.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function w4ProvenancesInSource(sourcePath?: string): readonly string[] {
  return unionMembers(sourcePath ?? abs(PAY_RUN_CORE), "W4Provenance");
}

export function assertEveryW4ProvenanceIsTaught(sourcePath?: string): void {
  const provenances = w4ProvenancesInSource(sourcePath);
  if (provenances.length === 0) {
    throw new Error(
      "W-4 PROVENANCE GATE BROKEN: read no provenances from pay-run-core.ts. A gate that " +
        "parses nothing approves everything (standing rule 39).",
    );
  }
  const taught = new Set(W4_PROVENANCE_LESSONS.map((l) => l.provenance as string));
  const untaught = provenances.filter((p) => !taught.has(p));
  if (untaught.length > 0) {
    throw new Error(
      `W-4 PROVENANCES WITH NO EXPLANATION: ${untaught.join(", ")}. These are the cases where ` +
        `the arithmetic is right and the situation is still wrong — an unsigned W-4 withholds ` +
        `as single while the employee believes their elections are in force. Unexplained, it ` +
        `looks like a normal cheque.`,
    );
  }
  const phantom = [...taught].filter((p) => !provenances.includes(p));
  if (phantom.length > 0) {
    throw new Error(
      `PAY RUN MENTOR EXPLAINS W-4 PROVENANCES THAT NO LONGER EXIST: ${phantom.join(", ")}. A ` +
        `stale lesson masks a real gap, because the count looks right.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4) THE STORE'S OWN FAILURE CODES
 *
 * A separate union in a separate file, and a real gap risk: `loadPayRun` can
 * fail before `computePayRun` is ever called, so NONE of its four codes is a
 * PayRunRefusalCode. Michael sees them on the same screen and cannot be
 * expected to know which layer produced them.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function payRunStoreFailureCodesInSource(sourcePath?: string): readonly string[] {
  return unionMembers(sourcePath ?? abs(PAY_RUN_STORE), "PayRunStoreFailureCode");
}

/**
 * WHERE THE TEACHING FOR EACH STORE FAILURE LIVES.
 *
 * The store's failures are deliberately NOT given their own lesson type. Three
 * of the four are the same event as a refusal seen one layer earlier — a rate
 * that is not on file is `RATE_NOT_ON_FILE` whether the store or the engine
 * notices it first — and giving each one a second, differently-worded lesson is
 * how a user ends up with two explanations of one problem and no idea which
 * applies. So each store code points at the teaching that already exists, and
 * this map is the record of that decision being made on purpose rather than by
 * omission.
 */
export const PAY_RUN_STORE_FAILURE_COVERAGE: Readonly<Record<string, string>> = {
  NOT_CONFIGURED:
    "Not a payroll problem and deliberately not taught as one: the server has no database " +
    "credentials, so nothing was read and no figure on the screen means anything. Teaching it " +
    "as a payroll condition would send Michael looking at timesheets for an infrastructure " +
    "fault.",
  READ_FAILED:
    "Same reasoning as NOT_CONFIGURED — the database refused a query. The pay run is not " +
    "wrong; it does not exist. The screen says so plainly rather than showing a partial run, " +
    "because a partial payroll is its own kind of wrong: the person left out finds out on " +
    "payday.",
  NO_SUCH_PERIOD:
    "Taught by the pre-flight check 'Are the timesheets finished' — a pay period that cannot " +
    "be found is almost always a period that was never opened, and the fix is in Timesheets, " +
    "not here.",
  RATES_NOT_ON_FILE:
    "Taught by the pre-flight check 'Is every rate for this pay DATE on file' and by the " +
    "RATE_NOT_ON_FILE refusal lesson. This is the same condition the engine refuses on, caught " +
    "one layer earlier so the run stops before a single employee is loaded — deliberately, " +
    "because a missing rate is wrong for everybody at once.",
};

export function assertEveryPayRunStoreFailureIsTaught(sourcePath?: string): void {
  const codes = payRunStoreFailureCodesInSource(sourcePath);
  if (codes.length === 0) {
    throw new Error(
      "PAY RUN STORE FAILURE GATE BROKEN: read no failure codes from pay-run-store.ts. A gate " +
        "that parses nothing approves everything (standing rule 39).",
    );
  }
  const covered = new Set(Object.keys(PAY_RUN_STORE_FAILURE_COVERAGE));
  const untaught = codes.filter((c) => !covered.has(c));
  if (untaught.length > 0) {
    throw new Error(
      `PAY RUN STORE FAILURES WITH NO EXPLANATION: ${untaught.join(", ")}. These reach the same ` +
        `screen as the engine's refusals and Michael cannot tell which layer produced them.`,
    );
  }
  const phantom = [...covered].filter((c) => !codes.includes(c));
  if (phantom.length > 0) {
    throw new Error(
      `PAY RUN STORE COVERAGE EXPLAINS FAILURES THAT NO LONGER EXIST: ${phantom.join(", ")}. A ` +
        `stale entry masks a real gap.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 5) THE ENGINE FUNCTIONS — standing rule 26
 * ═══════════════════════════════════════════════════════════════════════════ */

export const PAY_RUN_CORE_FUNCTION_COVERAGE: Readonly<Record<string, string>> = {
  chooseW4:
    "Taught by all three W-4 provenance lessons. This is the function the whole slice turned " +
    "on: every read of employee_w4 in this codebase was an existence check, and whether a form " +
    "EXISTS is not the question a paycheque asks. The question is which certificate governs " +
    "and what to do when there is not a good one, and the three lessons are the three answers.",
  describeW4Provenance:
    "Taught by the same three lessons. It exists so the sentence printed on the stub, the " +
    "sentence on the screen and the sentence in the ledger are one string with one source — " +
    "two wordings of the same fact is how a stub and a screen come to disagree.",
  yearOfDayKey:
    "Taught by the pre-flight check 'Is every rate for this pay DATE on file', which explains " +
    "why the YEAR of the pay date and not of the period worked selects the rates and the " +
    "year-to-date accumulator. A December period paid in January is a January cheque.",
  computePayRunLine:
    "Taught by the seven refusal lessons together with the pre-flight checklist: the checks are " +
    "in the order this function performs them, and the order is itself the lesson — an " +
    "employee with no hours AND no rates on file is told about the hours, which is their " +
    "actual situation, rather than about the rates, which is everybody's.",
  computePayRun:
    "Taught by the recovery stage 'before-approval' and by the canPay rule it implements: one " +
    "blocked line stops the WHOLE run, not just its own, because a partial payroll is its own " +
    "kind of wrong — the person left out finds out on payday.",
};

export function payRunCoreExportedFunctionNames(sourcePath?: string): readonly string[] {
  return exportedFunctionNames(sourcePath ?? abs(PAY_RUN_CORE), "PAY RUN CORE");
}

export function assertEveryPayRunFunctionIsTaught(sourcePath?: string): void {
  const fns = payRunCoreExportedFunctionNames(sourcePath);
  const covered = new Set(Object.keys(PAY_RUN_CORE_FUNCTION_COVERAGE));
  const untaught = fns.filter((f) => !covered.has(f));
  if (untaught.length > 0) {
    throw new Error(
      `PAY RUN ENGINE FUNCTIONS WITH NO EXPLANATION: ${untaught.join(", ")}. Standing rule 26 ` +
        `requires the engine to be explainable, not merely correct.`,
    );
  }
  const phantom = [...covered].filter((f) => !fns.includes(f));
  if (phantom.length > 0) {
    throw new Error(
      `PAY RUN MENTOR EXPLAINS FUNCTIONS THAT NO LONGER EXIST: ${phantom.join(", ")}. A stale ` +
        `entry masks a real gap, because the count looks right while a live function goes ` +
        `untaught.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 6) THE AUTHORITIES
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Every id in the `PayRunAuthorityId` union must be a real authority, and every
 * real authority must be in the union.
 *
 * The union is hand-written, which is what makes the citations compile-checked.
 * This is the gate that keeps the hand-written list honest — without it, a
 * deleted authority would leave a phantom id that still compiles and still
 * resolves to nothing at runtime, which is the precise failure the union was
 * introduced to eliminate.
 */
export function assertAuthorityIdUnionMatchesRegistry(): void {
  if (PAY_RUN_AUTHORITIES.length === 0 || ALL_PAY_RUN_AUTHORITY_IDS.length === 0) {
    throw new Error(
      "PAY RUN AUTHORITY ID GATE BROKEN: one of the two lists is empty, so the comparison below " +
        "would pass vacuously (standing rule 39).",
    );
  }
  const registryIds = PAY_RUN_AUTHORITIES.map((a) => a.id as string);
  const unionIds = ALL_PAY_RUN_AUTHORITY_IDS.map((i) => i as string);

  const notInUnion = registryIds.filter((i) => !unionIds.includes(i));
  if (notInUnion.length > 0) {
    throw new Error(
      `AUTHORITIES MISSING FROM PayRunAuthorityId: ${notInUnion.join(", ")}. A lesson cannot ` +
        `cite these without a cast, and a cast is how the unchecked string gets back in.`,
    );
  }
  const notInRegistry = unionIds.filter((i) => !registryIds.includes(i));
  if (notInRegistry.length > 0) {
    throw new Error(
      `PayRunAuthorityId ALLOWS IDS THAT DO NOT EXIST: ${notInRegistry.join(", ")}. These ` +
        `compile, look checked, and resolve to nothing — which is exactly the defect the union ` +
        `was added to prevent.`,
    );
  }
}

/**
 * Every authority id a lesson cites must resolve.
 *
 * `knownIds` exists so a test can hand this a deliberately short list and prove
 * the gate BITES (standing rule 16). ES module caching means a lesson cannot be
 * deleted from disk mid-test, so injection is the only honest way to prove a
 * gate like this is wired rather than decorative.
 */
export function assertEveryCitedPayRunAuthorityExists(knownIds?: readonly string[]): void {
  const ids = new Set(knownIds ?? PAY_RUN_AUTHORITIES.map((a) => a.id as string));
  if (ids.size === 0) {
    throw new Error(
      "PAY RUN AUTHORITY GATE BROKEN: there are no authorities to check against, so every " +
        "citation would look dangling and the failure would point at the lessons instead of at " +
        "the registry.",
    );
  }
  const cited = W4_PROVENANCE_LESSONS.map((l) => l.authorityId).filter(
    (i): i is NonNullable<typeof i> => i !== null,
  );
  if (cited.length === 0) {
    throw new Error(
      "PAY RUN AUTHORITY GATE BROKEN: no lesson cites any authority at all, so this gate has " +
        "nothing to verify and would pass forever.",
    );
  }
  const dangling = cited.filter((c) => !ids.has(c));
  if (dangling.length > 0) {
    throw new Error(
      `PAY RUN LESSONS CITE AUTHORITIES THAT DO NOT EXIST: ${dangling.join(", ")}. A citation ` +
        `that resolves to nothing reads as proof and is not. This exact failure shipped in the ` +
        `first draft of pay-run-mentor.ts — all three lessons cited the TypeScript const name ` +
        `instead of the authority id — which is why PayRunAuthority["id"] is now a union.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 7) THE CHECKLIST AND THE RECOVERIES
 *
 * Michael asked for these by name: "I want check lists and blockers if things
 * are right. I want it to tell me how to do it properly if I mess it up."
 * ═══════════════════════════════════════════════════════════════════════════ */

export function assertPayRunChecklistIsWellFormed(): void {
  if (PAY_RUN_CHECKS.length === 0) {
    throw new Error(
      "PAY RUN CHECKLIST GATE BROKEN: there are no checks, so every rule below would pass " +
        "vacuously.",
    );
  }
  const seenKeys = new Set<string>();
  const seenQuestions = new Set<string>();
  for (const c of PAY_RUN_CHECKS) {
    if (seenKeys.has(c.key)) throw new Error(`DUPLICATE PAY RUN CHECK KEY: ${c.key}.`);
    seenKeys.add(c.key);
    if (seenQuestions.has(c.question)) {
      throw new Error(`DUPLICATE PAY RUN CHECK QUESTION: ${c.question}.`);
    }
    seenQuestions.add(c.question);

    // A checklist item that states a conclusion gets ticked; one that asks a
    // question gets read. That distinction is the entire value of a checklist,
    // and it is the difference between a pilot's pre-flight and a formality.
    if (!c.question.trimEnd().endsWith("?")) {
      throw new Error(
        `PAY RUN CHECK IS NOT A QUESTION: "${c.question}". A checklist of assertions is ticked ` +
          `without being read.`,
      );
    }
  }

  // The order must be 1..n with no gaps and no repeats. The order IS the
  // teaching here — a mistake at step 1 makes every later step wrong while each
  // of them still looks internally consistent — so a duplicated or missing
  // order number is a broken lesson, not a cosmetic problem.
  const orders = PAY_RUN_CHECKS.map((c) => c.order).sort((a, b) => a - b);
  const expected = PAY_RUN_CHECKS.map((_, i) => i + 1);
  if (orders.join(",") !== expected.join(",")) {
    throw new Error(
      `PAY RUN CHECKLIST ORDER IS NOT 1..${PAY_RUN_CHECKS.length}: got ${orders.join(",")}. The ` +
        `order is the lesson; a gap or a repeat means two checks claim the same position and ` +
        `the screen will render them in whichever order the array happens to hold.`,
    );
  }
}

/**
 * The recovery ladder must cover the whole timeline, in order, with no rung
 * missing.
 *
 * WHY THE STAGES ARE FIXED AND CHECKED BY NAME. What changes the answer after a
 * payroll mistake is not how big the error was — it is WHEN it was found. Before
 * approval, nothing has been saved. After the money moved but inside the
 * quarter, the next deposit absorbs it. After the 941 is filed, it is a 941-X.
 * After the W-2 is issued, it is a W-2c. Drop any one rung and the ladder sends
 * somebody to the wrong remedy with complete confidence.
 */
export const REQUIRED_RECOVERY_STAGES: readonly string[] = [
  "before-approval",
  "after-approval-before-payment",
  "after-payment-same-quarter",
  "after-quarter-filed",
  "after-w2-issued",
];

export function assertRecoveryLadderIsComplete(): void {
  if (PAY_RUN_RECOVERIES.length === 0) {
    throw new Error(
      "PAY RUN RECOVERY GATE BROKEN: there are no recoveries, so the checks below would pass " +
        "vacuously.",
    );
  }
  const present = PAY_RUN_RECOVERIES.map((r) => r.key as string);
  const missing = REQUIRED_RECOVERY_STAGES.filter((s) => !present.includes(s));
  if (missing.length > 0) {
    throw new Error(
      `THE RECOVERY LADDER IS MISSING RUNGS: ${missing.join(", ")}. What changes the remedy is ` +
        `WHEN the mistake is found, not how big it is. A missing stage sends somebody to the ` +
        `wrong remedy with complete confidence.`,
    );
  }
  const unexpected = present.filter((s) => !REQUIRED_RECOVERY_STAGES.includes(s));
  if (unexpected.length > 0) {
    throw new Error(
      `UNRECOGNISED RECOVERY STAGE: ${unexpected.join(", ")}. If a genuinely new stage exists, ` +
        `add it to REQUIRED_RECOVERY_STAGES in the right position — the list is ordered and the ` +
        `screen renders it in that order.`,
    );
  }
  if (present.join(",") !== REQUIRED_RECOVERY_STAGES.join(",")) {
    throw new Error(
      `THE RECOVERY LADDER IS OUT OF ORDER: ${present.join(", ")}. It is a timeline. Rendered ` +
        `out of order it reads as a menu of options rather than as "find where you are".`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 8) THE SCRAPE ITSELF
 *
 * Standing rule 39 in its purest form: every gate above trusts `unionMembers`.
 * If that function silently stops matching, all of them pass and none of them
 * protect anything. So it gets its own gate.
 * ═══════════════════════════════════════════════════════════════════════════ */

export function assertUnionScrapeWorks(): void {
  const refusals = payRunRefusalCodesInSource();
  const provenances = w4ProvenancesInSource();
  const storeFailures = payRunStoreFailureCodesInSource();

  // Deliberately compared against the SMALLEST count each union has ever had,
  // not against today's count. Asserting an exact number turns every legitimate
  // addition into a failing test, and a test that fails on correct input gets
  // weakened or deleted within a week.
  if (refusals.length < 7) {
    throw new Error(
      `UNION SCRAPE DEGRADED: found ${refusals.length} refusal codes, expected at least 7. The ` +
        `scrape is matching less than it used to, which means the coverage gates above are ` +
        `checking a shrinking list and reporting success.`,
    );
  }
  if (provenances.length < 3) {
    throw new Error(
      `UNION SCRAPE DEGRADED: found ${provenances.length} W-4 provenances, expected at least 3.`,
    );
  }
  if (storeFailures.length < 4) {
    throw new Error(
      `UNION SCRAPE DEGRADED: found ${storeFailures.length} store failure codes, expected at ` +
        `least 4.`,
    );
  }

  // And prove it can MISS: a union that does not exist must scrape to nothing.
  // Without this, a regex accidentally rewritten to match every quoted string
  // in the file would satisfy every count above.
  const nonsense = unionMembers(abs(PAY_RUN_CORE), "ThisUnionDoesNotExistAnywhere");
  if (nonsense.length > 0) {
    throw new Error(
      `UNION SCRAPE IS NOT DISCRIMINATING: asked for a union that does not exist and got ` +
        `${nonsense.length} members. It is matching something other than the union it was asked ` +
        `for, so every gate above is reading the wrong list.`,
    );
  }
}
