"use client";

/**
 * VideoSettings — FLUX 3 video controls (R62). Only fields the verified API
 * accepts for the chosen mode are shown: aspect ratio, duration (auto or
 * 5–20 s; 5–15 s when continuing a video), resolution (HD native, or Full
 * HD / QHD / 4K via BFL's upsampler), audio, draft mode and safety 0–5. Edit
 * and upscale have their own (server-pinned) controls.
 */
import { FLUX_SAFETY_MAX } from "@/lib/marketing/flux-core";
import {
  FLUX_V2V_MAX_SECONDS,
  FLUX_VIDEO_ASPECTS,
  FLUX_VIDEO_MAX_SECONDS,
  FLUX_VIDEO_MIN_SECONDS,
  FLUX_VIDEO_RESOLUTIONS,
  type FluxVideoMode,
} from "@/lib/marketing/flux-video-core";

export type VideoUiSettings = {
  mode: FluxVideoMode;
  aspect: string;
  duration: "auto" | number;
  resolution: string;
  audio: boolean;
  draft: boolean;
  safety: number;
  timedKeyframes: boolean;
  creativity: 0 | 1;
  upscaleFactor: number;
};

export const DEFAULT_VIDEO_SETTINGS: VideoUiSettings = {
  mode: "t2v",
  aspect: "16:9",
  duration: "auto",
  resolution: "hd",
  audio: true,
  draft: true,
  safety: 2,
  timedKeyframes: false,
  creativity: 1,
  upscaleFactor: 2,
};

/** Quick-start formats: one click sets aspect + duration for common uses. */
export const VIDEO_FORMATS: { id: string; label: string; aspect: string; duration: "auto" | number }[] = [
  { id: "reel", label: "Reel / TikTok / Short", aspect: "9:16", duration: 10 },
  { id: "story", label: "Story (5 s)", aspect: "9:16", duration: 5 },
  { id: "feed", label: "Square feed post", aspect: "1:1", duration: 8 },
  { id: "landscape", label: "YouTube / web 16:9", aspect: "16:9", duration: 10 },
  { id: "banner", label: "Website hero loop", aspect: "21:9", duration: 8 },
  { id: "tv", label: "In-store screen", aspect: "16:9", duration: 15 },
];

const LBL = "mb-1 block text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]";

function Pills<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${o.value === value ? "bg-[var(--admin-accent)] text-black" : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: string; help: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-[var(--admin-accent)]" />
      <span>
        <span className="block text-sm font-semibold text-[var(--admin-text)]">{label}</span>
        <span className="block text-[0.7rem] leading-snug text-[var(--admin-text-muted)]">{help}</span>
      </span>
    </label>
  );
}

export function VideoSettings({ value, onChange, keyframeCount }: { value: VideoUiSettings; onChange: (next: VideoUiSettings) => void; keyframeCount: number }) {
  const s = value;
  const set = <K extends keyof VideoUiSettings>(k: K, v: VideoUiSettings[K]) => onChange({ ...s, [k]: v });
  const generative = s.mode === "t2v" || s.mode === "i2v" || s.mode === "v2v";
  const maxSec = s.mode === "v2v" ? FLUX_V2V_MAX_SECONDS : FLUX_VIDEO_MAX_SECONDS;
  const seconds = s.duration === "auto" ? 0 : s.duration;

  const safety = (
    <div>
      <span className={LBL}>Safety tolerance · {s.safety}</span>
      <input type="range" min={0} max={FLUX_SAFETY_MAX} step={1} value={s.safety} onChange={(e) => set("safety", Number(e.target.value))} className="w-full accent-[var(--admin-accent)]" aria-label="Safety tolerance" />
      <p className="text-[0.68rem] text-[var(--admin-text-faint)]">0 strictest · {FLUX_SAFETY_MAX} most permissive · BFL default 2</p>
    </div>
  );

  if (s.mode === "edit") {
    return (
      <div className="space-y-4">
        <p className="text-xs text-[var(--admin-text-muted)]">Length, resolution, aspect ratio and audio follow the source clip (BFL pins them for edits).</p>
        {safety}
      </div>
    );
  }

  if (s.mode === "upscale") {
    return (
      <div className="space-y-4">
        <div>
          <span className={LBL}>Upscale factor · {s.upscaleFactor}×</span>
          <input type="range" min={1.5} max={3} step={0.25} value={s.upscaleFactor} onChange={(e) => set("upscaleFactor", Number(e.target.value))} className="w-full accent-[var(--admin-accent)]" aria-label="Upscale factor" />
          <p className="text-[0.68rem] text-[var(--admin-text-faint)]">Output keeps the source shape and is capped at 13.75 MP per frame.</p>
        </div>
        <div>
          <span className={LBL}>Mode</span>
          <Pills
            label="Upscale creativity"
            value={s.creativity}
            onChange={(v) => set("creativity", v)}
            options={[
              { value: 1, label: "Creative detail", title: "Adds fine detail (BFL default)" },
              { value: 0, label: "Precise", title: "Stays faithful to the source" },
            ]}
          />
        </div>
        {safety}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {generative && (
        <div>
          <span className={LBL}>Quick format</span>
          <div className="flex flex-wrap gap-1">
            {VIDEO_FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onChange({ ...s, aspect: f.aspect, duration: typeof f.duration === "number" ? Math.min(maxSec, f.duration) : f.duration })}
                className={`rounded-md border px-2 py-1 text-[0.7rem] font-semibold transition ${s.aspect === f.aspect && s.duration === f.duration ? "border-[var(--admin-accent)] text-[var(--admin-accent)]" : "border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <span className={LBL}>Aspect ratio</span>
        <Pills label="Aspect ratio" value={s.aspect} onChange={(v) => set("aspect", v)} options={FLUX_VIDEO_ASPECTS.map((a) => ({ value: a, label: a === "auto" ? "Auto" : a }))} />
        {s.aspect === "auto" && <p className="mt-1 text-[0.68rem] text-[var(--admin-text-faint)]">FLUX picks from the prompt and any images.</p>}
      </div>

      <div>
        <span className={LBL}>Duration · {s.duration === "auto" ? "Auto" : `${seconds}s`}</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-[var(--admin-text)]">
            <input type="checkbox" checked={s.duration === "auto"} onChange={(e) => set("duration", e.target.checked ? "auto" : Math.min(maxSec, 8))} className="accent-[var(--admin-accent)]" />
            Auto
          </label>
          <input
            type="range"
            min={FLUX_VIDEO_MIN_SECONDS}
            max={maxSec}
            step={1}
            value={seconds || 8}
            disabled={s.duration === "auto"}
            onChange={(e) => set("duration", Number(e.target.value))}
            className="w-full accent-[var(--admin-accent)] disabled:opacity-40"
            aria-label="Duration in seconds"
          />
        </div>
        {s.mode === "i2v" && keyframeCount >= 3 && !s.timedKeyframes && s.duration === "auto" && (
          <p className="mt-1 text-[0.7rem] text-[var(--admin-orange)]">3+ keyframes need a set duration. FLUX spaces them evenly across it.</p>
        )}
      </div>

      <div>
        <span className={LBL}>Resolution</span>
        <Pills label="Resolution" value={s.resolution} onChange={(v) => set("resolution", v)} options={FLUX_VIDEO_RESOLUTIONS.map((r) => ({ value: r.value, label: r.label, title: r.note }))} />
        <p className="mt-1 text-[0.68rem] text-[var(--admin-text-faint)]">
          {s.draft ? "Drafts always render at HD. You choose the final resolution when you enhance." : FLUX_VIDEO_RESOLUTIONS.find((r) => r.value === s.resolution)?.note}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle checked={s.draft} onChange={(v) => set("draft", v)} label="Draft first (recommended)" help="A fast HD preview for about a third of the cost. If you like it, press “Enhance draft” to render the same shot at full quality." />
        <Toggle checked={s.audio} onChange={(v) => set("audio", v)} label="Generate audio" help="Synchronised sound. Describe it in the prompt with an “Audio:” line." />
      </div>

      {s.mode === "i2v" && (
        <Toggle
          checked={s.timedKeyframes}
          onChange={(v) => set("timedKeyframes", v)}
          label="Set keyframe times myself"
          help="Pin each image to a second (e.g. 0 s, 3.5 s, 8 s). Off: 1 image = first frame, 2 = first + last, 3+ = evenly spaced."
        />
      )}

      {safety}
    </div>
  );
}
