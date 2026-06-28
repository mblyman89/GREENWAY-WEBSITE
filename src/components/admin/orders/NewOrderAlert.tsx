"use client";

/**
 * src/components/admin/orders/NewOrderAlert.tsx
 *
 * Polls the staff-only /api/admin/orders/count endpoint every 15s. When the
 * number of NEW orders rises above what was on screen when the page loaded, it
 * shows a friendly "🔔 N new order(s)" banner with a Refresh button and plays a
 * short chime (WebAudio — no asset file, and only after the staffer has
 * interacted so browsers allow it). Sound can be muted; the choice is
 * remembered in localStorage.
 *
 * Purely additive: if polling fails (offline, perms), it silently does nothing.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 15000;
const MUTE_KEY = "gw_orders_muted";

function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch {
    /* audio not available — ignore */
  }
}

export function NewOrderAlert({ initialNew }: { initialNew: number }) {
  const router = useRouter();
  const baseline = useRef(initialNew);
  const [extra, setExtra] = useState(0);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setMuted(localStorage.getItem(MUTE_KEY) === "1");
  }, []);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/admin/orders/count", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { counts: { new: number } };
        if (!active) return;
        const diff = data.counts.new - baseline.current;
        if (diff > 0) {
          setExtra((prev) => {
            if (diff > prev && !muted) chime();
            return diff;
          });
        }
      } catch {
        /* ignore network errors */
      }
    };
    const id = setInterval(poll, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [muted]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div>
        {extra > 0 ? (
          <button
            onClick={() => router.refresh()}
            className="inline-flex animate-pulse items-center gap-2 rounded-full border border-[#ff7f00]/60 bg-[#ff7f00]/15 px-4 py-2 text-sm font-bold text-[#ff7f00] transition hover:bg-[#ff7f00]/25"
          >
            🔔 {extra} new order{extra === 1 ? "" : "s"} — tap to refresh
          </button>
        ) : (
          <span className="inline-flex items-center gap-2 text-xs text-white/40">
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#7ed957]" />
            Watching for new orders…
          </span>
        )}
      </div>
      <button
        onClick={toggleMute}
        className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 transition hover:border-white/30 hover:text-white"
        title={muted ? "Sound off — click to enable the new-order chime" : "Sound on — click to mute"}
      >
        {muted ? "🔇 Sound off" : "🔔 Sound on"}
      </button>
    </div>
  );
}
