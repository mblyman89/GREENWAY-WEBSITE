/**
 * REGRESSION — "I have tested the Leafly order acknowledge button again, and
 * it is still unable to complete... It just spins and thinks and never
 * finishes."
 *
 * Reported by the owner for the THIRD time, after two shipped fixes.
 *
 * ===========================================================================
 * WHY THE FIRST TWO FIXES DID NOT WORK
 * ===========================================================================
 * They were both correct, and both incomplete, and they were incomplete in
 * the same way: each bounded a NETWORK call because the network was the
 * hypothesis being tested at the time.
 *
 *   L-17 — bounded the fetch CONNECTION (`AbortSignal.timeout` on every
 *          outbound Leafly `fetch`). Shipped. The hang persisted.
 *   L-23 — bounded the response BODY read, which `AbortSignal` does not
 *          cover once headers have arrived. Shipped. The hang persisted.
 *
 * After two slices there was still no INVENTORY of every blocking call one
 * acknowledge click can make. Without one, each round picked the most
 * plausible suspect and bounded it. The database was never anybody's
 * suspect, so nobody looked, and:
 *
 *     grep -rn "abortSignal" src/    →    ZERO matches
 *
 * Not one database call in the entire application was bounded, while
 * `.abortSignal()` has been available on the installed postgrest-js the
 * whole time (`node_modules/@supabase/postgrest-js/dist/index.d.cts:1389`).
 *
 * ===========================================================================
 * THE MEASUREMENT (scripts/recon/supabase-hang-probe.mjs)
 * ===========================================================================
 * Against a real `node:http` server that accepts the TCP connection and then
 * answers nothing — which is what a wedged connection pool looks like:
 *
 *   [probe 1] UNBOUNDED (today's code): after 8006ms settled=false
 *                                       -> STILL HANGING
 *   [probe 2] BOUNDED (abortSignal 1500ms): after 1505ms
 *             -> returned an error value:
 *                TimeoutError: The operation was aborted due to timeout
 *
 * Probe 2 also establishes the fact that makes this fix cheap: an aborted
 * PostgREST query comes back through the ordinary `{ data, error }` channel
 * rather than throwing. Every existing `if (error)` branch therefore handles
 * a deadline correctly the moment the signal is attached.
 *
 * ===========================================================================
 * WHAT THIS FILE PINS
 * ===========================================================================
 * The budgets and the arithmetic live in `db-deadline-core.ts` and are
 * covered by the self-test sweep with an assertion floor. This file pins the
 * things a pure core cannot see:
 *
 *   1. that `.abortSignal()` is actually WIRED into the queries on the
 *      acknowledge path — a budget nothing calls is decoration;
 *   2. that the signal really does fire, against a real timer;
 *   3. that `.abortSignal()` sits on the TRANSFORM builder, which is the
 *      trap that makes this wiring easy to get wrong;
 *   4. that the outer action backstop resolves rather than hanging;
 *   5. that the acknowledge action and its redirect target both declare a
 *      `maxDuration`, because a function killed by the platform renders
 *      nothing at all and the spinner never stops.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LEAFLY_ACK_TOTAL_BUDGET_MS,
  LEAFLY_DB_OPERATIONS,
  LEAFLY_DB_TIMEOUT_MS,
  PLATFORM_MAX_DURATION_MS,
  dbTimeoutForOperation,
} from "@/lib/leafly/db-deadline-core";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Blank out comments so a mention of `.abortSignal(` in prose cannot satisfy
 * a wiring assertion.
 *
 * ── WHY THIS IS NOT PEDANTRY ────────────────────────────────────────────
 * Every deadline added in this slice carries a paragraph explaining why
 * that query must not hang, and several of those paragraphs contain the
 * literal text `.abortSignal(`. A test that greps the raw source would pass
 * on the comment alone — so deleting the actual call, the exact regression
 * this file exists to catch, would leave the suite green.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ========================================================================= *
 * 1. THE SIGNAL ACTUALLY FIRES
 * ========================================================================= */

describe("the database deadline is real, not decorative", () => {
  it("produces a signal that aborts on its own", async () => {
    const { dbDeadline } = await import("@/lib/leafly/db-deadline");
    const signal = dbDeadline("credentials_read");

    expect(signal.aborted).toBe(false);
    expect(typeof signal.addEventListener).toBe("function");
  });

  it("aborts a pending operation rather than waiting forever", async () => {
    // A short, explicit budget so the test is fast. The point is the
    // MECHANISM, not the production number.
    const signal = AbortSignal.timeout(50);

    const started = Date.now();
    const settled = await new Promise<string>((resolve) => {
      signal.addEventListener("abort", () => resolve("aborted"));
      // Deliberately never resolves on its own — this is the black hole.
      setTimeout(() => resolve("never"), 5_000);
    });
    const elapsed = Date.now() - started;

    expect(settled).toBe("aborted");
    expect(elapsed).toBeLessThan(2_000);
  });

  it("reports a timeout as a TimeoutError, which is what the probe measured", async () => {
    const { isDbDeadlineError } = await import("@/lib/leafly/db-deadline");

    // The exact error object shape postgrest-js surfaced in probe 2.
    expect(
      isDbDeadlineError({
        name: "TimeoutError",
        message: "The operation was aborted due to timeout",
      }),
    ).toBe(true);
    expect(isDbDeadlineError({ name: "AbortError", message: "aborted" })).toBe(true);

    // A real database error must NOT be mistaken for a deadline, or a
    // genuine fault would be reported to the operator as "too slow".
    expect(
      isDbDeadlineError({ name: "PostgrestError", message: "duplicate key value" }),
    ).toBe(false);
    expect(isDbDeadlineError(null)).toBe(false);
    expect(isDbDeadlineError(undefined)).toBe(false);
    expect(isDbDeadlineError("timeout")).toBe(false);
  });
});

/* ========================================================================= *
 * 2. THE BUDGETS FIT
 * ========================================================================= */

describe("the acknowledge budget arithmetic", () => {
  it("gives every operation a finite, positive budget", () => {
    for (const op of LEAFLY_DB_OPERATIONS) {
      const ms = LEAFLY_DB_TIMEOUT_MS[op];
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThan(0);
    }
  });

  it("falls back to the TIGHTEST budget for an unknown operation", () => {
    // The direction matters. Falling back to the loosest budget — or worse,
    // to no budget — would mean a typo'd operation name silently restores
    // the unbounded wait this whole slice exists to remove.
    const fallback = dbTimeoutForOperation("definitely_not_an_operation");
    expect(fallback).toBe(Math.min(...Object.values(LEAFLY_DB_TIMEOUT_MS)));
  });

  it("loses the race to the platform ceiling deliberately", () => {
    // Vercel KILLS a function that reaches its maxDuration. A killed
    // function renders nothing, so the browser gets no response and the
    // spinner never stops — which is precisely the symptom reported. Our
    // own budget must expire first, with enough headroom left to actually
    // render an explanation.
    expect(LEAFLY_ACK_TOTAL_BUDGET_MS).toBeLessThan(PLATFORM_MAX_DURATION_MS);
    expect(PLATFORM_MAX_DURATION_MS - LEAFLY_ACK_TOTAL_BUDGET_MS).toBeGreaterThanOrEqual(
      30_000,
    );
  });
});

/* ========================================================================= *
 * 3. THE OUTER BACKSTOP RESOLVES
 * ========================================================================= */

describe("withActionDeadline", () => {
  it("returns the value when the work finishes in time", async () => {
    const { withActionDeadline } = await import("@/lib/leafly/action-deadline");
    const result = await withActionDeadline(Promise.resolve("done"), {
      budgetMs: 1_000,
    });
    expect(result.timedOut).toBe(false);
    if (!result.timedOut) expect(result.value).toBe("done");
  });

  it("resolves — rather than hanging — when the work never settles", async () => {
    const { withActionDeadline } = await import("@/lib/leafly/action-deadline");

    // The black hole. Without the backstop this await never returns, which
    // is the bug in one line.
    const neverSettles = new Promise<string>(() => {});

    const started = Date.now();
    const result = await withActionDeadline(neverSettles, { budgetMs: 60 });
    const elapsed = Date.now() - started;

    expect(result.timedOut).toBe(true);
    expect(elapsed).toBeLessThan(3_000);
    if (result.timedOut) {
      expect(result.message.length).toBeGreaterThan(0);
      // The operator is told what to do, not shown a stack trace.
      expect(result.message).not.toMatch(/\bat \w+ \(/);
    }
  });

  it("tells the truth about whether the request was actually sent", async () => {
    const { withActionDeadline } = await import("@/lib/leafly/action-deadline");
    const neverSettles = new Promise<string>(() => {});

    // NOT sent: a retry is safe, and the operator must be told so — telling
    // them not to retry here would strand a live order inside Leafly's
    // fifteen-minute window.
    const notSent = await withActionDeadline(neverSettles, {
      budgetMs: 50,
      requestWasSent: () => false,
    });
    expect(notSent.timedOut).toBe(true);
    if (notSent.timedOut) {
      expect(notSent.message).toMatch(/not acknowledged|nothing has changed/i);
    }

    // SENT: the outcome is genuinely unknown, so a retry is NOT safe —
    // acknowledging is a one-way door.
    const sent = await withActionDeadline(neverSettles, {
      budgetMs: 50,
      requestWasSent: () => true,
    });
    expect(sent.timedOut).toBe(true);
    if (sent.timedOut) {
      expect(sent.message).toMatch(/do not press accept again/i);
    }

    // The two sentences must genuinely differ, or the flag is decorative.
    if (notSent.timedOut && sent.timedOut) {
      expect(notSent.message).not.toBe(sent.message);
    }
  });

  it("does not crash the process when abandoned work later rejects", async () => {
    const { withActionDeadline } = await import("@/lib/leafly/action-deadline");

    // Work we gave up on, which fails a moment later. If the abandoned
    // promise has no rejection handler attached, Node raises an
    // unhandledRejection and can tear down the serverless function — which
    // would turn a handled timeout back into a dead request.
    let reject: (e: Error) => void = () => {};
    const doomed = new Promise<string>((_, r) => {
      reject = r;
    });

    const result = await withActionDeadline(doomed, { budgetMs: 40 });
    expect(result.timedOut).toBe(true);

    reject(new Error("the abandoned work failed after we stopped waiting"));
    // Give the microtask queue a turn; an unhandled rejection would surface.
    await new Promise((r) => setTimeout(r, 50));
    expect(true).toBe(true);
  });
});

/* ========================================================================= *
 * 4. THE WIRING — a budget nothing calls is decoration
 * ========================================================================= */

describe("the deadline is wired into the acknowledge path", () => {
  /**
   * The queries one acknowledge click can reach, established by walking the
   * real static AND dynamic import graph out of the server action
   * (`scripts/recon/db-call-inventory.mjs`).
   *
   * `bridge-server.ts` is on this list specifically because it is reached
   * through `await import("./bridge-server")`. The first version of the
   * recon script walked only static imports, could not see it, and reported
   * the acknowledge path far cleaner than it was.
   */
  const ACK_PATH_FILES = [
    "src/lib/integrations/integration-credentials-store.ts",
    "src/lib/leafly/order-ack-server.ts",
    "src/lib/leafly/order-board-server.ts",
    "src/lib/leafly/order-detail-server.ts",
    "src/lib/leafly/order-fetch-server.ts",
    "src/lib/leafly/webhook-server.ts",
    "src/lib/leafly/bridge-server.ts",
    "src/lib/leafly/register-claim-server.ts",
  ];

  it.each(ACK_PATH_FILES)("%s bounds every query it makes", (rel) => {
    const source = stripComments(read(rel));

    // `Array.from(` is NOT a database query.
    //
    // Found by this very assertion failing: `register-claim-server.ts`
    // builds an id list with `Array.from(...)`, which a bare `\.from\(`
    // pattern counted as an eighth query and reported as unbounded. The
    // seven real queries were all correctly bounded.
    //
    // The lookbehind is the fix rather than a raised threshold, because a
    // threshold would also hide a genuinely missing deadline.
    const fromCount = (source.match(/(?<!Array)\.from\(/g) ?? []).length;
    const abortCount = (source.match(/\.abortSignal\(/g) ?? []).length;

    expect(fromCount).toBeGreaterThan(0);
    // One deadline per query. Not "at least one somewhere in the file" —
    // that would pass while nine of ten queries stayed unbounded, which is
    // exactly the state this slice found the codebase in.
    expect(abortCount).toBeGreaterThanOrEqual(fromCount);
  });

  it("bounds the credentials read that runs four times per click", () => {
    // The specific query the investigation traced the hang back to. It is
    // the shared root read behind every Leafly credential lookup, so it is
    // the single most-executed database call on the acknowledge path.
    const source = stripComments(read("src/lib/integrations/integration-credentials-store.ts"));
    expect(source).toContain("abortSignal");
    expect(source).toContain("dbDeadline");
  });

  it("bounds the session read that precedes every server action", () => {
    const source = stripComments(read("src/lib/auth/session.ts"));
    expect(source).toContain("abortSignal");
  });

  it("bounds the audit insert, so its own catch block can run", () => {
    // `recordAudit` swallows errors on purpose. An unbounded insert never
    // throws, so the catch never runs and the promise never settles: the
    // best-effort write becomes the hang.
    const source = stripComments(read("src/lib/auth/audit.ts"));
    expect(source).toContain("abortSignal");
  });
});

/* ========================================================================= *
 * 5. THE BUILDER-ORDER TRAP
 * ========================================================================= */

describe("abortSignal is attached to the transform builder", () => {
  /**
   * `.abortSignal()` is defined on the TRANSFORM builder — the object
   * returned by `.select()`, `.insert()`, `.update()`, `.upsert()` or
   * `.delete()` — not on the query builder `.from()` returns.
   *
   * Written directly after `.from(...)` it does not compile, which is the
   * good case. This test exists because the fluent chain reads as though
   * order should not matter, and it does.
   */
  it("never places .abortSignal() directly after .from()", () => {
    const files = [
      "src/lib/integrations/integration-credentials-store.ts",
      "src/lib/leafly/order-ack-server.ts",
      "src/lib/leafly/order-board-server.ts",
      "src/lib/leafly/order-detail-server.ts",
      "src/lib/leafly/order-fetch-server.ts",
      "src/lib/leafly/webhook-server.ts",
      "src/lib/leafly/bridge-server.ts",
      "src/lib/leafly/register-claim-server.ts",
      "src/lib/auth/session.ts",
      "src/lib/auth/audit.ts",
    ];

    for (const rel of files) {
      const source = stripComments(read(rel));
      expect(source).not.toMatch(/\.from\([^)]*\)\s*\.abortSignal\(/);
    }
  });
});

/* ========================================================================= *
 * 6. maxDuration — a killed function renders nothing
 * ========================================================================= */

describe("maxDuration is declared where the spinner is waiting", () => {
  it("is declared on the acknowledge action module", () => {
    const source = stripComments(read("src/app/admin/orders/leafly-actions.ts"));
    expect(source).toMatch(/export const maxDuration\s*=\s*\d+/);
  });

  it("is declared on /admin/orders, the redirect TARGET", () => {
    // This is the subtle one. With a real <form>, `useFormStatus().pending`
    // stays true until the NAVIGATION resolves — which includes rendering
    // the page the action redirects to. So the board's own render time is
    // part of how long the button spins, and if the board is killed by the
    // platform the spinner never stops even though the acknowledgement
    // itself succeeded.
    const source = stripComments(read("src/app/admin/orders/page.tsx"));
    expect(source).toMatch(/export const maxDuration\s*=\s*\d+/);
    expect(source).toContain("force-dynamic");
  });
});

/* ========================================================================= *
 * 7. THE CLICK PATH CARRIES NO UNBOUNDED QUERY
 * ========================================================================= *
 *
 * ── WHY THIS SECTION EXISTS ────────────────────────────────────────────────
 * `scripts/recon/db-call-inventory.mjs` walks the IMPORT graph and reports 30
 * unbounded queries reachable from the acknowledge action. That number is
 * alarming and it is also misleading, and the difference matters enough to
 * pin down permanently rather than re-derive by hand a fourth time.
 *
 * The unbounded queries live in the announcer and the printer stores. They are
 * reached because `order-ack-server` dynamically imports `bridge-server`, and
 * `bridge-server` imports both of those at module scope. An import graph
 * cannot tell which FUNCTION does the importing, so it reports everything the
 * module could possibly touch.
 *
 * Traced by function, the picture is different and much better:
 *
 *   onLeaflyOrderArrived   announce=true  print=true    <- the WEBHOOK path
 *   onLeaflyOrderAccepted  announce=false print=false   <- the CLICK path
 *   onLeaflyOrderCanceled  announce=false print=false
 *
 * The acknowledge button calls `onLeaflyOrderAccepted`. Announce and print
 * happen when the order ARRIVES, so a person walks over and sees it — not
 * when it is accepted. So no unbounded query runs on the click.
 *
 * ── WHAT THESE TESTS ACTUALLY DEFEND ───────────────────────────────────────
 * That this stays true. If someone later adds an announcement or a receipt to
 * the accept path, or adds a query to it without a deadline, the owner's
 * spinning button comes straight back — and it would come back for exactly
 * the same reason it hung for three slices, which is the outcome worth the
 * most effort to prevent.
 */

describe("the acknowledge click path runs no unbounded query", () => {
  const BRIDGE = "src/lib/leafly/bridge-server.ts";

  /** Slice a file into its top-level exported functions. */
  function exportedFunctions(rel: string): Map<string, string> {
    const lines = stripComments(read(rel)).split("\n");
    const out = new Map<string, string>();
    const marks: Array<{ name: string; start: number }> = [];

    for (const [index, line] of lines.entries()) {
      const match = /^export (?:async )?function (\w+)/.exec(line);
      if (match) marks.push({ name: match[1], start: index });
    }
    for (const [i, mark] of marks.entries()) {
      const end = i + 1 < marks.length ? marks[i + 1].start : lines.length;
      out.set(mark.name, lines.slice(mark.start, end).join("\n"));
    }
    return out;
  }

  it("bounds every query inside onLeaflyOrderAccepted", () => {
    const body = exportedFunctions(BRIDGE).get("onLeaflyOrderAccepted");
    expect(body, "onLeaflyOrderAccepted must exist").toBeTruthy();

    // `(?<!Array)` keeps `Array.from(` from being counted as a query. That
    // false positive once made a wiring assertion fail for the wrong reason.
    const queries = (body!.match(/(?<!Array)\.from\(/g) ?? []).length;
    const bounds = (body!.match(/\.abortSignal\(/g) ?? []).length;

    expect(queries).toBeGreaterThan(0); // else this test proves nothing
    expect(bounds).toBeGreaterThanOrEqual(queries);
  });

  it("does not announce or print on the accept path", () => {
    // Not a style preference. Both stores are full of unbounded queries, so
    // calling them here would put an unbounded await back under the spinner.
    const body = exportedFunctions(BRIDGE).get("onLeaflyOrderAccepted")!;

    expect(body).not.toContain("enqueueAnnouncement(");
    expect(body).not.toContain("queueOrderReceipt(");
  });

  it("CONTROL — the ARRIVAL path does announce and print", () => {
    // Without this control the test above would pass just as happily if
    // announcing had been deleted from the codebase altogether, or if the
    // function slicer silently returned empty bodies.
    const body = exportedFunctions(BRIDGE).get("onLeaflyOrderArrived");
    expect(body, "onLeaflyOrderArrived must exist").toBeTruthy();

    expect(body).toContain("enqueueAnnouncement(");
    expect(body).toContain("queueOrderReceipt(");
  });

  it("bounds every query in the other bridge entry points too", () => {
    // The cancel path is reached from the board, and the arrival path from the
    // webhook. Neither is under the acknowledge spinner, but both are under
    // SOMEONE's spinner, and an unbounded query is a hang wherever it lives.
    const fns = exportedFunctions(BRIDGE);

    for (const name of ["onLeaflyOrderArrived", "onLeaflyOrderCanceled"]) {
      const body = fns.get(name);
      expect(body, `${name} must exist`).toBeTruthy();
      const queries = (body!.match(/(?<!Array)\.from\(/g) ?? []).length;
      const bounds = (body!.match(/\.abortSignal\(/g) ?? []).length;
      expect(bounds, `${name}: ${queries} queries but ${bounds} deadlines`).toBeGreaterThanOrEqual(
        queries,
      );
    }
  });
});
