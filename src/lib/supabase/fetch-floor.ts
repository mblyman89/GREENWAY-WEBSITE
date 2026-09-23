/**
 * src/lib/supabase/fetch-floor.ts
 *
 * ===========================================================================
 * SLICE L-27 — THE HOLE UNDERNEATH THE FLOOR
 * ===========================================================================
 * The owner has now reported the Leafly acknowledge button hanging FIVE times.
 * The newest report is the one that finally located it, because the symptom
 * CHANGED:
 *
 *   > "I tested the acknowledge button again after placing an order. it spun
 *   >  for 5 minutes then quit."
 *
 * Five minutes is not a number this codebase chose anywhere. It is exactly
 * `export const maxDuration = 300` on `src/app/admin/orders/page.tsx` — the
 * platform's own killer. So the function was not finishing and reporting a
 * timeout; it was being executed until Vercel put it down.
 *
 * That single fact falsified every explanation we had. We hold this path to
 * two deadlines:
 *
 *   LEAFLY_ACK_TOTAL_BUDGET_MS   240s   the whole server action (L-25)
 *   DB_REQUEST_FLOOR_MS           15s   every PostgREST request  (L-26)
 *   RENDER_READER_BUDGET_MS       20s   every wrapped page reader (L-26)
 *
 * If ANY of those had fired, the operator would have seen a sentence at 240s
 * at the very latest, and never a dead page at 300s. None of them fired. The
 * blocking work therefore sat somewhere all three are blind to.
 *
 * ===========================================================================
 * WHERE IT WAS
 * ===========================================================================
 * The first statement of `acknowledgeLeaflyOrderAction` is:
 *
 *     const session = await requirePermission("orders.manage");
 *
 * which reaches `getStaffSession()` in `src/lib/auth/session.ts`, whose FIRST
 * await is:
 *
 *     const { data: { user } } = await supabase.auth.getUser();
 *
 * Two things about that line, both of which had to be true at once for this
 * bug to survive four fixes:
 *
 *   1. IT IS NOT A POSTGREST REQUEST, so L-26's `db: { timeout }` floor does
 *      not cover it. Reading supabase-js 2.x
 *      (`node_modules/@supabase/supabase-js/dist/index.mjs`):
 *
 *        line 684   `timeout: settings.db.timeout`   ← handed to PostgrestClient
 *        line 813   `_initSupabaseAuthClient(...)`   ← never receives it
 *
 *      and `@supabase/auth-js/dist/module/lib/fetch.js` line 109 performs the
 *      request as `await fetcher(url, Object.assign({}, requestParams))` —
 *      there is no `signal` anywhere in that file. The auth client has never
 *      had a timeout of any kind.
 *
 *   2. IT RUNS BEFORE `withActionDeadline`. L-25's 240s outer race is armed on
 *      the line AFTER the permission check. Work that hangs inside
 *      `requirePermission` happens before the race exists, so the race cannot
 *      lose — it is never started. This is why the "backstop that does not
 *      depend on the enumeration being complete" still had a gap: the backstop
 *      itself is downstream of the gap.
 *
 * Together those two facts produce precisely the reported behaviour: a click
 * that blocks on an unbounded socket, no deadline armed, and the platform
 * killing the function at 300s with no page rendered.
 *
 * ===========================================================================
 * THE MEASUREMENT (never assume — `scripts/recon/l27-auth-hang-probe.mjs`)
 * ===========================================================================
 * Against a local black-hole server that accepts the connection and answers
 * nothing for 25 seconds:
 *
 *   P1  PostgREST, db.timeout = 15000 ........ 15005ms  AbortError   BOUNDED
 *   P2  auth.getUser(), SAME client .......... 25009ms  resolved     UNBOUNDED
 *   P3  auth.getUser(), global.fetch bounded ..  8002ms  AbortError   BOUNDED
 *
 * P1 and P2 use the SAME client with the SAME options. The only difference is
 * which sub-client serves the call. That is the whole bug, measured.
 *
 * P3 is this file.
 *
 * ===========================================================================
 * THIS IS A KNOWN, REPORTED UPSTREAM PROBLEM
 * ===========================================================================
 * The owner asked directly whether there is community support on this. There
 * is, and it describes our symptom almost word for word:
 *
 *   supabase/supabase#35754 — "Client-side supabase.auth.getUser() hangs
 *   indefinitely" (labelled `bug`). The reporter is on Next.js App Router
 *   deployed to Vercel, and their diagnosis is the same instrument we used:
 *     > "We've confirmed this hang by wrapping the getUser() call in a
 *     >  Promise.race with a 10-second timeout, which consistently logs a
 *     >  timeout error for this specific call."
 *
 *   supabase/supabase-js#2111 — "auth methods hang indefinitely due to
 *   orphaned Web Locks".
 *
 * Neither is fixed upstream. The remedy every thread converges on is the one
 * implemented here: bound the transport, because the library will not.
 *
 * ===========================================================================
 * WHY A `global.fetch` OVERRIDE AND NOT A WRAPPER AT THE CALL SITE
 * ===========================================================================
 * A `Promise.race` around `getStaffSession()` would fix the orders page and
 * leave every other caller exposed — and "the enumeration was incomplete" is
 * the exact mistake that made L-17, L-23, L-25 and L-26 each look complete and
 * each fall short. `global.fetch` is the one seam EVERY supabase sub-client
 * funnels through: auth, PostgREST, Storage, Functions. Bounding it bounds all
 * of them at once, including sub-clients that do not exist yet.
 *
 * It composes correctly with the existing floors rather than replacing them.
 * PostgREST's own `db.timeout` (15s) and the per-query `.abortSignal()` calls
 * are TIGHTER than this ceiling and still win; an inner deadline that fires
 * first is exactly the intended behaviour. This is the outermost backstop, not
 * a replacement for anything.
 *
 * ===========================================================================
 * WHY `AbortSignal.any()` IS NOT USED (AND MUST NEVER BE)
 * ===========================================================================
 * Composing our timeout with a caller's existing signal is the textbook use of
 * `AbortSignal.any()`, and it is broken in exactly the way that would recreate
 * this bug. It holds its source signals WEAKLY: once the sources are garbage
 * collected the timer never fires and the request hangs forever.
 *
 *   nodejs/node#57736 — `confirmed-bug` (PR #57867)
 *   nodejs/node#55428 — `confirmed-bug`, still open
 *
 * Measured in this repo during L-26: a 900ms deadline built with
 * `AbortSignal.any()` was still hung after 6000ms under GC pressure. A
 * compliance test bans the API repository-wide, with a CONTROL case proving
 * the ban would catch a reintroduction.
 *
 * So this file composes signals MANUALLY, with `addEventListener("abort")` —
 * which is precisely what postgrest-js itself does for `db.timeout`
 * (`@supabase/postgrest-js/dist/index.mjs`, its constructor). Both the
 * `AbortController` and the `setTimeout` handle are reachable from the
 * returned promise's closure for as long as the request is in flight, so they
 * are GC roots and the timer is guaranteed to fire.
 */

/**
 * The outermost bound on any single HTTP request supabase makes.
 *
 * ── WHY 20 SECONDS ────────────────────────────────────────────────────────
 * It has to sit ABOVE the tighter deadlines so they keep winning, and far
 * BELOW the platform ceiling so a stall still leaves room to render a
 * sentence. The existing numbers pin it from both sides:
 *
 *   SESSION_READ_TIMEOUT_MS      5s   the session's own profile query
 *   LEAFLY_DB_TIMEOUT_MS       5–8s   per-operation Leafly queries
 *   DB_REQUEST_FLOOR_MS         15s   the global PostgREST floor  ← must win
 *   → AUTH_FETCH_FLOOR_MS       20s   this file
 *   RENDER_READER_BUDGET_MS     20s   a wrapped page reader
 *   LEAFLY_ACK_TOTAL_BUDGET_MS 240s   the whole action
 *   maxDuration                300s   the platform killer
 *
 * 20s also has meaning of its own for the operation that actually hangs. A
 * token refresh that has not answered in twenty seconds is not slow, it is
 * unreachable, and waiting longer cannot change the answer — while a budtender
 * standing at the counter with a fifteen-minute Leafly auto-cancel clock
 * running needs to be told something, not watched to spin.
 */
export const AUTH_FETCH_FLOOR_MS = 20_000;

/**
 * Wrap a `fetch` implementation so no single request can outlive the floor.
 *
 * Exported separately from the options object below so the compliance tests
 * can exercise the behaviour directly with an injected fetch, rather than
 * asserting on the shape of a config literal. A test that only checks
 * `{ fetch: something }` was passed proves nothing about whether the something
 * actually aborts.
 *
 * @param baseFetch  the implementation to wrap; defaults to the platform's.
 * @param floorMs    the ceiling for one request.
 */
export function createBoundedFetch(
  baseFetch?: typeof fetch,
  floorMs: number = AUTH_FETCH_FLOOR_MS,
): typeof fetch {
  // Resolved once, at construction, NOT per call. Reading `globalThis.fetch`
  // inside the returned function would let an instrumentation library that
  // patches the global later change which implementation we call mid-flight.
  const impl = baseFetch ?? globalThis.fetch;

  return async function boundedFetch(input, init) {
    // A floor that is not a usable positive number is a programming mistake,
    // not a licence to hang — but it is also not a reason to break every
    // request in the product. Fall back to the real default rather than
    // throwing, and never fall through to an unbounded call.
    const budget =
      typeof floorMs === "number" && Number.isFinite(floorMs) && floorMs > 0
        ? floorMs
        : AUTH_FETCH_FLOOR_MS;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        new DOMException(
          `Supabase request exceeded the ${budget}ms transport floor.`,
          "TimeoutError",
        ),
      );
    }, budget);

    // ── Bridge a caller's signal, by hand. See the header on AbortSignal.any.
    const callerSignal = init?.signal ?? undefined;
    let detachCaller: (() => void) | undefined;

    if (callerSignal) {
      if (callerSignal.aborted) {
        // Already cancelled before we started. Do not arm a timer that will
        // never be cleared, and do not swallow the caller's reason: hand the
        // original init straight through so the underlying fetch rejects with
        // the caller's own abort reason, which is the more specific truth.
        clearTimeout(timer);
        return impl(input, init);
      }
      const onCallerAbort = () => {
        clearTimeout(timer);
        controller.abort(callerSignal.reason);
      };
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      detachCaller = () =>
        callerSignal.removeEventListener("abort", onCallerAbort);
    }

    try {
      return await impl(input, { ...init, signal: controller.signal });
    } finally {
      // Both in `finally`, and both unconditional.
      //
      // The `clearTimeout` is what makes this safe to use on a hot path: a
      // live 20s timer per completed request would keep the event loop busy
      // and, on a serverless platform that freezes instances between
      // invocations, would fire against a request that finished long ago.
      //
      // The listener removal matters for the same reason in the other
      // direction: a long-lived caller signal (a request-scoped one reused
      // across several queries) would otherwise accumulate one listener per
      // request and leak for the life of the signal.
      clearTimeout(timer);
      detachCaller?.();
    }
  };
}

/**
 * The `global` block to spread into every `createClient` / `createServerClient`
 * call in this repository.
 *
 * Pinned in one place for the same reason `SUPABASE_DB_OPTIONS` is: a floor
 * that each factory re-declares is a floor that drifts, and the compliance
 * test can then only check that *a* number is present rather than that *the*
 * number is.
 */
export const SUPABASE_GLOBAL_OPTIONS = {
  fetch: createBoundedFetch(),
} as const;
