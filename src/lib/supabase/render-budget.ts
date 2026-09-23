import "server-only";

/**
 * src/lib/supabase/render-budget.ts
 *
 * SLICE L-26 — THE RENDER BACKSTOP. A slow panel must never hang the page.
 *
 * ===========================================================================
 * WHY THE FLOOR IS NOT ENOUGH ON ITS OWN
 * ===========================================================================
 * `db-floor.ts` bounds every individual PostgREST request at 15 seconds, and
 * that is the main fix. This file exists because of a failure mode the floor
 * cannot address, and because assuming otherwise is the mistake that has now
 * been made three times in a row.
 *
 * Two gaps remain after the floor is installed:
 *
 *   1. SEQUENTIAL TIMEOUTS ADD UP. The floor caps one request, not a
 *      render. The orders board's `Promise.all` runs eight readers
 *      concurrently, but several of those readers are internally
 *      sequential — `getAnnouncerPanelData` awaits `getAnnouncerSettings`
 *      and then issues further queries in order. If a stall is broad rather
 *      than isolated, a reader can spend 15s, then 15s again, and the
 *      board's total render time grows with the number of stalls rather
 *      than being capped by one of them.
 *
 *   2. NOT EVERYTHING IS A POSTGREST REQUEST. The floor is a PostgREST
 *      option. Storage calls, `auth.getUser()`, and any future non-PostgREST
 *      I/O are not covered by it. Those are exactly the "something outside
 *      the enumeration" that defeated L-17 and L-23.
 *
 * So the same two-layer shape that L-25 chose for the ACTION is applied to
 * the RENDER: bound the individual calls, and then bound the whole thing
 * anyway, because the enumeration has been wrong every previous time.
 *
 * ===========================================================================
 * WHY A FALLBACK VALUE AND NOT AN ERROR
 * ===========================================================================
 * This is the important design decision in this file, and it follows the
 * house pattern already established all over the orders page rather than
 * inventing a new one.
 *
 * Every reader on that page is already written to degrade rather than throw:
 * `loadLeaflyOrderBoard`, `countLeaflyOrdersAwaitingAck`,
 * `loadLeaflyOrderSetupState` and `getAnnouncerPanelDataCached` are all
 * documented as "non-throwing by construction", precisely so that a Leafly
 * or announcer problem degrades its own panel instead of 500-ing the screen
 * the shop runs its orders on. `page.tsx` says so in as many words.
 *
 * A deadline that THREW would break that contract: it would convert a slow
 * announcer into a dead orders board, which is a worse outcome than the one
 * being fixed. So `withRenderBudget` returns the caller's own empty state —
 * the same value that reader already returns when its table is missing — and
 * the panel renders its existing "couldn't check" branch.
 *
 * The operator therefore sees a working orders board with one degraded
 * panel, instead of a spinner. That is the entire point of the slice.
 *
 * ===========================================================================
 * WHY THE ORPHANED WORK IS NOT CANCELLED
 * ===========================================================================
 * Same reasoning as `lib/leafly/action-deadline.ts`, and worth restating
 * because it looks like a leak and is not.
 *
 * There is no safe general way to cancel an in-flight read: the underlying
 * request may be a write in disguise (an upsert inside a reader), and the
 * caller's promise is already running. So the losing promise is left to
 * settle into the void, with its rejection explicitly swallowed. An
 * unhandled rejection from an abandoned promise would crash the process on
 * some Node configurations, which would turn a slow panel into an outage —
 * the exact inversion of what this file is for.
 */

/**
 * How long ONE reader may take before the page gives up on it.
 *
 * ── HOW THIS NUMBER RELATES TO THE OTHERS ─────────────────────────────────
 *   DB_REQUEST_FLOOR_MS   15s   one PostgREST request
 *   RENDER_READER_BUDGET  20s   one reader (which may issue several)
 *   maxDuration          300s   the whole route, enforced by the platform
 *
 * Twenty seconds is deliberately just above the 15s request floor. A reader
 * whose single query is genuinely slow should be allowed to surface its own
 * error through its own `if (error)` branch — that produces a specific,
 * useful message like "the announcer tables aren't installed". Cutting it
 * off at less than the floor would replace every one of those precise
 * sentences with a generic timeout, which is a real loss of diagnostic
 * information.
 *
 * Above that, the reader is doing something the floor did not catch, and the
 * page stops waiting.
 */
export const RENDER_READER_BUDGET_MS = 20_000;

/**
 * Run a page-render reader with a hard ceiling, degrading to a fallback.
 *
 * Usage, at the call site that already has an empty state to hand:
 *
 *   const announcerData = await withRenderBudget(
 *     getAnnouncerPanelDataCached(),
 *     EMPTY_ANNOUNCER_PANEL_DATA,
 *     "announcer panel",
 *   );
 *
 * ── WHY IT TAKES A PROMISE AND NOT A THUNK ────────────────────────────────
 * Because the call sites are inside a `Promise.all([...])`, where the work
 * is already started by the time it is passed anywhere. Accepting a thunk
 * would invite someone to rewrite that array into sequential awaits to make
 * the types line up, quietly turning eight concurrent reads into eight
 * serial ones and making the very render this file is trying to speed up
 * several times slower.
 *
 * ── WHY IT ALSO CATCHES ───────────────────────────────────────────────────
 * The readers are documented as non-throwing, and they are. But "documented
 * as non-throwing" is a claim about today's code, and this is a backstop
 * whose entire justification is that such claims have been wrong three times
 * on this exact bug. If one of them ever does throw, the page should still
 * render with a degraded panel rather than 500.
 */
export async function withRenderBudget<T>(
  work: Promise<T>,
  fallback: T,
  /** Named in the server log so a slow panel can actually be found. */
  label: string,
  budgetMs: number = RENDER_READER_BUDGET_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  // A unique sentinel rather than `null` or `undefined`: a reader is allowed
  // to legitimately resolve to either of those, and a race that could not
  // tell "the reader returned null" from "the reader timed out" would log
  // phantom timeouts and, worse, discard real results.
  const TIMED_OUT = Symbol("render-budget-timeout");

  const guard = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), budgetMs);
  });

  try {
    const outcome = await Promise.race([
      // The catch lives INSIDE the race, not around it. Around it, a
      // rejection would beat the guard and propagate; inside, a throwing
      // reader degrades exactly like a slow one.
      work.catch((error: unknown) => {
        console.error(
          `[render-budget] "${label}" threw during page render; ` +
            `rendering its empty state instead: ${String(error)}`,
        );
        return fallback;
      }),
      guard,
    ]);

    if (outcome === TIMED_OUT) {
      console.error(
        `[render-budget] "${label}" exceeded ${budgetMs}ms during page ` +
          `render; rendering its empty state instead. The page is fine; ` +
          `this panel is degraded.`,
      );
      // Swallow the orphan. See the header: an unhandled rejection from an
      // abandoned promise can take the process down, which would turn one
      // slow panel into an outage.
      void work.catch(() => undefined);
      return fallback;
    }

    return outcome;
  } finally {
    // Always cleared. A pending timer keeps the event loop alive, and on a
    // serverless platform that is billed time and a delayed response.
    if (timer !== undefined) clearTimeout(timer);
  }
}
