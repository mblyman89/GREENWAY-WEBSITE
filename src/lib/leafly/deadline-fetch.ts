import "server-only";

/**
 * src/lib/leafly/deadline-fetch.ts
 *
 * SLICE L-17 — the one place a Leafly request is allowed to give up.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * Before this slice, `src/lib/leafly/` contained six outbound `fetch()` calls
 * and not one of them had a timeout. Measured, not assumed:
 *
 *   grep -rn "AbortController\|AbortSignal.timeout" src/lib/leafly/
 *   → no matches
 *
 * Meanwhile seventeen other client files in this repository already do it,
 * and `src/lib/atm/pai-client.ts:94` names the reason out loud: "fetch() with
 * a hard timeout via AbortController (no hanging syncs)."
 *
 * The owner felt the consequence directly:
 *
 *   > "for the leafly orders specifically, i can click the acknowledge
 *   >  button, confirm the action, then it sits waiting forever stuck."
 *
 * ===========================================================================
 * WHY A SHARED HELPER RATHER THAN SIX LOCAL COPIES
 * ===========================================================================
 * House rule 11 — do not re-implement a judgement that has a home. Six local
 * `AbortController` blocks would be six opportunities to forget the
 * `clearTimeout`, six chances to pick a different budget by accident, and six
 * places to fix when the next bug arrives. More importantly, each one would
 * have to decide independently what an abort MEANS, and that decision is a
 * rule about customer safety (see `deadline-core.ts`), not plumbing.
 *
 * So: the budgets and the meaning live in the pure core. The `setTimeout` and
 * the `signal` live here. The call sites just name their operation.
 *
 * ===========================================================================
 * SLICE L-23 — THE HALF THE DEADLINE MISSED
 * ===========================================================================
 * L-17 (above) bounded the CONNECTION and shipped. The owner tested again and
 * reported the identical symptom, in more detail:
 *
 *   > "I am still unable to acknowledge the order. It thinks for 5 minutes,
 *   >  vercels max, then refreshes the page not working."
 *
 * The reason the fix did not hold is a property of `fetch()` that is easy to
 * miss: **`fetch()` resolves when the response HEADERS arrive, not when the
 * response is complete.** The body is still streaming at that moment.
 *
 * So the original shape —
 *
 *     try   { return { ok: true, response: await fetch(...) }; }
 *     finally { clearTimeout(timer); }
 *
 * — disarmed the guard at the instant the headers landed, and every one of
 * the six call sites then read the body with no deadline at all:
 *
 *     order-ack-server.ts:292   await res.text()
 *     order-fetch-server.ts:199 await res.text()
 *     token.ts:137/140          await res.text() / res.json()
 *     push.ts:361, full-menu-server.ts:177, selection-server.ts:143
 *
 * Reproduced against a real HTTP server that flushed headers, wrote a partial
 * chunk, and then stalled — the shape of a proxy or load balancer that dies
 * mid-response:
 *
 *     [repro] budget is 1500ms
 *     [repro] helper returned ok=true after 30ms (headers received)
 *     [repro] after 8031ms the body read is: STILL-HANGING
 *
 * The budget had expired six and a half seconds earlier and nothing was left
 * to stop the read. On Vercel that runs to the platform's limit — five
 * minutes — and then the function is killed and the page reloads having done
 * nothing. That is the owner's sentence, exactly.
 *
 * THE LESSON, worth more than the fix: a timeout that covers the connection
 * but not the response is not a timeout. It is a timeout-shaped object, and
 * it passes every test that checks for the presence of an AbortController.
 *
 * ===========================================================================
 * SLICE L-24 — THE BINARY BODY
 * ===========================================================================
 * L-23 (above) moved the body read inside the budget by calling `.text()`
 * and rebuilding the Response from that STRING. That was correct for every
 * Leafly call that existed at the time, because all six of them were JSON.
 *
 * L-24 implemented the two endpoints the spec has always had and this
 * codebase never built — `GET /{key}/government_id/{id}` and
 * `GET /{key}/medical_id/{id}` — which return `image/*` BINARY. Sending
 * those through `.text()` does not degrade the image. It destroys it.
 *
 * Measured before writing the fix, against a real 52-byte JPEG served by a
 * real `node:http` server, rather than reasoned about:
 *
 *   [probe] original      len=52 hex=ffd8ffe000104a4649460001
 *   [probe] via .text()   len=68 hex=efbfbdefbfbdefbfbdefbfbd
 *   [probe] via arrayBuf  len=52 hex=ffd8ffe000104a4649460001
 *   [probe] text() path preserves bytes?      false
 *   [probe] arrayBuffer path preserves bytes? true
 *   [probe] JPEG magic survived text()?       false
 *
 * `.text()` decodes as UTF-8. Every byte that is not valid UTF-8 — which is
 * most of a JPEG — becomes U+FFFD, the replacement character, which re-encodes
 * to THREE bytes. The payload grew from 52 to 68 bytes, the `ffd8` magic
 * number became `efbfbd`, and no amount of re-encoding gets the original
 * back. The staff member would have been shown a broken image and had to
 * choose between acknowledging blind and cancelling a real customer's order.
 *
 * Hence `options.binary`. It defaults to FALSE, so the six existing JSON
 * call sites are bit-for-bit unchanged and did not need editing — the same
 * property that made L-23 a one-file change.
 *
 * WHY NOT ALWAYS USE arrayBuffer AND DECODE AT THE CALL SITE: because the
 * callers do `await res.json()` and `await res.text()` today, and a Response
 * built from an ArrayBuffer still serves both correctly — so "always binary"
 * would in fact have worked. It is not done because the flag also documents
 * INTENT at the call site: `binary: true` is the marker that says "this one
 * is an ID image, it is PII, do not log it, do not persist it". A silent
 * uniform change would have deleted that signal.
 *
 * ===========================================================================
 * THE ONE THING THIS FILE MUST NEVER DO
 * ===========================================================================
 * It must never convert a timeout into a success, and it must never claim to
 * know that a timed-out request failed to arrive. `didTimeout` is reported
 * honestly and separately from the error, so the caller can say "we stopped
 * waiting" instead of "it failed" — which, for an irreversible acknowledge,
 * is the difference between a safe screen and a destroyed set of ID images.
 */

import {
  classifyNetworkFault,
  describeDeadlineFailure,
  mayCarryBody,
  outcomeSettledByStatusAlone,
  timeoutForOperation,
  type DeadlineVerdict,
  type LeaflyOperation,
} from "./deadline-core";

/** What a deadline-bounded call can produce. */
export type DeadlineFetchResult =
  | { ok: true; response: Response }
  | {
      ok: false;
      /** Never a Response — this branch means no HTTP answer at all. */
      response: null;
      /** True only when OUR timer fired. Distinct from any network failure. */
      didTimeout: boolean;
      /** The pure core's verdict: message + the two safety flags. */
      verdict: DeadlineVerdict;
      /** The raw error text, for the attempt log. Never shown raw to staff. */
      detail: string;
    };

/**
 * `fetch()` that cannot outlive its budget.
 *
 * ── WHY `AbortController` AND NOT `AbortSignal.timeout()` ─────────────────
 * `AbortSignal.timeout()` is terser and this repo uses it in
 * `regulatory-ingest.ts:69`. It is not used here for one reason: we need to
 * know WHETHER OUR TIMER FIRED, with certainty, and not infer it from an
 * error message. With an explicit controller we set a boolean at the moment
 * we abort, so `classifyNetworkFault` is told the truth rather than sniffing
 * for the word "abort" — which would also match a genuinely aborted
 * navigation and mislabel it a Leafly timeout.
 *
 * ── WHY THE TIMER IS ALWAYS CLEARED ───────────────────────────────────────
 * `finally`, unconditionally. A stray 60-second timer on a serverless
 * function is a handle that keeps the lambda warm for no reason and, worse,
 * can abort a controller that a later code path is still holding.
 *
 * ── WHY IT NEVER THROWS ───────────────────────────────────────────────────
 * Because the six call sites do NOT agree about what a failure should do,
 * and this helper must not impose an answer on them.
 *
 * The two ORDER paths (`order-ack-server.ts`, `order-fetch-server.ts`)
 * already wrap their `fetch` in a try/catch that converts a throw into a
 * structured result, because a thrown error on the order path is how an
 * order disappears silently. The three MENU paths and the token mint do the
 * opposite: they have no try/catch at all, so a rejection propagates to the
 * caller, which is where their error reporting lives.
 *
 * Returning a result instead of throwing is what lets both survive unchanged.
 * The order paths keep converting; the menu paths re-throw one line later
 * with the verdict's sentence attached. Had this helper thrown, the order
 * paths would have been fine and the menu paths would have been fine, but
 * the decision would have been made HERE for all of them — and the first
 * call site whose contract disagreed would have had to catch its own
 * helper's throw to put it back, which is how a silent swallow gets born.
 */
/**
 * The shape of `fetch` this helper actually depends on. Declared so the test
 * seam below cannot silently widen into "anything goes".
 */
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/**
 * ── THE TEST SEAM, AND WHY IT HAD TO EXIST ────────────────────────────────
 *
 * Added in L-23 only after a mutation probe proved the 204 rescue below was
 * being DESCRIBED by the suite and not PINNED DOWN by it: mutating the rescue
 * to `if (false)` left every test green.
 *
 * The cause was measured, not guessed. Two throwaway probes against a raw
 * socket server established:
 *
 *   1. A null-body status NEVER stalls its body read. undici completes
 *      204/205/304 the instant the status line lands — under bare framing,
 *      under Content-Length, and under chunked alike. (A 200 stalls exactly
 *      as expected, so the probe itself was sound.)
 *
 *   2. If the deadline fires in the window BETWEEN the status line arriving
 *      and `.text()` being called, that read rejects with `AbortError`
 *      **even though the 204 already arrived complete**.
 *
 * Finding (1) means the rescue is unreachable by stalling a socket, so no
 * real-server test can execute it. Finding (2) means the rescue is genuinely
 * load-bearing: without it, an acknowledge that SUCCEEDED at Leafly is
 * reported to the operator as failed, inviting a second press on a one-way
 * door after the shopper's ID images are already destroyed.
 *
 * A branch that is real, dangerous and unreachable by the test harness is
 * exactly what a seam is for. This one is deliberately the narrowest
 * possible: one optional argument, defaulting to the global `fetch`, unused
 * by all six production call sites, and typed to the four members this
 * helper actually touches. It does NOT stub the stall that caused the
 * original bug — that is still proven against a real `node:http` server,
 * because a mock could never have reproduced it.
 */
export async function leaflyFetchWithDeadline(
  operation: LeaflyOperation,
  url: string,
  init: RequestInit,
  options?: { fetchImpl?: FetchLike; binary?: boolean },
): Promise<DeadlineFetchResult> {
  const fetchImpl: FetchLike = options?.fetchImpl ?? ((u, i) => fetch(u, i));
  // SLICE L-24 — see "THE BINARY BODY" in the header. Defaults to false so
  // all six pre-existing JSON call sites behave EXACTLY as before.
  const binary = options?.binary === true;
  const budgetMs = timeoutForOperation(operation);
  const controller = new AbortController();
  // Set BEFORE the abort call, read after the throw. This is the fact that
  // makes the classification honest instead of a guess.
  let weAborted = false;
  const timer = setTimeout(() => {
    weAborted = true;
    controller.abort();
  }, budgetMs);

  // SLICE L-23 — set the moment headers arrive, so the catch below can tell
  // a connect stall from a BODY stall. See the "THE HALF THE DEADLINE MISSED"
  // note in the file header for why that distinction is load-bearing.
  let receivedStatus: number | null = null;

  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    receivedStatus = response.status;

    // ═══ SLICE L-23 — THE BODY IS READ HERE, INSIDE THE BUDGET ═════════════
    //
    // `fetch()` resolves as soon as the RESPONSE HEADERS arrive. The body is
    // still streaming at that moment. Before this slice the helper returned
    // here and `finally` cleared the timer — so the guard was disarmed
    // BEFORE the body had been read, and every one of the six call sites
    // then did `await res.text()` with no deadline of any kind.
    //
    // That is not a hypothesis. It was reproduced against a real HTTP server
    // that flushed headers, wrote a partial chunk and then stalled:
    //
    //   [repro] budget is 1500ms
    //   [repro] helper returned ok=true after 30ms (headers received)
    //   [repro] after 8031ms the body read is: STILL-HANGING
    //
    // The budget had expired 6.5 seconds earlier and the read was still
    // running, with nothing left to stop it. On Vercel it runs until the
    // platform kills the function — which is precisely what the owner
    // reported: "It thinks for 5 minutes, vercels max, then refreshes the
    // page not working."
    //
    // L-17 was right about the diagnosis and fixed the half it could see.
    // This is the other half: a deadline that covers the connection but not
    // the response is not a deadline, it is a deadline-shaped object.
    //
    // Reading the body here means the timer is still armed while it streams,
    // so a stalled body aborts exactly like a stalled connection.
    // SLICE L-24 — `.text()` for JSON, `.arrayBuffer()` for images. Which one
    // is NOT a style choice: routing binary through `.text()` destroys it
    // irreversibly. Measured against a real 52-byte JPEG over a real HTTP
    // server before this branch was written (see the header note).
    //
    // Both read the WHOLE body inside the armed budget, which is the property
    // L-23 added and which must not be lost by adding a second path.
    const buffered: string | ArrayBuffer = binary
      ? await response.arrayBuffer()
      : await response.text();

    // The caller is handed a Response whose body is ALREADY BUFFERED, so the
    // six existing call sites keep calling `.text()` / `.json()` completely
    // unchanged and get an instant, local answer. This is what makes the fix
    // a one-file change instead of six risky edits to code paths that handle
    // money and irreversible actions.
    //
    // `mayCarryBody` is consulted rather than assumed: the Response
    // constructor THROWS for a null-body status given any body at all —
    // including the empty string `.text()` returns. Acknowledge's documented
    // success code is 204, so getting this wrong would throw on every
    // successful acknowledgement, after Leafly had accepted it and after the
    // ID images were already destroyed.
    return {
      ok: true,
      response: new Response(mayCarryBody(response.status) ? buffered : null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Network request failed.";
    const fault = classifyNetworkFault({ aborted: weAborted, message: detail });
    const phase = receivedStatus === null ? "connect" : "body";

    // ── THE 204 RESCUE ───────────────────────────────────────────────────
    // If the status line arrived and that status can never carry a body,
    // then the stalled read told us nothing we did not already know: the
    // status IS the whole answer. Reporting a failure here would be a lie in
    // the most expensive direction available in this codebase — Leafly's
    // acknowledge returns exactly 204, so we would be telling the operator
    // that an irreversible action failed when we are holding Leafly's own
    // confirmation that it succeeded. That invites a second press against a
    // door that is already closed.
    //
    // A 200 whose body stalls is NOT rescued: there, the body is the payload
    // and inventing an empty one would hand the caller a successful-looking
    // response with nothing in it.
    if (phase === "body" && outcomeSettledByStatusAlone(receivedStatus)) {
      return {
        ok: true,
        response: new Response(null, { status: receivedStatus as number }),
      };
    }

    const verdict = describeDeadlineFailure({ operation, fault, phase, receivedStatus });
    return {
      ok: false,
      response: null,
      didTimeout: weAborted,
      verdict,
      // The budget is appended so the attempt log records what we allowed,
      // not just what happened. Two identical "timeout" rows taken either
      // side of a budget change are otherwise indistinguishable.
      // SLICE L-23 — the PHASE is recorded too. Two "timed out after 12000ms"
      // rows, one where we never reached Leafly and one where Leafly answered
      // and went quiet, describe different incidents and need different
      // responses. Without the phase the attempt log cannot tell them apart.
      detail: weAborted
        ? `timed out after ${budgetMs}ms during ${phase}${
            receivedStatus === null ? "" : ` (Leafly answered HTTP ${receivedStatus})`
          }: ${detail}`
        : detail,
    };
  } finally {
    clearTimeout(timer);
  }
}
