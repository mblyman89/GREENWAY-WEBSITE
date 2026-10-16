"use client";

/**
 * R59-S1 — pro picture tools (Picture tab): one-click Looks (live thumbnails
 * of YOUR picture), then Adjust, Colour grade, Duotone, Finish (vignette,
 * grain, fade an edge, see-through over a backdrop colour) and Motion (Ken
 * Burns). Everything is non-destructive and previews live on the canvas.
 */
import type { CSSProperties, ReactNode } from "react";
import { BannerPicture } from "@/components/site/BannerPicture";
import { imageStyle, type BannerDesign } from "@/lib/cms/banner-design-core";
import {
  FADE_EDGES,
  IMAGE_BLENDS,
  IMAGE_LOOKS,
  KEN_BURNS,
  applyLook,
  currentLook,
  normalizeImageFx,
  type FadeEdge,
  type ImageBlend,
  type ImageFx,
  type KenBurns,
} from "@/lib/cms/banner-image-core";
import { isVideoSrc } from "@/lib/media/upload-policy-core";
import { ColorField, NumberSlider, Segmented, SelectField, Toggle } from "./controls";

function Group({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group rounded-md border border-white/10 p-2 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer select-none items-center justify-between text-[0.68rem] font-semibold uppercase tracking-wide text-white/60">
        {title}
        <span aria-hidden="true" className="transition-transform group-open:rotate-90">
          ›
        </span>
      </summary>
      <div className="mt-2 space-y-3">{children}</div>
    </details>
  );
}

export function ImageFxFields({ design, imageSrc, onChange }: { design: BannerDesign; imageSrc: string; onChange: (d: BannerDesign) => void }) {
  const im = design.image;
  const fx: ImageFx = im.fx ?? {};
  const setFx = (p: Partial<ImageFx>) => {
    const next = normalizeImageFx({ ...fx, ...p });
    const image = { ...im };
    if (next) image.fx = next;
    else delete image.fx;
    onChange({ ...design, image });
  };
  const look = currentLook(im);
  const video = imageSrc ? isVideoSrc(imageSrc) : false;

  return (
    <div className="space-y-2">
      <div>
        <p className="mb-1 text-[0.68rem] font-semibold uppercase tracking-wide text-white/60">Looks — one click</p>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
          {IMAGE_LOOKS.map((l) => {
            const preview = applyLook(im, l);
            const pd = { ...design, image: preview };
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={look === l.id}
                onClick={() => onChange({ ...design, image: applyLook(im, l) })}
                className={`overflow-hidden rounded-md border text-[0.6rem] ${look === l.id ? "border-[var(--admin-accent)] text-white" : "border-white/10 text-white/65 hover:border-white/30"}`}
              >
                <span className="relative block aspect-[4/3] bg-black/40">
                  {imageSrc && !video ? (
                    <BannerPicture fx={preview.fx ? { ...preview.fx, kb: undefined, fade: undefined } : undefined} className="absolute inset-0 overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element -- tiny editor thumbnail for any path/URL */}
                      <img src={imageSrc} alt="" loading="lazy" className="absolute inset-0 h-full w-full" style={imageStyle(pd) as unknown as CSSProperties} draggable={false} />
                    </BannerPicture>
                  ) : null}
                </span>
                <span className="block truncate px-1 py-0.5">{l.label}</span>
              </button>
            );
          })}
        </div>
        {look === null ? <p className="mt-1 text-[0.65rem] text-white/45">Custom look — your own settings below.</p> : null}
      </div>

      <Group title="Adjust" open>
        <NumberSlider label="Contrast" value={fx.contrast ?? 100} min={50} max={200} unit="%" onChange={(contrast) => setFx({ contrast })} />
        <NumberSlider label="Warmth" value={fx.warmth ?? 0} min={-100} max={100} onChange={(warmth) => setFx({ warmth })} hint="Left = cool blue, right = warm golden." />
        <NumberSlider label="Colour shift" value={fx.hue ?? 0} min={-180} max={180} unit="°" onChange={(hue) => setFx({ hue })} hint="Spins every colour round the colour wheel." />
        <NumberSlider label="Old photo (sepia)" value={fx.sepia ?? 0} min={0} max={100} unit="%" onChange={(sepia) => setFx({ sepia })} />
        <Toggle label="Flip picture upside down" checked={!!fx.flipY} onChange={(v) => setFx({ flipY: v ? true : undefined })} />
      </Group>

      <Group title="Colour grade">
        <Toggle label="Colour wash over the picture" checked={!!fx.tint} onChange={(v) => setFx({ tint: v ? { color: "#7ed957", blend: "soft-light", amount: 50 } : undefined })} />
        {fx.tint ? (
          <>
            <ColorField label="Wash colour" value={fx.tint.color} onChange={(color) => setFx({ tint: { ...fx.tint!, color } })} />
            <SelectField<ImageBlend>
              label={`Blend — ${IMAGE_BLENDS.find((b) => b.id === fx.tint!.blend)?.hint ?? ""}`}
              value={fx.tint.blend}
              options={IMAGE_BLENDS.map((b) => ({ value: b.id, label: b.label }))}
              onChange={(blend) => setFx({ tint: { ...fx.tint!, blend } })}
            />
            <NumberSlider label="Strength" value={fx.tint.amount} min={1} max={100} unit="%" onChange={(amount) => setFx({ tint: { ...fx.tint!, amount } })} />
          </>
        ) : null}
        <Toggle label="Duotone (two-colour poster look)" checked={!!fx.duo} onChange={(v) => setFx({ duo: v ? { dark: "#0b2015", light: "#7ed957" } : undefined })} />
        {fx.duo ? (
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="Shadows" value={fx.duo.dark} onChange={(dark) => setFx({ duo: { ...fx.duo!, dark } })} />
            <ColorField label="Highlights" value={fx.duo.light} onChange={(light) => setFx({ duo: { ...fx.duo!, light } })} />
          </div>
        ) : null}
      </Group>

      <Group title="Finish">
        <NumberSlider label="Vignette (dark corners)" value={fx.vignette ?? 0} min={0} max={100} unit="%" onChange={(vignette) => setFx({ vignette })} hint="Pulls the eye to the middle — great behind text." />
        {fx.vignette ? <ColorField label="Vignette colour" value={fx.vignetteColor ?? "#000000"} onChange={(vignetteColor) => setFx({ vignetteColor })} /> : null}
        <NumberSlider label="Film grain" value={fx.grain ?? 0} min={0} max={100} unit="%" onChange={(grain) => setFx({ grain })} />
        <NumberSlider label="Picture see-through" value={fx.opacity ?? 100} min={10} max={100} unit="%" onChange={(opacity) => setFx({ opacity })} hint="Lower = the backdrop colour shows through." />
        <Segmented<FadeEdge | "none">
          label="Fade an edge into the backdrop"
          value={fx.fade?.edge ?? "none"}
          options={[{ value: "none", label: "Off" }, ...FADE_EDGES.map((f) => ({ value: f.id, label: f.label }))]}
          onChange={(edge) => setFx({ fade: edge === "none" ? undefined : { edge, amount: fx.fade?.amount ?? 35 } })}
        />
        {fx.fade ? <NumberSlider label="Fade length" value={fx.fade.amount} min={5} max={70} unit="%" onChange={(amount) => setFx({ fade: { ...fx.fade!, amount } })} /> : null}
        {fx.opacity || fx.fade ? <ColorField label="Backdrop colour" value={fx.bg ?? "#1a1a1a"} onChange={(bg) => setFx({ bg })} /> : null}
      </Group>

      <Group title="Picture motion">
        <Segmented<KenBurns | "none">
          label="Slow cinematic move (Ken Burns)"
          value={fx.kb ?? "none"}
          options={[{ value: "none", label: "Still" }, ...KEN_BURNS.map((k) => ({ value: k.id, label: k.label }))]}
          onChange={(kb) => setFx({ kb: kb === "none" ? undefined : kb, kbSpeed: kb === "none" ? undefined : fx.kbSpeed })}
        />
        {fx.kb ? (
          <Segmented<"slow" | "normal" | "fast">
            label="Speed"
            value={fx.kbSpeed ?? "normal"}
            options={[
              { value: "slow", label: "Slower" },
              { value: "normal", label: "Normal" },
              { value: "fast", label: "Faster" },
            ]}
            onChange={(s) => setFx({ kbSpeed: s === "normal" ? undefined : s })}
          />
        ) : null}
        <p className="text-[0.65rem] text-white/45">Pauses when the slide isn’t showing and stays still for visitors who turn motion off.</p>
      </Group>

      {im.fx ? (
        <button type="button" className="text-xs text-white/60 underline" onClick={() => setFx({ contrast: undefined, hue: undefined, sepia: undefined, warmth: undefined, opacity: undefined, bg: undefined, flipY: undefined, tint: undefined, duo: undefined, vignette: undefined, vignetteColor: undefined, grain: undefined, fade: undefined, kb: undefined, kbSpeed: undefined })}>
          Reset all picture tools
        </button>
      ) : null}
    </div>
  );
}
