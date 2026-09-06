/**
 * src/lib/orders/new-order-watch-core.ts
 *
 * SLICE 22 — PURE decision logic for the Orders dashboard's "new order" chime.
 *
 * Owner, verbatim:
 *
 *   "the online orders dashboard in the back office has a feature that makes a
 *    noise when an online order is placed. I can test the sound to confirm it
 *    works, but it does not make noise when I complete an online order. Is this
 *    a bug or is it because I am placing the order on the same computer the
 *    back office is open on? Or something else?"
 *
 * THE ANSWER (proven from code, not guessed): it is a real bug, and the
 * same-computer theory is not the cause. The dashboard polls
 * /api/admin/orders/count — a SERVER round trip — so which browser placed the
 * order is irrelevant to whether the chime fires.
 *
 * What the old NewOrderAlert actually did (src/components/admin/orders/
 * NewOrderAlert.tsx before this slice):
 *
 *     const baseline = useRef(initialNew);          // :53  never reassigned
 *     const diff = data.counts.new - baseline.current;  // :86
 *     if (diff > prev && !muted) chime(volume);     // :88
 *
 * `counts.new` is the number of orders CURRENTLY SITTING in status "new"
 * (orders-store.ts getOrderStatusCounts → count of rows WHERE status = 'new').
 * That is a LEVEL, not an arrival counter, and a level goes DOWN whenever staff
 * acknowledge an order. Three independent failure modes follow:
 *
 *   1. ACK CANCELS AN ARRIVAL. Place one, acknowledge it, place another: the
 *      level returns to its start value, `diff` returns to its old value, and
 *      `diff > prev` is false. Silence — exactly when the store is busy.
 *   2. THE BASELINE IS FROZEN. `useRef(initialNew)` captures the count at first
 *      render and is never reassigned (verified: `grep -c "baseline.current ="`
 *      returned 0). router.refresh() re-renders the server component with a new
 *      initialNew, but the ref keeps the stale one, so the arithmetic drifts
 *      away from what is on screen.
 *   3. IT COMPARES AGAINST THE PREVIOUS DIFF, not against what the user has
 *      actually been alerted to.
 *
 * THE FIX MODELLED HERE: watch a signal that can only ever go UP. Every order
 * row carries `placed_at timestamptz not null default now()` (migration
 * 0007_slice7_orders.sql:90), written by the database at INSERT and never
 * touched by a status change. So "the newest placed_at I have already told the
 * user about" is a true high-water mark: acknowledging, completing, cancelling
 * or refunding an order cannot move it backwards.
 *
 * This module is PURE (no React, no I/O, no server-only) so the rule can be
 * unit-tested directly and shared by the client component and the tests.
 */

/** One arrival as the count endpoint reports it. */
export type OrderArrival = {
  /** Order id — used only to de-duplicate, never displayed here. */
  id: string;
  /** ISO timestamp from orders.placed_at (DB-assigned at insert). */
  placedAt: string;
  /** Customer-facing label for the banner (display name or GWY number). */
  label: string;
};

/**
 * What the watcher remembers between polls. Deliberately tiny and
 * serialisable so it can live in a ref, in localStorage, or in a test.
 */
export type WatchState = {
  /**
   * ISO timestamp of the newest arrival the user has ALREADY been alerted to.
   * Monotonic: never moves backwards. Null = nothing seen yet (first poll).
   */
  seenThroughIso: string | null;
  /** Ids already counted, so a duplicate poll cannot double-chime. */
  seenIds: string[];
};

export const EMPTY_WATCH_STATE: WatchState = { seenThroughIso: null, seenIds: [] };

/**
 * How many ids to retain. Enough to cover any realistic burst between polls
 * while keeping the state small; older ids are protected by the timestamp
 * water mark anyway.
 */
export const SEEN_ID_CAP = 200;

export type WatchDecision = {
  /** Arrivals the user has not been told about yet, oldest first. */
  fresh: OrderArrival[];
  /** True when the chime should sound. */
  shouldChime: boolean;
  /** The state to carry into the next poll. */
  next: WatchState;
};

/** Valid ISO instant? Never throws. */
export function isIsoInstant(v: unknown): v is string {
  if (typeof v !== "string" || !v.trim()) return false;
  const t = Date.parse(v);
  return Number.isFinite(t);
}

/**
 * Newest of two ISO instants. Used to advance the water mark without ever
 * letting it slip backwards (a clock skew or an out-of-order poll must not
 * re-arm an alert the user already saw).
 */
export function maxIso(a: string | null, b: string | null): string | null {
  if (!isIsoInstant(a)) return isIsoInstant(b) ? b : null;
  if (!isIsoInstant(b)) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * Sort arrivals oldest → newest by placed_at, tie-broken by id so the order is
 * deterministic (two orders can share a millisecond).
 */
export function sortArrivals(arrivals: OrderArrival[]): OrderArrival[] {
  return [...arrivals].sort((x, y) => {
    const dx = Date.parse(x.placedAt);
    const dy = Date.parse(y.placedAt);
    if (dx !== dy) return dx - dy;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}

/**
 * Decide what to do with a poll result.
 *
 * RULES, each one a fix for a proven defect:
 *
 *  A. FIRST POLL NEVER CHIMES. On mount we do not know what the staffer has
 *     already seen on the server-rendered page, so the first observation only
 *     establishes the water mark. Chiming here would fire on every navigation.
 *  B. ONLY STRICTLY NEWER ARRIVALS COUNT. An order is fresh when its placed_at
 *     is after the water mark AND its id has not been counted. Acknowledging,
 *     completing or cancelling an order changes its STATUS, never its
 *     placed_at, so staff activity can no longer suppress a chime.
 *  C. THE WATER MARK ONLY ADVANCES. maxIso guarantees it, so a late or
 *     out-of-order poll cannot re-alert on something already announced.
 *  D. MUTED STILL TRACKS. When muted we advance the state exactly the same
 *     way and merely withhold the sound — un-muting must not unleash a
 *     backlog of chimes for orders that arrived while muted.
 */
export function decideWatch(
  state: WatchState,
  arrivals: OrderArrival[],
  opts: { muted: boolean },
): WatchDecision {
  const valid = sortArrivals(
    (Array.isArray(arrivals) ? arrivals : []).filter(
      (a) => a && typeof a.id === "string" && a.id.length > 0 && isIsoInstant(a.placedAt),
    ),
  );

  const newestSeen = valid.length ? valid[valid.length - 1].placedAt : null;

  // RULE A — establish the mark, announce nothing.
  if (state.seenThroughIso === null) {
    return {
      fresh: [],
      shouldChime: false,
      next: {
        seenThroughIso: newestSeen,
        seenIds: valid.map((a) => a.id).slice(-SEEN_ID_CAP),
      },
    };
  }

  const mark = Date.parse(state.seenThroughIso);
  const seen = new Set(state.seenIds);

  // RULE B — strictly newer, and not already counted.
  const fresh = valid.filter((a) => Date.parse(a.placedAt) > mark && !seen.has(a.id));

  // RULE C — the mark only ever advances.
  const nextIso = maxIso(state.seenThroughIso, newestSeen);

  const nextIds = [...state.seenIds, ...fresh.map((a) => a.id)].slice(-SEEN_ID_CAP);

  return {
    fresh,
    // RULE D — muted withholds sound but not bookkeeping.
    shouldChime: fresh.length > 0 && !opts.muted,
    next: { seenThroughIso: nextIso, seenIds: nextIds },
  };
}

/**
 * Banner wording. Kept pure so the copy is testable and cannot drift between
 * the singular and plural cases.
 */
export function bannerText(count: number): string {
  if (count <= 0) return "";
  if (count === 1) return "1 new order — tap to refresh";
  return `${count} new orders — tap to refresh`;
}

/**
 * Clamp a persisted volume into the audible range. A stored 0 (or garbage)
 * must not silently disable a chime the owner believes is on — that is the
 * whole complaint we are fixing, so an unusable value falls back to the
 * default rather than to silence.
 */
export const DEFAULT_CHIME_VOLUME = 0.25;
export const MIN_CHIME_VOLUME = 0.05;

export function normalizeVolume(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < MIN_CHIME_VOLUME) return DEFAULT_CHIME_VOLUME;
  return Math.min(1, n);
}

// ---------------------------------------------------------------------------
// SECOND ROOT CAUSE — the browser's autoplay gate
// ---------------------------------------------------------------------------
//
// The water-mark fix above repairs WHEN we decide to chime. It does not repair
// WHETHER the browser will let the sound out, and that is an independent
// defect that produces exactly the symptom the owner reported: "I can test the
// sound to confirm it works, but it does not make noise when I complete an
// online order."
//
// Chrome's autoplay policy has covered the Web Audio API since Chrome 71
// (developer.chrome.com/blog/autoplay, "Web Audio" section), and states
// verbatim:
//
//     "If an AudioContext is created before the document receives a user
//      gesture, it will be created in the 'suspended' state, and you will need
//      to call resume() after the user gesture."
//
// The old chime() built a BRAND NEW AudioContext on every call
// (NewOrderAlert.tsx:28 `const ctx = new Ctx();`) and closed it 1.2s later
// (:45). Two consequences:
//
//   1. Pressing "Test sound" constructs the context INSIDE the click handler,
//      so it is created during a user gesture and starts `running`. It plays.
//      That is why testing always worked.
//   2. A poll-driven chime constructs its context inside a setInterval
//      callback. There is no gesture in that task. Per the policy above the
//      context is created `suspended`, osc.start() is scheduled against a
//      clock that is not advancing, the context is closed 1.2 seconds later,
//      and NOTHING IS EVER HEARD. No error is thrown, so the old try/catch at
//      :46 could not have surfaced it either. Silent failure.
//
// MDN's user-activation reference confirms Web Audio autoplay is gated on
// STICKY activation ("has at some time in the session pressed a button... It
// is not reset after it has been set initially"). Sticky activation belongs to
// the WINDOW, not to a callback, so a single real click anywhere on the page is
// enough to unlock audio for the rest of the session — but only if we keep and
// resume ONE long-lived context instead of building a throwaway one per chime.
//
// Hence the fix: create the AudioContext ONCE, resume() it on the first real
// user gesture, keep it alive, and reuse it for every chime. `audioGateState`
// below models the decision so it can be unit-tested without a browser.

/** What we know about the shared AudioContext at chime time. */
export type AudioGateInput = {
  /** BaseAudioContext.state, or null when no context exists yet. */
  contextState: "running" | "suspended" | "interrupted" | "closed" | null;
  /** navigator.userActivation.hasBeenActive — sticky activation. */
  hasBeenActive: boolean;
};

export type AudioGateAction =
  /** Build the shared context (first use). */
  | "create"
  /** Context exists but is parked; resume() then play. */
  | "resume"
  /** Good to go. */
  | "play"
  /** The old context is gone; build a fresh one. */
  | "recreate"
  /**
   * The browser has never seen a gesture in this window, so audio cannot be
   * unlocked yet. Show the "click Test sound" hint rather than pretending.
   */
  | "blocked";

/**
 * Decide how to reach an audible state.
 *
 * Note the ordering: a `closed` context is unusable no matter what, so it is
 * checked before the activation gate. And we NEVER report "blocked" for a
 * context that is already running — once the browser has let us in, later
 * activation bookkeeping is irrelevant.
 */
export function audioGateAction(input: AudioGateInput): AudioGateAction {
  if (input.contextState === "running") return "play";
  if (input.contextState === "closed") {
    return input.hasBeenActive ? "recreate" : "blocked";
  }
  if (input.contextState === null) {
    return input.hasBeenActive ? "create" : "blocked";
  }
  // "suspended" or "interrupted" — both are resumable.
  return input.hasBeenActive ? "resume" : "blocked";
}

/**
 * Should the "click Test sound to unlock audio" hint be visible?
 *
 * Only when sound is wanted (not muted) AND the browser has genuinely not been
 * activated. The old component defaulted `armed` to true (NewOrderAlert.tsx:59)
 * and then hydrated it from localStorage, which meant the hint was hidden on
 * first paint — precisely when it was most needed — and, worse, a stale
 * localStorage "1" from a previous session claimed audio was unlocked when the
 * new page load had received no gesture at all. Sticky activation does NOT
 * survive a navigation, so localStorage is the wrong source of truth here;
 * navigator.userActivation is the right one.
 */
export function shouldShowUnlockHint(opts: { muted: boolean; hasBeenActive: boolean }): boolean {
  return !opts.muted && !opts.hasBeenActive;
}

// ---------------------------------------------------------------------------
// THIRD ROOT CAUSE — background-tab timer throttling
// ---------------------------------------------------------------------------
//
// The back office is realistically left open on a second monitor or a
// background tab while staff work elsewhere. Chrome 88+ applies "intensive
// throttling" to chained timers — setInterval qualifies — when the page has
// been hidden more than 5 minutes, the chain count is 5 or greater, the page
// has been silent 30 seconds, and WebRTC is unused
// (developer.chrome.com/blog/timer-throttling-in-chrome-88). In that state
// "the browser will check timers in this group once per minute", so a 15s poll
// silently degrades to roughly 60s and an order can sit unannounced for a full
// minute.
//
// We cannot switch off throttling, and we should not want to. What we CAN do
// is poll immediately the moment the tab becomes visible again, so returning to
// the tab produces an instant, accurate answer instead of waiting out a
// throttled tick. POLL_ON_VISIBLE encodes that decision.

export const VISIBLE_POLL_MS = 15000;

/**
 * Poll interval to use for the current visibility. Hidden tabs poll less
 * often on purpose: the browser would throttle us anyway, and asking for
 * something we cannot have just burns the server's time. The visibility
 * handler covers the gap by polling on the way back in.
 */
export const HIDDEN_POLL_MS = 60000;

export function pollIntervalMs(visible: boolean): number {
  return visible ? VISIBLE_POLL_MS : HIDDEN_POLL_MS;
}

// ---------------------------------------------------------------------------
// Self-tests (wired into scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runNewOrderWatchCoreTests(): void {
  let pass = 0;
  let fail = 0;
  const ok = (cond: boolean, label: string) => {
    if (cond) pass += 1;
    else {
      fail += 1;
      console.error(`  FAIL new-order-watch-core: ${label}`);
    }
  };

  const a = (id: string, placedAt: string): OrderArrival => ({ id, placedAt, label: id });

  const T0 = "2026-09-06T17:00:00.000Z";
  const T1 = "2026-09-06T17:05:00.000Z";
  const T2 = "2026-09-06T17:10:00.000Z";

  // ── Rule A: the first poll only establishes the mark ──────────────────────
  {
    const d = decideWatch(EMPTY_WATCH_STATE, [a("o1", T0)], { muted: false });
    ok(!d.shouldChime, "first poll never chimes");
    ok(d.fresh.length === 0, "first poll reports nothing fresh");
    ok(d.next.seenThroughIso === T0, "first poll sets the water mark");
  }
  {
    const d = decideWatch(EMPTY_WATCH_STATE, [], { muted: false });
    ok(d.next.seenThroughIso === null, "empty first poll leaves the mark unset");
    ok(!d.shouldChime, "empty first poll silent");
  }

  // ── A genuinely new arrival chimes ────────────────────────────────────────
  {
    const s: WatchState = { seenThroughIso: T0, seenIds: ["o1"] };
    const d = decideWatch(s, [a("o1", T0), a("o2", T1)], { muted: false });
    ok(d.shouldChime, "a newer order chimes");
    ok(d.fresh.length === 1 && d.fresh[0].id === "o2", "only the new one is fresh");
    ok(d.next.seenThroughIso === T1, "mark advances to the newest");
  }

  // ── THE ORIGINAL BUG: acknowledging must not suppress the next chime ──────
  // Old code watched the LEVEL of status='new'. Ack drops it, so the next
  // arrival merely restored the old level and stayed silent. placed_at cannot
  // be dragged down by a status change, so this now chimes.
  {
    let s: WatchState = { seenThroughIso: null, seenIds: [] };
    s = decideWatch(s, [a("o1", T0)], { muted: false }).next; // order 1 arrives
    // staff acknowledge o1 — it leaves the "new" bucket entirely.
    const d = decideWatch(s, [a("o2", T1)], { muted: false });
    ok(d.shouldChime, "arrival after an acknowledgement still chimes (the reported bug)");
    ok(d.fresh.length === 1 && d.fresh[0].id === "o2", "the post-ack arrival is the fresh one");
  }

  // ── Re-polling the same data must not double-chime ────────────────────────
  {
    const s: WatchState = { seenThroughIso: T0, seenIds: ["o1"] };
    const first = decideWatch(s, [a("o2", T1)], { muted: false });
    ok(first.shouldChime, "first sight chimes");
    const second = decideWatch(first.next, [a("o2", T1)], { muted: false });
    ok(!second.shouldChime, "same payload does not chime twice");
    ok(second.fresh.length === 0, "nothing fresh on a repeat poll");
  }

  // ── An id already counted never re-fires, even at the same instant ────────
  {
    const s: WatchState = { seenThroughIso: T0, seenIds: ["dupe"] };
    const d = decideWatch(s, [{ id: "dupe", placedAt: T2, label: "dupe" }], { muted: false });
    ok(!d.shouldChime, "a counted id cannot chime again");
  }

  // ── Rule C: the mark never slips backwards ────────────────────────────────
  {
    const s: WatchState = { seenThroughIso: T2, seenIds: [] };
    const d = decideWatch(s, [a("old", T0)], { muted: false });
    ok(d.next.seenThroughIso === T2, "an older payload cannot rewind the mark");
    ok(!d.shouldChime, "an older arrival does not chime");
    ok(maxIso(T2, T0) === T2 && maxIso(T0, T2) === T2, "maxIso picks the newer");
    ok(maxIso(null, T0) === T0 && maxIso(T0, null) === T0, "maxIso tolerates null");
    ok(maxIso(null, null) === null, "maxIso of nothing is null");
  }

  // ── Rule D: muted tracks silently, so un-muting has no backlog ────────────
  {
    const s: WatchState = { seenThroughIso: T0, seenIds: [] };
    const d = decideWatch(s, [a("o2", T1)], { muted: true });
    ok(!d.shouldChime, "muted does not sound");
    ok(d.fresh.length === 1, "muted still reports the arrival for the banner");
    ok(d.next.seenThroughIso === T1, "muted still advances the mark");
    const after = decideWatch(d.next, [a("o2", T1)], { muted: false });
    ok(!after.shouldChime, "un-muting does not replay what arrived while muted");
  }

  // ── Several arrivals in one poll ──────────────────────────────────────────
  {
    const s: WatchState = { seenThroughIso: T0, seenIds: [] };
    const d = decideWatch(s, [a("o3", T2), a("o2", T1)], { muted: false });
    ok(d.fresh.length === 2, "both arrivals are fresh");
    ok(d.fresh[0].id === "o2" && d.fresh[1].id === "o3", "fresh is oldest-first");
    ok(d.shouldChime, "a burst chimes once");
    ok(d.next.seenThroughIso === T2, "mark jumps to the newest of the burst");
  }

  // ── Garbage in the payload is ignored, never thrown on ────────────────────
  {
    const s: WatchState = { seenThroughIso: T0, seenIds: [] };
    const junk = [
      { id: "", placedAt: T1, label: "" },
      { id: "ok", placedAt: "not-a-date", label: "x" },
      a("good", T1),
    ];
    const d = decideWatch(s, junk, { muted: false });
    ok(d.fresh.length === 1 && d.fresh[0].id === "good", "malformed arrivals dropped");
    ok(
      decideWatch(s, null as unknown as OrderArrival[], { muted: false }).fresh.length === 0,
      "a non-array payload is survivable",
    );
  }

  // ── Tie-break is deterministic at identical timestamps ────────────────────
  {
    const sorted = sortArrivals([a("b", T1), a("a", T1)]);
    ok(sorted[0].id === "a" && sorted[1].id === "b", "same instant ties break by id");
  }

  // ── The seen-id list stays bounded ────────────────────────────────────────
  {
    const many = Array.from({ length: SEEN_ID_CAP + 50 }, (_, i) =>
      a(`x${i}`, new Date(Date.parse(T0) + (i + 1) * 1000).toISOString()),
    );
    const d = decideWatch({ seenThroughIso: T0, seenIds: [] }, many, { muted: false });
    ok(d.next.seenIds.length === SEEN_ID_CAP, "seen ids are capped");
  }

  // ── isIsoInstant ──────────────────────────────────────────────────────────
  ok(isIsoInstant(T0), "valid iso accepted");
  ok(!isIsoInstant(""), "empty rejected");
  ok(!isIsoInstant("   "), "blank rejected");
  ok(!isIsoInstant(null), "null rejected");
  ok(!isIsoInstant("tomorrow"), "prose rejected");

  // ── Banner copy ───────────────────────────────────────────────────────────
  ok(bannerText(1) === "1 new order — tap to refresh", "singular banner");
  ok(bannerText(3) === "3 new orders — tap to refresh", "plural banner");
  ok(bannerText(0) === "", "no banner at zero");

  // ── Volume: a stored 0 must not masquerade as a working chime ─────────────
  ok(normalizeVolume(0) === DEFAULT_CHIME_VOLUME, "0 volume falls back to default");
  ok(normalizeVolume(-1) === DEFAULT_CHIME_VOLUME, "negative falls back");
  ok(normalizeVolume("junk") === DEFAULT_CHIME_VOLUME, "garbage falls back");
  ok(normalizeVolume(null) === DEFAULT_CHIME_VOLUME, "null falls back");
  ok(normalizeVolume(2) === 1, "above range clamps to 1");
  ok(normalizeVolume(0.4) === 0.4, "a good value survives");

  // ── The autoplay gate — the second root cause ───────────────────────────
  // Chrome creates an AudioContext "suspended" when there was no gesture, so
  // a poll-built context never sounds. These assertions pin the recovery.
  ok(
    audioGateAction({ contextState: null, hasBeenActive: true }) === "create",
    "no context yet + activated => create one",
  );
  ok(
    audioGateAction({ contextState: null, hasBeenActive: false }) === "blocked",
    "no context and no gesture => blocked, show the hint",
  );
  ok(
    audioGateAction({ contextState: "suspended", hasBeenActive: true }) === "resume",
    "a suspended context is resumed, not rebuilt (the actual bug)",
  );
  ok(
    audioGateAction({ contextState: "interrupted", hasBeenActive: true }) === "resume",
    "an interrupted context (iOS backgrounding) is resumable too",
  );
  ok(
    audioGateAction({ contextState: "suspended", hasBeenActive: false }) === "blocked",
    "suspended with no gesture stays blocked",
  );
  ok(
    audioGateAction({ contextState: "closed", hasBeenActive: true }) === "recreate",
    "a closed context must be rebuilt",
  );
  ok(
    audioGateAction({ contextState: "closed", hasBeenActive: false }) === "blocked",
    "closed with no gesture is blocked",
  );
  ok(
    audioGateAction({ contextState: "running", hasBeenActive: true }) === "play",
    "a running context just plays",
  );
  ok(
    audioGateAction({ contextState: "running", hasBeenActive: false }) === "play",
    "already running beats the activation flag — never re-block ourselves",
  );

  // ── The unlock hint ─────────────────────────────────────────────────────
  ok(
    shouldShowUnlockHint({ muted: false, hasBeenActive: false }),
    "hint shows when sound is wanted but audio is locked",
  );
  ok(
    !shouldShowUnlockHint({ muted: false, hasBeenActive: true }),
    "hint hides once the browser has been activated",
  );
  ok(
    !shouldShowUnlockHint({ muted: true, hasBeenActive: false }),
    "no hint when the staffer chose silence",
  );
  ok(
    !shouldShowUnlockHint({ muted: true, hasBeenActive: true }),
    "no hint when muted and activated",
  );

  // ── Poll cadence vs Chrome's background throttling ──────────────────────
  ok(pollIntervalMs(true) === VISIBLE_POLL_MS, "a visible tab polls fast");
  ok(pollIntervalMs(false) === HIDDEN_POLL_MS, "a hidden tab backs off");
  ok(HIDDEN_POLL_MS > VISIBLE_POLL_MS, "backing off means slower, never faster");

  console.log(`new-order-watch-core: ${pass} assertions passed`);
  if (fail > 0) throw new Error(`new-order-watch-core: ${fail} failure(s)`);
}
