/**
 * src/lib/payroll/net-pay-mentor-gates.ts   (books-37)
 *
 * THE RULE-26 COVERAGE GATES FOR THE NET-PAY MENTOR.
 *
 * Separate from `net-pay-mentor.ts` for the reason set out at the top of
 * `sick-leave-mentor-gates.ts`: these call `readFileSync`, the mentor's lesson
 * data is reachable from client components, and mixing the two put `node:fs`
 * into a browser bundle in books-33 and broke every deployment while CI stayed
 * green. Standing rule 65b. `tests/compliance/client-bundle-purity.test.ts`
 * walks the client component graph and fails, naming the exact chain, if the
 * boundary breaks again.
 *
 * WHY THESE GATES READ FROM DISK. A hand-typed list of fields, refusal codes or
 * function names passes forever after somebody adds one and forgets the lesson
 * - standing rule 50, dead code wearing a green check. Every gate below parses
 * the real engine, and every gate refuses when it parses NOTHING, because a
 * coverage gate that inspects an empty list approves everything (standing rule
 * 39).
 *
 * Each gate also checks the OPPOSITE direction. A lesson beside a function that
 * was renamed or deleted reads as reassurance while covering nothing, and it is
 * the more dangerous of the two failures because the count still looks right.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO ENGINES, ONE MENTOR, AND WHY THAT IS DELIBERATE
 * ─────────────────────────────────────────────────────────────────────────────
 * This mentor covers `net-pay-core.ts` AND `ytd-store.ts`. They could have had
 * one mentor each. They share one because they are two halves of a single idea:
 * the year-to-date store exists so the tax engine can see the annual ceilings,
 * and the net-pay engine exists so the result reaches a cheque in the right
 * order. Teaching them apart would leave a reader holding two correct
 * explanations and no account of how a pay run actually flows.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertQuotedLessonsResolve,
  exportedFunctionNames,
} from "@/lib/payroll/mentor-quote-gate";

/**
 * The MERGED registry, not just this slice's own authorities.
 *
 * Net-pay lessons legitimately cite ids from other registries - the W-2 wage
 * base authorities, because the Social Security ceiling is the entire reason
 * the year-to-date store exists. Checking against `NET_PAY_AUTHORITIES` alone
 * would report those correct citations as dangling, and a gate that fails on
 * correct input gets weakened or deleted within a week.
 *
 * Checking against the merged registry is also STRICTER in the direction that
 * matters: it proves a cross-registry citation resolves to a real authority
 * rather than to a plausible-looking id nobody defined. It is pure data - the
 * registry file is explicitly free of I/O - so importing it here costs nothing.
 */
import { GUIDANCE_AUTHORITIES } from "@/lib/accounting/books-guidance-core";
import { NET_PAY_AUTHORITIES } from "@/lib/payroll/net-pay-authorities";
import {
  NET_PAY_FIELD_LESSONS,
  NET_PAY_REFUSAL_LESSONS,
  NET_PAY_REVIEW_CHECKS,
  NET_PAY_SCREEN_LESSONS,
} from "@/lib/payroll/net-pay-mentor";

const NET_PAY_CORE = join("src", "lib", "payroll", "net-pay-core.ts");
const YTD_STORE = join("src", "lib", "payroll", "ytd-store.ts");
/** This file, read from disk. See assertEveryQuotedNetPayLessonExists. */
const NET_PAY_GATES_SELF = join("src", "lib", "payroll", "net-pay-mentor-gates.ts");

/* ═══════════════════════════════════════════════════════════════════════════
 * THE ENGINE FUNCTIONS - every export must be taught
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * WHERE THE TEACHING FOR EACH EXPORTED FUNCTION LIVES.
 *
 * Standing rule 26: the engine has to be explainable, not merely correct. An
 * entry that quotes a lesson title does so in 'single quotes', and
 * `assertEveryQuotedNetPayLessonExists` proves the quoted lesson actually
 * exists - otherwise the map cheerfully directs a reader to teaching that was
 * deleted three slices ago.
 */
export const NET_PAY_CORE_FUNCTION_COVERAGE: Readonly<Record<string, string>> = {
  requiredByLawFor:
    "Taught by the six requiredByLaw.* field lessons and by the screen lesson 'The L&I premium " +
    "was missing from the base, and that is not a rounding detail', which is the defect this " +
    "function exists to fix: it is the single place that decides what counts as compelled, and " +
    "it itemises the answer rather than returning one opaque total.",
  computeNetPay:
    "Taught by the screen lesson 'Every number can be right and the cheque still wrong' — the " +
    "sequence gross → required-by-law → garnishment → voluntary → net is this function's entire " +
    "body, and the lesson explains why that order is arithmetic rather than presentation.",
  netPayReconciles:
    "Taught by the netPayCents field lesson and the review check that asks whether the components " +
    "add back up, which explain why a plausible-looking total is not evidence: two compensating " +
    "errors produce a correct net pay sitting on top of a wrong garnishment remittance.",
};

/**
 * The same, for the year-to-date STORE.
 *
 * Kept as a separate map from the one above rather than merged, because the two
 * are read from two different files on disk and a single map would make it
 * impossible to tell which engine an untaught function belonged to.
 */
export const YTD_STORE_FUNCTION_COVERAGE: Readonly<Record<string, string>> = {
  loadYtdForEmployee:
    "Taught by the screen lesson 'Year-to-date is not a report, it is an input', which explains " +
    "why this read happens before the tax calculation rather than after it, and why a missing row " +
    "is a legitimate start-of-year state rather than an error.",
  applyRunToYtd:
    "Taught by the same lesson together with the NET_PAY_TAXES_REFUSED refusal lesson: this is the " +
    "conditional write that makes a pay run land exactly once, and the reason it refuses on a lost " +
    "race instead of retrying is that a silent retry is how a year-to-date total gets doubled.",
  unapplyRunFromYtd:
    "Taught by the netPayCents field lesson's point about reversal: voiding a run must unwind " +
    "exactly the figures that were added, which is why this is a mirror of applyRunToYtd rather " +
    "than a fresh subtraction computed from current inputs.",
  loadYtdBoard:
    "Taught by the review check asking whether a garnished employee has crossed the Social " +
    "Security ceiling — this is the read that answers it for every active employee at once, and " +
    "it reports how many inactive rows it did not show rather than filtering them silently.",
  reconcileEmployeeYtd:
    "Taught by the review check 'Do the components of every cheque add back up to its net pay?' " +
    "applied across the year: it re-adds every run line and compares the total to the stored " +
    "accumulator, which is the only way a drift between the two becomes visible.",
};

export function netPayExportedFunctionNames(sourcePath?: string): readonly string[] {
  return exportedFunctionNames(sourcePath ?? join(process.cwd(), NET_PAY_CORE), "NET PAY");
}

/**
 * THE ASYNC ENGINE, and the reason the shared scrape had to be fixed.
 *
 * `ytd-store.ts` is the first engine in this codebase whose exports are ALL
 * `export async function`. The pattern every mentor-gate module used privately
 * — `/^export function (...)/gm` — matches none of them, so this gate would
 * have read an empty list, found none of them untaught, and reported full
 * coverage of a 700-line module that teaches nothing. That is standing rule 39
 * exactly. `exportedFunctionNames` in mentor-quote-gate.ts handles both forms
 * and throws rather than returning an empty list.
 */
export function ytdStoreExportedFunctionNames(sourcePath?: string): readonly string[] {
  return exportedFunctionNames(sourcePath ?? join(process.cwd(), YTD_STORE), "YTD STORE");
}

function assertFunctionsAreTaught(
  fns: readonly string[],
  coverage: Readonly<Record<string, string>>,
  label: string,
): void {
  const covered = new Set(Object.keys(coverage));
  const untaught = fns.filter((f) => !covered.has(f));
  if (untaught.length > 0) {
    throw new Error(
      `${label} ENGINE FUNCTIONS WITH NO EXPLANATION: ${untaught.join(", ")}. Standing rule 26 ` +
        `requires the engine to be explainable, not merely correct.`,
    );
  }
  const phantom = [...covered].filter((f) => !fns.includes(f));
  if (phantom.length > 0) {
    throw new Error(
      `${label} MENTOR EXPLAINS FUNCTIONS THAT NO LONGER EXIST: ${phantom.join(", ")}. A stale ` +
        `entry masks a real gap, because the count looks right while a live function goes ` +
        `untaught.`,
    );
  }
}

export function assertEveryNetPayFunctionIsTaught(sourcePath?: string): void {
  assertFunctionsAreTaught(
    netPayExportedFunctionNames(sourcePath),
    NET_PAY_CORE_FUNCTION_COVERAGE,
    "NET PAY",
  );
}

export function assertEveryYtdStoreFunctionIsTaught(sourcePath?: string): void {
  assertFunctionsAreTaught(
    ytdStoreExportedFunctionNames(sourcePath),
    YTD_STORE_FUNCTION_COVERAGE,
    "YTD STORE",
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE REFUSAL CODES - every code the engine can emit must be explained
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Parsed from the engine's own union type on disk, not from a list typed here.
 *
 * Standing rule 43: every refusal code must be reachable by a test, and the
 * first step is knowing what the codes actually ARE rather than what somebody
 * remembered them to be.
 */
export function netPayRefusalCodes(sourcePath?: string): readonly string[] {
  const p = sourcePath ?? join(process.cwd(), NET_PAY_CORE);
  const text = readFileSync(p, "utf8");
  const block = text.match(/export type NetPayRefusalCode\s*=([\s\S]*?);/);
  if (!block) return [];
  return [...block[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
}

export function assertEveryNetPayRefusalCodeIsTaught(sourcePath?: string): void {
  const codes = netPayRefusalCodes(sourcePath);
  if (codes.length === 0) {
    throw new Error(
      "NET PAY REFUSAL GATE BROKEN: read no refusal codes from net-pay-core.ts. A gate that " +
        "parses nothing approves everything (standing rule 39).",
    );
  }
  const taught = new Set(NET_PAY_REFUSAL_LESSONS.map((l) => l.code as string));
  const untaught = codes.filter((c) => !taught.has(c));
  if (untaught.length > 0) {
    throw new Error(
      `NET PAY REFUSAL CODES WITH NO EXPLANATION: ${untaught.join(", ")}. A refusal that reaches ` +
        `Michael as a bare code is a dead end, and a dead end in payroll is where somebody ` +
        `overrides the software.`,
    );
  }
  const phantom = [...taught].filter((c) => !codes.includes(c));
  if (phantom.length > 0) {
    throw new Error(
      `NET PAY MENTOR EXPLAINS REFUSAL CODES THAT NO LONGER EXIST: ${phantom.join(", ")}. A stale ` +
        `entry masks a real gap, because the count looks right while a live code goes untaught.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE FIELDS - every figure on the breakdown must be explained
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The fields of `NetPayBreakdown`, read from the engine's own type on disk.
 *
 * WHY THE NESTED BUCKET IS EXPANDED. `requiredByLaw` is one field on the
 * breakdown and six figures on the screen, and the six are the entire subject
 * of this slice — the L&I one is the defect that started it. A gate that
 * accepted a single lesson for "requiredByLaw" would let the most important
 * deduction in the module ship unexplained while reporting full coverage.
 */
export function netPayBreakdownFieldNames(sourcePath?: string): readonly string[] {
  const p = sourcePath ?? join(process.cwd(), NET_PAY_CORE);
  const text = readFileSync(p, "utf8");
  const names: string[] = [];

  const breakdown = text.match(/export type NetPayBreakdown = \{([\s\S]*?)\n\};/);
  if (breakdown) {
    names.push(
      ...[...breakdown[1].matchAll(/^\s{2}readonly ([A-Za-z0-9_]+)[?]?:/gm)].map((m) => m[1]),
    );
  }

  const required = text.match(/export type RequiredByLawBreakdown = \{([\s\S]*?)\n\};/);
  if (required) {
    names.push(
      ...[...required[1].matchAll(/^\s{2}readonly ([A-Za-z0-9_]+)[?]?:/gm)].map(
        (m) => `requiredByLaw.${m[1]}`,
      ),
    );
  }
  return names;
}

/**
 * Fields that exist but are not lessons.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS LIST IS NOT TRUSTED. IT IS CHECKED.
 * ─────────────────────────────────────────────────────────────────────────────
 * In books-34 a mutation campaign added the W-2 box 3 figure to an equivalent
 * list and the whole suite stayed GREEN: every gate still ran, still read the
 * source, still reported full coverage, while the most important number in the
 * table quietly stopped needing an explanation.
 *
 * So each exemption below carries its reason in writing, and the reasons are
 * narrow. Every one of these is either a PASS-THROUGH of a figure taught in
 * full elsewhere, or a derived total whose components are each taught. Nothing
 * is exempt merely for being small or obvious.
 */
export const NET_PAY_STRUCTURAL_FIELDS: readonly string[] = [
  // The engine's record of what it deliberately did NOT subtract from the base.
  // Its meaning is the entire subject of the voluntaryTotalCents lesson and of
  // the screen lesson on health insurance, so it is taught by both.
  "voluntaryDeductions",
  // requiredByLaw is a container. Its six members are each taught individually
  // above, which is stricter than teaching the container.
  "requiredByLaw",
  // A derived sum whose only meaning is "the six members of requiredByLaw added
  // up". The members carry the teaching; a lesson here would restate them.
  "requiredByLaw.totalCents",
];

export function assertEveryNetPayFieldIsTaught(sourcePath?: string): void {
  const fields = netPayBreakdownFieldNames(sourcePath);
  if (fields.length === 0) {
    throw new Error(
      "NET PAY FIELD GATE BROKEN: read no fields from net-pay-core.ts. A gate that parses nothing " +
        "approves everything (standing rule 39).",
    );
  }
  const taught = new Set(NET_PAY_FIELD_LESSONS.map((l) => l.field));
  const exempt = new Set(NET_PAY_STRUCTURAL_FIELDS);
  const untaught = fields.filter((f) => !taught.has(f) && !exempt.has(f));
  if (untaught.length > 0) {
    throw new Error(
      `NET PAY FIGURES WITH NO EXPLANATION: ${untaught.join(", ")}. Every figure on a paycheque ` +
        `breakdown has to be explainable to the person signing it.`,
    );
  }
  const phantom = [...taught].filter((f) => !fields.includes(f));
  if (phantom.length > 0) {
    throw new Error(
      `NET PAY MENTOR EXPLAINS FIGURES THAT NO LONGER EXIST: ${phantom.join(", ")}. A stale lesson ` +
        `masks a real gap, because the count looks right while a live figure goes untaught.`,
    );
  }
  const staleExemptions = NET_PAY_STRUCTURAL_FIELDS.filter((f) => !fields.includes(f));
  if (staleExemptions.length > 0) {
    throw new Error(
      `NET PAY EXEMPTS FIELDS THAT NO LONGER EXIST: ${staleExemptions.join(", ")}. An exemption ` +
        `for a deleted field is how a NEW field with the same name later ships unexplained.`,
    );
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE AUTHORITIES - every citation must resolve
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Every authority id a lesson cites must be a real authority.
 *
 * A citation that resolves to nothing is worse than no citation: it reads as
 * proof, and the reader has no way to discover it is empty short of looking the
 * id up by hand.
 *
 * NOTE ON SCOPE. Lessons here legitimately cite ids from OTHER registries — the
 * W-2 wage-base authorities, for instance, because the Social Security ceiling
 * is the reason the year-to-date store exists. So this checks against the whole
 * merged guidance registry rather than only `NET_PAY_AUTHORITIES`, and the
 * `knownIds` parameter lets a test hand it a deliberately short list to prove
 * the gate BITES (standing rule 16).
 */
export function assertEveryCitedNetPayAuthorityExists(knownIds?: readonly string[]): void {
  const ids = new Set(knownIds ?? GUIDANCE_AUTHORITIES.map((a) => a.id));
  if (ids.size === 0) {
    throw new Error(
      "NET PAY AUTHORITY GATE BROKEN: there are no authorities to check against, so every " +
        "citation would look dangling.",
    );
  }
  const cited = new Set<string>();
  for (const l of NET_PAY_FIELD_LESSONS) for (const a of l.authorityIds) cited.add(a);
  for (const l of NET_PAY_SCREEN_LESSONS) for (const a of l.authorityIds) cited.add(a);
  if (cited.size === 0) {
    throw new Error(
      "NET PAY AUTHORITY GATE BROKEN: no lesson cites any authority at all, so this gate has " +
        "nothing to verify and would pass forever.",
    );
  }
  const dangling = [...cited].filter((c) => !ids.has(c));
  if (dangling.length > 0) {
    throw new Error(
      `NET PAY LESSONS CITE AUTHORITIES THAT DO NOT EXIST: ${dangling.join(", ")}. A citation ` +
        `that resolves to nothing reads as proof and is not.`,
    );
  }
}

/**
 * THE OPPOSITE DIRECTION: every net-pay authority must be cited by a lesson.
 *
 * An authority nobody cites is research that never reached Michael — mirrored,
 * verbatim-checked, and invisible. That is precisely the condition books-36
 * found across ten mentor modules, and it is worth a gate rather than a hope.
 */
export function assertEveryNetPayAuthorityIsUsed(): void {
  const cited = new Set<string>();
  for (const l of NET_PAY_FIELD_LESSONS) for (const a of l.authorityIds) cited.add(a);
  for (const l of NET_PAY_SCREEN_LESSONS) for (const a of l.authorityIds) cited.add(a);
  const unused = NET_PAY_AUTHORITIES.filter((a) => !cited.has(a.id)).map((a) => a.id);
  if (unused.length > 0) {
    throw new Error(
      `NET PAY AUTHORITIES NOBODY CITES: ${unused.join(", ")}. An authority that no lesson ` +
        `references is research that never reaches the person who needs it.`,
    );
  }
}

/**
 * Every lesson title NET_PAY_CORE_FUNCTION_COVERAGE quotes must exist.
 *
 * books-36, standing rule 23. Deleting a quoted lesson used to leave the suite
 * green while the coverage map went on telling readers where teaching lived
 * that had been deleted. The shared implementation lives in mentor-quote-gate.ts
 * so a fix there is a fix everywhere (standing rule 25).
 *
 * `topicsOverride` exists so a test can hand this a deliberately broken lesson
 * list and prove the gate BITES (standing rule 16).
 */
export function assertEveryQuotedNetPayLessonExists(topicsOverride?: readonly string[]): void {
  assertQuotedLessonsResolve({
    gatesSourcePath: NET_PAY_GATES_SELF,
    mapName: "NET_PAY_CORE_FUNCTION_COVERAGE",
    topics: topicsOverride ?? NET_PAY_SCREEN_LESSONS.map((l) => l.topic),
    label: "NET PAY",
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
 * THE REVIEW CHECKLIST
 * ═══════════════════════════════════════════════════════════════════════════ */

export function assertNetPayReviewChecksAreWellFormed(): void {
  if (NET_PAY_REVIEW_CHECKS.length === 0) {
    throw new Error(
      "NET PAY REVIEW CHECKLIST GATE BROKEN: there are no checks, so the rules below would pass " +
        "vacuously.",
    );
  }
  const seen = new Set<string>();
  for (const c of NET_PAY_REVIEW_CHECKS) {
    if (seen.has(c.question)) {
      throw new Error(`DUPLICATE NET PAY REVIEW CHECK: ${c.question}.`);
    }
    seen.add(c.question);
    // A checklist item that states a conclusion gets ticked; one that asks a
    // question gets read. The distinction is the whole value of the checklist.
    if (!c.question.trimEnd().endsWith("?")) {
      throw new Error(
        `NET PAY REVIEW CHECK IS NOT A QUESTION: "${c.question}". A checklist of assertions is ` +
          `ticked without being read.`,
      );
    }
  }
}
