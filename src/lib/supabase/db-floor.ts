/**
 * src/lib/supabase/db-floor.ts
 *
 * SLICE L-26 — THE FLOOR. One deadline, installed at the client factory,
 * that no database call in this application can be written without.
 *
 * ===========================================================================
 * WHY A FLOOR AND NOT A FOURTH LIST
 * ===========================================================================
 * The owner has now reported the Leafly acknowledge button hanging FOUR
 * times. Three fixes have shipped. Every one of them was correct, and every
 * one of them was a LIST:
 *
 *   L-17  bounded the outbound fetch connection      → still hangs
 *   L-23  bounded the outbound response body         → still hangs
 *   L-25  bounded the ~14 DB calls on the ack path   → still hangs
 *
 * Each list was assembled carefully by reading the code, and each turned out
 * to be smaller than reality. The current inventory
 * (`scripts/recon/db-call-inventory.mjs`) reports THREE HUNDRED reachable
 * database queries that still have no deadline of any kind.
 *
 * A fourth list would fail the same way, for the same reason, only later:
 * it protects the calls somebody remembered, and query number 301 is written
 * next week by somebody who has never read this file.
 *
 * A floor inverts that. The deadline is a property of the CLIENT, so it
 * applies to every query that has ever been written and every query that
 * ever will be, including ones added by a dependency. Nobody has to remember
 * anything.
 *
 * ===========================================================================
 * WHY THIS IS THE MISSING HALF OF THE ACKNOWLEDGE BUG
 * ===========================================================================
 * The three previous fixes all bounded the ACTION. But the button's spinner
 * is `useFormStatus().pending`, and Next.js documents that an action which
 * redirects does not answer the browser until the DESTINATION has rendered.
 * From the Server Actions guide, verbatim:
 *
 *   > "When a Server Action triggers an immediate revalidation, Next.js does
 *   >  the work inside one HTTP request: it runs the action, then re-renders
 *   >  the current route server-side."
 *
 *   > "Calls `redirect`. The response navigates the router and streams the
 *   >  destination's RSC Payload."
 *
 *   > "The mutation, the cache invalidation, and the page re-render all
 *   >  complete in a single roundtrip."
 *
 * `acknowledgeLeaflyOrderAction` ends with BOTH `revalidatePath("/admin/
 * orders")` and `redirect(...)`. So the single HTTP response the browser is
 * waiting on contains the acknowledgement AND a complete server render of
 * the orders board — a seven-way `Promise.all` plus follow-up reads, touching
 * the announcer, printer, loyalty, orders and name-pool stores.
 *
 * Not one query in that render was bounded. The acknowledgement could
 * succeed in 200ms and the button would still spin until the platform killed
 * the function, because the render it is waiting for never finished. That is
 * exactly what the owner describes: "it just spins and thinks and never
 * finishes."
 *
 * ===========================================================================
 * THE TRAP THIS MODULE EXISTS TO AVOID — READ BEFORE CHANGING IT
 * ===========================================================================
 * The obvious implementation is a custom `fetch` that composes the caller's
 * signal with a floor signal:
 *
 *     signal: AbortSignal.any([init.signal, AbortSignal.timeout(floorMs)])
 *
 * DO NOT DO THIS. It is broken, it is broken silently, and it is broken in
 * precisely the conditions this fix is meant to survive.
 *
 * `AbortSignal.any()` holds its source signals WEAKLY. Once a garbage
 * collection runs, the sources can be collected and their timers never fire,
 * so the composite signal becomes permanently incapable of aborting.
 *
 * Measured on this exact Node version, `scripts/recon/l26-signal-gc.mjs`:
 *
 *     [G1 any(), no gc          ] TimeoutError after 904ms
 *     [G2 any(), FORCED GC      ] HUNG (>6000ms)  <-- DEADLINE NEVER FIRED
 *     [G3 any(), sources pinned ] TimeoutError after 901ms
 *     [G4 bare timeout, FORCED GC] TimeoutError after 900ms
 *
 * This is not a local mistake. It is a confirmed upstream defect:
 *
 *   nodejs/node#57736  "AbortSignal.any() is unreliable and breaks timeouts"
 *                      label: confirmed-bug            (PR #57867)
 *   nodejs/node#55428  "Request signal isn't aborted after garbage
 *                       collection"  label: confirmed-bug, still OPEN
 *
 * It also explains something that would otherwise look like flakiness: the
 * same construction, run twice in one process, aborted at 901ms the first
 * time and hung forever the second. The only variable was whether a GC cycle
 * had run. A deadline with that property is WORSE than no deadline — it
 * passes every test and fails under load, which is the one moment it matters.
 *
 * ===========================================================================
 * WHAT IS USED INSTEAD, AND WHY IT IS SAFE
 * ===========================================================================
 * `@supabase/supabase-js` exposes a first-class `db.timeout` option. Its
 * documentation, verbatim: "When set, requests will automatically abort after
 * this duration to prevent indefinite hangs."
 *
 * Crucially, postgrest-js implements it WITHOUT `AbortSignal.any`. From the
 * vendored source, `@supabase/postgrest-js/dist/index.mjs`:
 *
 *     const controller = new AbortController();
 *     const timeoutId = setTimeout(() => controller.abort(), timeout);
 *
 * A pending `setTimeout` is a GC root, and its closure holds the controller
 * strongly, so neither can be collected while the timer is live. That is the
 * shape probe G4 measured as safe.
 *
 * It composes correctly too. When the caller supplies its own signal,
 * postgrest-js bridges it with a listener rather than a composite:
 *
 *     existingSignal.addEventListener("abort", abortHandler, { once: true });
 *
 * so a per-query `.abortSignal()` that is SHORTER than the floor still wins.
 * Measured, `scripts/recon/l26-db-timeout-proof.mjs`:
 *
 *     [P1 CONTROL no timeout   ] HUNG (>9000ms)
 *     [P2 timeout 1200         ] settled after 1205ms -> AbortError
 *     [P3 timeout + FORCED GC  ] survived GC, settled after 1202ms
 *     [P4 floor 30s + query 800] settled after 802ms   <-- tighter wins
 *     [P5 error channel        ] arrives as an ERROR VALUE, not a throw
 *     [P6 healthy query        ] settled after 8ms, untouched
 *
 * P5 is what makes this safe to install under 300 existing call sites
 * without editing them. Every reader in this codebase is written as
 * `const { data, error } = await ...; if (error) return <fallback>`. Because
 * the timeout arrives through the ordinary error channel, all 300 of those
 * branches handle it correctly and unmodified. Nothing has to learn a new
 * failure mode; the announcer panel degrades to "couldn't check" instead of
 * hanging the page the shop runs its orders on.
 *
 * ===========================================================================
 * WHY THIS DOES NOT REPLACE SLICE L-25's PER-QUERY DEADLINES
 * ===========================================================================
 * It is a floor, not a ceiling, and the two answer different questions.
 *
 * The per-query budgets in `lib/leafly/db-deadline-core.ts` encode what a
 * SPECIFIC operation should cost — an order read, a credential lookup, an
 * outbound attempt insert — and are summed into a worst case proven to fit
 * under the platform limit. Those numbers are knowledge about Leafly and are
 * worth keeping.
 *
 * This number encodes something much dumber and much more general: no
 * database call in a web request may ever take longer than this, whatever it
 * is and whoever wrote it. P4 proves the specific budget still governs where
 * one exists. The floor only decides the cases nobody thought about — which,
 * on the evidence of three failed slices, is most of them.
 */

import "server-only";

/**
 * The ceiling for any single PostgREST request, in milliseconds.
 *
 * ── WHY FIFTEEN SECONDS ───────────────────────────────────────────────────
 * It is chosen to be uncontroversially longer than any healthy query in this
 * product and uncontroversially shorter than a person's patience.
 *
 * The queries behind the orders board are indexed reads of small tables and
 * a paged read of `orders`; measured normally they return in single-digit to
 * low-double-digit milliseconds. Fifteen seconds is roughly a thousand times
 * that. Nothing legitimate is being cut off — this is a fault detector, not
 * a performance budget, and if a query here ever genuinely needs fifteen
 * seconds the right response is to fix the query, not to raise this number.
 *
 * ── WHY NOT SHORTER ───────────────────────────────────────────────────────
 * A cold serverless container, a connection-pool refill and a slow region
 * can legitimately stack up a few seconds on the first query of a request.
 * A three- or five-second floor would turn an ordinary cold start into a
 * visible error for the shop, which trades a rare hang for a frequent
 * failure. That is a bad trade on a screen somebody uses at a counter.
 *
 * ── WHY NOT LONGER ────────────────────────────────────────────────────────
 * The page declares `maxDuration = 300`, and a render that reaches the
 * platform limit is KILLED — it renders nothing at all, so the operator's
 * last visual state is the spinner, which is the exact symptom being fixed.
 * The floor has to be short enough that several queries can each fail, be
 * absorbed by their existing `if (error)` branches, and still leave time to
 * render a real page. Fifteen seconds leaves that room with a wide margin
 * even if a handful of calls time out in sequence.
 */
export const DB_REQUEST_FLOOR_MS = 15_000;

/**
 * The `db` options block every Supabase client in this app is built with.
 *
 * ── WHY A SHARED CONSTANT RATHER THAN THE NUMBER IN TWO FACTORIES ─────────
 * There are two clients — the cookie-bound server client and the
 * service-role admin client — and they must not drift. Two literals is how
 * one of them silently loses its floor during an unrelated refactor, and the
 * failure would be invisible: everything works until the day something
 * stalls, on whichever client somebody forgot.
 *
 * Exported so the compliance test can assert the shipped value rather than
 * restate it. A test that hard-codes `15_000` is a second source of truth
 * and passes happily while the real client says something else.
 */
export const SUPABASE_DB_OPTIONS = {
  timeout: DB_REQUEST_FLOOR_MS,
} as const;
