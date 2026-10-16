"use client";

/**
 * R59-S3 — "Start blank, then reveal": the banner starts as a solid colour,
 * gradient, picture/logo or frosted glass that the smoke plays over; after
 * the hold it leaves with one of 8 transitions and the real banner (with its
 * entrances) comes in. One-click recipes also add the matching smoke.
 */
import { INTRO_LIMITS, INTRO_OUTS, INTRO_PRESETS, introStyle, normalizeIntro, revealFor, type Intro, type IntroOut } from "@/lib/cms/banner-enter-core";
import { SMOKE_PRESETS, MAX_SMOKE_LAYERS, presetLayer } from "@/lib/cms/banner-atmos-core";
import { safeImageSrc, type BannerDesign } from "@/lib/cms/banner-design-core";
import type { MediaChoice } from "@/components/admin/ContentImageField";
import { isVideoSrc } from "@/lib/media/upload-policy-core";
import { ColorField, NumberSlider, Segmented, SelectField, Toggle } from "./controls";
import { studioReplay } from "./EnterFields";

const box = "space-y-3 rounded-md border border-white/10 p-2";
const hint = "text-[0.7rem] text-white/50";
const BRAND_PICS = [
  { url: "/brand/greenway-black-gold-logo-transparent.png", title: "Greenway logo (gold)" },
  { url: "/brand/greenway-marijuana-wordmark-transparent.png", title: "Greenway wordmark" },
  { url: "/brand/store-hours-open-transparent.png", title: "We're open sign" },
];

export function IntroFields({ design, onChange, mediaChoices = [] }: { design: BannerDesign; onChange: (d: BannerDesign) => void; mediaChoices?: MediaChoice[] }) {
  const it = design.intro;
  const set = (next: Intro | undefined, replay = true) => {
    onChange({ ...design, intro: next ? normalizeIntro(next, safeImageSrc) : undefined });
    if (replay && next) studioReplay();
  };
  const patch = (p: Partial<Intro>) => it && set({ ...it, ...p });
  const pics = [...BRAND_PICS, ...mediaChoices.filter((m) => !isVideoSrc(m.url) && !(m.mimeType ?? "").startsWith("video/") && safeImageSrc(m.url)).map((m) => ({ url: m.url, title: m.title || "Library picture" }))];

  function applyPreset(i: number) {
    const p = INTRO_PRESETS[i];
    const next: BannerDesign = { ...design, intro: p.intro };
    // Words wait for the curtain (auto), unless the owner set their own wait.
    delete next.reveal;
    const sp = SMOKE_PRESETS.find((s) => s.id === p.smoke);
    const layers = design.smoke ?? [];
    if (sp && !layers.length && layers.length < MAX_SMOKE_LAYERS) next.smoke = [presetLayer(sp, "smoke-1")];
    onChange(next);
    studioReplay();
  }

  return (
    <div className={box}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-white/80">🎬 Start blank, then reveal the banner</p>
        {it ? (
          <button type="button" onClick={studioReplay} className="rounded-full bg-[var(--admin-accent)] px-3 py-1 text-xs font-bold text-black">
            ▶ Play
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {INTRO_PRESETS.map((p, i) => (
          <button key={p.id} type="button" onClick={() => applyPreset(i)} className="flex items-center gap-2 rounded-md bg-white/5 px-2 py-2 text-left text-xs text-white/85 hover:bg-white/15">
            <span aria-hidden="true" className="h-6 w-8 shrink-0 rounded border border-white/20" style={introStyle({ ...p.intro, frost: undefined, opacity: undefined })} />
            {p.label}
          </button>
        ))}
      </div>
      <p className={hint}>
        The banner starts covered, the smoke plays over the cover, then the cover leaves and the words come in. A recipe adds its smoke only when the banner has none yet.
      </p>
      {!it ? (
        <button type="button" onClick={() => set({ color: "#000000", hold: 2, out: "smoke", dur: 1.4 })} className="rounded-full bg-white/10 px-3 py-1 text-xs text-white/85 hover:bg-white/20">
          + Start from a plain colour
        </button>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="Cover colour" value={it.color} onChange={(color) => patch({ color })} />
            {it.color2 ? <ColorField label="Blends into" value={it.color2} onChange={(color2) => patch({ color2 })} /> : null}
          </div>
          <Toggle label="Two-colour gradient" checked={!!it.color2} onChange={(on) => patch({ color2: on ? "#1f5130" : undefined, angle: undefined })} />
          {it.color2 ? <NumberSlider label="Gradient angle" value={it.angle ?? 180} min={0} max={359} unit="°" onChange={(angle) => patch({ angle })} /> : null}
          <NumberSlider
            label="Cover strength"
            value={it.opacity ?? 100}
            min={0}
            max={100}
            unit="%"
            onChange={(opacity) => patch({ opacity })}
            hint="Lower = the banner shows through (pair with frosted glass)."
          />
          <NumberSlider label="Frosted glass (blur the banner behind)" value={it.frost ?? 0} min={0} max={30} unit="px" onChange={(frost) => patch({ frost })} />
          <SelectField<string>
            label="Picture or logo on the cover"
            value={it.image ?? ""}
            options={[{ value: "", label: "None" }, ...(it.image && !pics.some((p) => p.url === it.image) ? [{ value: it.image, label: it.image }] : []), ...pics.map((p) => ({ value: p.url, label: p.title }))]}
            onChange={(v) => patch({ image: v || undefined, fit: v ? (it.fit ?? "contain") : undefined, size: undefined })}
          />
          {it.image ? (
            <>
              <Segmented<"cover" | "contain">
                label="Picture size"
                value={it.fit ?? "cover"}
                options={[
                  { value: "contain", label: "Centred (logo)" },
                  { value: "cover", label: "Fill the banner" },
                ]}
                onChange={(fit) => patch({ fit: fit === "contain" ? "contain" : undefined })}
              />
              {it.fit === "contain" ? <NumberSlider label="Logo width" value={it.size ?? 40} min={10} max={100} unit="%" onChange={(size) => patch({ size })} /> : null}
            </>
          ) : null}
          <NumberSlider label="Stay covered for" value={it.hold} min={INTRO_LIMITS.holdMin} max={INTRO_LIMITS.holdMax} step={0.1} unit="s" onChange={(hold) => patch({ hold })} />
          <SelectField<IntroOut> label="How the cover leaves" value={it.out} options={INTRO_OUTS.map((o) => ({ value: o.id, label: o.label }))} onChange={(out) => patch({ out })} />
          <NumberSlider label="Transition length" value={it.dur} min={INTRO_LIMITS.durMin} max={INTRO_LIMITS.durMax} step={0.1} unit="s" onChange={(dur) => patch({ dur })} />
          <p className={hint}>
            Words and buttons come in at {design.reveal ?? revealFor(it)}s {design.reveal ? "(your “fade in after” setting)" : "(as the cover is leaving)"}. Each item’s own ✨ Entrance plays from then on.
          </p>
          <button type="button" onClick={() => set(undefined, false)} className="text-xs text-red-300 underline">
            Remove the cover
          </button>
        </>
      )}
    </div>
  );
}
