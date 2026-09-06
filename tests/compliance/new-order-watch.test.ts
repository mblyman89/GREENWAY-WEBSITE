/**
 * tests/compliance/new-order-watch.test.ts
 *
 * SLICE 22 — the online-order chime.
 *
 * The owner reported, verbatim: "I can test the sound to confirm it works, but
 * it does not make noise when I complete an online order. Is this a bug or is
 * it because I am placing the order on the same computer the back office is
 * open on?"
 *
 * It was a bug — three stacked bugs — and the same-computer theory was wrong:
 * the dashboard learns about orders over a SERVER round trip, so the browser
 * that placed the order is irrelevant. These tests pin all three fixes so they
 * cannot silently regress.
 *
 * NEVER GUESS the contracts under test:
 *
 *  1. ARRIVALS, NOT LEVELS. The old code watched `counts.new`, the number of
 *     orders currently in status "new". That is a level and staff pull it down
 *     by acknowledging. We now watch `orders.placed_at`, which the database
 *     writes at INSERT (0007_slice7_orders.sql:90) and which no status change
 *     ever touches. The water mark must therefore be immune to acknowledge,
 *     complete, cancel and refund.
 *  2. THE AUTOPLAY GATE. Chrome creates an AudioContext "suspended" when there
 *     was no user gesture (developer.chrome.com/blog/autoplay, Web Audio), so a
 *     context built inside a setInterval callback never sounds. The gate must
 *     resume an existing context rather than rebuild a throwaway one, and must
 *     never re-block a context that is already running.
 *  3. BACKGROUND THROTTLING. Chrome 88+ checks hidden-tab timers "once per
 *     minute" (developer.chrome.com/blog/timer-throttling-in-chrome-88), so a
 *     hidden tab must back OFF (and the component polls on visibilitychange to
 *     cover the gap) — never poll faster when hidden.
 *
 * Every assertion below is a behaviour the owner would notice in the store.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_CHIME_VOLUME,
  EMPTY_WATCH_STATE,
  HIDDEN_POLL_MS,
  MIN_CHIME_VOLUME,
  SEEN_ID_CAP,
  VISIBLE_POLL_MS,
  audioGateAction,
  bannerText,
  decideWatch,
  isIsoInstant,
  maxIso,
  normalizeVolume,
  pollIntervalMs,
  shouldShowUnlockHint,
  sortArrivals,
  type OrderArrival,
  type WatchState,
} from "@/lib/orders/new-order-watch-core";

// ── Fixtures ───────────────────────────────────────────────────────────────
const T0 = "2026-09-06T17:00:00.000Z";
const T1 = "2026-09-06T17:05:00.000Z";
const T2 = "2026-09-06T17:10:00.000Z";
const T3 = "2026-09-06T17:15:00.000Z";

function arrival(id: string, placedAt: string, label = id): OrderArrival {
  return { id, placedAt, label };
}

/** Convenience: run a poll and return the decision. */
function poll(state: WatchState, arrivals: OrderArrival[], muted = false) {
  return decideWatch(state, arrivals, { muted });
}

describe("new-order chime — arrivals, not levels", () => {
  it("the first poll establishes the mark and stays silent", () => {
    // On mount we cannot know what the staffer already saw on the
    // server-rendered page. Chiming here would fire on every navigation.
    const d = poll(EMPTY_WATCH_STATE, [arrival("o1", T0)]);
    expect(d.shouldChime).toBe(false);
    expect(d.fresh).toHaveLength(0);
    expect(d.next.seenThroughIso).toBe(T0);
  });

  it("an empty first poll leaves the mark unset so the next order still counts", () => {
    const first = poll(EMPTY_WATCH_STATE, []);
    expect(first.next.seenThroughIso).toBeNull();

    // A store that opens with zero orders must still chime on order #1. If the
    // empty poll had planted a mark of "now", this would be silent.
    const second = poll(first.next, [arrival("o1", T0)]);
    expect(second.shouldChime).toBe(false); // still the establishing poll
    const third = poll(second.next, [arrival("o1", T0), arrival("o2", T1)]);
    expect(third.shouldChime).toBe(true);
  });

  it("a genuinely newer order chimes exactly once", () => {
    const state: WatchState = { seenThroughIso: T0, seenIds: ["o1"] };
    const d = poll(state, [arrival("o1", T0), arrival("o2", T1)]);
    expect(d.shouldChime).toBe(true);
    expect(d.fresh.map((a) => a.id)).toEqual(["o2"]);
    expect(d.next.seenThroughIso).toBe(T1);

    // Re-polling the identical payload must not chime again.
    const repeat = poll(d.next, [arrival("o1", T0), arrival("o2", T1)]);
    expect(repeat.shouldChime).toBe(false);
    expect(repeat.fresh).toHaveLength(0);
  });

  it("THE REPORTED BUG: an order placed after staff acknowledge still chimes", () => {
    // This is the exact sequence that used to be silent. Old logic:
    //   counts.new goes 0 -> 1 (order A), staff ack -> 0, order B -> 1.
    //   diff never exceeded its previous value, so no chime.
    // placed_at cannot be dragged down by a status change, so B now chimes.
    let state = poll(EMPTY_WATCH_STATE, [arrival("A", T0)]).next;

    // Staff acknowledge A. It leaves the "new" bucket entirely, so the
    // arrivals feed keeps reporting it (placed_at is unchanged) — but the old
    // level-based counter would have dropped to zero here.
    const afterAck = poll(state, [arrival("A", T0)]);
    expect(afterAck.shouldChime).toBe(false);
    state = afterAck.next;

    const orderB = poll(state, [arrival("A", T0), arrival("B", T1)]);
    expect(orderB.shouldChime).toBe(true);
    expect(orderB.fresh.map((a) => a.id)).toEqual(["B"]);
  });

  it("survives a long ack/arrive/ack/arrive shift without ever going deaf", () => {
    // A busy Saturday: staff clear the queue between every order. The old code
    // degraded to permanent silence; this must chime on every single arrival.
    let state = poll(EMPTY_WATCH_STATE, [arrival("seed", T0)]).next;
    const stamps = [T1, T2, T3];
    let chimes = 0;

    stamps.forEach((ts, i) => {
      // Only the newest order is still "new"; older ones were acknowledged and
      // would have vanished from a level-based count.
      const d = poll(state, [arrival(`o${i}`, ts)]);
      if (d.shouldChime) chimes += 1;
      state = d.next;
    });

    expect(chimes).toBe(stamps.length);
  });

  it("a burst between polls chimes once but reports every order", () => {
    const state: WatchState = { seenThroughIso: T0, seenIds: [] };
    // Deliberately out of order, as a newest-first API response would be.
    const d = poll(state, [arrival("c", T3), arrival("a", T1), arrival("b", T2)]);
    expect(d.shouldChime).toBe(true);
    expect(d.fresh.map((a) => a.id)).toEqual(["a", "b", "c"]); // oldest first
    expect(d.next.seenThroughIso).toBe(T3);
  });

  it("the water mark never rewinds on a late or out-of-order response", () => {
    // Two polls in flight; the slower one returns stale data afterwards.
    const state: WatchState = { seenThroughIso: T3, seenIds: [] };
    const late = poll(state, [arrival("old", T0)]);
    expect(late.next.seenThroughIso).toBe(T3);
    expect(late.shouldChime).toBe(false);
  });

  it("an order sitting exactly AT the water mark is never re-announced", () => {
    // Found by mutation testing: swapping `>` for `>=` survived the suite.
    // It is not theoretical. The id memory is capped (SEEN_ID_CAP), so on a
    // busy day the id of the order that SET the mark can be evicted while the
    // mark itself persists — leaving an arrival whose timestamp equals the
    // mark and whose id is no longer remembered. Under `>=` that order would
    // be announced again on every single poll, chiming forever.
    const state: WatchState = { seenThroughIso: T1, seenIds: [] };
    const d = poll(state, [arrival("at-the-mark", T1)]);
    expect(d.fresh).toHaveLength(0);
    expect(d.shouldChime).toBe(false);
    expect(d.next.seenThroughIso).toBe(T1);
  });

  it("does not chime forever when the mark's own id has aged out", () => {
    // The same defect, played out over repeated polls: the boundary order must
    // stay silent every time, not just once.
    let state: WatchState = { seenThroughIso: T2, seenIds: [] };
    let chimes = 0;
    for (let i = 0; i < 5; i += 1) {
      const d = poll(state, [arrival("boundary", T2)]);
      if (d.shouldChime) chimes += 1;
      state = d.next;
    }
    expect(chimes).toBe(0);
  });

  it("a boundary order stays silent while a genuinely newer one still chimes", () => {
    // Guards the fix from over-correcting into silence.
    const state: WatchState = { seenThroughIso: T1, seenIds: [] };
    const d = poll(state, [arrival("at-mark", T1), arrival("newer", T2)]);
    expect(d.fresh.map((a) => a.id)).toEqual(["newer"]);
    expect(d.shouldChime).toBe(true);
  });

  it("an id already counted can never chime a second time", () => {
    // Belt and braces alongside the timestamp: if the same order somehow
    // reappears with a newer stamp, the id memory still suppresses it.
    const state: WatchState = { seenThroughIso: T0, seenIds: ["dupe"] };
    const d = poll(state, [arrival("dupe", T3)]);
    expect(d.shouldChime).toBe(false);
    expect(d.fresh).toHaveLength(0);
  });

  it("muted tracks state silently, so un-muting replays no backlog", () => {
    const state: WatchState = { seenThroughIso: T0, seenIds: [] };
    const whileMuted = poll(state, [arrival("o2", T1)], true);
    expect(whileMuted.shouldChime).toBe(false);
    // The banner still needs to know, even when the sound is off.
    expect(whileMuted.fresh).toHaveLength(1);
    expect(whileMuted.next.seenThroughIso).toBe(T1);

    const afterUnmute = poll(whileMuted.next, [arrival("o2", T1)], false);
    expect(afterUnmute.shouldChime).toBe(false);
  });

  it("orders arriving at the same millisecond are ordered deterministically", () => {
    const sorted = sortArrivals([arrival("b", T1), arrival("a", T1)]);
    expect(sorted.map((a) => a.id)).toEqual(["a", "b"]);
  });

  it("two orders sharing an instant are both announced", () => {
    // A tie at the water mark must not swallow either one.
    const state: WatchState = { seenThroughIso: T0, seenIds: [] };
    const d = poll(state, [arrival("x", T1), arrival("y", T1)]);
    expect(d.fresh).toHaveLength(2);
    expect(d.shouldChime).toBe(true);
  });

  it("malformed payloads are ignored instead of crashing the dashboard", () => {
    const state: WatchState = { seenThroughIso: T0, seenIds: [] };
    const junk = [
      { id: "", placedAt: T1, label: "" },
      { id: "bad-date", placedAt: "not-a-date", label: "x" },
      arrival("good", T1),
    ] as OrderArrival[];
    const d = poll(state, junk);
    expect(d.fresh.map((a) => a.id)).toEqual(["good"]);

    expect(poll(state, null as unknown as OrderArrival[]).fresh).toHaveLength(0);
    expect(poll(state, undefined as unknown as OrderArrival[]).shouldChime).toBe(false);
  });

  it("the seen-id memory stays bounded on a very busy day", () => {
    const many = Array.from({ length: SEEN_ID_CAP + 75 }, (_, i) =>
      arrival(`x${i}`, new Date(Date.parse(T0) + (i + 1) * 1000).toISOString()),
    );
    const d = poll({ seenThroughIso: T0, seenIds: [] }, many);
    expect(d.fresh).toHaveLength(SEEN_ID_CAP + 75);
    expect(d.next.seenIds).toHaveLength(SEEN_ID_CAP);
    // The cap keeps the NEWEST ids — the ones a duplicate poll might repeat.
    expect(d.next.seenIds.at(-1)).toBe(`x${SEEN_ID_CAP + 74}`);
  });

  it("never mutates the state or payload it was handed", () => {
    const state: WatchState = { seenThroughIso: T0, seenIds: ["keep"] };
    const arrivals = [arrival("b", T2), arrival("a", T1)];
    const snapshotIds = [...state.seenIds];
    const snapshotOrder = arrivals.map((a) => a.id);

    poll(state, arrivals);

    expect(state.seenIds).toEqual(snapshotIds);
    expect(state.seenThroughIso).toBe(T0);
    expect(arrivals.map((a) => a.id)).toEqual(snapshotOrder);
  });
});

describe("iso helpers", () => {
  it("accepts real instants and rejects everything else", () => {
    expect(isIsoInstant(T0)).toBe(true);
    expect(isIsoInstant("")).toBe(false);
    expect(isIsoInstant("   ")).toBe(false);
    expect(isIsoInstant(null)).toBe(false);
    expect(isIsoInstant(undefined)).toBe(false);
    expect(isIsoInstant(1234567890)).toBe(false);
    expect(isIsoInstant("tomorrow")).toBe(false);
  });

  it("maxIso picks the newer and tolerates nulls", () => {
    expect(maxIso(T0, T2)).toBe(T2);
    expect(maxIso(T2, T0)).toBe(T2);
    expect(maxIso(T2, T2)).toBe(T2);
    expect(maxIso(null, T0)).toBe(T0);
    expect(maxIso(T0, null)).toBe(T0);
    expect(maxIso(null, null)).toBeNull();
    expect(maxIso("junk", T0)).toBe(T0);
  });
});

describe("the autoplay gate — why 'Test sound' worked but real orders did not", () => {
  it("resumes a suspended context instead of rebuilding a throwaway one", () => {
    // THE BUG: the old chime() did `new AudioContext()` on every call. Inside a
    // setInterval there is no user gesture, so Chrome creates it suspended and
    // the notes are scheduled against a clock that never runs. Nothing is
    // heard, and nothing throws.
    expect(audioGateAction({ contextState: "suspended", hasBeenActive: true })).toBe("resume");
  });

  it("treats an interrupted context (iOS backgrounding) as resumable", () => {
    expect(audioGateAction({ contextState: "interrupted", hasBeenActive: true })).toBe("resume");
  });

  it("creates the shared context on first use once the page has been clicked", () => {
    expect(audioGateAction({ contextState: null, hasBeenActive: true })).toBe("create");
  });

  it("rebuilds a closed context", () => {
    expect(audioGateAction({ contextState: "closed", hasBeenActive: true })).toBe("recreate");
  });

  it("plays straight through when the context is already running", () => {
    expect(audioGateAction({ contextState: "running", hasBeenActive: true })).toBe("play");
  });

  it("never re-blocks a context that is already running", () => {
    // Once the browser has let us in, later activation bookkeeping is
    // irrelevant. Blocking here would mute a working chime.
    expect(audioGateAction({ contextState: "running", hasBeenActive: false })).toBe("play");
  });

  it("reports blocked — rather than failing silently — before any gesture", () => {
    // Silent failure is what made this so hard to diagnose. Every non-running
    // state without activation must surface as "blocked" so the UI can say so.
    for (const state of [null, "suspended", "interrupted", "closed"] as const) {
      expect(audioGateAction({ contextState: state, hasBeenActive: false })).toBe("blocked");
    }
  });
});

describe("the unlock hint", () => {
  it("shows only when sound is wanted and audio is genuinely locked", () => {
    expect(shouldShowUnlockHint({ muted: false, hasBeenActive: false })).toBe(true);
    expect(shouldShowUnlockHint({ muted: false, hasBeenActive: true })).toBe(false);
    expect(shouldShowUnlockHint({ muted: true, hasBeenActive: false })).toBe(false);
    expect(shouldShowUnlockHint({ muted: true, hasBeenActive: true })).toBe(false);
  });
});

describe("poll cadence vs Chrome's background throttling", () => {
  it("a visible tab polls on the fast cadence", () => {
    expect(pollIntervalMs(true)).toBe(VISIBLE_POLL_MS);
  });

  it("a hidden tab backs off rather than fighting the throttler", () => {
    expect(pollIntervalMs(false)).toBe(HIDDEN_POLL_MS);
    expect(HIDDEN_POLL_MS).toBeGreaterThan(VISIBLE_POLL_MS);
  });

  it("the visible cadence is fast enough to feel immediate at the counter", () => {
    expect(VISIBLE_POLL_MS).toBeLessThanOrEqual(15000);
  });
});

describe("volume", () => {
  it("a stored zero falls back to the default instead of silent failure", () => {
    // A 0 in localStorage would look exactly like the bug we are fixing: the
    // owner believes sound is on, and hears nothing.
    expect(normalizeVolume(0)).toBe(DEFAULT_CHIME_VOLUME);
    expect(normalizeVolume("0")).toBe(DEFAULT_CHIME_VOLUME);
  });

  it("garbage and out-of-range values are made safe", () => {
    expect(normalizeVolume(-1)).toBe(DEFAULT_CHIME_VOLUME);
    expect(normalizeVolume("junk")).toBe(DEFAULT_CHIME_VOLUME);
    expect(normalizeVolume(null)).toBe(DEFAULT_CHIME_VOLUME);
    expect(normalizeVolume(undefined)).toBe(DEFAULT_CHIME_VOLUME);
    expect(normalizeVolume(NaN)).toBe(DEFAULT_CHIME_VOLUME);
    expect(normalizeVolume(Infinity)).toBe(DEFAULT_CHIME_VOLUME);
    expect(normalizeVolume(2)).toBe(1);
  });

  it("keeps a good value, including the slider's floor", () => {
    expect(normalizeVolume(0.4)).toBe(0.4);
    expect(normalizeVolume(1)).toBe(1);
    expect(normalizeVolume(MIN_CHIME_VOLUME)).toBe(MIN_CHIME_VOLUME);
    expect(normalizeVolume(String(DEFAULT_CHIME_VOLUME))).toBe(DEFAULT_CHIME_VOLUME);
  });

  it("the default sits inside the slider's own range", () => {
    expect(DEFAULT_CHIME_VOLUME).toBeGreaterThanOrEqual(MIN_CHIME_VOLUME);
    expect(DEFAULT_CHIME_VOLUME).toBeLessThanOrEqual(1);
  });
});

describe("banner copy", () => {
  it("reads correctly in the singular and plural", () => {
    expect(bannerText(1)).toBe("1 new order — tap to refresh");
    expect(bannerText(2)).toBe("2 new orders — tap to refresh");
    expect(bannerText(12)).toBe("12 new orders — tap to refresh");
  });

  it("says nothing when there is nothing to say", () => {
    expect(bannerText(0)).toBe("");
    expect(bannerText(-3)).toBe("");
  });
});
