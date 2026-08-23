/**
 * tests/compliance/wage-order-write-store.test.ts   (books-38)
 *
 * THE GATE OVER THE ONLY WRITE PATH A WAGE ORDER HAS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS PROTECTING
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `wage-order-entry-core.ts` is proven to validate a judgement correctly, and
 * that proof is worth nothing if the store ignores it, works around it, or
 * writes a row the validator never approved. Standing rule 63d: the handoff is
 * where the defect lives.
 *
 * The specific handoffs that can go wrong here, each of which has a test below:
 *
 *   - The store could write WITHOUT validating, or validate and then write the
 *     raw draft rather than the validated row.
 *   - The store could check duplicates against a list the FORM supplied rather
 *     than reading the current one, re-opening the double-withholding hole.
 *   - The store could coerce a null tri-state into `false`, which is the one
 *     error in this domain that lands on the employer personally.
 *   - The store could hand Michael a raw Postgres constraint name.
 *   - The store could grow a delete function.
 *   - The actions could skip the access gate, which on this path is the ONLY
 *     protection, because the service role bypasses 0198's RLS entirely.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY SO MANY OF THESE ARE SOURCE-LEVEL ASSERTIONS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * These functions need a Supabase connection to run. There is no connection in
 * CI, and mocking the client would prove only that the mock behaves as written.
 * The properties that actually matter here — "the gate is called FIRST", "the
 * status guard is on the update", "no null becomes a false", "there is no
 * delete" — are structural, and structural properties are checkable in the
 * source with certainty.
 *
 * Comments are stripped before any source assertion runs, so a rule DESCRIBED
 * in prose cannot satisfy a test looking for the rule IMPLEMENTED. This file
 * has a very long header, and without stripping, that header would make half
 * these tests pass on its own.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CONSTRAINT_EXPLANATIONS,
  MIN_TERMINATION_NOTE_CHARS,
  explainConstraintViolation,
} from "@/lib/payroll/wage-order-write-store";
import { WAGE_ORDER_CONSTRAINT_PARITY } from "@/lib/payroll/wage-order-entry-core";

const ROOT = join(__dirname, "..", "..");
const STORE_PATH = join(ROOT, "src", "lib", "payroll", "wage-order-write-store.ts");
const ACTIONS_PATH = join(ROOT, "src", "app", "admin", "books", "garnishments", "actions.ts");

const storeSrc = readFileSync(STORE_PATH, "utf8");
const actionsSrc = readFileSync(ACTIONS_PATH, "utf8");

/** Strip block and line comments so prose cannot satisfy a code assertion. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const storeCode = stripComments(storeSrc);
const actionsCode = stripComments(actionsSrc);

/* ══════════════════════════════════════════════════════════════════════════
 * GUARD THE GUARD (rule 39)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the comment stripper actually strips", () => {
  it("removes the prose and keeps the code", () => {
    // Without this, every "the source does NOT contain X" test below could pass
    // simply because the stripper returned an empty string, and every "the
    // source DOES contain X" test could pass off a sentence in a comment.
    expect(storeCode.length).toBeGreaterThan(1000);
    expect(storeCode.length).toBeLessThan(storeSrc.length);

    // A distinctive phrase that appears ONLY in a comment must be gone.
    expect(storeSrc).toContain("never invent a default");
    expect(storeCode).not.toContain("never invent a default");

    // Real code must survive.
    expect(storeCode).toContain("export async function createWageOrder");
  });

  it("strips the actions file too, without emptying it", () => {
    expect(actionsCode).toContain("export async function createWageOrderAction");
    expect(actionsSrc).toContain("PUBLIC HTTP ENDPOINT");
    expect(actionsCode).not.toContain("PUBLIC HTTP ENDPOINT");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE VALIDATOR IS ACTUALLY USED
 * ══════════════════════════════════════════════════════════════════════════ */

describe("nothing is written that the validator did not approve", () => {
  it("the create path calls validateWageOrderDraft", () => {
    expect(storeCode).toContain("validateWageOrderDraft");
  });

  it("it validates TWICE - once for shape, once against the live duplicate list", () => {
    // The second pass is the whole defence against a re-entered writ. A single
    // pass against an empty list would validate the shape and then write a
    // duplicate, doubling somebody's withholding.
    const calls = storeCode.match(/validateWageOrderDraft\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("the duplicate list is READ from the database, not accepted from the caller", () => {
    // If the case numbers arrived as a parameter, a stale or hostile caller
    // could pass [] and walk straight past the duplicate rule.
    expect(storeCode).toContain("activeCaseNumbersFor");
    expect(storeCode).toMatch(/\.eq\(\s*"employee_id"/);
    expect(storeCode).toMatch(/\.eq\(\s*"status",\s*"active"\s*\)/);
  });

  it("the INSERT writes the validated row, never the raw draft", () => {
    // The single most dangerous possible defect in this file: validate, ignore
    // the result, and insert what the human typed. Every inserted value must
    // come off `row.`, which only exists as the validator's output.
    const insertBlock = storeCode.slice(
      storeCode.indexOf('.from("wage_orders")\n    .insert('),
      storeCode.indexOf(".select(\"id\")"),
    );
    expect(insertBlock.length).toBeGreaterThan(200);
    expect(insertBlock).toContain("row.employee_id");
    expect(insertBlock).toContain("row.served_date");
    expect(insertBlock).not.toContain("draft.");
  });

  it("served_date is written - the column 0201 added is not silently dropped", () => {
    // The whole reason migration 0201 exists. A write path that omitted it
    // would hit the NOT NULL constraint at runtime, but only once the column
    // was enforced, and the failure would look like a database fault.
    expect(storeCode).toContain("served_date: row.served_date");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE TRI-STATE SURVIVES (rule 62d)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("a null answer never becomes a false", () => {
  it("the two support booleans are passed straight through", () => {
    expect(storeCode).toContain("arrears_over_twelve_weeks: row.arrears_over_twelve_weeks");
    expect(storeCode).toContain("supports_second_family: row.supports_second_family");
  });

  it("neither is defaulted, coalesced or coerced anywhere in the file", () => {
    // `?? false`, `|| false`, `Boolean(...)` on either of these is the exact
    // shape of the defect: the system looks like it works and quietly
    // under-withholds child support. RCW 26.23.090 makes that the employer's
    // problem, personally.
    for (const field of ["arrears_over_twelve_weeks", "supports_second_family"]) {
      const re = new RegExp(`${field}[^,\\n]*(\\?\\?|\\|\\||Boolean\\()`);
      expect(storeCode).not.toMatch(re);
    }
    expect(storeCode).not.toMatch(/arrearsOverTwelveWeeks\s*\?\?\s*false/);
    expect(storeCode).not.toMatch(/supportsSecondFamily\s*\?\?\s*false/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * CONSTRAINT TRANSLATION (rule 64a - detection is not explanation)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("a constraint violation is translated, never shown raw", () => {
  it("every constraint the engine knows about has an explanation here", () => {
    // Derived from the engine's own parity list, NOT from a copy. A constraint
    // added there without a sentence here fails this test instead of reaching
    // Michael as a Postgres error string.
    expect(WAGE_ORDER_CONSTRAINT_PARITY.length).toBeGreaterThan(3);
    const missing = WAGE_ORDER_CONSTRAINT_PARITY.map((p) => p.constraint).filter(
      (c) => !(c in CONSTRAINT_EXPLANATIONS),
    );
    expect(missing).toEqual([]);
  });

  it("recognises each constraint inside a realistic Postgres message", () => {
    const message =
      'duplicate key value violates unique constraint "wage_orders_one_live_per_case"';
    const explained = explainConstraintViolation(message);
    expect(explained).not.toBeNull();
    expect(explained!.toLowerCase()).toContain("twice");
  });

  it("recognises the not-null violation on served_date, which names a COLUMN not a constraint", () => {
    // Postgres phrases NOT NULL failures differently from CHECK failures. A
    // matcher that only looked for constraint names would miss this one
    // entirely and fall through to the raw-message branch.
    const message =
      'null value in column "served_date" of relation "wage_orders" violates not-null constraint';
    const explained = explainConstraintViolation(message);
    expect(explained).not.toBeNull();
    expect(explained!).toContain("twenty days");
  });

  it("returns null for a message it does not recognise, rather than guessing", () => {
    // Standing rule 1. A confident wrong explanation is worse than an honest
    // "this is not something the system recognises", because the first one
    // sends Michael off to fix the wrong thing.
    expect(explainConstraintViolation("connection reset by peer")).toBeNull();
  });

  it("every explanation says what to do, not just what happened", () => {
    for (const [name, text] of Object.entries(CONSTRAINT_EXPLANATIONS)) {
      expect(text.length, `${name} is too short to be an explanation`).toBeGreaterThan(120);
      // Each one must state the write outcome plainly. A reader who does not
      // know whether the order was saved will either enter it twice or not at
      // all, and both are worse than the original error.
      expect(text.toLowerCase(), `${name} does not say whether anything was saved`).toMatch(
        /nothing was (saved|changed)/,
      );
    }
  });

  it("no explanation is merely the constraint name restated", () => {
    for (const [name, text] of Object.entries(CONSTRAINT_EXPLANATIONS)) {
      expect(text).not.toContain(name);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * NOTHING IS EVER DELETED
 * ══════════════════════════════════════════════════════════════════════════ */

describe("a wage order can be ended but never erased", () => {
  it("there is no delete anywhere in the write path", () => {
    // A deleted order cannot answer "what did you withhold in March, and under
    // what authority". An employer who cannot answer that is the one who pays.
    expect(storeCode).not.toMatch(/\.delete\(/);
    expect(storeCode).not.toMatch(/export\s+async\s+function\s+delete/i);
    expect(actionsCode).not.toMatch(/\.delete\(/);
    expect(actionsCode).not.toMatch(/export\s+async\s+function\s+delete/i);
  });

  it("ending an order requires a real reason", () => {
    expect(MIN_TERMINATION_NOTE_CHARS).toBeGreaterThanOrEqual(5);
    expect(storeCode).toContain("MIN_TERMINATION_NOTE_CHARS");
    expect(storeCode).toContain("termination_note");
  });

  it("terminate, suspend and resume each guard on the CURRENT status", () => {
    // Without the status guard, two people acting on the same order in two tabs
    // both report success and one silently overwrites the other's reason - and
    // on a termination, the reason is the entire point.
    expect(storeCode).toMatch(/status:\s*"terminated"/);
    expect(storeCode).toMatch(/\.in\(\s*"status",\s*\["active",\s*"suspended"\]\s*\)/);
    // suspend acts only on active; resume acts only on suspended.
    expect(storeCode).toMatch(/status:\s*"suspended"[\s\S]{0,400}?\.eq\(\s*"status",\s*"active"\s*\)/);
    expect(storeCode).toMatch(/status:\s*"active"[\s\S]{0,400}?\.eq\(\s*"status",\s*"suspended"\s*\)/);
  });

  it("a terminated order cannot be resumed", () => {
    // Restarting withholding under a RELEASED order is taking money the payee
    // is no longer entitled to. Resume is scoped to 'suspended' only, and the
    // refusal explains why rather than just saying not found.
    const resume = storeCode.slice(storeCode.indexOf("export async function resumeWageOrder"));
    expect(resume).toMatch(/\.eq\(\s*"status",\s*"suspended"\s*\)/);
    expect(resume).not.toMatch(/\.in\(\s*"status"/);
  });

  it("the new-order insert does not set status, leaving 0198's default to decide", () => {
    // Two places deciding what a new order's status is would eventually
    // disagree, and the disagreement would be invisible.
    const insertBlock = storeCode.slice(
      storeCode.indexOf('.insert({'),
      storeCode.indexOf('.select("id")'),
    );
    expect(insertBlock.length).toBeGreaterThan(200);
    expect(insertBlock).not.toMatch(/status:/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE READ FAILURE IS NOT AN EMPTY LIST (rule 39)
 * ══════════════════════════════════════════════════════════════════════════ */

describe("a failed duplicate check stops the write", () => {
  it("activeCaseNumbersFor returns a failure rather than an empty list on error", () => {
    const fn = storeCode.slice(
      storeCode.indexOf("export async function activeCaseNumbersFor"),
      storeCode.indexOf("export async function createWageOrder"),
    );
    expect(fn.length).toBeGreaterThan(200);
    // The dangerous version returns `{ ok: true, caseNumbers: [] }` on error,
    // turning "we could not check" into "there are no duplicates" - which is
    // permission to double-withhold.
    expect(fn).toContain('code: "READ_FAILED"');
    expect(fn).not.toMatch(/error\s*\)\s*\{[\s\S]{0,200}caseNumbers:\s*\[\]/);
  });

  it("the create path aborts when that read fails", () => {
    expect(storeCode).toContain("if (!existing.ok) return existing;");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE ACCESS GATE - the only protection on this path
 * ══════════════════════════════════════════════════════════════════════════ */

describe("every action checks access before doing anything", () => {
  const EXPORTED = [
    "createWageOrderAction",
    "terminateWageOrderAction",
    "suspendWageOrderAction",
    "resumeWageOrderAction",
    // books-40c. This roster deliberately has to be widened by hand, and this
    // test failing on the day the fifth action landed is the gate doing its
    // job exactly as its comment below promised.
    "recordWageOrderAnswerAction",
  ];

  /**
   * Strip comments before counting.
   *
   * The docblock above these actions discusses `requireBooksAccess()` twice in
   * prose. A raw count therefore reported 7 calls for 5 actions, which happens
   * to be a SAFE direction to be wrong in - but only by luck. Prose could just
   * as easily have masked a missing call, and an access-control gate that can
   * be satisfied by a comment is not a gate (standing rule 39).
   */
  const codeOnly = actionsCode
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("all five actions exist", () => {
    for (const name of EXPORTED) {
      expect(actionsCode).toContain(`export async function ${name}`);
    }
  });

  it("EVERY exported action calls requireBooksAccess, with none missed", () => {
    // Counted rather than spot-checked. A fifth action added later without the
    // gate is the exact defect this catches, and spot-checking four names would
    // never see it.
    const exported = [...codeOnly.matchAll(/export\s+async\s+function\s+(\w+)/g)].map(
      (m) => m[1],
    );
    expect(exported.sort()).toEqual([...EXPORTED].sort());

    // Counted on code with comments removed, so that prose ABOUT the gate can
    // never stand in for a call TO the gate.
    const gateCalls = codeOnly.match(/requireBooksAccess\(\)/g) ?? [];
    expect(gateCalls.length).toBe(exported.length);
  });

  it("the gate is called BEFORE any store function, in every action", () => {
    // Order matters. A gate called after the write has already happened is
    // decoration. This checks the position of the call within each function
    // body rather than merely its presence.
    const bodies = codeOnly.split(/export\s+async\s+function\s+/).slice(1);
    expect(bodies.length).toBe(EXPORTED.length);
    for (const body of bodies) {
      const gateAt = body.indexOf("requireBooksAccess()");
      expect(gateAt).toBeGreaterThan(-1);
      for (const store of [
        "createWageOrder(",
        "terminateWageOrder(",
        "suspendWageOrder(",
        "resumeWageOrder(",
        // books-40c. Omitting the new store function here would have left the
        // ordering check passing while saying nothing at all about it.
        "recordWageOrderAnswer(",
      ]) {
        const storeAt = body.indexOf(store);
        if (storeAt > -1) expect(gateAt).toBeLessThan(storeAt);
      }
    }
  });

  it("the staff id comes from the session, never from the form", () => {
    // An audit fact that arrives in the request body is not a fact.
    expect(actionsCode).toContain("createdByStaffId: session.profile.id");
    expect(actionsCode).not.toMatch(/createdByStaffId:\s*(draft|input)\./);
  });

  it("the store is server-only, so it can never reach a browser bundle", () => {
    expect(storeSrc).toMatch(/^import\s+"server-only";/m);
  });

  it("a successful write revalidates the screens whose numbers just changed", () => {
    // Net pay is the one that matters. A new garnishment changes take-home from
    // the effective date, and a cached net-pay page would show a figure that no
    // longer matches what will actually be paid.
    expect(actionsCode).toContain('revalidatePath("/admin/books/net-pay")');
    expect(actionsCode).toContain("revalidatePath(SCREEN)");
  });

  it("nothing throws - every failure path returns a sentence", () => {
    // A thrown error renders Next's error boundary: a blank screen, and no
    // indication of whether the order was saved.
    expect(actionsCode).not.toMatch(/\bthrow\s+new\b/);
    expect(storeCode).not.toMatch(/\bthrow\s+new\b/);
  });
});
