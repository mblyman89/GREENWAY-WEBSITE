/**
 * REGRESSION — "its still not letting me acknowledge the order... because it
 * doesnt stop spinning, i am unable to record an error message."
 *
 * Reported by the owner for the FOURTH time, after three shipped fixes.
 *
 * ===========================================================================
 * WHY THE FIRST THREE FIXES DID NOT WORK
 * ===========================================================================
 *   L-17 — bounded the outbound fetch CONNECTION.       Hang persisted.
 *   L-23 — bounded the response BODY read.              Hang persisted.
 *   L-25 — bounded every DB call on the ACTION path.    Hang persisted.
 *
 * All three were correct. All three bounded the same half of the work.
 *
 * Next.js documents the response model that makes the other half matter, and
 * it is the whole bug (docs, verbatim):
 *
 *   "When a Server Action triggers an immediate revalidation, Next.js does
 *    the work inside one HTTP request: it runs the action, then re-renders
 *    the current route server-side."
 *   "Calls `redirect`. The response navigates the router and streams the
 *    destination's RSC Payload."
 *   "The mutation, the cache invalidation, and the page re-render all
 *    complete in a single roundtrip."
 *
 * `acknowledgeLeaflyOrderAction` calls BOTH `revalidatePath("/admin/orders")`
 * AND `redirect(...)`. So the single HTTP response the browser is waiting on
 * contains the acknowledge PLUS a full server render of /admin/orders.
 * `useFormStatus().pending` clears when that response completes — not when
 * the acknowledge completes.
 *
 * The spinner is therefore the RENDER, and the render was entirely unbounded.
 * `scripts/recon/db-call-inventory.mjs` on main@28e9b22c measured it: every
 * module the ACTION reaches was bounded by L-25, and every module the PAGE
 * RENDER reaches was not — announcer-store 12 unbounded queries,
 * announcer-admin-store 6, announcer-sounds-store 11, printer-store 13,
 * orders-store 30, order-name-pool-store 11, order-readiness-server 3.
 *
 * ===========================================================================
 * THE TRAP THAT ALMOST BECAME THE FOURTH FAILED FIX
 * ===========================================================================
 * The intended fix was a global floor built with `AbortSignal.any([...])`, to
 * compose a per-client floor with any caller's own shorter signal. A probe
 * disproved it BEFORE it shipped (`scripts/recon/l26-signal-gc.mjs`, run with
 * --expose-gc):
 *
 *   [G1 any(), no gc           ] TimeoutError after 904ms
 *   [G2 any(), FORCED GC       ] HUNG (>6000ms)   <-- DEADLINE NEVER FIRED
 *   [G3 any(), sources pinned  ] TimeoutError after 901ms
 *   [G4 bare timeout, FORCED GC] TimeoutError after 900ms
 *   [G5 bare timeout, pinned   ] TimeoutError after 900ms
 *
 * `AbortSignal.any()` holds its source signals WEAKLY. After a GC cycle the
 * sources are collected and their timers never fire, so the composite can
 * never abort. Confirmed upstream: nodejs/node#57736 ("AbortSignal.any() is
 * unreliable and breaks timeouts", label confirmed-bug, PR #57867) and
 * nodejs/node#55428 (label confirmed-bug, still open).
 *
 * A timeout that works until the garbage collector runs is the worst possible
 * shape for this bug: it would pass every test and fail in production under
 * load, which is exactly the report. Hence §3 below.
 *
 * The shipped mechanism instead is supabase-js's own `db: { timeout }`, which
 * postgrest-js implements with a plain AbortController + setTimeout (a
 * pending setTimeout is a GC ROOT), proven end-to-end against a real
 * black-hole socket by `scripts/recon/l26-db-timeout-proof.mjs`:
 *
 *   [P1 CONTROL no timeout   ] HUNG (>9000ms)
 *   [P2 timeout 1200         ] settled after 1205ms -> "AbortError: This operation was aborted"
 *   [P3 timeout + FORCED GC  ] survived GC, settled after 1202ms
 *   [P4 floor 30s + query 800] settled after 802ms   <-- tighter deadline wins
 *   [P5 error channel        ] arrives as an ERROR VALUE, not a throw
 *   [P6 healthy query        ] settled after 8ms -> data intact
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DB_REQUEST_FLOOR_MS,
  SUPABASE_DB_OPTIONS,
} from "@/lib/supabase/db-floor";
import {
  RENDER_READER_BUDGET_MS,
  withRenderBudget,
} from "@/lib/supabase/render-budget";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Blank out comments so a mention of an API in prose cannot satisfy a wiring
 * assertion. This file's own source is dense with explanatory comments that
 * quote the very identifiers being asserted on, so without this the tests
 * would pass on documentation alone — and deleting the real call, the exact
 * regression this file exists to catch, would leave the suite green.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/* ========================================================================= *
 * 1. THE FLOOR EXISTS AND IS A REAL NUMBER
 * ========================================================================= */

describe("the global database floor", () => {
  it("is finite and positive, because Infinity is the bug", () => {
    expect(Number.isFinite(DB_REQUEST_FLOOR_MS)).toBe(true);
    expect(DB_REQUEST_FLOOR_MS).toBeGreaterThan(0);
  });

  /**
   * The floor is a BACKSTOP, not the primary deadline. L-25's per-operation
   * budgets are tighter on purpose and must keep winning the race; the floor
   * only catches the ~300 queries nobody has bounded by hand. If the floor
   * ever dropped below a per-operation budget it would start cancelling
   * healthy work early and cause a different, worse bug.
   */
  it("sits above the per-operation budgets it backs up", async () => {
    const { LEAFLY_DB_TIMEOUT_MS } = await import("@/lib/leafly/db-deadline-core");
    // A Record of budgets, so the floor must clear the LARGEST of them.
    // Measured rather than hard-coded: a new, slower operation added later
    // must push this assertion, not silently slip under a stale literal.
    const slowest = Math.max(...Object.values(LEAFLY_DB_TIMEOUT_MS));
    expect(slowest).toBeGreaterThan(0);
    expect(DB_REQUEST_FLOOR_MS).toBeGreaterThan(slowest);
  });

  /**
   * Below the platform ceiling, or the function is killed before the floor
   * can report anything and the user gets the same silent spinner.
   */
  it("stays under the platform ceiling, so it can actually report", async () => {
    const { PLATFORM_MAX_DURATION_MS } = await import("@/lib/leafly/db-deadline-core");
    expect(DB_REQUEST_FLOOR_MS).toBeLessThan(PLATFORM_MAX_DURATION_MS);
  });

  it("is the value the clients are handed, not a second copy of it", () => {
    expect(SUPABASE_DB_OPTIONS.timeout).toBe(DB_REQUEST_FLOOR_MS);
  });
});

/* ========================================================================= *
 * 2. THE FLOOR IS WIRED INTO **BOTH** CLIENT FACTORIES
 * ========================================================================= */

/**
 * Two factories, and missing either one leaves a whole class of queries
 * unbounded:
 *
 *   admin.ts  — the service-role client, used by essentially every store.
 *   server.ts — the cookie-bound client, which resolves the staff session on
 *               every render AND every server action. A hang here blocks the
 *               request before any page code runs at all.
 */
describe("the floor is installed in every Supabase client factory", () => {
  const FACTORIES = [
    "src/lib/supabase/admin.ts",
    "src/lib/supabase/server.ts",
  ] as const;

  for (const rel of FACTORIES) {
    it(`${rel} passes the shared db options`, () => {
      const src = stripComments(read(rel));
      expect(src).toContain("SUPABASE_DB_OPTIONS");
      // Passed as the `db` option, not merely imported and forgotten.
      expect(src).toMatch(/db:\s*SUPABASE_DB_OPTIONS/);
    });

    /**
     * A literal here would silently drift from DB_REQUEST_FLOOR_MS the first
     * time someone tuned one of them, and the drift would be invisible.
     */
    it(`${rel} does not hard-code the number`, () => {
      const src = stripComments(read(rel));
      expect(src).not.toMatch(/timeout:\s*\d/);
    });
  }

  /**
   * CONTROL — proves the two assertions above can fail. If the regex or the
   * stripComments helper were broken, the tests above would pass against
   * anything; this shows they discriminate.
   */
  it("CONTROL — the assertions reject a factory without the option", () => {
    const sabotaged = stripComments(
      read("src/lib/supabase/admin.ts").replace(/db:\s*SUPABASE_DB_OPTIONS/g, ""),
    );
    expect(sabotaged).not.toMatch(/db:\s*SUPABASE_DB_OPTIONS/);
  });
});

/* ========================================================================= *
 * 3. NOBODY MAY REINTRODUCE AbortSignal.any
 * ========================================================================= */

describe("AbortSignal.any is banned from src/", () => {
  /**
   * This is the single most important test in the file. The measured failure
   * mode (G2) is GC-dependent, so a reintroduction would pass code review,
   * pass a unit test, pass a smoke test, and then hang in production under
   * memory pressure — indistinguishable from the bug being fixed.
   */
  it("appears nowhere in application source", () => {
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry.name)) {
          if (/AbortSignal\s*\.\s*any\s*\(/.test(stripComments(read(rel)))) {
            offenders.push(rel);
          }
        }
      }
    };
    walk("src");

    expect(
      offenders,
      "AbortSignal.any() holds its sources weakly and stops firing after a " +
        "GC cycle (nodejs/node#57736, #55428). Measured here as G2: HUNG " +
        ">6000ms with a 900ms deadline. Use a plain AbortController.",
    ).toEqual([]);
  });

  /**
   * CONTROL — the detector finds a real occurrence. Without this, a typo in
   * the regex would make the ban vacuously true forever.
   */
  it("CONTROL — the detector actually matches the pattern", () => {
    expect(/AbortSignal\s*\.\s*any\s*\(/.test("AbortSignal.any([a, b])")).toBe(true);
    expect(/AbortSignal\s*\.\s*any\s*\(/.test("AbortSignal.timeout(5)")).toBe(false);
  });

  /**
   * The ban is only safe because the replacement is documented where the
   * next maintainer will look: in the floor module itself.
   */
  it("the reason is recorded in db-floor.ts, with the upstream issues", () => {
    const doc = read("src/lib/supabase/db-floor.ts");
    expect(doc).toContain("57736");
    expect(doc).toContain("55428");
  });
});

/* ========================================================================= *
 * 4. withRenderBudget BEHAVES
 * ========================================================================= */

describe("withRenderBudget", () => {
  it("returns the real value when the reader finishes in time", async () => {
    const value = await withRenderBudget(Promise.resolve("real"), "fallback", "fast", 1_000);
    expect(value).toBe("real");
  });

  /**
   * THE POINT OF THE WHOLE FILE: a reader that never settles must not make
   * the render never settle.
   */
  it("resolves — rather than hanging — when the reader never settles", async () => {
    const started = Date.now();
    const value = await withRenderBudget(
      new Promise<string>(() => {}),
      "fallback",
      "never settles",
      120,
    );
    expect(value).toBe("fallback");
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  /**
   * Readers are documented as non-throwing. That is a claim about today's
   * code, and such claims have been wrong three times on this exact bug.
   */
  it("degrades a THROWING reader exactly like a slow one", async () => {
    const value = await withRenderBudget(
      Promise.reject(new Error("boom")),
      "fallback",
      "throwing",
      1_000,
    );
    expect(value).toBe("fallback");
  });

  /**
   * A reader may legitimately resolve to null or undefined. If the race used
   * one of those as its timeout sentinel it could not tell a real result from
   * a timeout, and would discard good data. Hence the unique Symbol.
   */
  it("does not mistake a legitimate null result for a timeout", async () => {
    const value = await withRenderBudget<string | null>(
      Promise.resolve(null),
      "fallback",
      "null result",
      1_000,
    );
    expect(value).toBeNull();
  });

  it("does not mistake a legitimate undefined result for a timeout", async () => {
    const value = await withRenderBudget<string | undefined>(
      Promise.resolve(undefined),
      "fallback",
      "undefined result",
      1_000,
    );
    expect(value).toBeUndefined();
  });

  /**
   * The abandoned promise is still in flight after we stop waiting. If it
   * later rejects with nobody listening, Node can take the whole process
   * down — turning one slow panel into an outage, which is strictly worse
   * than the bug being fixed.
   */
  it("does not crash the process when abandoned work later rejects", async () => {
    let reject!: (e: Error) => void;
    const doomed = new Promise<string>((_resolve, r) => {
      reject = r;
    });

    const value = await withRenderBudget(doomed, "fallback", "late rejector", 60);
    expect(value).toBe("fallback");

    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    reject(new Error("too late"));
    await new Promise((r) => setTimeout(r, 120));
    process.off("unhandledRejection", unhandled);

    expect(unhandled).not.toHaveBeenCalled();
  });

  /**
   * A degraded panel that logs nothing is a silent lie: the owner sees an
   * empty card and no explanation exists anywhere. The label must reach the
   * log so a slow panel can be identified.
   */
  it("names the slow reader in the server log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let logged = "";
    try {
      await withRenderBudget(new Promise<string>(() => {}), "fallback", "announcer panel", 60);
      // Read the calls BEFORE restoring: mockRestore() resets mock.calls, so
      // reading afterwards always yields "" and the assertion could never
      // fail — a test that proves nothing.
      logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    } finally {
      spy.mockRestore();
    }

    expect(logged).toContain("announcer panel");
    // and it must say WHY, not just name the reader
    expect(logged).toMatch(/60ms|budget|exceeded/i);
  });

  it("clears its timer so a fast render is not held open by the guard", async () => {
    // If the timer leaked, the process would stay alive past the budget.
    // Measured indirectly: a fast resolve must not take the budget's time.
    const started = Date.now();
    await withRenderBudget(Promise.resolve(1), 0, "fast", 5_000);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("has a finite, positive default budget under the platform ceiling", async () => {
    const { PLATFORM_MAX_DURATION_MS } = await import("@/lib/leafly/db-deadline-core");
    expect(Number.isFinite(RENDER_READER_BUDGET_MS)).toBe(true);
    expect(RENDER_READER_BUDGET_MS).toBeGreaterThan(0);
    expect(RENDER_READER_BUDGET_MS).toBeLessThan(PLATFORM_MAX_DURATION_MS);
  });
});

/* ========================================================================= *
 * 5. THE ORDERS PAGE WRAPS THE RIGHT READERS — AND NOT THE WRONG ONES
 * ========================================================================= */

describe("the /admin/orders render is bounded where it should be", () => {
  const PAGE = "src/app/admin/orders/page.tsx";

  it("wraps the secondary readers that the board can survive without", () => {
    const src = stripComments(read(PAGE));
    for (const reader of [
      "listPoolNamesStatus",
      "getPrinterSettings",
      "loadLeaflyOrderBoard",
      "countLeaflyOrdersAwaitingAck",
      "loadLeaflyOrderSetupState",
      "getAnnouncerPanelDataCached",
      "listInterruptsForOrders",
    ]) {
      const wrapped = new RegExp(
        `withRenderBudget\\(\\s*(?:\\/\\*[^]*?\\*\\/\\s*)?${reader}\\(`,
      );
      expect(wrapped.test(src), `${reader} must be wrapped in withRenderBudget`).toBe(true);
    }
  });

  /**
   * DELIBERATELY NOT WRAPPED. An orders board that renders with no orders and
   * no counts is not a degraded board, it is a lie — it would tell the shop
   * there is nothing to do while Leafly orders sit unacknowledged, which is
   * a worse failure than a slow page. If these two cannot be read, the render
   * must fail loudly instead.
   */
  it("does NOT wrap the primary readers, which must never be faked", () => {
    const src = stripComments(read(PAGE));
    expect(src).not.toMatch(/withRenderBudget\(\s*listOrdersPaged\(/);
    expect(src).not.toMatch(/withRenderBudget\(\s*getOrderStatusCounts\(/);
  });

  /**
   * The redirect TARGET is where the spinner is actually waiting, so the
   * platform ceiling has to be declared here or the function is killed
   * mid-render and the browser gets nothing.
   */
  it("still declares a maxDuration, the ceiling the budgets sit under", () => {
    expect(stripComments(read(PAGE))).toMatch(/export const maxDuration\s*=\s*\d+/);
  });
});

/* ========================================================================= *
 * 6. THE FALLBACKS ARE HONEST
 * ========================================================================= */

/**
 * A fallback is shown to the owner as if it were fact. It may therefore say
 * only what we actually know. The announcer fallback is the sharp case: the
 * module's own `summarizeShop` checks `devices.length === 0` BEFORE it checks
 * `globalEnabled`, and returns the fixed headline "No speakers are set up
 * yet." with the fix "Press 'Add a speaker' to pair your first Raspberry Pi."
 *
 * For a genuinely empty shop that is true. For a shop whose speakers we
 * merely failed to READ in time it is a fabrication that would send the owner
 * to set up hardware they already own. So the empty state hand-builds a
 * verdict that admits the real cause instead of calling summarizeShop([]).
 */
describe("the degraded panels do not invent facts", () => {
  it("the announcer fallback blames the read, not the shop's hardware", async () => {
    const { emptyAnnouncerPanelData } = await import("@/lib/announcer/announcer-admin-store");
    const data = emptyAnnouncerPanelData();

    expect(data.verdict.headline).not.toContain("No speakers are set up yet");
    expect(data.verdict.fix).not.toContain("Add a speaker");
    expect(data.verdict.headline.length).toBeGreaterThan(0);
    // Pessimistic about noise, per the isSpeakerReady policy: never claim a
    // sound we have not verified.
    expect(data.verdict.willAnnounce).toBe(false);
  });

  /**
   * `notInstalled: true` makes the panel say "run the migration" — confident,
   * specific, and wrong when the truth is that a read was slow. We did not
   * learn the tables are missing; we learned nothing.
   */
  it("the announcer fallback does not accuse anyone of a missing migration", async () => {
    const { emptyAnnouncerPanelData } = await import("@/lib/announcer/announcer-admin-store");
    expect(emptyAnnouncerPanelData().notInstalled).toBe(false);
  });

  /**
   * Settings drive the visible "Announce new orders" toggle. Inventing
   * `enabled: false` would draw that switch OFF and describe a setting the
   * owner never chose. FALLBACK_SETTINGS is what getAnnouncerSettings itself
   * returns on a failed read, for the documented reason that "failing closed
   * means one bad read silences every speaker in the building".
   */
  it("the announcer fallback reuses FALLBACK_SETTINGS rather than inventing settings", async () => {
    const [{ emptyAnnouncerPanelData }, { FALLBACK_SETTINGS }] = await Promise.all([
      import("@/lib/announcer/announcer-admin-store"),
      import("@/lib/announcer/announcer-store"),
    ]);
    expect(emptyAnnouncerPanelData().settings).toEqual(FALLBACK_SETTINGS);
  });

  it("the announcer fallback carries no rows that would look like real data", async () => {
    const { emptyAnnouncerPanelData } = await import("@/lib/announcer/announcer-admin-store");
    const data = emptyAnnouncerPanelData();
    expect(data.devices).toEqual([]);
    expect(data.recent).toEqual([]);
    expect(data.assignments).toEqual([]);
    expect(data.pendingPairings).toEqual([]);
  });

  /**
   * The Leafly setup panel's degraded state must not read as "your Leafly
   * integration is fine" — an empty problem string renders as a clean bill of
   * health.
   */
  it("the Leafly setup fallback states a problem instead of implying success", async () => {
    const { emptyLeaflyOrderSetupState } = await import("@/lib/leafly/order-readiness-server");
    const state = emptyLeaflyOrderSetupState("could not be checked in time");
    expect(JSON.stringify(state)).toContain("could not be checked in time");
  });

  /**
   * CONTROL — proves the assertion above discriminates. If the problem text
   * were dropped on the floor, the test must fail.
   */
  it("CONTROL — the Leafly setup fallback actually carries the text it is given", async () => {
    const { emptyLeaflyOrderSetupState } = await import("@/lib/leafly/order-readiness-server");
    const state = emptyLeaflyOrderSetupState("UNIQUE-SENTINEL-XYZ");
    expect(JSON.stringify(state)).toContain("UNIQUE-SENTINEL-XYZ");
    const other = emptyLeaflyOrderSetupState("different text");
    expect(JSON.stringify(other)).not.toContain("UNIQUE-SENTINEL-XYZ");
  });
});
