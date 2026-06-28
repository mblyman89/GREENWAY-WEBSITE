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
const VOL_KEY = "gw_orders_volume";
const ARMED_KEY = "gw_orders_sound_armed";

/** Play a two-note chime at the given peak gain (0..1). */
function chime(volume = 0.25) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const peak = Math.max(0.02, Math.min(1, volume));
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
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
  const [volume, setVolume] = useState(0.25);
  // "armed" = the staffer has interacted (test sound) so the browser will let
  // the chime play. We show a one-time hint until they do.
  const [armed, setArmed] = useState(true);

  useEffect(() => {
    setMuted(localStorage.getItem(MUTE_KEY) === "1");
    const v = Number(localStorage.getItem(VOL_KEY));
    if (!Number.isNaN(v) && v > 0) setVolume(v);
    setArmed(localStorage.getItem(ARMED_KEY) === "1");
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
            if (diff > prev && !muted) chime(volume);
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
  }, [muted, volume]);

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStorage.setItem(MUTE_KEY, next ? "1" : "0");
  }

  function testSound() {
    chime(volume);
    if (!armed) {
      setArmed(true);
      localStorage.setItem(ARMED_KEY, "1");
    }
  }

  function changeVolume(v: number) {
    setVolume(v);
    localStorage.setItem(VOL_KEY, String(v));
  }

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
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

        <div className="flex items-center gap-2">
          {/* Volume slider (only meaningful when not muted) */}
          {!muted && (
            <label className="flex items-center gap-1.5 text-[11px] text-white/40" title="Chime volume">
              <span>🔈</span>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                className="h-1 w-20 cursor-pointer accent-[#7ed957]"
                aria-label="New-order chime volume"
              />
            </label>
          )}
          <button
            onClick={testSound}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 transition hover:border-[#7ed957] hover:text-white"
            title="Play a test chime (also enables sound for this browser)"
          >
            ▶ Test sound
          </button>
          <button
            onClick={toggleMute}
            className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 transition hover:border-white/30 hover:text-white"
            title={muted ? "Sound off — click to enable the new-order chime" : "Sound on — click to mute"}
          >
            {muted ? "🔇 Sound off" : "🔔 Sound on"}
          </button>
        </div>
      </div>

      {/* One-time hint: browsers block audio until the page is interacted with. */}
      {!muted && !armed && (
        <p className="rounded-lg border border-[#ffd700]/20 bg-[#ffd700]/5 px-3 py-1.5 text-[11px] text-[#ffd700]">
          Tip: click <strong>▶ Test sound</strong> once so your browser allows the new-order chime to
          play automatically while you work.
        </p>
      )}
    </div>
  );
}
