"use client";

/**
 * ImageSettings — the FLUX image controls (R62). Mirrors the BFL Playground
 * (aspect ratio + custom, safety tolerance 0–5, output format, prompt
 * upsampling, number of images) and adds only verified per-model fields that
 * change the output: seed, size, FLUX 3 resolution tier + grounding, and
 * FLUX.2 [flex] guidance/steps. Fields a model doesn't accept are hidden.
 */
import {
  FLUX3_RESOLUTIONS,
  FLUX_ASPECTS,
  FLUX_COUNTS,
  FLUX_MEGAPIXELS,
  FLUX_MODELS,
  FLUX_SAFETY_MAX,
  closestFluxAspect,
  dimensionsForRatio,
  fluxModel,
  parseRatio,
  type FluxImageSettings,
  type FluxOutputFormat,
} from "@/lib/marketing/flux-core";
import { placementById, placementsByGroup } from "@/lib/marketing/creative-placements-core";

export type ImageUiSettings = {
  model: string;
  /** "auto" | preset ratio | "custom" | "exact" | "dest:<placementId>" */
  size: string;
  customRatio: string;
  exactW: number;
  exactH: number;
  megapixels: number;
  resolution: string;
  safety: number;
  format: FluxOutputFormat;
  upsampling: boolean;
  seed: string;
  count: number;
  grounding: boolean;
  guidance: number;
  steps: number;
};

export const DEFAULT_IMAGE_SETTINGS: ImageUiSettings = {
  model: "flux-2-max",
  size: "1:1",
  customRatio: "5:4",
  exactW: 1024,
  exactH: 1024,
  megapixels: 1,
  resolution: "1k",
  safety: 2,
  format: "jpeg",
  upsampling: true,
  seed: "",
  count: 1,
  grounding: true,
  guidance: 5,
  steps: 50,
};

/** Translate UI state into the core's request settings (no prompt/refs). */
export function toRequestSettings(s: ImageUiSettings): Omit<FluxImageSettings, "prompt" | "referenceImages"> {
  const m = fluxModel(s.model);
  const dest = s.size.startsWith("dest:") ? placementById(s.size.slice(5)) : null;
  let aspect = "auto";
  let width: number | undefined;
  let height: number | undefined;
  if (m.sizing === "tier") {
    if (dest) aspect = closestFluxAspect(dest.width, dest.height);
    else if (s.size === "exact") aspect = closestFluxAspect(s.exactW, s.exactH);
    else if (s.size === "custom") {
      const r = parseRatio(s.customRatio);
      aspect = r ? closestFluxAspect(r.w, r.h) : "auto";
    } else aspect = s.size;
  } else if (dest) {
    width = dest.width;
    height = dest.height;
  } else if (s.size === "exact") {
    width = s.exactW;
    height = s.exactH;
  } else aspect = s.size === "custom" ? s.customRatio : s.size;
  return {
    model: m.id,
    aspect,
    width,
    height,
    megapixels: s.megapixels,
    resolution: s.resolution,
    safetyTolerance: s.safety,
    outputFormat: s.format,
    promptUpsampling: s.upsampling,
    seed: s.seed.trim() === "" ? null : Number(s.seed),
    grounding: s.grounding,
    guidance: m.family === "flux2-flex" ? s.guidance : undefined,
    steps: m.family === "flux2-flex" ? s.steps : undefined,
    count: s.count,
  };
}

/** One-line size summary shown under the size picker. */
export function sizeSummary(s: ImageUiSettings): string {
  const r = toRequestSettings(s);
  const m = fluxModel(s.model);
  if (m.sizing === "tier") {
    const tier = FLUX3_RESOLUTIONS.find((x) => x.value === s.resolution)?.label ?? s.resolution;
    return r.aspect === "auto" ? `Aspect follows image 1 (or the prompt) · ${tier}` : `${r.aspect} · ${tier}`;
  }
  if (r.width && r.height) return `${r.width} × ${r.height}px · ${((r.width * r.height) / 1_048_576).toFixed(2)} MP`;
  if (r.aspect === "auto") return "Auto — FLUX picks the size (matches image 1 when you attach references)";
  const d = dimensionsForRatio(String(r.aspect), s.megapixels);
  return d ? `${d.width} × ${d.height}px · ${((d.width * d.height) / 1_048_576).toFixed(2)} MP` : "Enter a ratio like 5:4";
}

const LBL = "mb-1 block text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--admin-text-muted)]";
const CTL =
  "admin-focus w-full rounded-[var(--admin-radius)] border border-[var(--admin-border-strong)] bg-[var(--admin-surface-2)] px-2.5 py-1.5 text-sm text-[var(--admin-text)] outline-none focus:border-[var(--admin-accent)]";

function Pills<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-bold transition ${o.value === value ? "bg-[var(--admin-accent)] text-black" : "bg-[var(--admin-surface-2)] text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ImageSettings({ value, onChange }: { value: ImageUiSettings; onChange: (next: ImageUiSettings) => void }) {
  const s = value;
  const m = fluxModel(s.model);
  const set = <K extends keyof ImageUiSettings>(k: K, v: ImageUiSettings[K]) => onChange({ ...s, [k]: v });

  return (
    <div className="space-y-4">
      <div>
        <label className={LBL} htmlFor="flux-model">Model</label>
        <select id="flux-model" className={CTL} value={m.id} onChange={(e) => set("model", e.target.value)}>
          {FLUX_MODELS.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
        <p className="mt-1 text-[0.7rem] text-[var(--admin-text-faint)]">{m.note}</p>
      </div>

      <div>
        <label className={LBL} htmlFor="flux-size">Aspect ratio</label>
        <select id="flux-size" className={CTL} value={s.size} onChange={(e) => set("size", e.target.value)}>
          <option value="auto">Auto</option>
          {FLUX_ASPECTS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
          <option value="custom">Custom ratio…</option>
          {m.sizing === "pixels" && <option value="exact">Exact pixels…</option>}
          {placementsByGroup().map((g) => (
            <optgroup key={g.group} label={`Size for: ${g.label}`}>
              {g.placements.map((p) => (
                <option key={p.id} value={`dest:${p.id}`}>{p.label} · {p.width}×{p.height}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {s.size === "custom" && (
          <input className={`${CTL} mt-1.5`} value={s.customRatio} onChange={(e) => set("customRatio", e.target.value)} placeholder="W:H, e.g. 5:4 or 1920x1080" aria-label="Custom aspect ratio" />
        )}
        {s.size === "exact" && m.sizing === "pixels" && (
          <div className="mt-1.5 flex items-center gap-1.5">
            <input type="number" min={64} step={16} className={CTL} value={s.exactW} onChange={(e) => set("exactW", Number(e.target.value))} aria-label="Width in pixels" />
            <span className="text-xs text-[var(--admin-text-muted)]">×</span>
            <input type="number" min={64} step={16} className={CTL} value={s.exactH} onChange={(e) => set("exactH", Number(e.target.value))} aria-label="Height in pixels" />
          </div>
        )}
        <p className="mt-1 text-[0.7rem] text-[var(--admin-text-faint)]">{sizeSummary(s)}</p>
        {m.sizing === "tier" && (s.size === "custom" || s.size === "exact" || s.size.startsWith("dest:")) && (
          <p className="mt-0.5 text-[0.7rem] text-[var(--admin-orange)]">FLUX 3 uses fixed ratios — the closest one is used.</p>
        )}
      </div>

      {m.sizing === "pixels" && s.size !== "exact" && !s.size.startsWith("dest:") && s.size !== "auto" && (
        <div>
          <span className={LBL}>Size</span>
          <Pills label="Megapixels" value={s.megapixels} onChange={(v) => set("megapixels", v)} options={FLUX_MEGAPIXELS.map((x) => ({ value: x.value, label: x.label }))} />
        </div>
      )}
      {m.sizing === "tier" && (
        <div>
          <label className={LBL} htmlFor="flux-res">Resolution</label>
          <select id="flux-res" className={CTL} value={s.resolution} onChange={(e) => set("resolution", e.target.value)}>
            {FLUX3_RESOLUTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <span className={LBL}>Number of images</span>
        <Pills label="Number of images" value={s.count} onChange={(v) => set("count", v)} options={FLUX_COUNTS.map((c) => ({ value: c, label: String(c) }))} />
        <p className="mt-1 text-[0.7rem] text-[var(--admin-text-faint)]">Each image is a separate, separately-billed generation.</p>
      </div>

      <div>
        <label className={LBL} htmlFor="flux-safety">Safety tolerance: {s.safety}</label>
        <input id="flux-safety" type="range" min={0} max={FLUX_SAFETY_MAX} step={1} value={s.safety} onChange={(e) => set("safety", Number(e.target.value))} className="w-full accent-[var(--admin-accent)]" />
        <div className="flex justify-between text-[0.65rem] text-[var(--admin-text-faint)]">
          <span>0 strict</span>
          <span>default 2</span>
          <span>5 permissive</span>
        </div>
      </div>

      {m.formats.length > 0 && (
        <div>
          <span className={LBL}>Output format</span>
          <Pills label="Output format" value={s.format} onChange={(v) => set("format", v)} options={m.formats.map((f) => ({ value: f, label: f.toUpperCase() }))} />
        </div>
      )}

      {m.family !== "flux3" && (
        <label className="flex items-start gap-2 text-sm text-[var(--admin-text)]">
          <input type="checkbox" checked={s.upsampling} onChange={(e) => set("upsampling", e.target.checked)} className="mt-0.5 accent-[var(--admin-accent)]" />
          <span>
            Prompt upsampling
            <span className="block text-[0.7rem] text-[var(--admin-text-faint)]">On by default (like the Playground): FLUX enriches your prompt. Turn off to use it exactly as written.</span>
          </span>
        </label>
      )}
      {m.family === "flux3" && (
        <label className="flex items-start gap-2 text-sm text-[var(--admin-text)]">
          <input type="checkbox" checked={s.grounding} onChange={(e) => set("grounding", e.target.checked)} className="mt-0.5 accent-[var(--admin-accent)]" />
          <span>
            Grounding
            <span className="block text-[0.7rem] text-[var(--admin-text-faint)]">On by default: FLUX 3 can look up real-world facts for the prompt.</span>
          </span>
        </label>
      )}

      {m.family === "flux2-flex" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={LBL} htmlFor="flux-guidance">Guidance: {s.guidance}</label>
            <input id="flux-guidance" type="range" min={1.5} max={10} step={0.5} value={s.guidance} onChange={(e) => set("guidance", Number(e.target.value))} className="w-full accent-[var(--admin-accent)]" />
            <p className="text-[0.65rem] text-[var(--admin-text-faint)]">Higher follows the prompt more strictly (default 5).</p>
          </div>
          <div>
            <label className={LBL} htmlFor="flux-steps">Steps: {s.steps}</label>
            <input id="flux-steps" type="range" min={1} max={50} step={1} value={s.steps} onChange={(e) => set("steps", Number(e.target.value))} className="w-full accent-[var(--admin-accent)]" />
            <p className="text-[0.65rem] text-[var(--admin-text-faint)]">More = finer detail, slower (default 50).</p>
          </div>
        </div>
      )}

      {m.seed && (
        <div>
          <label className={LBL} htmlFor="flux-seed">Seed (optional)</label>
          <div className="flex gap-1.5">
            <input id="flux-seed" inputMode="numeric" className={CTL} value={s.seed} onChange={(e) => set("seed", e.target.value.replace(/[^0-9]/g, "").slice(0, 10))} placeholder="Random" />
            <button type="button" onClick={() => set("seed", String(Math.floor(Math.random() * 4_294_967_295)))} className="rounded-md bg-[var(--admin-surface-2)] px-2.5 text-xs font-bold text-[var(--admin-text-muted)] hover:text-[var(--admin-text)]" title="Random seed">🎲</button>
          </div>
          <p className="mt-1 text-[0.7rem] text-[var(--admin-text-faint)]">Same seed + same settings ≈ same image. With several images, each uses the next seed.</p>
        </div>
      )}
    </div>
  );
}
