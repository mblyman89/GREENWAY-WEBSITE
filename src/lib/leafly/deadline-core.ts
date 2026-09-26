/**
 * src/lib/leafly/deadline-core.ts
 *
 * SLICE L-17 — NOTHING MAY HANG FOREVER.
 *
 * ===========================================================================
 * WHAT THE OWNER REPORTED
 * ===========================================================================
 * Verbatim:
 *
 *   > "for the leafly orders specifically, i can click the acknowledge
 *   >  button, confirm the action, then it sits waiting forever stuck."
 *
 * "Forever" was not an exaggeration and it was not a UI problem. It was
 * measured, by reading the code:
 *
 *   grep -rn "AbortController\|AbortSignal.timeout" src/lib/leafly/
 *   → ZERO matches.
 *
 * Six outbound `fetch()` calls in `src/lib/leafly/` had no timeout of any
 * kind:
 *
 *   order-ack-server.ts:221   the acknowledge POST — the reported hang
 *   order-fetch-server.ts:157 go and collect the order
 *   full-menu-server.ts:153   push the whole menu
 *   push.ts:332               push a menu delta
 *   selection-server.ts:118   read the menu back
 *   token.ts:97               mint the bearer token
 *
 * That last one matters more than its position in the list suggests: the
 * token mint runs BEFORE every single one of the other five. An untimed mint
 * hangs an operation that has not even started yet, which is the hardest
 * version of this bug to reason about from the outside, because the
 * diagnostic log line for the real call never appears.
 *
 * ===========================================================================
 * THIS IS A HOUSE CONVENTION THAT LEAFLY ALONE MISSED
 * ===========================================================================
 * This is not a new idea being introduced to the codebase. Seventeen other
 * files already do exactly this. `src/lib/atm/pai-client.ts:94` states it
 * verbatim:
 *
 *   > "fetch() with a hard timeout via AbortController (no hanging syncs)."
 *
 * `src/lib/regulatory/regulatory-ingest.ts:69` uses the terser
 * `signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)`. Purchasing, inventory,
 * crypto, AI, media and inbound-email clients all have one. The Leafly client
 * — the newest and the only one with a hard external deadline attached to it —
 * is the one that never got it.
 *
 * ===========================================================================
 * WHY A PURE CORE FOR SOMETHING AS SMALL AS A NUMBER
 * ===========================================================================
 * Because it is not a number. It is four decisions, and three of them are
 * easy to get wrong in a way that is invisible until a real customer is
 * waiting:
 *
 *   1. HOW LONG. Different operations deserve different budgets. An
 *      acknowledge sits inside Leafly's fifteen-minute auto-cancel window
 *      with a human watching; a full menu push is unattended and legitimately
 *      slow. One shared constant would either strangle the menu push or let
 *      the acknowledge run past the only deadline that can actually lose the
 *      order.
 *
 *   2. HOW MANY TIMES. `order-ack-server.ts` retries a 401 exactly once, so
 *      the WORST CASE for the operator is two full budgets plus two token
 *      mints — not one budget. A per-call timeout that looks safe in
 *      isolation can still blow the fifteen-minute window once it is
 *      multiplied by the retry and the mint. The total is what has to fit,
 *      and computing the total is a rule, so it belongs here.
 *
 *   3. WHAT IT MEANS. "We aborted at ten seconds" and "the connection was
 *      refused" are both `networkError` to `fetch`, but they are completely
 *      different events for the person holding the tablet. One means "Leafly
 *      is slow or unreachable, and your order is still waiting for you to
 *      acknowledge it"; the other means "we never got out of the building".
 *      Both must be distinguishable, and neither may ever be reported as
 *      "the order was acknowledged".
 *
 *   4. WHETHER IT IS SAFE TO PRESS AGAIN. This is the one that could actually
 *      hurt someone. A timeout on a menu push is harmless to retry. A timeout
 *      on an ACKNOWLEDGE is not knowable: the POST may have arrived and been
 *      processed by Leafly while we gave up waiting for the response. The
 *      spec says acknowledgement revokes our access to the customer's ID
 *      images, so a second acknowledge is not a clean no-op we can assume
 *      away. The honest answer is "we do not know whether Leafly got it", and
 *      the core says exactly that instead of a cheerful "try again".
 *
 * Every one of those is a judgement, every one is testable without a network,
 * and none of them belongs in a `catch` block.
 *
 * ===========================================================================
 * IMPORT-FREE BY CONSTRUCTION
 * ===========================================================================
 * Zero runtime imports, so it runs in the pure self-test harness with no
 * database, no environment and no Leafly account. `__runLeaflyDeadlineTests()`
 * is registered in `scripts/compliance/run-pure-selftests.ts` with an
 * assertion floor, so deleting assertions fails CI as loudly as breaking one.
 */

/* ------------------------------------------------------------------------- *
 * 1. The budgets
 * ------------------------------------------------------------------------- */

/**
 * The operations that talk to Leafly, named so a budget can be attached to
 * each one rather than to a shared guess.
 *
 * ── THE MAP, READ OUT OF THE CODE RATHER THAN REMEMBERED ──────────────────
 * There are SIX physical `fetch()` calls in `src/lib/leafly/`, but they do
 * not correspond one-to-one with operations, and the first pass at this file
 * got the mapping wrong twice. Both errors are recorded here because the
 * wrong map produces the right-looking code with the wrong budget:
 *
 *   order-ack-server.ts:221   → acknowledge | status_push  (one fetch, two
 *                               operations, chosen by the caller)
 *   order-fetch-server.ts:157 → order_fetch
 *   token.ts:97               → token_mint
 *   push.ts:332               → menu_push | integration_status |
 *                               menu_readback  (ONE `authedFetch` serving
 *                               THREE endpoints: /menu/items, /status, /menu)
 *   full-menu-server.ts:153   → full_menu_push
 *   selection-server.ts:118   → menu_push   (NOT the readback: it PUTs to
 *                               menuItemsUrl(). Corrected after reading
 *                               selection-server.ts:382.)
 *
 * `integration_status` (push.ts:711) was missed entirely by the first audit.
 * It matters because it is the one call site that passes NO `maxRetries`, so
 * it takes `authedFetch`'s hard-coded `?? 2` default and attempts THREE
 * times — a number that exists nowhere in the settings screen and would have
 * been silently wrong had it been folded into either of the other groups.
 *
 * Naming the mint separately is deliberate: it is not an operation the owner
 * ever asks for, it is a cost that every other operation silently pays, and
 * it was the least visible hang in the set.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * SLICE L-24 — `media_fetch`, the ninth operation
 * ─────────────────────────────────────────────────────────────────────────
 * `GET /{key}/government_id/{id}` and `GET /{key}/medical_id/{id}`, the two
 * endpoints in the vendored spec that this codebase never implemented. They
 * return `image/*` binary, not JSON, which makes them the first Leafly call
 * whose body is not text.
 *
 * It is NOT folded into `order_fetch` even though both read one order, and
 * the reason is the clock rather than tidiness. The spec is explicit:
 *
 *   "This endpoint is only usable prior to order acknowledgement and only
 *    when the order is in pending status."
 *
 * So every media read happens inside the fifteen-minute auto-cancel window,
 * with a person waiting to look at an ID before they press a one-way door.
 * That is the ATTENDED, clock-bound profile — the acknowledge profile — not
 * the order_fetch profile, which also runs on a webhook with nobody
 * watching. Giving media `order_fetch`'s 15s would have been "close enough"
 * and would have quietly widened an attended budget by three seconds for no
 * stated reason. Twelve seconds, two attempts, same as the button it
 * precedes.
 */
export const LEAFLY_OPERATIONS = [
  "acknowledge",
  "status_push",
  "order_fetch",
  "menu_push",
  "full_menu_push",
  "menu_readback",
  "integration_status",
  "token_mint",
  "media_fetch",
  // SLICE L-48 — POST /{key}/orders/{id}/cart ("Update Order's Cart").
  "cart_update",
] as const;

export type LeaflyOperation = (typeof LEAFLY_OPERATIONS)[number];

/**
 * Leafly auto-cancels an order that is not acknowledged within fifteen
 * minutes. Stated in the vendored spec and already encoded elsewhere in this
 * codebase; repeated here as a NUMBER because this file's job is to prove our
 * budgets fit inside it.
 *
 * It is expressed in milliseconds so every comparison in this file is in one
 * unit. Mixing minutes and milliseconds is how a budget that "obviously fits"
 * turns out to be sixty times too long.
 */
export const LEAFLY_AUTO_CANCEL_MS = 15 * 60 * 1000;

/**
 * Per-attempt budgets, in milliseconds.
 *
 * ── WHY ACKNOWLEDGE AND STATUS ARE THE TIGHTEST ────────────────────────────
 * Both are pressed by a person who is standing still, watching a spinner,
 * inside the fifteen-minute window. Twelve seconds is long enough to absorb a
 * slow TLS handshake and a cold Leafly lambda, and short enough that the
 * operator gets an answer while they are still looking at the screen. Beyond
 * about fifteen seconds people stop believing the button worked and start
 * pressing it again, which on an irreversible action is the outcome we least
 * want.
 *
 * ── WHY THE MINT IS TIGHTER STILL ─────────────────────────────────────────
 * The mint is pure overhead on every other operation. Eight seconds is
 * generous for an OAuth client-credentials exchange, and keeping it below the
 * operation budget means a hung mint is attributed to the mint rather than
 * eating the whole operation's allowance and looking like Leafly ignoring our
 * acknowledge.
 *
 * ── WHY THE MENU PUSHES ARE ALLOWED TO BE SLOW ────────────────────────────
 * Nobody is watching a menu push and nothing is auto-cancelled if it is slow.
 * Its failure mode is a stale menu, not a lost order. Strangling it to match
 * the acknowledge would convert a working-but-slow sync into a broken one,
 * which is a regression dressed as a fix. Sixty seconds for the full menu
 * reflects that it legitimately sends the whole catalogue.
 *
 * ── WHY THE INTEGRATION-STATUS CHECK IS AS TIGHT AS THE ACKNOWLEDGE ───────
 * It is a button a person presses and then watches, and `actions.ts:726`
 * records that this exact button has already generated an owner complaint
 * once ("FINDING J-4: this is the exact button the owner reported"). An
 * attended button gets an attended budget. It is not clock-bound by Leafly,
 * so it is not held to the auto-cancel rule, but there is no reason to make
 * a human wait longer for a health check than for a real acknowledgement.
 *
 * ── WHY THERE IS NO "0 MEANS UNLIMITED" ESCAPE HATCH ──────────────────────
 * Because that is the bug this file exists to remove, and an escape hatch is
 * how it comes back. Every operation has a finite budget and the invariant
 * tests below assert it.
 *
 * ── WHY THE MEDIA FETCH MATCHES THE ACKNOWLEDGE ────────────────────────────
 * A staff member is holding the tablet, looking at the order, deciding
 * whether the face on the ID matches the name on the cart, and the
 * fifteen-minute auto-cancel clock is running the whole time. That is the
 * acknowledge's profile exactly, so it gets the acknowledge's number. There
 * is also a second-order reason to keep it tight: if the images are slow,
 * the operator's temptation is to give up and press acknowledge WITHOUT
 * looking — which destroys the images permanently. A budget that fails fast
 * returns them to a screen that can still offer a retry inside the window.
 *
 * Two attempts, not six, for the same reason acknowledge gets two: the
 * window is shared with the human, and backoff spends the thing we are
 * short of.
 *
 * ── WHY THE CART UPDATE GETS FIFTEEN SECONDS (SLICE L-48) ────────────────────
 * A person is waiting (dashboard or register), so it is attended. But unlike
 * the acknowledge, Leafly does real work before answering: the spec says it
 * re-validates every referenced variant against the menu, checks stock,
 * recalculates discounts and totals, and answers 200 with the whole revised
 * Order. That is the order-fetch's profile (a full Order body back), so it
 * gets the order-fetch's number rather than the acknowledge's. It is NOT
 * clock-bound by the auto-cancel window: the spec only allows a cart update
 * AFTER acknowledgement, and acknowledgement is what stops that clock.
 *
 * It is not irreversible either. The body is the COMPLETE desired cart, so
 * sending the same body twice lands on the same cart; there is no "second
 * press" hazard of the acknowledge kind. It is still re-read after an
 * unknowable outcome (order-ack-server.ts), because "we cannot tell" is
 * cheaper to resolve by asking than by guessing.
 */
export const LEAFLY_TIMEOUT_MS: Readonly<Record<LeaflyOperation, number>> = {
  acknowledge: 12_000,
  status_push: 12_000,
  order_fetch: 15_000,
  menu_push: 30_000,
  full_menu_push: 60_000,
  menu_readback: 30_000,
  integration_status: 12_000,
  token_mint: 8_000,
  media_fetch: 12_000,
  cart_update: 15_000,
};

/**
 * How many times each operation may attempt the network.
 *
 * These MIRROR what the server files already do — they do not impose anything
 * new. They were read out of the code, not assumed, and the two groups differ:
 *
 *   acknowledge / status_push / order_fetch → 2
 *     `order-ack-server.ts` and `order-fetch-server.ts` retry a 401 exactly
 *     once and nothing else. Their own comments explain why: these paths are
 *     attended and sit inside the fifteen-minute window, so burning seconds
 *     on backoff is the wrong trade.
 *
 *   menu_push / full_menu_push / menu_readback → 6
 *     These take an owner-tunable `maxRetries` from sync settings
 *     (`push.ts:327`, `full-menu-server.ts:148`, `selection-server.ts:113`,
 *     all `Math.max(1, (opts?.maxRetries ?? 2) + 1)`), and that setting is
 *     clamped 0–5 by `MAX_RETRIES_MIN/MAX` in
 *     `syndication/sync-settings-core.ts:144-145`. Five extra attempts plus
 *     the first is six. The DEFAULT is 3, but a budget must be computed from
 *     what the owner is ALLOWED to set, not from the default he happens to
 *     have today — otherwise raising the setting silently invalidates the
 *     arithmetic.
 *
 *   integration_status → 3
 *     The odd one out, and the reason this table is not two groups. Every
 *     other menu call threads `settings.maxRetries` into `authedFetch`;
 *     `push.ts:711` alone calls `authedFetch(statusUrl(), "GET")` with no
 *     fourth argument, so it falls through to the wrapper's own hard-coded
 *     `?? 2` default — `Math.max(1, 2 + 1)` = three attempts. Three is not
 *     reachable from the settings screen and is not a number anybody chose
 *     on purpose; it is what the code does. It is written down here rather
 *     than rounded to a neighbouring group, because a budget that is
 *     "about right" is how a worst case is understated.
 *
 *   token_mint → 1
 *     The mint is what a retry re-runs; it does not retry itself.
 *
 * They are stated here so `worstCaseMs()` can compute the real exposure. A
 * budget is only honest once it is multiplied by the retries the code actually
 * performs.
 */
export const LEAFLY_MAX_ATTEMPTS: Readonly<Record<LeaflyOperation, number>> = {
  acknowledge: 2,
  status_push: 2,
  order_fetch: 2,
  menu_push: 6,
  full_menu_push: 6,
  menu_readback: 6,
  integration_status: 3,
  token_mint: 1,
  media_fetch: 2,
  // SLICE L-48 — same transport as acknowledge/status_push (orderApiPost),
  // which retries a 401 exactly once and nothing else.
  cart_update: 2,
};

/** The budget for one attempt. Unknown operations get the tightest budget. */
export function timeoutForOperation(operation: string): number {
  const key = typeof operation === "string" ? operation.trim() : "";
  if (isLeaflyOperation(key)) return LEAFLY_TIMEOUT_MS[key];
  // An unrecognised operation is a programming mistake, not a licence to
  // hang. It gets the tightest budget in the table so the failure is fast and
  // loud rather than slow and silent.
  return LEAFLY_TIMEOUT_MS.token_mint;
}

export function isLeaflyOperation(value: unknown): value is LeaflyOperation {
  return (
    typeof value === "string" && (LEAFLY_OPERATIONS as readonly string[]).includes(value)
  );
}

/**
 * The true worst case an operator can wait, in milliseconds.
 *
 * Every attempt mints a token before it calls, because a 401 retry resets the
 * token cache — so the mint cost is paid per attempt, not once. Anyone
 * eyeballing `LEAFLY_TIMEOUT_MS.acknowledge` alone would conclude the worst
 * case is twelve seconds. It is forty.
 *
 * The mint itself is excluded from its own sum: it does not mint a token
 * before minting a token.
 */
export function worstCaseMs(operation: LeaflyOperation): number {
  const attempts = LEAFLY_MAX_ATTEMPTS[operation];
  const per = LEAFLY_TIMEOUT_MS[operation];
  if (operation === "token_mint") return attempts * per;
  return attempts * (per + LEAFLY_TIMEOUT_MS.token_mint);
}

/**
 * Does this operation's worst case leave the fifteen-minute window usable?
 *
 * The question is not "is it under fifteen minutes" — a budget that used
 * fourteen of the fifteen minutes would be catastrophic and still pass that
 * test. The requirement is that a failure leaves enough of the window to
 * actually recover in: notice the error, read it, and press the button again.
 * A quarter of the window is the line, which is generous to us and still
 * leaves eleven minutes.
 *
 * Only the two clock-bound operations are held to this. A menu push has no
 * relationship to the auto-cancel window, and asserting one would be
 * inventing a rule.
 */
export function fitsInsideAutoCancelWindow(operation: LeaflyOperation): boolean {
  if (operation !== "acknowledge" && operation !== "status_push") return true;
  return worstCaseMs(operation) * 4 <= LEAFLY_AUTO_CANCEL_MS;
}

/* ------------------------------------------------------------------------- *
 * 2. What actually happened
 * ------------------------------------------------------------------------- */

/**
 * Why a Leafly call produced no HTTP status.
 *
 * `fetch` collapses all of these into one thrown error, and the old code
 * collapsed them further into a single "Network request failed." string. They
 * are separated here because they point at different places:
 *
 *   timeout    → we gave up. The request may still have landed.
 *   offline    → we never got out. Nothing landed.
 *   dns        → the hostname did not resolve. Nothing landed. Usually ours
 *                (wrong environment) rather than Leafly's.
 *   tls        → certificate or handshake failure. Nothing useful landed.
 *   unknown    → a thrown fetch we could not classify. Never guessed into one
 *                of the above.
 */
export const LEAFLY_NETWORK_FAULTS = [
  "timeout",
  "offline",
  "dns",
  "tls",
  "unknown",
] as const;

export type LeaflyNetworkFault = (typeof LEAFLY_NETWORK_FAULTS)[number];

/**
 * Classify a thrown fetch error into one of the five faults above.
 *
 * `aborted` is passed SEPARATELY rather than sniffed from the message,
 * because that is the one fact the caller knows for certain: it owns the
 * AbortController and it knows whether it fired the timer. Guessing "timeout"
 * from the word "abort" in a message would also catch a user-cancelled
 * navigation, which is not a timeout at all.
 *
 * Message sniffing is used ONLY to separate the three never-left-the-building
 * faults from each other, and it falls through to `unknown` rather than
 * picking the most likely candidate. An unknown network fault reported as
 * "DNS" sends someone to check a hostname that was always fine.
 */
export function classifyNetworkFault(input: {
  aborted: boolean;
  message: string | null | undefined;
}): LeaflyNetworkFault {
  if (input.aborted === true) return "timeout";
  const raw = typeof input.message === "string" ? input.message.toLowerCase() : "";
  if (raw === "") return "unknown";
  // Order matters: check the most specific tokens first. "getaddrinfo enotfound"
  // contains neither "offline" nor "certificate", so there is no overlap to
  // worry about between these three, but the ordering is pinned by tests so a
  // future edit cannot reorder them into ambiguity.
  if (raw.includes("enotfound") || raw.includes("getaddrinfo") || raw.includes("dns")) {
    return "dns";
  }
  if (
    raw.includes("certificate") ||
    raw.includes("tls") ||
    raw.includes("ssl") ||
    raw.includes("self-signed") ||
    raw.includes("self signed")
  ) {
    return "tls";
  }
  if (
    raw.includes("econnrefused") ||
    raw.includes("enetunreach") ||
    raw.includes("ehostunreach") ||
    raw.includes("econnreset") ||
    raw.includes("socket hang up") ||
    raw.includes("offline")
  ) {
    return "offline";
  }
  return "unknown";
}

/* ------------------------------------------------------------------------- *
 * 2b. SLICE L-23 — the half of the request the deadline never covered
 * ------------------------------------------------------------------------- */

/**
 * HTTP statuses that are forbidden from carrying a response body.
 *
 * ═══ WHY THIS LIST IS IN A PURE CORE AND NOT INLINE AT THE CALL SITE ═══════
 * L-23 buffers the response body INSIDE the deadline (see `deadline-fetch.ts`
 * for why), which means it must then hand the caller a reconstructed
 * `Response`. The `Response` constructor THROWS a TypeError if a null-body
 * status is given any body at all — including the empty string that
 * `await res.text()` returns for a bodiless response.
 *
 * That is not a theoretical edge. Measured, from the vendored spec
 * `docs/leafly-specs/order-api-v1.openapi.json`:
 *
 *   POST /{order_integration_key}/orders/{id}/acknowledge  →  204
 *
 * **204 is the success code of the single most important call in the
 * integration, and it is the one that is irreversible.** Getting this list
 * wrong would not produce a rare edge-case bug — it would throw a TypeError
 * on EVERY successful acknowledgement, after Leafly had already accepted it
 * and after the shopper's ID images were already destroyed. The order would
 * then fail to reach the register, and the screen would report a failure for
 * an action that had in fact succeeded and could never be repeated.
 *
 * So the list is here, with the reasoning attached, and it is asserted in CI
 * rather than remembered.
 *
 * The three members are not a preference. They are fixed by the Fetch
 * standard's "null body status" definition (101, 103, 204, 205 and 304); the
 * two informational codes never surface as a resolved `Response` from
 * `fetch`, so the three that can are the three listed.
 */
export const NULL_BODY_STATUSES = [204, 205, 304] as const;

/**
 * May a response with this status legally carry a body?
 *
 * Used to decide whether the buffered text is passed to the reconstructed
 * `Response` or replaced with `null`. Non-numeric and out-of-range input is
 * treated as "may carry a body", because the only consequence of being wrong
 * in that direction is an unnecessary empty string, whereas being wrong in
 * the other direction throws.
 */
export function mayCarryBody(status: number | null | undefined): boolean {
  if (typeof status !== "number" || !Number.isFinite(status)) return true;
  return !(NULL_BODY_STATUSES as readonly number[]).includes(status);
}

/**
 * The two distinct ways a bounded request can run out of time.
 *
 * ═══ WHY THIS DISTINCTION EARNS ITS OWN TYPE ══════════════════════════════
 * `connect` — we never got an answer at all. No headers, no status. This is
 *   the fault L-17 fixed, and for an acknowledge it means "we cannot tell
 *   whether Leafly got it", because the request may have been processed
 *   after we stopped listening.
 *
 * `body` — Leafly ANSWERED. We have the status line and the headers; the
 *   response body then stalled mid-stream. This is a materially different
 *   event, and conflating the two would throw away the most valuable fact we
 *   possess at the worst possible moment.
 *
 * Why it matters so much for exactly one operation: the acknowledge endpoint
 * returns **204 No Content**. A 204 has no body to wait for. So if we have
 * received the status line and it says 204, the acknowledgement has
 * *succeeded* — there is nothing further to read, and giving up at that point
 * and reporting failure would be a lie in the most expensive direction: the
 * ID images are already gone, the door is already closed, and telling the
 * operator it failed invites a second press against a door that cannot open
 * twice.
 *
 * Keeping the two faults separate is what lets the code say "Leafly answered
 * 204, we are done" instead of "we stopped waiting, we cannot tell".
 */
export const DEADLINE_PHASES = ["connect", "body"] as const;
export type DeadlinePhase = (typeof DEADLINE_PHASES)[number];

/**
 * Given a status that HAS arrived, is the outcome already fully determined
 * even though the body never finished arriving?
 *
 * True only when the status itself is a null-body status: there was never
 * going to be a body, so a stalled read tells us nothing we do not already
 * know, and the status is the entire answer.
 *
 * This is deliberately narrow. A 200 whose body stalls is NOT determined —
 * the body is the payload, and inventing an empty one would hand the caller
 * a successful-looking response with nothing in it.
 */
export function outcomeSettledByStatusAlone(status: number | null | undefined): boolean {
  if (typeof status !== "number" || !Number.isFinite(status)) return false;
  return !mayCarryBody(status);
}

/* ------------------------------------------------------------------------- *
 * 3. What to tell the operator
 * ------------------------------------------------------------------------- */

export type DeadlineVerdict = {
  fault: LeaflyNetworkFault;
  /** The operation that failed, echoed so the sentence can name it. */
  operation: LeaflyOperation;
  /** One sentence, plain English, for the person at the counter. */
  message: string;
  /**
   * Is it safe to assume Leafly did NOT receive the request?
   *
   * True only when we never got out of the building. A timeout means we
   * stopped listening, not that nothing arrived — so this is false for a
   * timeout, and that is the whole point of the field.
   */
  certainlyNotDelivered: boolean;
  /**
   * May the operator press the button again without risking a double effect?
   *
   * False for an acknowledge that timed out: the POST may have landed, and
   * acknowledgement is irreversible and revokes the ID images. Anything we
   * know never left the building is safe to repeat regardless of operation.
   */
  safeToRetry: boolean;
  /** True when the clock we set is what ended it, rather than the network. */
  wasOurClock: boolean;
};

/**
 * Whether an operation is irreversible, for retry-safety purposes only.
 *
 * Acknowledge is the one-way door (the spec: acknowledgement revokes access
 * to the order's media). A status push to a TERMINAL status is also
 * unrepeatable, but which statuses are terminal is already owned by
 * `order-ack-core.ts` and is not re-decided here — house rule 11. This
 * function answers only the question this file is entitled to answer.
 */
export function isIrreversibleOperation(operation: LeaflyOperation): boolean {
  return operation === "acknowledge";
}

/**
 * Turn a fault into the sentence the operator reads, plus the two safety
 * flags that decide what the screen is allowed to offer next.
 *
 * Every message names the operation, says what we know, and — critically —
 * says what we do NOT know. The previous behaviour was a spinner, which
 * asserted nothing and taught the operator to wait indefinitely.
 */
export function describeDeadlineFailure(input: {
  operation: LeaflyOperation;
  fault: LeaflyNetworkFault;
  /**
   * SLICE L-23 — WHERE the time ran out. Optional, defaulting to `connect`,
   * so the existing call shape and every existing sentence are unchanged.
   *
   * `body` is only ever passed when a status line was genuinely received and
   * the body then stalled. It changes the sentence because it changes what
   * is true: "Leafly never answered" and "Leafly answered and then went
   * quiet mid-sentence" are different facts, and the second one is far more
   * useful to the person holding the tablet.
   */
  phase?: DeadlinePhase;
  /**
   * The status we DID receive, when `phase` is `body`. Named in the message
   * because a status we actually hold is the strongest evidence available,
   * and withholding it would be throwing away the best fact we have.
   */
  receivedStatus?: number | null;
}): DeadlineVerdict {
  const { operation, fault } = input;
  const phase: DeadlinePhase = input.phase ?? "connect";
  const seconds = Math.round(timeoutForOperation(operation) / 1000);
  const irreversible = isIrreversibleOperation(operation);
  const certainlyNotDelivered = fault !== "timeout" && fault !== "unknown";
  const wasOurClock = fault === "timeout";

  let message: string;
  if (fault === "timeout" && phase === "body") {
    // Leafly ANSWERED. We are not guessing about delivery any more, and the
    // sentence must not pretend otherwise — saying "we cannot tell whether
    // Leafly received it" when we are holding their status line would send
    // the operator to check something we already know.
    const statusPart =
      typeof input.receivedStatus === "number" && Number.isFinite(input.receivedStatus)
        ? `Leafly answered (HTTP ${input.receivedStatus})`
        : `Leafly began answering`;
    message = irreversible
      ? `${statusPart} but the reply did not finish arriving within ${seconds} seconds. ` +
        `Leafly DID receive this acknowledgement — the request reached them. ` +
        `Do NOT acknowledge it again. Refresh this page to confirm the order's status.`
      : `${statusPart} but the reply did not finish arriving within ${seconds} ` +
        `seconds. The request did reach Leafly. Refresh this page to see the ` +
        `current status before trying again.`;
  } else if (fault === "timeout") {
    message = irreversible
      ? `Leafly did not answer within ${seconds} seconds, so we stopped waiting. ` +
        `We cannot tell whether Leafly received the acknowledgement or not. ` +
        `Check the order's status on this page before pressing it again — ` +
        `acknowledging twice cannot be undone. The 15-minute Leafly deadline ` +
        `is still running.`
      : `Leafly did not answer within ${seconds} seconds, so we stopped ` +
        `waiting. Nothing was confirmed either way. You can try again.`;
  } else if (fault === "offline") {
    message =
      `We could not reach Leafly at all, so nothing was sent. ` +
      `This is a connection problem on our side of the call, not a refusal ` +
      `from Leafly. Try again in a moment.`;
  } else if (fault === "dns") {
    message =
      `We could not look up Leafly's address, so nothing was sent. ` +
      `That usually means the Leafly environment setting is wrong rather ` +
      `than Leafly being down. Check the Leafly integration settings.`;
  } else if (fault === "tls") {
    message =
      `The secure connection to Leafly could not be established, so nothing ` +
      `was sent. Nothing reached Leafly. If this repeats, it is worth ` +
      `telling your Leafly contact.`;
  } else {
    message =
      `The request to Leafly failed before we got an answer, and we could ` +
      `not tell why. We cannot confirm whether it arrived. ` +
      (irreversible
        ? `Check this order's status on this page before pressing it again.`
        : `You can try again.`);
  }

  return {
    fault,
    operation,
    message,
    certainlyNotDelivered,
    // Safe when we know it never arrived, OR when repeating it is harmless.
    //
    // SLICE L-23: a BODY-phase timeout is never safe to retry on an
    // irreversible operation, and for the strongest possible reason — we
    // have Leafly's status line, so we know the request ARRIVED. The
    // general clause below already yields false for that case
    // (certainlyNotDelivered is false for a timeout, and acknowledge is
    // irreversible), so no special case is added here. It is called out in
    // this comment because the temptation, on seeing "we got a status", is
    // to conclude the call is safe to repeat — it is the exact opposite.
    safeToRetry: certainlyNotDelivered || !irreversible,
    wasOurClock,
  };
}

/* ------------------------------------------------------------------------- *
 * 4. Self-tests
 * ------------------------------------------------------------------------- */

export function __runLeaflyDeadlineTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const ok = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else {
      failed += 1;
      console.error(`  ✗ ${name}`);
    }
  };
  const eq = (name: string, actual: unknown, expected: unknown) =>
    ok(`${name} (got ${JSON.stringify(actual)})`, Object.is(actual, expected));

  // ---- 1. Every operation has a finite, positive budget -------------------
  // This is THE invariant of the slice. If any of these ever fails, the
  // "hangs forever" defect has come back.
  for (const op of LEAFLY_OPERATIONS) {
    const t = LEAFLY_TIMEOUT_MS[op];
    ok(`${op} has a budget`, typeof t === "number");
    ok(`${op} budget is finite`, Number.isFinite(t));
    ok(`${op} budget is positive`, t > 0);
    ok(`${op} budget is an integer of ms`, Number.isInteger(t));
    // A budget over two minutes is indistinguishable from no budget for a
    // person waiting, and over ten is indistinguishable from the old bug.
    ok(`${op} budget is under 10 minutes`, t < 10 * 60 * 1000);
  }
  // SLICE L-24 — nine, not eight. `media_fetch` joined the set when the two
  // ID-image endpoints were finally implemented. This count is deliberately
  // hard-coded rather than derived: it is the assertion that fails when
  // somebody adds an operation and forgets to give it a budget, an attempt
  // count, and a reason. The loops above cover the new one automatically;
  // this line is what makes the ADDITION itself a conscious act.
  // SLICE L-48 — ten. `cart_update` joined for "Update Order's Cart".
  eq("there are ten operations", LEAFLY_OPERATIONS.length, 10);
  ok("cart_update is a known operation", isLeaflyOperation("cart_update"));
  eq("cart_update gets the order-fetch budget", LEAFLY_TIMEOUT_MS.cart_update, 15_000);
  eq(
    "cart_update matches the order fetch (both return a whole Order)",
    LEAFLY_TIMEOUT_MS.cart_update,
    LEAFLY_TIMEOUT_MS.order_fetch,
  );
  eq("cart_update attempts exactly twice (one 401 retry)", LEAFLY_MAX_ATTEMPTS.cart_update, 2);
  ok(
    "cart_update is NOT irreversible (the body is the whole desired cart)",
    !isIrreversibleOperation("cart_update"),
  );
  ok(
    "a cart_update timeout states its own 15s budget",
    describeDeadlineFailure({ operation: "cart_update", fault: "timeout" }).message.includes(
      "15 seconds",
    ),
  );
  ok(
    "cart_update worst case is under a minute (2 x (15s + 8s mint))",
    worstCaseMs("cart_update") === 46_000,
  );
  ok("media_fetch is a known operation", isLeaflyOperation("media_fetch"));
  eq("media_fetch gets the attended budget", LEAFLY_TIMEOUT_MS.media_fetch, 12_000);
  eq("media_fetch attempts exactly twice", LEAFLY_MAX_ATTEMPTS.media_fetch, 2);
  // It shares the acknowledge's profile because it shares the acknowledge's
  // circumstances: a person waiting, inside the 15-minute window. If these
  // two ever diverge it should be because somebody decided they should.
  eq(
    "media_fetch matches the acknowledge it precedes",
    LEAFLY_TIMEOUT_MS.media_fetch,
    LEAFLY_TIMEOUT_MS.acknowledge,
  );
  ok(
    "media_fetch is NOT irreversible (looking at an ID changes nothing)",
    !isIrreversibleOperation("media_fetch"),
  );
  // Reading an image is a GET. A timed-out GET is always safe to repeat, and
  // saying otherwise would discourage the operator from the very thing the
  // acknowledge warning tells them to do first.
  ok(
    "a media_fetch timeout is safe to retry",
    describeDeadlineFailure({ operation: "media_fetch", fault: "timeout" }).safeToRetry,
  );
  ok(
    "a media_fetch timeout states its own 12s budget",
    describeDeadlineFailure({ operation: "media_fetch", fault: "timeout" }).message.includes(
      "12 seconds",
    ),
  );
  eq(
    "budget table covers exactly the operations",
    Object.keys(LEAFLY_TIMEOUT_MS).length,
    LEAFLY_OPERATIONS.length,
  );
  eq(
    "attempt table covers exactly the operations",
    Object.keys(LEAFLY_MAX_ATTEMPTS).length,
    LEAFLY_OPERATIONS.length,
  );
  for (const op of LEAFLY_OPERATIONS) {
    ok(`${op} is in the budget table`, Object.hasOwn(LEAFLY_TIMEOUT_MS, op));
    ok(`${op} is in the attempt table`, Object.hasOwn(LEAFLY_MAX_ATTEMPTS, op));
    ok(`${op} attempts are positive`, LEAFLY_MAX_ATTEMPTS[op] >= 1);
    ok(`${op} attempts are integral`, Number.isInteger(LEAFLY_MAX_ATTEMPTS[op]));
    // The upper bound is the owner-tunable menu clamp (MAX_RETRIES_MAX = 5,
    // plus the first attempt = 6). Anything beyond that is not something the
    // settings screen can produce, so it would be a coding error.
    ok(`${op} attempts are at most 6`, LEAFLY_MAX_ATTEMPTS[op] <= 6);
  }
  // The attended, clock-bound operations must NOT inherit the menu's generous
  // retry count. This is the assertion that would fail if somebody "unified"
  // the two groups for tidiness — which would put up to six 12-second
  // attempts plus six mints inside a fifteen-minute window.
  eq("acknowledge attempts exactly twice", LEAFLY_MAX_ATTEMPTS.acknowledge, 2);
  eq("status push attempts exactly twice", LEAFLY_MAX_ATTEMPTS.status_push, 2);
  eq("order fetch attempts exactly twice", LEAFLY_MAX_ATTEMPTS.order_fetch, 2);
  eq("the mint attempts exactly once", LEAFLY_MAX_ATTEMPTS.token_mint, 1);
  // Pinned to the real clamp in syndication/sync-settings-core.ts:144-145
  // (MAX_RETRIES_MIN 0, MAX_RETRIES_MAX 5) plus the first attempt.
  eq("menu push mirrors the 0-5 clamp + 1", LEAFLY_MAX_ATTEMPTS.menu_push, 6);
  eq("full menu push mirrors the clamp", LEAFLY_MAX_ATTEMPTS.full_menu_push, 6);
  eq("menu readback mirrors the clamp", LEAFLY_MAX_ATTEMPTS.menu_readback, 6);
  // Pinned to `authedFetch`'s own default at push.ts:327, because push.ts:711
  // is the single call site that passes no opts. If somebody threads
  // settings.maxRetries into the status call, this assertion fails and the
  // worst-case arithmetic below gets corrected with it.
  eq("integration status takes the wrapper default", LEAFLY_MAX_ATTEMPTS.integration_status, 3);
  ok(
    "integration status is its own group, between the two",
    LEAFLY_MAX_ATTEMPTS.acknowledge < LEAFLY_MAX_ATTEMPTS.integration_status &&
      LEAFLY_MAX_ATTEMPTS.integration_status < LEAFLY_MAX_ATTEMPTS.menu_push,
  );
  ok(
    "the attended operations retry less than the unattended ones",
    LEAFLY_MAX_ATTEMPTS.acknowledge < LEAFLY_MAX_ATTEMPTS.menu_push,
  );

  // ---- 2. The operator-facing operations are the tight ones ---------------
  ok(
    "acknowledge is tighter than the menu push",
    LEAFLY_TIMEOUT_MS.acknowledge < LEAFLY_TIMEOUT_MS.menu_push,
  );
  ok(
    "status push is tighter than the menu push",
    LEAFLY_TIMEOUT_MS.status_push < LEAFLY_TIMEOUT_MS.menu_push,
  );
  ok(
    "the mint is tighter than the acknowledge it precedes",
    LEAFLY_TIMEOUT_MS.token_mint < LEAFLY_TIMEOUT_MS.acknowledge,
  );
  ok(
    "the mint is the tightest budget of all",
    LEAFLY_OPERATIONS.every(
      (op) => op === "token_mint" || LEAFLY_TIMEOUT_MS.token_mint <= LEAFLY_TIMEOUT_MS[op],
    ),
  );
  ok(
    "the full menu push is the most generous",
    LEAFLY_OPERATIONS.every((op) => LEAFLY_TIMEOUT_MS[op] <= LEAFLY_TIMEOUT_MS.full_menu_push),
  );
  ok(
    "acknowledge is under 15 seconds (people stop believing the button)",
    LEAFLY_TIMEOUT_MS.acknowledge <= 15_000,
  );
  // The budgets a human waits on, held to one standard. order_fetch is
  // included: it backs a screen the operator is looking at too. L-24 added
  // media_fetch, which is the most attended of the lot — it is the thing the
  // operator is literally staring at before an irreversible press.
  for (const attended of [
    "acknowledge",
    "status_push",
    "integration_status",
    "order_fetch",
    "media_fetch",
  ] as const) {
    ok(
      `${attended} keeps an attended budget (<= 15s)`,
      LEAFLY_TIMEOUT_MS[attended] <= 15_000,
    );
    ok(
      `${attended} is tighter than the full menu push`,
      LEAFLY_TIMEOUT_MS[attended] < LEAFLY_TIMEOUT_MS.full_menu_push,
    );
  }
  ok(
    "the health check is no slower than the acknowledge it reports on",
    LEAFLY_TIMEOUT_MS.integration_status <= LEAFLY_TIMEOUT_MS.acknowledge,
  );

  // ---- 3. The worst case, which is the number that actually matters -------
  // 2 attempts x (12s call + 8s mint) = 40s. Proving the arithmetic, not
  // restating the constant, so a change to either input is caught.
  eq("acknowledge worst case is 40s", worstCaseMs("acknowledge"), 40_000);
  eq("status push worst case is 40s", worstCaseMs("status_push"), 40_000);
  eq("mint worst case is its own budget", worstCaseMs("token_mint"), 8_000);
  // 3 x (12s call + 8s mint) = 60s. Stated because it is the largest wait
  // this codebase imposes on somebody who is actually watching the screen,
  // and it is only visible once the attempt count is honest.
  eq("integration status worst case is 60s", worstCaseMs("integration_status"), 60_000);
  ok(
    "the attended health check still beats the unattended menu push",
    worstCaseMs("integration_status") < worstCaseMs("menu_push"),
  );
  ok(
    "the worst case always exceeds one attempt",
    LEAFLY_OPERATIONS.every((op) => worstCaseMs(op) >= LEAFLY_TIMEOUT_MS[op]),
  );
  ok(
    "the worst case for a retrying op includes the mint twice",
    worstCaseMs("acknowledge") ===
      2 * (LEAFLY_TIMEOUT_MS.acknowledge + LEAFLY_TIMEOUT_MS.token_mint),
  );
  // The regression this guards: someone raises the acknowledge budget to a
  // "safe-looking" 5 minutes and the worst case silently becomes 10m16s,
  // which does not leave a usable quarter of the window.
  for (const op of LEAFLY_OPERATIONS) {
    ok(`${op} fits the auto-cancel rule`, fitsInsideAutoCancelWindow(op));
  }
  ok(
    "acknowledge worst case leaves 3/4 of the window",
    worstCaseMs("acknowledge") * 4 <= LEAFLY_AUTO_CANCEL_MS,
  );
  eq("the auto-cancel window is 15 minutes", LEAFLY_AUTO_CANCEL_MS, 900_000);
  ok(
    "a menu push is NOT held to the auto-cancel rule",
    fitsInsideAutoCancelWindow("full_menu_push"),
  );
  // Stated explicitly so the number is visible rather than surprising: a full
  // menu push at the owner's maximum retry setting can legitimately occupy
  // 6 x (60s + 8s) = 6m48s. That is FINE — it is unattended and loses no
  // order if it is slow — but it is exactly why it may not share a budget
  // with the acknowledge, and exactly why it is excluded from the window rule.
  eq("full menu worst case is 6m48s", worstCaseMs("full_menu_push"), 408_000);
  eq("menu push worst case is 3m48s", worstCaseMs("menu_push"), 228_000);
  ok(
    "the unattended worst case far exceeds the attended one",
    worstCaseMs("full_menu_push") > worstCaseMs("acknowledge") * 5,
  );
  // And the corollary that protects the customer: no attended operation may
  // ever grow into the menu's territory.
  ok(
    "no clock-bound operation exceeds a minute of worst case",
    worstCaseMs("acknowledge") <= 60_000 && worstCaseMs("status_push") <= 60_000,
  );

  // ---- 4. timeoutForOperation, including the garbage paths ----------------
  eq("acknowledge resolves", timeoutForOperation("acknowledge"), 12_000);
  eq("whitespace is trimmed", timeoutForOperation("  acknowledge  "), 12_000);
  eq("unknown gets the tightest", timeoutForOperation("nonsense"), LEAFLY_TIMEOUT_MS.token_mint);
  eq("empty gets the tightest", timeoutForOperation(""), LEAFLY_TIMEOUT_MS.token_mint);
  ok("unknown is still finite", Number.isFinite(timeoutForOperation("nope")));
  ok("unknown is still positive", timeoutForOperation("nope") > 0);
  ok("isLeaflyOperation accepts a real one", isLeaflyOperation("acknowledge"));
  ok("isLeaflyOperation rejects nonsense", !isLeaflyOperation("acknowledge!"));
  ok("isLeaflyOperation rejects null", !isLeaflyOperation(null));
  ok("isLeaflyOperation rejects a number", !isLeaflyOperation(12_000));
  ok("isLeaflyOperation rejects an object", !isLeaflyOperation({}));
  ok("isLeaflyOperation is case-sensitive", !isLeaflyOperation("Acknowledge"));

  // ---- 5. Fault classification -------------------------------------------
  // `aborted` WINS over the message. This is the load-bearing case: the
  // caller owns the AbortController and its knowledge is authoritative.
  eq(
    "aborted is a timeout",
    classifyNetworkFault({ aborted: true, message: "The operation was aborted" }),
    "timeout",
  );
  eq(
    "aborted beats a DNS-looking message",
    classifyNetworkFault({ aborted: true, message: "getaddrinfo ENOTFOUND leafly" }),
    "timeout",
  );
  eq(
    "aborted with no message is still a timeout",
    classifyNetworkFault({ aborted: true, message: null }),
    "timeout",
  );
  eq(
    "ENOTFOUND is dns",
    classifyNetworkFault({ aborted: false, message: "getaddrinfo ENOTFOUND x" }),
    "dns",
  );
  eq(
    "ECONNREFUSED is offline",
    classifyNetworkFault({ aborted: false, message: "connect ECONNREFUSED 1.2.3.4:443" }),
    "offline",
  );
  eq(
    "socket hang up is offline",
    classifyNetworkFault({ aborted: false, message: "socket hang up" }),
    "offline",
  );
  eq(
    "certificate is tls",
    classifyNetworkFault({ aborted: false, message: "unable to verify the first certificate" }),
    "tls",
  );
  eq(
    "self-signed is tls",
    classifyNetworkFault({ aborted: false, message: "self-signed certificate in chain" }),
    "tls",
  );
  eq(
    "an unrecognised message is unknown, NOT a guess",
    classifyNetworkFault({ aborted: false, message: "fetch failed" }),
    "unknown",
  );
  eq(
    "an empty message is unknown",
    classifyNetworkFault({ aborted: false, message: "" }),
    "unknown",
  );
  eq(
    "a null message is unknown",
    classifyNetworkFault({ aborted: false, message: null }),
    "unknown",
  );
  eq(
    "an undefined message is unknown",
    classifyNetworkFault({ aborted: false, message: undefined }),
    "unknown",
  );
  eq(
    "classification is case-insensitive",
    classifyNetworkFault({ aborted: false, message: "CONNECT ECONNREFUSED" }),
    "offline",
  );
  ok(
    "every fault is a known fault",
    (LEAFLY_NETWORK_FAULTS as readonly string[]).includes(
      classifyNetworkFault({ aborted: false, message: "anything at all" }),
    ),
  );
  eq("there are five faults", LEAFLY_NETWORK_FAULTS.length, 5);

  // ---- 6. The verdicts, and the safety flags that matter most -------------
  const ackTimeout = describeDeadlineFailure({ operation: "acknowledge", fault: "timeout" });
  eq("ack timeout keeps its fault", ackTimeout.fault, "timeout");
  eq("ack timeout keeps its operation", ackTimeout.operation, "acknowledge");
  ok("ack timeout was our clock", ackTimeout.wasOurClock);
  // THE most important assertion in this file. A timeout means we stopped
  // listening — never that nothing arrived.
  ok("ack timeout does NOT claim undelivered", !ackTimeout.certainlyNotDelivered);
  ok("ack timeout is NOT safe to retry blindly", !ackTimeout.safeToRetry);
  ok("ack timeout admits we cannot tell", ackTimeout.message.includes("cannot tell"));
  ok("ack timeout says it cannot be undone", ackTimeout.message.includes("cannot be undone"));
  ok("ack timeout names the 15-minute clock", ackTimeout.message.includes("15-minute"));
  ok("ack timeout states the budget in seconds", ackTimeout.message.includes("12 seconds"));
  ok("ack timeout never claims success", !ackTimeout.message.toLowerCase().includes("acknowledged the order"));

  const ackOffline = describeDeadlineFailure({ operation: "acknowledge", fault: "offline" });
  ok("offline IS certainly undelivered", ackOffline.certainlyNotDelivered);
  // Safe even though acknowledge is irreversible: nothing left the building,
  // so there is nothing to double.
  ok("offline is safe to retry even for acknowledge", ackOffline.safeToRetry);
  ok("offline was not our clock", !ackOffline.wasOurClock);
  ok("offline says nothing was sent", ackOffline.message.includes("nothing was sent"));
  ok("offline does not blame Leafly", ackOffline.message.includes("not a refusal"));

  const ackDns = describeDeadlineFailure({ operation: "acknowledge", fault: "dns" });
  ok("dns is certainly undelivered", ackDns.certainlyNotDelivered);
  ok("dns is safe to retry", ackDns.safeToRetry);
  ok("dns points at our own settings", ackDns.message.includes("integration settings"));

  const ackTls = describeDeadlineFailure({ operation: "acknowledge", fault: "tls" });
  ok("tls is certainly undelivered", ackTls.certainlyNotDelivered);
  ok("tls is safe to retry", ackTls.safeToRetry);
  ok("tls says nothing reached Leafly", ackTls.message.includes("Nothing reached Leafly"));

  const ackUnknown = describeDeadlineFailure({ operation: "acknowledge", fault: "unknown" });
  // Unknown must fail towards caution for exactly the same reason as timeout:
  // we do not know, so we may not claim.
  ok("unknown does NOT claim undelivered", !ackUnknown.certainlyNotDelivered);
  ok("unknown is NOT safe to retry for acknowledge", !ackUnknown.safeToRetry);
  ok("unknown was not our clock", !ackUnknown.wasOurClock);
  ok("unknown admits ignorance", ackUnknown.message.includes("could not tell why"));

  // A REVERSIBLE operation that timed out IS safe to retry — this is the
  // asymmetry the irreversibility flag exists to create.
  const pushTimeout = describeDeadlineFailure({ operation: "menu_push", fault: "timeout" });
  ok("a menu push timeout is safe to retry", pushTimeout.safeToRetry);
  ok("a menu push timeout still admits nothing confirmed", pushTimeout.message.includes("Nothing was confirmed"));
  ok("a menu push timeout does not claim undelivered", !pushTimeout.certainlyNotDelivered);
  ok("a menu push timeout states its own 30s budget", pushTimeout.message.includes("30 seconds"));

  const statusTimeout = describeDeadlineFailure({ operation: "status_push", fault: "timeout" });
  ok("a status push timeout is safe to retry", statusTimeout.safeToRetry);
  ok("status push is not irreversible here", !isIrreversibleOperation("status_push"));
  ok(
    "a health check is never irreversible",
    !isIrreversibleOperation("integration_status"),
  );
  const statusCheckTimeout = describeDeadlineFailure({
    operation: "integration_status",
    fault: "timeout",
  });
  ok("a health check timeout is safe to retry", statusCheckTimeout.safeToRetry);
  ok(
    "a health check timeout states its 12s budget",
    statusCheckTimeout.message.includes("12 seconds"),
  );
  ok("acknowledge IS irreversible", isIrreversibleOperation("acknowledge"));
  ok(
    "acknowledge is the ONLY irreversible operation in this file",
    LEAFLY_OPERATIONS.filter((op) => isIrreversibleOperation(op)).length === 1,
  );

  // ---- 7. Invariants across the whole matrix ------------------------------
  // Seven operations x five faults = 35 verdicts, every one of which must
  // obey the same four rules. Enumerated rather than spot-checked because a
  // single wrong cell here is a wrong answer to "did the customer's order get
  // acknowledged".
  for (const op of LEAFLY_OPERATIONS) {
    for (const fault of LEAFLY_NETWORK_FAULTS) {
      const v = describeDeadlineFailure({ operation: op, fault });
      ok(`${op}/${fault} has a message`, v.message.length > 0);
      ok(`${op}/${fault} message is a full sentence`, v.message.trim().endsWith("."));
      ok(`${op}/${fault} echoes the operation`, v.operation === op);
      ok(`${op}/${fault} echoes the fault`, v.fault === fault);
      // Never, under any combination, claim the thing succeeded.
      ok(
        `${op}/${fault} never claims success`,
        !/\bsucceeded\b|\bwas acknowledged\b|\bconfirmed to leafly\b/i.test(v.message),
      );
      // wasOurClock is true for exactly one fault.
      ok(`${op}/${fault} clock flag agrees with fault`, v.wasOurClock === (fault === "timeout"));
      // certainlyNotDelivered is false for exactly the two unknowable faults.
      ok(
        `${op}/${fault} delivery flag is honest`,
        v.certainlyNotDelivered === (fault !== "timeout" && fault !== "unknown"),
      );
      // The safety rule, stated independently of the implementation.
      ok(
        `${op}/${fault} retry flag is safe`,
        v.safeToRetry === (v.certainlyNotDelivered || !isIrreversibleOperation(op)),
      );
      // An unknowable outcome on an irreversible operation must NEVER be
      // reported as safe. This is the one that protects the customer's ID
      // images.
      if (isIrreversibleOperation(op) && !v.certainlyNotDelivered) {
        ok(`${op}/${fault} irreversible+unknown is not safe`, !v.safeToRetry);
      }
    }
  }

  // ---- SLICE L-23. The body-phase deadline ---------------------------------
  //
  // These assertions exist because the deadline that shipped in L-17 covered
  // the connection and not the response, and the owner felt the difference as
  // a five-minute hang. Each one pins a fact that, if it flipped, would bring
  // that hang back or replace it with something worse.

  // The null-body list. Getting this wrong throws on every successful
  // acknowledgement, which is the single most expensive throw available here.
  eq("there are three null-body statuses", NULL_BODY_STATUSES.length, 3);
  for (const s of [204, 205, 304]) {
    ok(`${s} is a null-body status`, (NULL_BODY_STATUSES as readonly number[]).includes(s));
    ok(`${s} may NOT carry a body`, !mayCarryBody(s));
    ok(`${s} is settled by its status alone`, outcomeSettledByStatusAlone(s));
  }
  // 204 is called out by name: it is the acknowledge endpoint's documented
  // success code, per docs/leafly-specs/order-api-v1.openapi.json.
  ok("the acknowledge success code 204 may not carry a body", !mayCarryBody(204));
  ok("the acknowledge success code 204 is settled by status alone", outcomeSettledByStatusAlone(204));

  // Statuses that DO carry a body must never be rescued. A 200 whose body
  // stalled has lost its payload, and pretending otherwise hands the caller a
  // successful-looking response with nothing in it.
  for (const s of [200, 201, 202, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503]) {
    ok(`${s} may carry a body`, mayCarryBody(s));
    ok(`${s} is NOT settled by status alone`, !outcomeSettledByStatusAlone(s));
  }
  // The status-push success code is 200, deliberately different from the
  // acknowledge's 204 — so it must fall on the other side of this rule.
  ok("the status-push success code 200 is not rescued", !outcomeSettledByStatusAlone(200));

  // Absent/garbage input. Wrong in the "may carry a body" direction costs an
  // unnecessary empty string; wrong the other way throws.
  for (const bad of [null, undefined, NaN, Infinity, -Infinity]) {
    ok(`${String(bad)} defaults to may-carry-body`, mayCarryBody(bad as number | null | undefined));
    ok(`${String(bad)} is not settled by status alone`, !outcomeSettledByStatusAlone(bad as number | null));
  }

  eq("there are two deadline phases", DEADLINE_PHASES.length, 2);
  ok("connect is a phase", (DEADLINE_PHASES as readonly string[]).includes("connect"));
  ok("body is a phase", (DEADLINE_PHASES as readonly string[]).includes("body"));

  // The phase changes the SENTENCE, and it must change it in the direction
  // that reflects what we actually know.
  {
    const connect = describeDeadlineFailure({ operation: "acknowledge", fault: "timeout" });
    const body = describeDeadlineFailure({
      operation: "acknowledge",
      fault: "timeout",
      phase: "body",
      receivedStatus: 204,
    });
    ok("connect and body timeouts read differently", connect.message !== body.message);

    // The connect sentence must admit we cannot tell. The body sentence must
    // NOT, because we are holding Leafly's status line.
    ok("connect timeout says we cannot tell", /cannot tell/i.test(connect.message));
    ok("body timeout does NOT say we cannot tell", !/cannot tell/i.test(body.message));

    // The body sentence must state the fact that makes it useful.
    ok("body timeout says Leafly did receive it", /did receive|reached them/i.test(body.message));
    ok("body timeout names the status we hold", body.message.includes("204"));
    ok("body timeout forbids a second press", /do not acknowledge it again/i.test(body.message));

    // Both remain unsafe to retry. The temptation on seeing "we got a status"
    // is to conclude the call is repeatable; it is the exact opposite, because
    // we now KNOW it arrived.
    ok("connect timeout on acknowledge is not safe to retry", !connect.safeToRetry);
    ok("body timeout on acknowledge is not safe to retry", !body.safeToRetry);
    ok("body timeout is still our clock", body.wasOurClock);
    ok("body timeout is not 'certainly not delivered'", !body.certainlyNotDelivered);

    // Neither may ever claim success. This is the invariant that protects the
    // ID images from a second acknowledgement.
    for (const v of [connect, body]) {
      ok(
        "a timeout never claims the order was acknowledged",
        !/\bsucceeded\b|\bwas acknowledged\b/i.test(v.message),
      );
    }
  }

  // A body-phase timeout with no status still has to produce a true sentence:
  // it must not invent a status it does not have.
  {
    const v = describeDeadlineFailure({
      operation: "acknowledge",
      fault: "timeout",
      phase: "body",
      receivedStatus: null,
    });
    ok("body timeout without a status says 'began answering'", /began answering/i.test(v.message));
    ok("body timeout without a status invents no HTTP code", !/HTTP \d/.test(v.message));
  }

  // Omitting the phase must behave EXACTLY as before this slice, so that the
  // five other call sites and every existing assertion are untouched.
  for (const op of LEAFLY_OPERATIONS) {
    for (const fault of LEAFLY_NETWORK_FAULTS) {
      const implicit = describeDeadlineFailure({ operation: op, fault });
      const explicit = describeDeadlineFailure({ operation: op, fault, phase: "connect" });
      eq(`${op}/${fault} default phase is connect`, implicit.message, explicit.message);
      ok(
        `${op}/${fault} default phase keeps its flags`,
        implicit.safeToRetry === explicit.safeToRetry &&
          implicit.certainlyNotDelivered === explicit.certainlyNotDelivered,
      );
    }
  }

  // The body phase only changes the sentence for a TIMEOUT. A DNS failure did
  // not reach Leafly regardless of what phase we claim, and saying otherwise
  // would be the dangerous lie pointed the other way.
  for (const fault of LEAFLY_NETWORK_FAULTS) {
    if (fault === "timeout") continue;
    const a = describeDeadlineFailure({ operation: "acknowledge", fault });
    const b = describeDeadlineFailure({ operation: "acknowledge", fault, phase: "body" });
    eq(`${fault} reads the same in either phase`, a.message, b.message);
  }

  // A non-irreversible body timeout may still be retried, and must say so —
  // otherwise a menu push would be stranded by a rule written for the
  // acknowledge.
  {
    const v = describeDeadlineFailure({
      operation: "menu_push",
      fault: "timeout",
      phase: "body",
      receivedStatus: 200,
    });
    ok("a reversible body timeout is safe to retry", v.safeToRetry);
    ok("a reversible body timeout still says it reached Leafly", /did reach Leafly/i.test(v.message));
  }

  return { passed, failed };
}
