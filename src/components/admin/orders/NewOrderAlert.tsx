"use client";

/**
 * src/components/admin/orders/NewOrderAlert.tsx
 *
 * The Orders dashboard's "a new order just came in" watcher: a banner plus a
 * chime.
 *
 * SLICE 22 — REWRITTEN. The owner reported, verbatim:
 *
 *   "the online orders dashboard in the back office has a feature that makes a
 *    noise when an online order is placed. I can test the sound to confirm it
 *    works, but it does not make noise when I complete an online order. Is this
 *    a bug or is it because I am placing the order on the same computer the
 *    back office is open on? Or something else?"
 *
 * It is a bug — three of them, stacked — and the same-computer theory is not
 * the cause. The dashboard learns about orders through a SERVER round trip
 * (/api/admin/orders/count), so which browser placed the order is irrelevant.
 *
 *   BUG 1 — WE WATCHED A LEVEL, NOT ARRIVALS.
 *     The old code did `const diff = data.counts.new - baseline.current` and
 *     chimed only when `diff > prev`. `counts.new` is how many orders are
 *     CURRENTLY sitting in status "new". Acknowledging an order lowers it, so
 *     "place one, acknowledge it, place another" left the arithmetic exactly
 *     where it started and the second order arrived in silence — the busier
 *     the store, the more reliably it failed. `baseline` was also captured by
 *     useRef at first render and never reassigned, so router.refresh() drifted
 *     it further. Fixed by watching `orders.placed_at`, which the DATABASE
 *     assigns at insert (0007_slice7_orders.sql:90) and no status change ever
 *     touches: a high-water mark that can only move forward. The rules live in
 *     new-order-watch-core.ts and are unit-tested there.
 *
 *   BUG 2 — THE BROWSER WAS SWALLOWING THE SOUND. This is the one that
 *     explains "test works, real orders do not".
 *     Chrome's autoplay policy has covered Web Audio since Chrome 71:
 *     "If an AudioContext is created before the document receives a user
 *      gesture, it will be created in the 'suspended' state, and you will need
 *      to call resume() after the user gesture."
 *     (developer.chrome.com/blog/autoplay). The old chime() built a NEW
 *     AudioContext on every call and closed it 1.2s later. Inside the "Test
 *     sound" click handler that context is born during a gesture and plays
 *     perfectly. Inside a setInterval callback there is no gesture, so the
 *     context is born SUSPENDED, the notes are scheduled against a clock that
 *     never advances, and the context is closed before anything is heard —
 *     with no exception thrown, so the old try/catch could not reveal it.
 *     Fixed by keeping ONE shared AudioContext and resume()-ing it, and by
 *     reading real sticky activation from navigator.userActivation instead of
 *     trusting a localStorage flag that cannot survive a page load.
 *
 *   BUG 3 — A BACKGROUND TAB WAS THROTTLED TO A CRAWL.
 *     Chrome 88+ checks chained timers in a hidden tab "once per minute"
 *     (developer.chrome.com/blog/timer-throttling-in-chrome-88), so the 15s
 *     poll silently became ~60s on the second monitor. We now poll on
 *     visibilitychange so returning to the tab is instant, and we stop
 *     pretending a hidden tab polls quickly.
 *
 * Also fixed while here: the poll effect depended on [muted, volume], so every
 * nudge of the volume slider tore down and rebuilt the interval, resetting the
 * countdown to the next poll. Live values now travel through refs and the
 * interval is created once.
 *
 * Purely additive and fail-quiet: if polling fails (offline, permissions) the
 * component simply shows nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/admin/ui";
import {
  DEFAULT_CHIME_VOLUME,
  EMPTY_WATCH_STATE,
  MIN_CHIME_VOLUME,
  audioGateAction,
  bannerText,
  decideWatch,
  normalizeVolume,
  pollIntervalMs,
  shouldAutoRefresh,
  shouldShowUnlockHint,
  type OrderArrival,
  type WatchState,
} from "@/lib/orders/new-order-watch-core";

const MUTE_KEY = "gw_orders_muted";
const VOL_KEY = "gw_orders_volume";

type CountPayload = {
  counts?: { new?: number };
  arrivals?: OrderArrival[];
  /** SLICE L-37 — moves whenever any order changes anywhere. */
  fingerprint?: string;
};

/**
 * SLICE L-37 — is the operator typing into something on this page? A refresh
 * must never eat a half-written note, search or override reason.
 */
function userIsEditing(): boolean {
  try {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  } catch {
    return false;
  }
}

/** Does this window have sticky user activation? Conservative when unknown. */
function hasStickyActivation(): boolean {
  try {
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive?: boolean } })
      .userActivation;
    // Older browsers do not expose userActivation. Rather than block audio on
    // them forever, treat "API missing" as activated and let the play attempt
    // decide — those browsers predate the strict Web Audio gate anyway.
    if (!ua || typeof ua.hasBeenActive !== "boolean") return true;
    return ua.hasBeenActive;
  } catch {
    return true;
  }
}

export function NewOrderAlert() {
  const router = useRouter();

  const [pending, setPending] = useState<OrderArrival[]>([]);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(DEFAULT_CHIME_VOLUME);
  const [audioUnlocked, setAudioUnlocked] = useState(true);

  // Live values for the poll loop. Reading these from refs is what lets the
  // interval be created exactly once (see BUG 3 note above) — changing the
  // volume must not restart the poll timer. Mirrored in an effect rather than
  // during render, because writing a ref while rendering is unsafe under
  // concurrent React (react-hooks/refs).
  const watch = useRef<WatchState>(EMPTY_WATCH_STATE);
  const fingerprintRef = useRef<string | null>(null);
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  // ONE shared AudioContext for the life of the page. A throwaway context per
  // chime is what BUG 2 was.
  const audioRef = useRef<AudioContext | null>(null);

  /**
   * Sound the chime through the shared context, resuming it if the browser
   * parked it. Returns nothing and never throws — audio must never be able to
   * break the dashboard.
   */
  const playChime = useCallback((vol: number) => {
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;

      const existing = audioRef.current;
      const action = audioGateAction({
        contextState: existing ? existing.state : null,
        hasBeenActive: hasStickyActivation(),
      });

      if (action === "blocked") {
        // Tell the truth in the UI instead of failing silently, which is what
        // made this bug so hard for the owner to pin down.
        setAudioUnlocked(false);
        return;
      }

      let ctx = existing;
      if (action === "create" || action === "recreate" || !ctx) {
        ctx = new Ctx();
        audioRef.current = ctx;
      }

      const emit = (target: AudioContext) => {
        const now = target.currentTime;
        const peak = Math.max(0.02, Math.min(1, vol));
        [880, 1320].forEach((freq, i) => {
          const osc = target.createOscillator();
          const gain = target.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          const start = now + i * 0.18;
          gain.gain.setValueAtTime(0.0001, start);
          gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
          osc.connect(gain);
          gain.connect(target.destination);
          osc.start(start);
          osc.stop(start + 0.4);
        });
        // Deliberately NOT closed — the context is reused. Closing it is what
        // forced a new (suspended) context on every chime.
      };

      if (ctx.state === "running") {
        emit(ctx);
        return;
      }

      const target = ctx;
      void target
        .resume()
        .then(() => {
          setAudioUnlocked(true);
          emit(target);
        })
        .catch(() => {
          setAudioUnlocked(false);
        });
    } catch {
      /* audio unavailable — the banner still does its job */
    }
  }, []);

  // Hydrate saved sound preferences. Deferred to a microtask so the effect body
  // never sets state synchronously (react-hooks/set-state-in-effect) — same
  // pattern as CartProvider hydration.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        setMuted(localStorage.getItem(MUTE_KEY) === "1");
        setVolume(normalizeVolume(localStorage.getItem(VOL_KEY)));
      } catch {
        /* private mode / storage disabled — defaults are fine */
      }
      // Sticky activation belongs to THIS page load, so it is read live rather
      // than remembered. A stale localStorage flag claiming "armed" was part of
      // why the failure looked random.
      setAudioUnlocked(hasStickyActivation());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Any genuine click/keypress anywhere unlocks audio for the session. Once we
  // know we are unlocked we stop listening.
  useEffect(() => {
    if (audioUnlocked) return;
    const onGesture = () => {
      if (hasStickyActivation()) setAudioUnlocked(true);
    };
    window.addEventListener("pointerdown", onGesture, { passive: true });
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [audioUnlocked]);

  // The poll loop. Created ONCE (empty deps) — live prefs come from refs.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const res = await fetch("/api/admin/orders/count", { cache: "no-store" });
        if (!res.ok || !active) return;
        const data = (await res.json()) as CountPayload;
        if (!active) return;

        const arrivals = Array.isArray(data.arrivals) ? data.arrivals : [];
        const decision = decideWatch(watch.current, arrivals, { muted: mutedRef.current });
        watch.current = decision.next;

        if (decision.fresh.length > 0) {
          setPending((prev) => [...prev, ...decision.fresh]);
        }
        if (decision.shouldChime) {
          playChime(volumeRef.current);
        }

        // SLICE L-37 — something changed elsewhere (a register pressed
        // Confirm / Mark ready, a sale completed and picked the order up, a
        // Leafly webhook landed): re-render the board so it never shows a
        // stale step. Skipped while the operator is typing; the fingerprint
        // is then NOT advanced, so the refresh happens on the next quiet poll.
        const fp = typeof data.fingerprint === "string" ? data.fingerprint : null;
        if (fp !== null) {
          if (shouldAutoRefresh({ previous: fingerprintRef.current, current: fp, userIsEditing: userIsEditing() })) {
            fingerprintRef.current = fp;
            router.refresh();
          } else if (fingerprintRef.current === null || !userIsEditing()) {
            fingerprintRef.current = fp;
          }
        }
      } catch {
        /* offline or blocked — try again next tick */
      }
    };

    const schedule = () => {
      if (timer) clearInterval(timer);
      const visible = typeof document === "undefined" || document.visibilityState === "visible";
      timer = setInterval(poll, pollIntervalMs(visible));
    };

    // Establish the water mark immediately rather than waiting a full interval,
    // so an order placed 3 seconds after the page loads is still caught.
    void poll();
    schedule();

    const onVisibility = () => {
      // Chrome throttles hidden-tab timers to roughly once a minute, so coming
      // back to the tab polls right away instead of waiting one out.
      if (document.visibilityState === "visible") void poll();
      schedule();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [playChime, router]);

  // Close the shared AudioContext only when the component really goes away.
  useEffect(() => {
    return () => {
      const ctx = audioRef.current;
      audioRef.current = null;
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
    };
  }, []);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    try {
      localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    } catch {
      /* storage disabled */
    }
  }

  function testSound() {
    // Inside a click handler, so this is the moment the browser will let us
    // create/resume the shared context for the rest of the session.
    playChime(volume);
    if (hasStickyActivation()) setAudioUnlocked(true);
  }

  function changeVolume(v: number) {
    const next = normalizeVolume(v);
    setVolume(next);
    try {
      localStorage.setItem(VOL_KEY, String(next));
    } catch {
      /* storage disabled */
    }
  }

  function refreshNow() {
    setPending([]);
    router.refresh();
  }

  const count = pending.length;
  const showHint = shouldShowUnlockHint({ muted, hasBeenActive: audioUnlocked });
  // Newest few labels, so staff can see WHICH orders landed without refreshing.
  const names = pending.slice(-3).map((a) => a.label).filter(Boolean);

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {count > 0 ? (
            <Button
              type="button"
              onClick={refreshNow}
              variant="primary"
              className="animate-pulse gap-2"
            >
              🔔 {bannerText(count)}
            </Button>
          ) : (
            <span className="inline-flex items-center gap-2 text-xs text-white/40">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--admin-accent)]" />
              Watching for new orders and register updates…
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Volume slider (only meaningful when not muted) */}
          {!muted && (
            <label
              className="flex items-center gap-1.5 text-[11px] text-white/40"
              title="Chime volume"
            >
              <span>🔈</span>
              <input
                type="range"
                min={MIN_CHIME_VOLUME}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                className="h-1 w-20 cursor-pointer accent-[var(--admin-accent)]"
                aria-label="New-order chime volume"
              />
            </label>
          )}
          <Button
            type="button"
            onClick={testSound}
            variant="neutral"
            size="sm"
            title="Play a test chime (also enables sound for this browser)"
          >
            ▶ Test sound
          </Button>
          <Button
            type="button"
            onClick={toggleMute}
            variant="neutral"
            size="sm"
            title={muted ? "Sound off — click to enable the new-order chime" : "Sound on — click to mute"}
          >
            {muted ? "🔇 Sound off" : "🔔 Sound on"}
          </Button>
        </div>
      </div>

      {/* Which orders arrived, so the banner is informative and not just a count. */}
      {count > 0 && names.length > 0 && (
        <p className="text-[11px] text-white/50">
          Just in: {names.join(", ")}
          {count > names.length ? ` and ${count - names.length} more` : ""}
        </p>
      )}

      {/* Browsers block audio until the page has been clicked. Read live from
          navigator.userActivation, so this is the truth for THIS page load. */}
      {showHint && (
        <p className="rounded-lg border border-[var(--admin-gold)]/20 bg-[var(--admin-gold)]/5 px-3 py-1.5 text-[11px] text-[var(--admin-gold)]">
          Tip: click <strong>▶ Test sound</strong> once so your browser allows the new-order chime to
          play automatically while you work.
        </p>
      )}
    </div>
  );
}
